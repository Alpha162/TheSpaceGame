import Phaser from 'phaser';
import { Enemy } from '../entities/Enemy';
import { GameNode } from '../entities/Node';
import { CommandHub } from '../entities/CommandHub';
import { Shield } from '../entities/defence/Shield';
import { Blaster } from '../entities/turrets/Blaster';
import { ResourceManager } from './ResourceManager';
import { PowerNetwork } from './PowerNetwork';
import { BuildSystem } from './BuildSystem';
import {
    WORLD_WIDTH, WORLD_HEIGHT, ENEMY_MINERAL_REWARD, ENEMY_ATTACK_RANGE,
    ENEMY_PROJECTILE_SPEED, ENEMY_THREAT_WEIGHT,
    COLOUR_CYAN, COLOUR_AMBER, COLOUR_RED
} from '../utils/Constants';
import { distanceBetween } from '../utils/Helpers';

interface Projectile {
    x: number;
    y: number;
    vx: number;
    vy: number;
    damage: number;
    life: number;
    friendly: boolean; // true = player (hits enemies), false = enemy (hits nodes)
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

    /** Fire a friendly projectile from (sx,sy) toward enemy */
    fireProjectile(sx: number, sy: number, target: Enemy, damage: number, speed: number): void {
        const dx = target.x - sx;
        const dy = target.y - sy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        const gfx = this.scene.add.graphics();
        gfx.setDepth(8);

        this.projectiles.push({
            x: sx, y: sy,
            vx: (dx / dist) * speed,
            vy: (dy / dist) * speed,
            damage, life: 2000,
            friendly: true,
            graphics: gfx
        });
    }

    /** Fire an enemy projectile toward a node */
    private fireEnemyProjectile(sx: number, sy: number, target: GameNode, damage: number): void {
        const dx = target.x - sx;
        const dy = target.y - sy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        const gfx = this.scene.add.graphics();
        gfx.setDepth(8);

        this.projectiles.push({
            x: sx, y: sy,
            vx: (dx / dist) * ENEMY_PROJECTILE_SPEED,
            vy: (dy / dist) * ENEMY_PROJECTILE_SPEED,
            damage, life: 3000,
            friendly: false,
            graphics: gfx
        });
    }

    /** Pick best target using threat-weighted scoring — enemies prefer blasters */
    private pickTarget(enemy: Enemy, allNodes: GameNode[]): { node: GameNode; dist: number } | null {
        let bestNode: GameNode | null = null;
        let bestScore = Infinity;
        let bestDist = Infinity;

        for (const node of allNodes) {
            if (node.currentHealth <= 0) continue;
            const dist = distanceBetween(enemy.x, enemy.y, node.x, node.y);

            // Blasters are threats — reduce their effective distance so enemies prioritize them
            const isThreat = node instanceof Blaster;
            const effectiveDist = isThreat
                ? dist * (1 - ENEMY_THREAT_WEIGHT)
                : dist;

            if (effectiveDist < bestScore) {
                bestScore = effectiveDist;
                bestNode = node;
                bestDist = dist;
            }
        }

        return bestNode ? { node: bestNode, dist: bestDist } : null;
    }

    update(delta: number): void {
        const hub = this.powerNetwork.getHub();
        if (!hub) return;

        const allNodes: GameNode[] = [hub, ...this.buildSystem.getPlacedNodes()];

        // Collect active player-built shields
        const activeShields: Shield[] = [];
        for (const node of this.powerNetwork.getAllNodes()) {
            if (node instanceof Shield && node.isShieldActive() && node.bubbleRadius > 0) {
                activeShields.push(node);
            }
        }

        const hubShieldUp = hub.isHubShieldUp();

        // Update enemies
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            if (!enemy.alive) {
                enemy.destroy();
                this.enemies.splice(i, 1);
                continue;
            }

            // Pick target with threat-weighted AI
            const targetResult = this.pickTarget(enemy, allNodes);
            const nearestNode = targetResult?.node ?? null;
            const nearestDist = targetResult?.dist ?? Infinity;

            if (nearestNode) {
                enemy.setTarget(nearestNode.x, nearestNode.y);
            }

            // Check player-built shields BEFORE movement
            let shieldTarget: Shield | null = null;
            for (const shield of activeShields) {
                const distToShield = distanceBetween(enemy.x, enemy.y, shield.x, shield.y);
                const stopDist = shield.bubbleRadius + enemy.radius + 1;

                if (distToShield <= stopDist) {
                    enemy.blockedByShield = true;
                    shieldTarget = shield;
                    break;
                }

                if (nearestNode) {
                    const targetToShield = distanceBetween(nearestNode.x, nearestNode.y, shield.x, shield.y);
                    if (targetToShield < shield.bubbleRadius) {
                        const moveAllowance = distToShield - stopDist;
                        if (moveAllowance < enemy.moveClamp) {
                            enemy.moveClamp = moveAllowance;
                            shieldTarget = shield;
                        }
                    }
                }
            }

            // Check hub shield
            let hitHubShield = false;
            if (hubShieldUp && !enemy.blockedByShield) {
                const distToHub = distanceBetween(enemy.x, enemy.y, hub.x, hub.y);
                const stopDist = hub.hubShieldRadius + enemy.radius + 1;

                if (distToHub <= stopDist) {
                    enemy.blockedByShield = true;
                    hitHubShield = true;
                } else if (nearestNode) {
                    const targetToHub = distanceBetween(nearestNode.x, nearestNode.y, hub.x, hub.y);
                    if (targetToHub < hub.hubShieldRadius) {
                        const moveAllowance = distToHub - stopDist;
                        if (moveAllowance < enemy.moveClamp) {
                            enemy.moveClamp = moveAllowance;
                            hitHubShield = true;
                        }
                    }
                }
            }

            // When blocked by a shield, retarget to the blocking shield so the
            // enemy attacks it instead of standing idle against the bubble wall.
            let attackTarget = nearestNode;
            let attackDist = nearestDist;

            if (shieldTarget && (enemy.blockedByShield || enemy.moveClamp < Infinity)) {
                attackTarget = shieldTarget;
                attackDist = distanceBetween(enemy.x, enemy.y, shieldTarget.x, shieldTarget.y);
                enemy.setTarget(shieldTarget.x, shieldTarget.y);
            } else if (hitHubShield) {
                // Hub shield blocks the path — attack the hub (damage absorbed by shield in flight)
                attackTarget = hub;
                attackDist = distanceBetween(enemy.x, enemy.y, hub.x, hub.y);
                enemy.setTarget(hub.x, hub.y);
            }

            enemy.update(delta);

            // Re-check shield contact after movement
            if (!enemy.blockedByShield && shieldTarget) {
                const distAfter = distanceBetween(enemy.x, enemy.y, shieldTarget.x, shieldTarget.y);
                if (distAfter <= shieldTarget.bubbleRadius + enemy.radius + 3) {
                    enemy.blockedByShield = true;
                }
            }
            if (!enemy.blockedByShield && hitHubShield && hubShieldUp) {
                const distAfter = distanceBetween(enemy.x, enemy.y, hub.x, hub.y);
                if (distAfter <= hub.hubShieldRadius + enemy.radius + 3) {
                    enemy.blockedByShield = true;
                }
            }

            // Attack logic — enemies fire projectiles at range; shields intercept in flight
            if (enemy.canAttack() && attackTarget && attackDist <= ENEMY_ATTACK_RANGE + enemy.radius) {
                const damage = enemy.performAttack();
                this.fireEnemyProjectile(enemy.x, enemy.y, attackTarget, damage);
            }
        }

        this.updateProjectiles(delta, allNodes, hub, activeShields);
    }

    private updateProjectiles(delta: number, allNodes: GameNode[], hub: CommandHub, activeShields: Shield[]): void {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            p.life -= delta;

            if (p.life <= 0) {
                p.graphics.destroy();
                this.projectiles.splice(i, 1);
                continue;
            }

            p.x += p.vx * (delta / 1000);
            p.y += p.vy * (delta / 1000);

            let hit = false;

            if (p.friendly) {
                // Friendly projectile — hits enemies
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
            } else {
                // Enemy projectile — blocked by shields, then hits nodes

                // Check hub shield intercept
                if (hub.isHubShieldUp()) {
                    const dist = distanceBetween(p.x, p.y, hub.x, hub.y);
                    if (dist <= hub.hubShieldRadius) {
                        hub.absorbShieldDamage(p.damage);
                        hit = true;
                    }
                }

                // Check player shield bubbles
                if (!hit) {
                    for (const shield of activeShields) {
                        const dist = distanceBetween(p.x, p.y, shield.x, shield.y);
                        if (dist <= shield.bubbleRadius) {
                            shield.absorbDamage(p.damage);
                            hit = true;
                            break;
                        }
                    }
                }

                // Check direct node hits
                if (!hit) {
                    for (const node of allNodes) {
                        if (node.currentHealth <= 0) continue;
                        const dist = distanceBetween(p.x, p.y, node.x, node.y);
                        if (dist <= node.nodeRadius + 3) {
                            const died = node.takeDamage(p.damage);
                            if (died) {
                                this.handleNodeDeath(node);
                            }
                            hit = true;
                            break;
                        }
                    }
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

            const maxLife = p.friendly ? 2000 : 3000;
            const age = maxLife - p.life;
            const flash = age < 50 ? 1 : 0.7;

            if (p.friendly) {
                p.graphics.fillStyle(COLOUR_CYAN, flash);
                p.graphics.fillCircle(0, 0, 2);
                p.graphics.fillStyle(COLOUR_AMBER, flash * 0.4);
                p.graphics.fillCircle(0, 0, 3.5);
            } else {
                p.graphics.fillStyle(COLOUR_RED, flash);
                p.graphics.fillCircle(0, 0, 2);
                p.graphics.fillStyle(COLOUR_RED, flash * 0.3);
                p.graphics.fillCircle(0, 0, 4);
            }
        }
    }

    private handleNodeDeath(node: GameNode): void {
        if (node instanceof CommandHub) {
            this.scene.events.emit('hub-destroyed');
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
