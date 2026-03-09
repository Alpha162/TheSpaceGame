import { GameNode } from '../entities/Node';
import { CommandHub } from '../entities/CommandHub';
import { PowerRelay } from '../entities/support/PowerRelay';
import { Capacitor } from '../entities/support/Capacitor';
import { Shield } from '../entities/defence/Shield';
import { Blaster } from '../entities/turrets/Blaster';
import { PowerLink } from '../entities/PowerLink';
import { MAX_POWER_LINK_LENGTH, POWER_TICK_INTERVAL_MS, PowerPriority } from '../utils/Constants';
import { distanceBetween } from '../utils/Helpers';

interface IslandSubNetwork {
    nodes: Set<GameNode>;
    capacitors: Capacitor[];
    distances: Map<GameNode, number>;
}

export class PowerNetwork {
    private adjacency: Map<GameNode, Set<GameNode>> = new Map();
    private links: PowerLink[] = [];
    private hub: CommandHub | null = null;
    private bfsDistances: Map<GameNode, number> = new Map();
    private scene: Phaser.Scene | null = null;
    private islandSubNetworks: IslandSubNetwork[] = [];

    // Tick-based power economy state
    private tickAccumulator = 0;
    private _totalGeneration = 0;
    private _totalDemand = 0;
    private _capacitorStored = 0;
    private _capacitorMax = 0;
    private _capacitorDischarging = 0; // power discharged from capacitors this tick

    setHub(hub: CommandHub): void {
        this.hub = hub;
        this.scene = hub.scene;
        this.adjacency.set(hub, new Set());
        this.updateConnectivity();
    }

    getHub(): CommandHub | null {
        return this.hub;
    }

    getAllNodes(): GameNode[] {
        return Array.from(this.adjacency.keys());
    }

    getLinks(): PowerLink[] {
        return this.links;
    }

    getBfsDistances(): Map<GameNode, number> {
        return this.bfsDistances;
    }

    // Power economy getters for HUD
    get totalGeneration(): number { return this._totalGeneration; }
    get totalDemand(): number { return this._totalDemand; }
    get capacitorStored(): number { return this._capacitorStored; }
    get capacitorMax(): number { return this._capacitorMax; }
    get capacitorDischarging(): number { return this._capacitorDischarging; }

    addNode(node: GameNode): PowerLink[] {
        if (this.adjacency.has(node)) return [];
        this.adjacency.set(node, new Set());

        // Auto-connect to nearby nodes
        const newLinks: PowerLink[] = [];
        for (const existing of this.adjacency.keys()) {
            if (existing === node) continue;
            const dist = distanceBetween(node.x, node.y, existing.x, existing.y);
            if (dist <= MAX_POWER_LINK_LENGTH) {
                this.addLink(node, existing);
                if (this.scene) {
                    const link = new PowerLink(this.scene, node, existing);
                    this.links.push(link);
                    newLinks.push(link);
                }
            }
        }

        this.updateConnectivity();
        return newLinks;
    }

    removeNode(node: GameNode): void {
        const neighbors = this.adjacency.get(node);
        if (neighbors) {
            for (const neighbor of neighbors) {
                this.adjacency.get(neighbor)?.delete(node);
            }
        }
        this.adjacency.delete(node);

        // Remove associated links
        this.links = this.links.filter(link => {
            if (link.connects(node)) {
                link.destroy();
                return false;
            }
            return true;
        });

        this.updateConnectivity();
    }

    private addLink(a: GameNode, b: GameNode): void {
        this.adjacency.get(a)?.add(b);
        this.adjacency.get(b)?.add(a);
    }

    updateConnectivity(): void {
        if (!this.hub) return;

        // Phase 1: BFS from hub — traverse through fully constructed nodes, and reach
        // (but don't traverse through) constructing nodes so they can draw power
        this.bfsDistances.clear();
        const hubVisited = new Set<GameNode>();
        const queue: Array<{ node: GameNode; distance: number }> = [{ node: this.hub, distance: 0 }];
        hubVisited.add(this.hub);
        this.bfsDistances.set(this.hub, 0);

        while (queue.length > 0) {
            const { node, distance } = queue.shift()!;
            const neighbors = this.adjacency.get(node);
            if (neighbors) {
                for (const neighbor of neighbors) {
                    if (!hubVisited.has(neighbor)) {
                        hubVisited.add(neighbor);
                        this.bfsDistances.set(neighbor, distance + 1);
                        if (neighbor.isFullyConstructed()) {
                            queue.push({ node: neighbor, distance: distance + 1 });
                        }
                    }
                }
            }
        }

        // Phase 2: Find disconnected sub-networks with charged capacitors
        // These "island" networks can sustain themselves from stored energy
        this.islandSubNetworks = [];
        const allVisited = new Set<GameNode>(hubVisited);

        for (const node of this.adjacency.keys()) {
            if (allVisited.has(node) || !node.isFullyConstructed()) continue;

            // BFS to find this disconnected component
            const component = new Set<GameNode>();
            const componentQueue: GameNode[] = [node];
            component.add(node);
            allVisited.add(node);
            const componentCapacitors: Capacitor[] = [];

            while (componentQueue.length > 0) {
                const current = componentQueue.shift()!;
                if (current instanceof Capacitor && current.currentStorage > 0) {
                    componentCapacitors.push(current);
                }
                const neighbors = this.adjacency.get(current);
                if (neighbors) {
                    for (const neighbor of neighbors) {
                        if (!allVisited.has(neighbor) && neighbor.isFullyConstructed()) {
                            allVisited.add(neighbor);
                            component.add(neighbor);
                            componentQueue.push(neighbor);
                        }
                    }
                }
            }

            // Only keep this island if it has charged capacitors
            if (componentCapacitors.length > 0) {
                // BFS from capacitors to assign distances within the island
                const islandDistances = new Map<GameNode, number>();
                const islandQueue: Array<{ node: GameNode; distance: number }> = [];
                for (const cap of componentCapacitors) {
                    islandDistances.set(cap, 0);
                    islandQueue.push({ node: cap, distance: 0 });
                }
                while (islandQueue.length > 0) {
                    const { node: n, distance: d } = islandQueue.shift()!;
                    const neighbors = this.adjacency.get(n);
                    if (neighbors) {
                        for (const neighbor of neighbors) {
                            if (component.has(neighbor) && !islandDistances.has(neighbor)) {
                                islandDistances.set(neighbor, d + 1);
                                islandQueue.push({ node: neighbor, distance: d + 1 });
                            }
                        }
                    }
                }

                // Merge island distances into main bfsDistances (offset to distinguish from hub)
                for (const [n, d] of islandDistances) {
                    this.bfsDistances.set(n, d);
                }

                this.islandSubNetworks.push({
                    nodes: component,
                    capacitors: componentCapacitors,
                    distances: islandDistances
                });
            }
        }

        // Collect all powered nodes (hub-connected + island-powered)
        const allPowered = new Set<GameNode>(hubVisited);
        for (const island of this.islandSubNetworks) {
            for (const n of island.nodes) {
                allPowered.add(n);
            }
        }

        // Update node states
        for (const node of this.adjacency.keys()) {
            if (node === this.hub) continue;
            if (!node.isFullyConstructed()) {
                node.setNodeState('constructing');
                node.constructionPowered = hubVisited.has(node);
            } else if (allPowered.has(node)) {
                node.setNodeState('online');
            } else {
                node.setNodeState('offline');
            }
        }

        // Run power distribution immediately after connectivity change
        this.runPowerDistribution();

        // Update link visuals
        this.updateLinkVisuals(allPowered);
    }

    private updateLinkVisuals(visited: Set<GameNode>): void {
        if (!this.hub) return;

        // Build BFS tree parent map for tracing paths back to hub
        const parent = new Map<GameNode, GameNode>();
        const bfsQueue: Array<{ node: GameNode; distance: number }> = [{ node: this.hub, distance: 0 }];
        const bfsVisited = new Set<GameNode>([this.hub]);
        while (bfsQueue.length > 0) {
            const { node, distance } = bfsQueue.shift()!;
            const neighbors = this.adjacency.get(node);
            if (neighbors) {
                for (const neighbor of neighbors) {
                    if (!bfsVisited.has(neighbor) && visited.has(neighbor)) {
                        bfsVisited.add(neighbor);
                        parent.set(neighbor, node);
                        if (neighbor.isFullyConstructed()) {
                            bfsQueue.push({ node: neighbor, distance: distance + 1 });
                        }
                    }
                }
            }
        }

        // Also build parent maps for island sub-networks (BFS from capacitors)
        for (const island of this.islandSubNetworks) {
            const islandVisited = new Set<GameNode>();
            const islandQueue: Array<{ node: GameNode; distance: number }> = [];
            for (const cap of island.capacitors) {
                islandVisited.add(cap);
                islandQueue.push({ node: cap, distance: 0 });
            }
            while (islandQueue.length > 0) {
                const { node, distance } = islandQueue.shift()!;
                const neighbors = this.adjacency.get(node);
                if (neighbors) {
                    for (const neighbor of neighbors) {
                        if (!islandVisited.has(neighbor) && island.nodes.has(neighbor)) {
                            islandVisited.add(neighbor);
                            parent.set(neighbor, node);
                            islandQueue.push({ node: neighbor, distance: distance + 1 });
                        }
                    }
                }
            }
        }

        // Trace consumers to source for power-carrying paths
        const powerCarrying = new Set<GameNode>();
        for (const node of visited) {
            if (node === this.hub) continue;
            const isPassiveConduit = node instanceof PowerRelay && node.isFullyConstructed();
            const isIdleNode = node.nodeState === 'online' && node.getCurrentPowerDraw() === 0;
            if (!isPassiveConduit && !isIdleNode) {
                let current: GameNode | undefined = node;
                while (current && !powerCarrying.has(current)) {
                    powerCarrying.add(current);
                    current = parent.get(current);
                }
            }
        }

        // Build set of island capacitors (they act as power sources like the hub)
        const powerSources = new Set<GameNode>();
        powerSources.add(this.hub);
        for (const island of this.islandSubNetworks) {
            for (const cap of island.capacitors) {
                powerSources.add(cap);
            }
        }

        // Update link visuals and flow direction
        // Only show pulses on BFS tree edges (parent-child) that carry power
        for (const link of this.links) {
            link.setFlowDirection(this.bfsDistances);
            link.updateState(visited);

            const a = link.getNodeA();
            const b = link.getNodeB();
            const isTreeEdge = parent.get(a) === b || parent.get(b) === a;
            const aCarries = powerCarrying.has(a) || powerSources.has(a);
            const bCarries = powerCarrying.has(b) || powerSources.has(b);
            link.setShowPulses(isTreeEdge && aCarries && bCarries);
        }
    }

    /**
     * Priority-based tick power distribution.
     * 1. Calculate total generation (hub + future generators)
     * 2. Distribute to each priority tier in order
     * 3. Within each tier, if budget insufficient, brown out furthest nodes first
     * 4. Capacitors discharge to fill shortfalls in higher tiers
     * 5. Excess generation charges capacitors
     * 6. Island sub-networks powered entirely by capacitor discharge
     */
    private runPowerDistribution(): void {
        if (!this.hub) return;

        // Build set of island nodes for filtering
        const islandNodeSet = new Set<GameNode>();
        for (const island of this.islandSubNetworks) {
            for (const n of island.nodes) islandNodeSet.add(n);
        }

        // Total generation available this tick
        this._totalGeneration = this.hub.powerGeneration;
        let availablePower = this._totalGeneration;

        // Gather hub-connected online/brownout nodes grouped by priority
        const tiers: Map<PowerPriority, Array<{ node: GameNode; distance: number; draw: number }>> = new Map();
        const hubCapacitors: Capacitor[] = [];

        for (const [node, distance] of this.bfsDistances) {
            if (node === this.hub) continue;
            if (islandNodeSet.has(node)) continue; // handled separately
            if (node.nodeState === 'offline' || node.nodeState === 'constructing') continue;

            if (node instanceof Capacitor) {
                hubCapacitors.push(node);
            }

            const priority = node.powerPriority;
            if (!tiers.has(priority)) tiers.set(priority, []);
            tiers.get(priority)!.push({
                node,
                distance,
                draw: node.getCurrentPowerDraw()
            });
        }

        // Track total demand (hub + islands)
        this._totalDemand = 0;
        for (const tier of tiers.values()) {
            for (const entry of tier) {
                this._totalDemand += entry.draw;
            }
        }

        // Update capacitor stats (all capacitors across hub and islands)
        this._capacitorStored = 0;
        this._capacitorMax = 0;
        this._capacitorDischarging = 0;
        for (const cap of hubCapacitors) {
            this._capacitorStored += cap.currentStorage;
            this._capacitorMax += cap.maxStorage;
        }

        // Distribute hub power tier by tier (CRITICAL first, then HIGH, NORMAL, LOW)
        const priorityOrder = [
            PowerPriority.CRITICAL,
            PowerPriority.HIGH,
            PowerPriority.NORMAL,
            PowerPriority.LOW
        ];

        for (const priority of priorityOrder) {
            const tier = tiers.get(priority);
            if (!tier || tier.length === 0) continue;

            const tierDemand = tier.reduce((sum, e) => sum + e.draw, 0);

            if (tierDemand <= availablePower) {
                for (const entry of tier) {
                    if (entry.node.nodeState === 'brownout') {
                        entry.node.setNodeState('online');
                    }
                    if (entry.node instanceof Capacitor && entry.draw > 0) {
                        entry.node.charge(entry.draw);
                    }
                }
                availablePower -= tierDemand;
            } else {
                let shortfall = tierDemand - availablePower;

                if (priority !== PowerPriority.LOW && hubCapacitors.length > 0) {
                    for (const cap of hubCapacitors) {
                        if (shortfall <= 0) break;
                        const discharged = cap.discharge(shortfall);
                        shortfall -= discharged;
                        this._capacitorDischarging += discharged;
                    }
                }

                const effectivePower = tierDemand - shortfall;

                if (effectivePower >= tierDemand) {
                    for (const entry of tier) {
                        if (entry.node.nodeState === 'brownout') {
                            entry.node.setNodeState('online');
                        }
                    }
                } else {
                    tier.sort((a, b) => b.distance - a.distance);
                    let remaining = tierDemand;
                    for (const entry of tier) {
                        if (remaining <= effectivePower) {
                            entry.node.setNodeState('online');
                        } else {
                            entry.node.setNodeState('brownout');
                            remaining -= entry.draw;
                        }
                    }
                }

                availablePower = 0;
            }
        }

        // Phase 2: Distribute power within island sub-networks using capacitor discharge
        for (const island of this.islandSubNetworks) {
            // Gather island nodes by priority
            const islandTiers: Map<PowerPriority, Array<{ node: GameNode; distance: number; draw: number }>> = new Map();
            let islandDemand = 0;

            for (const node of island.nodes) {
                if (node.nodeState === 'offline' || node.nodeState === 'constructing') continue;
                if (node instanceof Capacitor) continue; // capacitors power the island, don't draw

                const distance = island.distances.get(node) ?? 0;
                const draw = node.getCurrentPowerDraw();
                islandDemand += draw;

                const priority = node.powerPriority;
                if (!islandTiers.has(priority)) islandTiers.set(priority, []);
                islandTiers.get(priority)!.push({ node, distance, draw });
            }

            this._totalDemand += islandDemand;

            // Discharge capacitors to meet island demand
            let islandPower = 0;
            for (const cap of island.capacitors) {
                this._capacitorStored += cap.currentStorage;
                this._capacitorMax += cap.maxStorage;

                const discharged = cap.discharge(islandDemand - islandPower);
                islandPower += discharged;
                this._capacitorDischarging += discharged;
                if (islandPower >= islandDemand) break;
            }

            // Distribute island power tier by tier
            let islandAvailable = islandPower;
            for (const priority of priorityOrder) {
                const tier = islandTiers.get(priority);
                if (!tier || tier.length === 0) continue;

                const tierDemand = tier.reduce((sum, e) => sum + e.draw, 0);

                if (tierDemand <= islandAvailable) {
                    for (const entry of tier) {
                        if (entry.node.nodeState === 'brownout') {
                            entry.node.setNodeState('online');
                        }
                    }
                    islandAvailable -= tierDemand;
                } else {
                    // Not enough — brown out furthest first
                    tier.sort((a, b) => b.distance - a.distance);
                    let remaining = tierDemand;
                    for (const entry of tier) {
                        if (remaining <= islandAvailable) {
                            entry.node.setNodeState('online');
                        } else {
                            entry.node.setNodeState('brownout');
                            remaining -= entry.draw;
                        }
                    }
                    islandAvailable = 0;
                }
            }

            // If no power available at all, island nodes go offline
            if (islandPower <= 0) {
                for (const node of island.nodes) {
                    if (node.nodeState !== 'constructing') {
                        node.setNodeState('offline');
                    }
                }
            }
        }

        // Update capacitor stored totals after all discharge
        this._capacitorStored = 0;
        for (const node of this.adjacency.keys()) {
            if (node instanceof Capacitor) {
                this._capacitorStored += node.currentStorage;
                // Ensure capacitorMax includes all capacitors
            }
        }
        this._capacitorMax = 0;
        for (const node of this.adjacency.keys()) {
            if (node instanceof Capacitor && node.isFullyConstructed()) {
                this._capacitorMax += node.maxStorage;
            }
        }
    }

    getPowerUsage(): number {
        return this._totalDemand;
    }

    getPowerCapacity(): number {
        return this._totalGeneration;
    }

    update(delta: number): void {
        // Animate links every frame
        for (const link of this.links) {
            link.animate();
        }

        // Update hub built-in shield
        if (this.hub) {
            this.hub.updateHubShield(delta);
        }

        // Update shield visuals every frame
        // First, collect all active shields and set up sibling references for merging
        const activeShields: Shield[] = [];
        for (const node of this.adjacency.keys()) {
            if (node instanceof Shield && node.isFullyConstructed() && node.bubbleRadius > 0) {
                activeShields.push(node);
            }
        }
        for (const shield of activeShields) {
            shield.siblingShields = activeShields.filter(s => s !== shield);
        }
        for (const node of this.adjacency.keys()) {
            if (node instanceof Shield && node.isFullyConstructed()) {
                node.update(0, delta);
            }
        }

        // Update blaster turrets every frame
        for (const node of this.adjacency.keys()) {
            if (node instanceof Blaster && node.isFullyConstructed()) {
                node.update(0, delta);
            }
        }

        // Power tick at fixed interval
        this.tickAccumulator += delta;
        if (this.tickAccumulator >= POWER_TICK_INTERVAL_MS) {
            this.tickAccumulator -= POWER_TICK_INTERVAL_MS;
            this.powerTick();
        }
    }

    private powerTick(): void {
        if (!this.hub) return;

        // Let nodes do per-tick behaviour
        for (const node of this.adjacency.keys()) {
            if (node === this.hub) continue;
            if (node.nodeState === 'online') {
                node.onPowerTick(POWER_TICK_INTERVAL_MS);
            }
        }

        // Recalculate power distribution (also re-evaluates island sub-networks
        // since capacitor charge changes each tick)
        this.updateConnectivity();
    }
}
