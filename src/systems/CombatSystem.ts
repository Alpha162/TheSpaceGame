import Phaser from 'phaser';
import { Enemy, EnemyType, ProjectileInfo } from '../entities/Enemy';
import { GameNode } from '../entities/Node';
import { CommandHub } from '../entities/CommandHub';
import { Shield } from '../entities/defence/Shield';
import { Blaster } from '../entities/turrets/Blaster';
import { ResourceManager } from './ResourceManager';
import { PowerNetwork } from './PowerNetwork';
import { BuildSystem } from './BuildSystem';
import type { MineralManager } from './MineralManager';
import {
    WORLD_WIDTH, WORLD_HEIGHT, ENEMY_MINERAL_REWARD,
    ENEMY_PROJECTILE_SPEED, ENEMY_THREAT_WEIGHT,
    COLOUR_CYAN, COLOUR_AMBER, COLOUR_RED
} from '../utils/Constants';
import { distanceBetween } from '../utils/Helpers';
import { SoundManager } from './SoundManager';

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
    private mineralManager: MineralManager | null = null;

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

    setMineralManager(mm: MineralManager): void {
        this.mineralManager = mm;
    }

    getEnemies(): Enemy[] {
        return this.enemies;
    }

    spawnWave(count: number): void {
        const hub = this.powerNetwork.getHub();
        if (!hub) return;
        SoundManager.play('waveSpawn');

        const types: EnemyType[] = ['drone', 'scout', 'tank', 'swarm'];
        const weights = [0.4, 0.25, 0.15, 0.2];

        for (let i = 0; i < count; i++) {
            const type = this.weightedRandom(types, weights);
            const { x, y } = this.randomEdgePosition();

            if (type === 'swarm') {
                // Swarm spawns a group
                const groupSize = 3 + Math.floor(Math.random() * 3);
                for (let j = 0; j < groupSize; j++) {
                    const sx = x + (Math.random() - 0.5) * 20;
                    const sy = y + (Math.random() - 0.5) * 20;
                    this.enemies.push(new Enemy(this.scene, sx, sy, hub.x, hub.y, 'swarm'));
                }
            } else if (type === 'drone') {
                // Drones spawn in flocks for visible flocking behavior
                const groupSize = 6 + Math.floor(Math.random() * 3); // 6-8
                for (let j = 0; j < groupSize; j++) {
                    const sx = x + (Math.random() - 0.5) * 30;
                    const sy = y + (Math.random() - 0.5) * 30;
                    this.enemies.push(new Enemy(this.scene, sx, sy, hub.x, hub.y, 'drone'));
                }
            } else {
                this.enemies.push(new Enemy(this.scene, x, y, hub.x, hub.y, type));
            }
        }
    }

    private weightedRandom<T>(items: T[], weights: number[]): T {
        const total = weights.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        for (let i = 0; i < items.length; i++) {
            r -= weights[i];
            if (r <= 0) return items[i];
        }
        return items[items.length - 1];
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

    /** Does line segment (ax,ay)→(bx,by) intersect circle at (cx,cy) radius r? */
    private lineIntersectsCircle(ax: number, ay: number, bx: number, by: number,
        cx: number, cy: number, r: number): boolean {
        const dx = bx - ax, dy = by - ay;
        const fx = ax - cx, fy = ay - cy;
        const a = dx * dx + dy * dy;
        if (a < 0.001) return false;
        const b = 2 * (fx * dx + fy * dy);
        const c = fx * fx + fy * fy - r * r;
        const disc = b * b - 4 * a * c;
        if (disc < 0) return false;
        const sqrtDisc = Math.sqrt(disc);
        const t1 = (-b - sqrtDisc) / (2 * a);
        const t2 = (-b + sqrtDisc) / (2 * a);
        return (t1 >= 0 && t1 <= 1) || (t2 >= 0 && t2 <= 1);
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

        // Collect friendly projectile data for enemy avoidance behaviors
        const friendlyProjectiles: ProjectileInfo[] = [];
        for (const p of this.projectiles) {
            if (p.friendly) {
                friendlyProjectiles.push({ x: p.x, y: p.y, vx: p.vx, vy: p.vy });
            }
        }

        // Collect drones for flocking
        const drones = this.enemies.filter(e => e.alive && e.enemyType === 'drone');

        // Update enemies
        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const enemy = this.enemies[i];
            if (!enemy.alive) {
                SoundManager.play('enemyDeath');
                if (this.mineralManager) {
                    this.mineralManager.spawnPickup(enemy.x, enemy.y, enemy.reward);
                } else {
                    this.resourceManager.earn(enemy.reward);
                }
                enemy.destroy();
                this.enemies.splice(i, 1);
                continue;
            }

            // Pick target with threat-weighted AI
            const targetResult = this.pickTarget(enemy, allNodes);
            let nearestNode = targetResult?.node ?? null;
            let nearestDist = targetResult?.dist ?? Infinity;

            if (nearestNode) {
                enemy.setTarget(nearestNode.x, nearestNode.y);
            }

            // --- Shield path detection ---
            // Proactively detect shields blocking the path to the target,
            // even when far away, so enemies target shields from range.
            let shieldTarget: Shield | null = null;

            if (nearestNode) {
                // Check if any player shield bubble lies on the path
                for (const shield of activeShields) {
                    if (shield === nearestNode) continue;
                    const distToShield = distanceBetween(enemy.x, enemy.y, shield.x, shield.y);
                    const stopDist = shield.bubbleRadius + enemy.radius + 1;

                    // Contact check
                    if (distToShield <= stopDist) {
                        enemy.blockedByShield = true;
                        shieldTarget = shield;
                        break;
                    }

                    // Path intersection check: is the shield bubble between enemy and target?
                    if (this.lineIntersectsCircle(
                        enemy.x, enemy.y, nearestNode.x, nearestNode.y,
                        shield.x, shield.y, shield.bubbleRadius
                    )) {
                        shieldTarget = shield;
                        // Also clamp movement so we don't overshoot into the bubble
                        const moveAllowance = distToShield - stopDist;
                        if (moveAllowance < enemy.moveClamp) {
                            enemy.moveClamp = moveAllowance;
                        }
                        break;
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
                } else if (nearestNode && nearestNode !== hub) {
                    // Check if hub shield lies on path to target
                    if (this.lineIntersectsCircle(
                        enemy.x, enemy.y, nearestNode.x, nearestNode.y,
                        hub.x, hub.y, hub.hubShieldRadius
                    )) {
                        hitHubShield = true;
                        const moveAllowance = distToHub - stopDist;
                        if (moveAllowance < enemy.moveClamp) {
                            enemy.moveClamp = moveAllowance;
                        }
                    }
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

            // Retarget to the blocking shield so the enemy attacks it at range
            let attackTarget: GameNode | null = nearestNode;
            let attackDist: number = nearestDist;

            if (shieldTarget) {
                attackTarget = shieldTarget;
                attackDist = distanceBetween(enemy.x, enemy.y, shieldTarget.x, shieldTarget.y);
                enemy.setTarget(shieldTarget.x, shieldTarget.y);
            } else if (hitHubShield) {
                attackTarget = hub;
                attackDist = distanceBetween(enemy.x, enemy.y, hub.x, hub.y);
                enemy.setTarget(hub.x, hub.y);
            }

            // Inject behavioral data before update
            if (enemy.enemyType === 'scout') {
                enemy.computeScoutEvasion(friendlyProjectiles);
            } else if (enemy.enemyType === 'drone') {
                enemy.computeDroneFlocking(drones, friendlyProjectiles);
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

            // Attack logic — enemies fire projectiles at range
            // Recompute distance after movement; for shields, measure from bubble edge
            if (attackTarget) {
                attackDist = distanceBetween(enemy.x, enemy.y, attackTarget.x, attackTarget.y);
                if (shieldTarget && attackTarget === shieldTarget) {
                    attackDist = Math.max(0, attackDist - shieldTarget.bubbleRadius);
                } else if (hitHubShield && attackTarget === hub) {
                    attackDist = Math.max(0, attackDist - hub.hubShieldRadius);
                }
            }
            if (enemy.canAttack() && attackTarget && attackDist <= enemy.getAttackRange() + enemy.radius) {
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
                        enemy.takeDamage(p.damage);
                        SoundManager.play('hit');
                        // Reward handled in enemy cleanup loop above
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
                        SoundManager.play('shieldHit');
                        hit = true;
                    }
                }

                // Check player shield bubbles
                if (!hit) {
                    for (const shield of activeShields) {
                        const dist = distanceBetween(p.x, p.y, shield.x, shield.y);
                        if (dist <= shield.bubbleRadius) {
                            shield.absorbDamage(p.damage);
                            SoundManager.play('shieldHit');
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
                            SoundManager.play('hit');
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
            SoundManager.play('gameOver');
            this.scene.events.emit('hub-destroyed');
            return;
        }

        SoundManager.play('nodeDestroyed');
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
