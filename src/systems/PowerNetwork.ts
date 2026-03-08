import { GameNode } from '../entities/Node';
import { CommandHub } from '../entities/CommandHub';
import { PowerRelay } from '../entities/support/PowerRelay';
import { PowerLink } from '../entities/PowerLink';
import { MAX_POWER_LINK_LENGTH } from '../utils/Constants';
import { distanceBetween } from '../utils/Helpers';

export class PowerNetwork {
    private adjacency: Map<GameNode, Set<GameNode>> = new Map();
    private links: PowerLink[] = [];
    private hub: CommandHub | null = null;
    private bfsDistances: Map<GameNode, number> = new Map();
    private scene: Phaser.Scene | null = null;

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
                        // Only continue traversal through fully constructed nodes
                        // Constructing nodes are reachable (draw power) but not conduits
                        if (neighbor.isFullyConstructed()) {
                            queue.push({ node: neighbor, distance: distance + 1 });
                        }
                    }
                }
            }
        }

        // Update node states
        for (const node of this.adjacency.keys()) {
            if (node === this.hub) continue;
            if (!node.isFullyConstructed()) {
                node.setNodeState('constructing');
            } else if (visited.has(node)) {
                node.setNodeState('online');
            } else {
                node.setNodeState('offline');
            }
        }

        // Update power distribution
        this.updatePowerDistribution();

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

        // A node is a "consumer" if it's not a fully-built relay and not the hub
        // Trace each consumer back to the hub, marking all nodes on the path as power-carrying
        const powerCarrying = new Set<GameNode>();
        for (const node of visited) {
            if (node === this.hub) continue;
            const isPassiveConduit = node instanceof PowerRelay && node.isFullyConstructed();
            if (!isPassiveConduit) {
                // Trace back to hub
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
            // Show pulses only on links where both endpoints are on a power-carrying path
            const aCarries = powerCarrying.has(link.getNodeA()) || link.getNodeA() === this.hub;
            const bCarries = powerCarrying.has(link.getNodeB()) || link.getNodeB() === this.hub;
            link.setShowPulses(aCarries && bCarries);
        }
    }

    private updatePowerDistribution(): void {
        if (!this.hub) return;

        const totalGeneration = this.hub.powerGeneration;
        let totalConsumption = 0;

        // Collect connected nodes with their distances
        const connectedNodes: Array<{ node: GameNode; distance: number }> = [];
        for (const [node, distance] of this.bfsDistances) {
            if (node === this.hub) continue;
            if (node.nodeState !== 'offline') {
                connectedNodes.push({ node, distance });
                totalConsumption += node.powerConsumption;
            }
        }

        if (totalConsumption <= totalGeneration) {
            // All connected nodes are fine
            for (const { node } of connectedNodes) {
                // Don't overwrite constructing state — it still needs to finish building
                if (node.nodeState === 'brownout') {
                    node.setNodeState('online');
                }
            }
            return;
        }

        // Over budget — brown out furthest nodes first
        connectedNodes.sort((a, b) => b.distance - a.distance);

        let remaining = totalConsumption;
        for (const { node } of connectedNodes) {
            // Don't overwrite constructing state
            if (node.nodeState === 'constructing') continue;
            if (remaining <= totalGeneration) {
                node.setNodeState('online');
            } else {
                node.setNodeState('brownout');
                remaining -= node.powerConsumption;
            }
        }
    }

    getPowerUsage(): number {
        let total = 0;
        for (const [node] of this.bfsDistances) {
            if (node !== this.hub && node.nodeState !== 'offline' && node.nodeState !== 'constructing') {
                total += node.powerConsumption;
            }
        }
        return total;
    }

    getPowerCapacity(): number {
        return this.hub?.powerGeneration ?? 0;
    }

    update(): void {
        // Animate links
        for (const link of this.links) {
            link.animate();
        }
    }
}
