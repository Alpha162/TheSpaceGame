import { GameNode } from '../entities/Node';
import { CommandHub } from '../entities/CommandHub';
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

        // BFS from hub — only traverse through fully constructed nodes (or the hub itself)
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
                    if (!visited.has(neighbor) && neighbor.isFullyConstructed()) {
                        visited.add(neighbor);
                        this.bfsDistances.set(neighbor, distance + 1);
                        queue.push({ node: neighbor, distance: distance + 1 });
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

        // Update link visuals and flow direction
        for (const link of this.links) {
            link.setFlowDirection(this.bfsDistances);
            link.updateState(visited);
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
            if (node.nodeState !== 'offline' && node.nodeState !== 'constructing') {
                connectedNodes.push({ node, distance });
                totalConsumption += node.powerConsumption;
            }
        }

        if (totalConsumption <= totalGeneration) {
            // All connected nodes are fine
            for (const { node } of connectedNodes) {
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
