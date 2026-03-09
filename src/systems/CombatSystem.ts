import Phaser from 'phaser';
import { Enemy } from '../entities/Enemy';
import { GameNode } from '../entities/Node';
import { CommandHub } from '../entities/CommandHub';
import { Shield } from '../entities/defence/Shield';
import { ResourceManager } from './ResourceManager';
import { PowerNetwork } from './PowerNetwork';
import { BuildSystem } from './BuildSystem';
import {
    WORLD_WIDTH, WORLD_HEIGHT, ENEMY_MINERAL_REWARD, ENEMY_ATTACK_RANGE,
    COLOUR_CYAN, COLOUR_AMBER
} from '../utils/Constants';
import { distanceBetween } from '../utils/Helpers';

interface Projectile {
    x: number;
    y: number;
    vx: number;
    vy: number;
    damage: number;
    life: number;
    graphics: Phaser.GameObjects.Graphics;
}

export class CombatSystem {
    private scene: Phaser.Scene;
    private resourceManager: ResourceManager;
    private powerNetwork: PowerNetwork;
    private buildSystem: BuildSystem;
    private enemies: Enemy[] = [];
    private projectiles: Projectile[] = [];

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
            case 0: return { x: Math.random() * WORLD_WIDTH, y: -margin };
            case 1: return { x: WORLD_WIDTH + margin, y: Math.random() * WORLD_HEIGHT };
            case 2: return { x: Math.random() * WORLD_WIDTH, y: WORLD_HEIGHT + margin };
            default: return { x: -margin, y: Math.random() * WORLD_HEIGHT };
        }
    }

    /** Fire a projectile from (sx,sy) toward enemy */
    fireProjectile(sx: number, sy: number, target: Enemy, damage: number, speed: number): void {
        const dx = target.x - sx;
        const dy = target.y - sy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        const gfx = this.scene.add.graphics();
        gfx.setDepth(8);

        this.projectiles.push({
            x: sx,
            y: sy,
            vx: (dx / dist) * speed,
            vy: (dy / dist) * speed,
            damage,
            life: 2000,
            graphics: gfx
        });
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

        // Update enemies
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            if (!enemy.alive) {
                enemy.destroy();
                this.enemies.splice(i, 1);
                continue;
            }

            // Find nearest target
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

            // Check shields BEFORE movement — clamp enemy to stop at shield edge
            let shieldTarget: Shield | null = null;
            for (const shield of activeShields) {
                const distToShield = distanceBetween(enemy.x, enemy.y, shield.x, shield.y);
                const stopDist = shield.bubbleRadius + enemy.radius + 1;

                if (distToShield <= stopDist) {
                    // Already at or inside shield boundary — block and attack
                    enemy.blockedByShield = true;
                    shieldTarget = shield;
                    break;
                }

                // Check if target is inside this shield — enemy needs to stop at the boundary
                if (nearestNode) {
                    const targetToShield = distanceBetween(nearestNode.x, nearestNode.y, shield.x, shield.y);
                    if (targetToShield < shield.bubbleRadius) {
                        // Target is shielded; clamp movement to stop at bubble edge
                        const moveAllowance = distToShield - stopDist;
                        if (moveAllowance < enemy.moveClamp) {
                            enemy.moveClamp = moveAllowance;
                            shieldTarget = shield;
                        }
                    }
                }
            }

            enemy.update(delta);

            // After movement: re-check if now touching shield (from clamped movement)
            if (!enemy.blockedByShield && shieldTarget) {
                const distAfter = distanceBetween(enemy.x, enemy.y, shieldTarget.x, shieldTarget.y);
                if (distAfter <= shieldTarget.bubbleRadius + enemy.radius + 3) {
                    enemy.blockedByShield = true;
                }
            }

            // Attack logic
            if (enemy.canAttack()) {
                if (shieldTarget && (enemy.blockedByShield || enemy.moveClamp < 5)) {
                    // Attack the shield
                    const damage = enemy.performAttack();
                    shieldTarget.absorbDamage(damage);
                } else if (!shieldTarget && nearestNode && nearestDist <= ENEMY_ATTACK_RANGE + enemy.radius) {
                    // Attack node directly (no shield in the way)
                    const damage = enemy.performAttack();
                    const died = nearestNode.takeDamage(damage);
                    if (died) {
                        this.handleNodeDeath(nearestNode);
                    }
                }
            }
        }

        // Update projectiles
        this.updateProjectiles(delta);
    }

    private updateProjectiles(delta: number): void {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            p.life -= delta;

            if (p.life <= 0) {
                p.graphics.destroy();
                this.projectiles.splice(i, 1);
                continue;
            }

            // Move
            p.x += p.vx * (delta / 1000);
            p.y += p.vy * (delta / 1000);

            // Check hit against enemies
            let hit = false;
            for (const enemy of this.enemies) {
                if (!enemy.alive) continue;
                const dist = distanceBetween(p.x, p.y, enemy.x, enemy.y);
                if (dist <= enemy.radius + 3) {
                    const died = enemy.takeDamage(p.damage);
                    if (died) {
                        this.resourceManager.earn(ENEMY_MINERAL_REWARD);
                    }
                    hit = true;
                    break;
                }
            }

            if (hit) {
                p.graphics.destroy();
                this.projectiles.splice(i, 1);
                continue;
            }

            // Draw projectile
            p.graphics.clear();
            p.graphics.x = p.x;
            p.graphics.y = p.y;

            const age = 2000 - p.life;
            const flash = age < 50 ? 1 : 0.7;
            p.graphics.fillStyle(COLOUR_CYAN, flash);
            p.graphics.fillCircle(0, 0, 2);
            p.graphics.fillStyle(COLOUR_AMBER, flash * 0.4);
            p.graphics.fillCircle(0, 0, 3.5);
        }
    }

    private handleNodeDeath(node: GameNode): void {
        if (node instanceof CommandHub) {
            console.log('Command Hub destroyed! Game Over.');
            return;
        }

        this.powerNetwork.removeNode(node);
        const placedNodes = this.buildSystem.getPlacedNodes();
        const idx = placedNodes.indexOf(node);
        if (idx >= 0) placedNodes.splice(idx, 1);
        node.destroy();
    }

    killEnemy(enemy: Enemy): void {
        this.resourceManager.earn(ENEMY_MINERAL_REWARD);
        enemy.alive = false;
    }

    getEnemyCount(): number {
        return this.enemies.length;
    }

    destroy(): void {
        for (const enemy of this.enemies) {
            enemy.destroy();
        }
        this.enemies = [];
        for (const p of this.projectiles) {
            p.graphics.destroy();
        }
        this.projectiles = [];
    }
}
