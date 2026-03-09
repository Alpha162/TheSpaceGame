import Phaser from 'phaser';
import { Enemy } from '../entities/Enemy';
import { GameNode } from '../entities/Node';
import { CommandHub } from '../entities/CommandHub';
import { Shield } from '../entities/defence/Shield';
import { ResourceManager } from './ResourceManager';
import { PowerNetwork } from './PowerNetwork';
import { BuildSystem } from './BuildSystem';
import {
    WORLD_WIDTH, WORLD_HEIGHT, ENEMY_MINERAL_REWARD, ENEMY_ATTACK_RANGE
} from '../utils/Constants';
import { distanceBetween } from '../utils/Helpers';

export class CombatSystem {
    private scene: Phaser.Scene;
    private resourceManager: ResourceManager;
    private powerNetwork: PowerNetwork;
    private buildSystem: BuildSystem;
    private enemies: Enemy[] = [];

    constructor(
        scene: Phaser.Scene,
        resourceManager: ResourceManager,
        powerNetwork: PowerNetwork,
        buildSystem: BuildSystem
    ) {
        this.scene = scene;
        this.resourceManager = resourceManager;
        this.powerNetwork = powerNetwork;
        this.buildSystem = buildSystem;
    }

    getEnemies(): Enemy[] {
        return this.enemies;
    }

    /** Spawn a batch of enemies from random world edges, targeting the hub */
    spawnWave(count: number): void {
        const hub = this.powerNetwork.getHub();
        if (!hub) return;

        for (let i = 0; i < count; i++) {
            const { x, y } = this.randomEdgePosition();
            const enemy = new Enemy(this.scene, x, y, hub.x, hub.y);
            this.enemies.push(enemy);
        }
    }

    private randomEdgePosition(): { x: number; y: number } {
        const edge = Math.floor(Math.random() * 4);
        const margin = 20;
        switch (edge) {
            case 0: // top
                return { x: Math.random() * WORLD_WIDTH, y: -margin };
            case 1: // right
                return { x: WORLD_WIDTH + margin, y: Math.random() * WORLD_HEIGHT };
            case 2: // bottom
                return { x: Math.random() * WORLD_WIDTH, y: WORLD_HEIGHT + margin };
            default: // left
                return { x: -margin, y: Math.random() * WORLD_HEIGHT };
        }
    }

    update(delta: number): void {
        const hub = this.powerNetwork.getHub();
        if (!hub) return;

        // Collect all targetable nodes (hub + placed nodes)
        const allNodes: GameNode[] = [hub, ...this.buildSystem.getPlacedNodes()];

        // Collect active shields
        const activeShields: Shield[] = [];
        for (const node of this.powerNetwork.getAllNodes()) {
            if (node instanceof Shield && node.isShieldActive() && node.bubbleRadius > 0) {
                activeShields.push(node);
            }
        }

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            if (!enemy.alive) {
                enemy.destroy();
                this.enemies.splice(i, 1);
                continue;
            }

            // Find nearest target for this enemy
            let nearestNode: GameNode | null = null;
            let nearestDist = Infinity;
            for (const node of allNodes) {
                if (node.currentHealth <= 0) continue;
                const dist = distanceBetween(enemy.x, enemy.y, node.x, node.y);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestNode = node;
                }
            }

            if (nearestNode) {
                enemy.setTarget(nearestNode.x, nearestNode.y);
            }

            enemy.update(delta);

            // Check shield collision — if enemy is inside an active shield bubble,
            // damage the shield instead of passing through
            let blockedByShield = false;
            for (const shield of activeShields) {
                const distToShield = distanceBetween(enemy.x, enemy.y, shield.x, shield.y);
                if (distToShield <= shield.bubbleRadius + enemy.radius) {
                    // Enemy is touching/inside the shield bubble
                    if (enemy.canAttack(shield.x, shield.y)) {
                        const damage = enemy.performAttack();
                        shield.absorbDamage(damage);
                    }
                    blockedByShield = true;
                    // Push enemy to shield boundary
                    if (distToShield < shield.bubbleRadius) {
                        const dx = enemy.x - shield.x;
                        const dy = enemy.y - shield.y;
                        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                        enemy.x = shield.x + (dx / dist) * (shield.bubbleRadius + enemy.radius);
                        enemy.y = shield.y + (dy / dist) * (shield.bubbleRadius + enemy.radius);
                    }
                    break;
                }
            }

            // Attack nearest node if in range and not blocked by shield
            if (!blockedByShield && nearestNode && nearestDist <= ENEMY_ATTACK_RANGE + enemy.radius) {
                if (enemy.canAttack(nearestNode.x, nearestNode.y)) {
                    const damage = enemy.performAttack();
                    const died = nearestNode.takeDamage(damage);
                    if (died) {
                        this.handleNodeDeath(nearestNode);
                    }
                }
            }
        }
    }

    private handleNodeDeath(node: GameNode): void {
        if (node instanceof CommandHub) {
            // Game over — for now just log it
            console.log('Command Hub destroyed! Game Over.');
            return;
        }

        // Remove from build system and power network
        this.powerNetwork.removeNode(node);
        const placedNodes = this.buildSystem.getPlacedNodes();
        const idx = placedNodes.indexOf(node);
        if (idx >= 0) placedNodes.splice(idx, 1);
        node.destroy();
    }

    /** Kill a specific enemy and award minerals */
    killEnemy(enemy: Enemy): void {
        this.resourceManager.earn(ENEMY_MINERAL_REWARD);
        enemy.alive = false;
    }

    /** Get current enemy count */
    getEnemyCount(): number {
        return this.enemies.length;
    }

    destroy(): void {
        for (const enemy of this.enemies) {
            enemy.destroy();
        }
        this.enemies = [];
    }
}
