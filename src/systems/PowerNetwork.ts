import { GameNode } from '../entities/Node';
import { CommandHub } from '../entities/CommandHub';
import { PowerRelay } from '../entities/support/PowerRelay';
import { Capacitor } from '../entities/support/Capacitor';
import { Shield } from '../entities/defence/Shield';
import { PowerLink } from '../entities/PowerLink';
import { MAX_POWER_LINK_LENGTH, POWER_TICK_INTERVAL_MS, PowerPriority } from '../utils/Constants';
import { distanceBetween } from '../utils/Helpers';

export class PowerNetwork {
    private adjacency: Map<GameNode, Set<GameNode>> = new Map();
    private links: PowerLink[] = [];
    private hub: CommandHub | null = null;
    private bfsDistances: Map<GameNode, number> = new Map();
    private scene: Phaser.Scene | null = null;

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

        // BFS from hub — traverse through fully constructed nodes, and reach
        // (but don't traverse through) constructing nodes so they can draw power
        this.bfsDistances.clear();
        const visited = new Set<GameNode>();
        const queue: Array<{ node: GameNode; distance: number }> = [{ node: this.hub, distance: 0 }];
        visited.add(this.hub);
        this.bfsDistances.set(this.hub, 0);

        while (queue.length > 0) {
            const { node, distance } = queue.shift()!;
            const neighbors = this.adjacency.get(node);
            if (neighbors) {
                for (const neighbor of neighbors) {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        this.bfsDistances.set(neighbor, distance + 1);
                        if (neighbor.isFullyConstructed()) {
                            queue.push({ node: neighbor, distance: distance + 1 });
                        }
                    }
                }
            }
        }

        // Update node states (connectivity only — power distribution happens in tick)
        for (const node of this.adjacency.keys()) {
            if (node === this.hub) continue;
            if (!node.isFullyConstructed()) {
                node.setNodeState('constructing');
                node.constructionPowered = visited.has(node);
            } else if (visited.has(node)) {
                // Mark as online initially; power tick will set brownout if needed
                if (node.nodeState === 'offline') {
                    node.setNodeState('online');
                }
            } else {
                node.setNodeState('offline');
            }
        }

        // Run power distribution immediately after connectivity change
        this.runPowerDistribution();

        // Update link visuals
        this.updateLinkVisuals(visited);
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

        // Trace consumers to hub for power-carrying paths
        const powerCarrying = new Set<GameNode>();
        for (const node of visited) {
            if (node === this.hub) continue;
            const isPassiveConduit = node instanceof PowerRelay && node.isFullyConstructed();
            if (!isPassiveConduit) {
                let current: GameNode | undefined = node;
                while (current && !powerCarrying.has(current)) {
                    powerCarrying.add(current);
                    current = parent.get(current);
                }
            }
        }

        // Update link visuals and flow direction
        for (const link of this.links) {
            link.setFlowDirection(this.bfsDistances);
            link.updateState(visited);
            const aCarries = powerCarrying.has(link.getNodeA()) || link.getNodeA() === this.hub;
            const bCarries = powerCarrying.has(link.getNodeB()) || link.getNodeB() === this.hub;
            link.setShowPulses(aCarries && bCarries);
        }
    }

    /**
     * Priority-based tick power distribution.
     * 1. Calculate total generation (hub + future generators)
     * 2. Distribute to each priority tier in order
     * 3. Within each tier, if budget insufficient, brown out furthest nodes first
     * 4. Capacitors discharge to fill shortfalls in higher tiers
     * 5. Excess generation charges capacitors
     */
    private runPowerDistribution(): void {
        if (!this.hub) return;

        // Total generation available this tick
        this._totalGeneration = this.hub.powerGeneration;
        let availablePower = this._totalGeneration;

        // Gather all connected online/brownout nodes grouped by priority
        const tiers: Map<PowerPriority, Array<{ node: GameNode; distance: number; draw: number }>> = new Map();
        const capacitors: Capacitor[] = [];

        for (const [node, distance] of this.bfsDistances) {
            if (node === this.hub) continue;
            if (node.nodeState === 'offline' || node.nodeState === 'constructing') continue;

            if (node instanceof Capacitor) {
                capacitors.push(node);
            }

            const priority = node.powerPriority;
            if (!tiers.has(priority)) tiers.set(priority, []);
            tiers.get(priority)!.push({
                node,
                distance,
                draw: node.getCurrentPowerDraw()
            });
        }

        // Track total demand
        this._totalDemand = 0;
        for (const tier of tiers.values()) {
            for (const entry of tier) {
                this._totalDemand += entry.draw;
            }
        }

        // Update capacitor stats
        this._capacitorStored = 0;
        this._capacitorMax = 0;
        this._capacitorDischarging = 0;
        for (const cap of capacitors) {
            this._capacitorStored += cap.currentStorage;
            this._capacitorMax += cap.maxStorage;
        }

        // Distribute power tier by tier (CRITICAL first, then HIGH, NORMAL, LOW)
        const priorityOrder = [
            PowerPriority.CRITICAL,
            PowerPriority.HIGH,
            PowerPriority.NORMAL,
            PowerPriority.LOW
        ];

        for (const priority of priorityOrder) {
            const tier = tiers.get(priority);
            if (!tier || tier.length === 0) continue;

            // Calculate total demand for this tier
            const tierDemand = tier.reduce((sum, e) => sum + e.draw, 0);

            if (tierDemand <= availablePower) {
                // Enough power — all nodes in this tier are online
                for (const entry of tier) {
                    if (entry.node.nodeState === 'brownout') {
                        entry.node.setNodeState('online');
                    }
                    // Charge capacitors with allocated power
                    if (entry.node instanceof Capacitor && entry.draw > 0) {
                        entry.node.charge(entry.draw);
                    }
                }
                availablePower -= tierDemand;
            } else {
                // Not enough from generation alone — try discharging capacitors
                // (but only for tiers above LOW, since capacitors ARE low tier)
                let shortfall = tierDemand - availablePower;

                if (priority !== PowerPriority.LOW && capacitors.length > 0) {
                    for (const cap of capacitors) {
                        if (shortfall <= 0) break;
                        const discharged = cap.discharge(shortfall);
                        shortfall -= discharged;
                        this._capacitorDischarging += discharged;
                    }
                }

                const effectivePower = tierDemand - shortfall;

                if (effectivePower >= tierDemand) {
                    // Capacitors filled the gap — all online
                    for (const entry of tier) {
                        if (entry.node.nodeState === 'brownout') {
                            entry.node.setNodeState('online');
                        }
                    }
                } else {
                    // Still not enough — brown out furthest nodes first within this tier
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

                availablePower = 0; // all generation consumed
            }
        }

        // Update capacitor stored totals after discharge
        this._capacitorStored = 0;
        for (const cap of capacitors) {
            this._capacitorStored += cap.currentStorage;
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

        // Update shield visuals every frame
        for (const node of this.adjacency.keys()) {
            if (node instanceof Shield && node.isFullyConstructed()) {
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

        // Recalculate power distribution
        this.runPowerDistribution();

        // Re-gather visited for link visuals
        const visited = new Set<GameNode>();
        for (const node of this.bfsDistances.keys()) {
            visited.add(node);
        }
        this.updateLinkVisuals(visited);
    }
}
