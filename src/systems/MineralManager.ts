import { MineralPickup } from '../entities/MineralPickup';
import { GameNode } from '../entities/Node';
import { CommandHub } from '../entities/CommandHub';
import { PowerNetwork } from './PowerNetwork';
import { ResourceManager } from './ResourceManager';
import {
    MINERAL_PICKUP_TRACTOR_RANGE, MINERAL_PICKUP_TRACTOR_SPEED,
    MINERAL_PICKUP_TRANSIT_SPEED, COLOUR_AMBER
} from '../utils/Constants';
import { distanceBetween } from '../utils/Helpers';

export class MineralManager {
    private pickups: MineralPickup[] = [];
    private scene: Phaser.Scene;
    private powerNetwork: PowerNetwork;
    private resourceManager: ResourceManager;
    private beamGraphics: Phaser.GameObjects.Graphics;

    constructor(scene: Phaser.Scene, powerNetwork: PowerNetwork, resourceManager: ResourceManager) {
        this.scene = scene;
        this.powerNetwork = powerNetwork;
        this.resourceManager = resourceManager;
        this.beamGraphics = scene.add.graphics();
        this.beamGraphics.setDepth(3);
    }

    spawnPickup(x: number, y: number, value: number): void {
        this.pickups.push(new MineralPickup(this.scene, x, y, value));
    }

    update(delta: number): void {
        this.beamGraphics.clear();

        const hub = this.powerNetwork.getHub();
        const allNodes = this.powerNetwork.getAllNodes();
        const bfs = this.powerNetwork.getBfsDistances();

        for (let i = this.pickups.length - 1; i >= 0; i--) {
            const pickup = this.pickups[i];

            if (!pickup.alive) {
                pickup.destroy();
                this.pickups.splice(i, 1);
                continue;
            }

            switch (pickup.state) {
                case 'floating':
                    this.updateFloating(pickup, allNodes, hub);
                    break;
                case 'tractored':
                    this.updateTractored(pickup, delta, hub);
                    break;
                case 'transiting':
                    this.updateTransiting(pickup, delta, bfs, hub);
                    break;
            }

            pickup.update(delta);
        }
    }

    private updateFloating(pickup: MineralPickup, allNodes: GameNode[], hub: CommandHub | null): void {
        let bestNode: GameNode | null = null;
        let bestDist = MINERAL_PICKUP_TRACTOR_RANGE;

        // Check hub first
        if (hub && hub.currentHealth > 0) {
            const dist = distanceBetween(pickup.x, pickup.y, hub.x, hub.y);
            if (dist < bestDist) {
                bestDist = dist;
                bestNode = hub;
            }
        }

        // Check all online nodes
        for (const node of allNodes) {
            if (node.currentHealth <= 0 || node.nodeState === 'offline') continue;
            const dist = distanceBetween(pickup.x, pickup.y, node.x, node.y);
            if (dist < bestDist) {
                bestDist = dist;
                bestNode = node;
            }
        }

        if (bestNode) {
            pickup.state = 'tractored';
            pickup.tractorTarget = bestNode;
        }
    }

    private updateTractored(pickup: MineralPickup, delta: number, hub: CommandHub | null): void {
        const target = pickup.tractorTarget;
        if (!target) {
            pickup.state = 'floating';
            return;
        }

        // Check if target node is still valid (alive + online)
        if (target instanceof GameNode) {
            if (target.currentHealth <= 0 || target.nodeState === 'offline') {
                pickup.state = 'floating';
                pickup.tractorTarget = null;
                return;
            }
        }

        // Draw tractor beam line
        const dist = distanceBetween(pickup.x, pickup.y, target.x, target.y);
        const beamAlpha = Math.min(0.4, 0.1 + (1 - dist / MINERAL_PICKUP_TRACTOR_RANGE) * 0.3);
        this.beamGraphics.lineStyle(1.5, COLOUR_AMBER, beamAlpha);
        this.beamGraphics.beginPath();
        this.beamGraphics.moveTo(pickup.x, pickup.y);
        this.beamGraphics.lineTo(target.x, target.y);
        this.beamGraphics.strokePath();

        // Move toward target
        const speed = MINERAL_PICKUP_TRACTOR_SPEED * delta;
        if (dist <= speed + 5) {
            // Arrived at node
            pickup.x = target.x;
            pickup.y = target.y;

            if (hub && target === hub) {
                // Reached hub directly — credit minerals
                this.creditMinerals(pickup);
            } else {
                // Start transiting along links toward hub
                pickup.state = 'transiting';
                pickup.tractorTarget = null;
                this.assignNextTransitTarget(pickup, target as GameNode);
            }
        } else {
            // Move toward target
            const dx = target.x - pickup.x;
            const dy = target.y - pickup.y;
            pickup.x += (dx / dist) * speed;
            pickup.y += (dy / dist) * speed;
            // Zero out scatter velocity once tractored
            pickup.vx = 0;
            pickup.vy = 0;
        }
    }

    private updateTransiting(
        pickup: MineralPickup, delta: number,
        _bfs: Map<GameNode, number>, hub: CommandHub | null
    ): void {
        const target = pickup.transitTarget;
        if (!target || !hub) {
            // Lost path — just credit minerals wherever we are
            this.creditMinerals(pickup);
            return;
        }

        const dist = distanceBetween(pickup.x, pickup.y, target.x, target.y);
        const speed = MINERAL_PICKUP_TRANSIT_SPEED * delta;

        if (dist <= speed + 3) {
            // Arrived at this waypoint
            pickup.x = target.x;
            pickup.y = target.y;

            if (target === hub) {
                this.creditMinerals(pickup);
                return;
            }

            // Find next waypoint toward hub
            this.assignNextTransitTarget(pickup, target as GameNode);
        } else {
            const dx = target.x - pickup.x;
            const dy = target.y - pickup.y;
            pickup.x += (dx / dist) * speed;
            pickup.y += (dy / dist) * speed;
        }
    }

    private assignNextTransitTarget(pickup: MineralPickup, currentNode: GameNode): void {
        const bfs = this.powerNetwork.getBfsDistances();
        const hub = this.powerNetwork.getHub();
        const neighbors = this.powerNetwork.getNeighbors(currentNode);

        if (!hub || !neighbors) {
            this.creditMinerals(pickup);
            return;
        }

        const currentDist = bfs.get(currentNode);
        if (currentDist === undefined) {
            // Node is disconnected — credit minerals immediately
            this.creditMinerals(pickup);
            return;
        }

        // Find neighbor closest to hub (lowest BFS distance)
        let bestNeighbor: GameNode | null = null;
        let bestDist = currentDist;

        for (const neighbor of neighbors) {
            const nd = bfs.get(neighbor);
            if (nd !== undefined && nd < bestDist) {
                bestDist = nd;
                bestNeighbor = neighbor;
            }
        }

        if (bestNeighbor) {
            pickup.transitTarget = bestNeighbor;
        } else {
            // No path to hub — credit anyway
            this.creditMinerals(pickup);
        }
    }

    private creditMinerals(pickup: MineralPickup): void {
        this.resourceManager.earn(pickup.value);
        pickup.state = 'absorbed';
        pickup.alive = false;
    }
}
