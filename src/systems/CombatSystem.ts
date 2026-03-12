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
    SHIELD_ABSORB_HEAT_PER_DAMAGE,
    SHIELD_TUNE_BLEEDTHROUGH_MIN, SHIELD_TUNE_BLEEDTHROUGH_MAX,
    TUNING_DRIFT_MIN_INTERVAL_MS,
    COLOUR_CYAN, COLOUR_AMBER, COLOUR_RED
} from '../utils/Constants';
import type { ShieldCluster } from './ShieldClusterManager';
import { distanceBetween, getTuningVisual } from '../utils/Helpers';
import { triggerImpact } from '../rendering/ShieldEffects';
import { SoundManager } from './SoundManager';

interface Projectile {
    x: number;
    y: number;
    vx: number;
    vy: number;
    damage: number;
    damageType: number;  // 0.0 = kinetic, 1.0 = energy
    life: number;
    friendly: boolean; // true = player (hits enemies), false = enemy (hits nodes)
    graphics: Phaser.GameObjects.Graphics;
}

/** Entity-like reference for applyDamage source/target */
interface DamageEntity {
    x: number;
    y: number;
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

        const types: EnemyType[] = ['drone', 'scout', 'tank', 'swarm', 'lancer'];
        const weights = [0.35, 0.22, 0.15, 0.18, 0.10];

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
            } else if (type === 'lancer') {
                // Lancers spawn in small numbers (1-2), specialists not fodder
                const groupSize = 1 + (Math.random() < 0.3 ? 1 : 0);
                for (let j = 0; j < groupSize; j++) {
                    const sx = x + (Math.random() - 0.5) * 15;
                    const sy = y + (Math.random() - 0.5) * 15;
                    const lancer = new Enemy(this.scene, sx, sy, hub.x, hub.y, 'lancer');
                    lancer.setCombatSystem(this);
                    this.enemies.push(lancer);
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

    /** AoE drift guard: tracks clusters/shields that have already received drift in current AoE */
    private aoeDriftedClusters: Set<ShieldCluster | Shield | CommandHub> | null = null;

    /**
     * Unified damage pipeline. ALL damage flows through this method.
     * Integrates shield tuning: bleedthrough scales heat, tuning drifts toward incoming type.
     */
    applyDamage(
        source: DamageEntity,
        target: DamageEntity,
        damage: number,
        damageType: number,
        isBeam: boolean = false,
        isAoE: boolean = false
    ): void {
        const targetIsEnemy = target instanceof Enemy;

        if (targetIsEnemy) {
            // Player weapon → enemy: check enemy shield first
            const enemy = target as Enemy;
            if (enemy.isShieldUp()) {
                const impactAngle = Math.atan2(source.y - enemy.y, source.x - enemy.x);
                enemy.absorbShieldDamage(damage, damageType, isBeam, impactAngle);
                SoundManager.play('shieldHit');
            } else {
                enemy.takeDamage(damage);
                SoundManager.play('hit');
            }
        } else {
            // Enemy weapon → player node: check player shields first
            const hub = this.powerNetwork.getHub();
            if (!hub) return;

            // For beams, use ray-cast to find intercepting shield
            if (isBeam) {
                // Check hub shield first
                if (hub.isHubShieldUp()) {
                    const intersects = this.lineIntersectsCircle(
                        source.x, source.y, target.x, target.y,
                        hub.x, hub.y, hub.hubShieldRadius
                    );
                    if (intersects) {
                        this.applyPlayerShieldDamage(hub, damage, damageType, isBeam, isAoE, source);
                        return;
                    }
                }

                // Check player-built shields
                const activeShields: Shield[] = [];
                for (const node of this.powerNetwork.getAllNodes()) {
                    if (node instanceof Shield && node.isShieldActive() && node.bubbleRadius > 0) {
                        activeShields.push(node);
                    }
                }
                const interceptingShield = this.checkBeamShieldIntersection(
                    { x: source.x, y: source.y },
                    { x: target.x, y: target.y },
                    activeShields
                );
                if (interceptingShield) {
                    this.applyPlayerShieldDamage(interceptingShield, damage, damageType, isBeam, isAoE, source);
                    return;
                }
            }

            // No shield intercepted (or not a beam — projectile shields handled separately)
            const node = target as GameNode;
            const died = node.takeDamage(damage);
            SoundManager.play('hit');
            if (died) {
                this.handleNodeDeath(node);
            }
        }
    }

    /**
     * Apply damage to a player shield (Shield or CommandHub) with tuning bleedthrough + drift.
     * Handles beam drift rate cap and AoE cluster drift guard.
     */
    private applyPlayerShieldDamage(
        shield: Shield | CommandHub,
        damage: number,
        damageType: number,
        isBeam: boolean,
        isAoE: boolean,
        source?: DamageEntity
    ): void {
        // Trigger visual impact effect
        if (source) {
            const shieldX = shield.x;
            const shieldY = shield.y;
            const impactAngle = Math.atan2(source.y - shieldY, source.x - shieldX);
            const effectiveTuningForImpact = shield instanceof Shield
                ? (shield.clusterManager?.getClusterFor(shield)?.clusterTuning ?? shield.tuning)
                : ((shield as CommandHub).clusterManager?.getClusterFor(shield as any)?.clusterTuning ?? (shield as CommandHub).tuning);
            const tuningVis = getTuningVisual(effectiveTuningForImpact);
            const shieldRadius = shield instanceof Shield ? shield.bubbleRadius : (shield as CommandHub).hubShieldRadius;
            triggerImpact(shield.effectState, impactAngle, effectiveTuningForImpact, tuningVis.colour, shieldRadius);
        }

        // Get effective tuning (cluster tuning if clustered, individual otherwise)
        let effectiveTuning: number;
        let cluster: ShieldCluster | undefined;

        if (shield instanceof Shield && shield.clusterManager) {
            cluster = shield.clusterManager.getClusterFor(shield);
        } else if (shield instanceof CommandHub && shield.clusterManager) {
            cluster = shield.clusterManager.getClusterFor(shield);
        }

        effectiveTuning = cluster ? cluster.clusterTuning : (shield as Shield | CommandHub).tuning;

        // Calculate bleedthrough from mismatch
        const mismatch = Math.abs(effectiveTuning - damageType);
        const bleedthrough = SHIELD_TUNE_BLEEDTHROUGH_MIN
            + (SHIELD_TUNE_BLEEDTHROUGH_MAX - SHIELD_TUNE_BLEEDTHROUGH_MIN)
            * mismatch;

        // Apply tuning drift BEFORE heat (so bleedthrough uses pre-drift tuning)
        this.applyTuningDrift(shield, cluster, damageType, isBeam, isAoE);

        // Apply heat scaled by bleedthrough
        const heatIncrease = damage * bleedthrough * SHIELD_ABSORB_HEAT_PER_DAMAGE;

        if (shield instanceof Shield) {
            if (shield.clusterManager) {
                shield.clusterManager.distributeHeat(shield, heatIncrease);
            } else {
                shield.setHeat(shield.getHeat() + heatIncrease);
                if (shield.getHeat() >= 1) {
                    shield.collapseShield();
                }
            }
        } else {
            // CommandHub
            const hub = shield as CommandHub;
            if (hub.clusterManager) {
                hub.clusterManager.distributeHeat(hub, heatIncrease);
            } else {
                hub.setHeat(hub.getHeat() + heatIncrease);
                if (hub.getHeat() >= 1) {
                    hub.collapseShield();
                }
            }
        }

        SoundManager.play('shieldHit');
    }

    /**
     * Apply tuning drift to a shield or its cluster, respecting edge case guards:
     * - Beam drift rate cap: max 5 drift applications per second (200ms interval)
     * - AoE cluster drift guard: one drift per cluster per AoE detonation
     */
    private applyTuningDrift(
        shield: Shield | CommandHub,
        cluster: ShieldCluster | undefined,
        damageType: number,
        isBeam: boolean,
        isAoE: boolean
    ): void {
        const now = performance.now();

        // Determine the drift target (cluster or individual shield)
        const driftTarget = cluster ?? shield;

        // AoE cluster drift guard: skip if this target already drifted this AoE
        if (isAoE && this.aoeDriftedClusters) {
            if (this.aoeDriftedClusters.has(driftTarget as any)) return;
            this.aoeDriftedClusters.add(driftTarget as any);
        }

        // Beam drift rate cap: only drift if 200ms elapsed since last drift
        const lastDriftTime = cluster ? cluster.lastTuningDriftTime : shield.lastTuningDriftTime;
        if (isBeam) {
            if (now - lastDriftTime < TUNING_DRIFT_MIN_INTERVAL_MS) return;
        }

        // Apply drift
        if (cluster) {
            const clusterMgr = (shield instanceof Shield ? shield.clusterManager : (shield as CommandHub).clusterManager)!;
            clusterMgr.applyClusterTuningDrift(cluster, damageType);
            cluster.lastTuningDriftTime = now;
        } else if (shield instanceof Shield) {
            shield.applyTuningDrift(damageType);
            shield.lastTuningDriftTime = now;
        } else {
            // CommandHub solo — use same drift logic as Shield
            const hub = shield as CommandHub;
            hub.applyTuningDrift(damageType);
            hub.lastTuningDriftTime = now;
        }
    }

    /**
     * Begin an AoE drift guard scope. Call before processing AoE hits,
     * and call endAoeDriftGuard() after.
     */
    beginAoeDriftGuard(): void {
        this.aoeDriftedClusters = new Set();
    }

    endAoeDriftGuard(): void {
        this.aoeDriftedClusters = null;
    }

    /**
     * Ray-cast from beam origin to beam target, checking for shield bubble intersections.
     * Returns the first (closest to beamOrigin) intersecting shield, or null.
     */
    checkBeamShieldIntersection(
        beamOrigin: { x: number; y: number },
        beamTarget: { x: number; y: number },
        shields: Shield[]
    ): Shield | null {
        let closestShield: Shield | null = null;
        let closestT = Infinity;

        for (const shield of shields) {
            if (!shield.isShieldActive() || shield.bubbleRadius <= 0) continue;

            // Calculate closest point on line segment to shield centre
            const dx = beamTarget.x - beamOrigin.x;
            const dy = beamTarget.y - beamOrigin.y;
            const lenSq = dx * dx + dy * dy;
            if (lenSq < 0.001) continue;

            const fx = beamOrigin.x - shield.x;
            const fy = beamOrigin.y - shield.y;

            // Parametric intersection: solve quadratic for line-circle intersection
            const a = lenSq;
            const b = 2 * (fx * dx + fy * dy);
            const c = fx * fx + fy * fy - shield.bubbleRadius * shield.bubbleRadius;
            const disc = b * b - 4 * a * c;

            if (disc < 0) continue;

            const sqrtDisc = Math.sqrt(disc);
            const t1 = (-b - sqrtDisc) / (2 * a);
            const t2 = (-b + sqrtDisc) / (2 * a);

            // Find earliest intersection point within segment [0, 1]
            let t = Infinity;
            if (t1 >= 0 && t1 <= 1) t = t1;
            else if (t2 >= 0 && t2 <= 1) t = t2;
            else continue;

            if (t < closestT) {
                closestT = t;
                closestShield = shield;
            }
        }

        return closestShield;
    }

    /** Fire a friendly projectile from (sx,sy) toward enemy */
    fireProjectile(sx: number, sy: number, target: Enemy, damage: number, speed: number, damageType: number = 0.0): void {
        const dx = target.x - sx;
        const dy = target.y - sy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        const gfx = this.scene.add.graphics();
        gfx.setDepth(8);

        this.projectiles.push({
            x: sx, y: sy,
            vx: (dx / dist) * speed,
            vy: (dy / dist) * speed,
            damage, damageType, life: 2000,
            friendly: true,
            graphics: gfx
        });
    }

    /** Fire an enemy projectile toward a node */
    private fireEnemyProjectile(sx: number, sy: number, target: GameNode, damage: number, damageType: number = 0.0): void {
        const dx = target.x - sx;
        const dy = target.y - sy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        const gfx = this.scene.add.graphics();
        gfx.setDepth(8);

        this.projectiles.push({
            x: sx, y: sy,
            vx: (dx / dist) * ENEMY_PROJECTILE_SPEED,
            vy: (dy / dist) * ENEMY_PROJECTILE_SPEED,
            damage, damageType, life: 3000,
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
            } else if (enemy.enemyType === 'lancer') {
                // Lancers need the target node reference for beam attacks
                enemy.setLancerTarget(attackTarget);
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
            // Lancers fire beams (handled in their own update), not projectiles
            if (enemy.enemyType !== 'lancer' && enemy.canAttack() && attackTarget && attackDist <= enemy.getAttackRange() + enemy.radius) {
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
                // Friendly projectile — hits enemies (future: check enemy shields first)
                for (const enemy of this.enemies) {
                    if (!enemy.alive) continue;
                    const dist = distanceBetween(p.x, p.y, enemy.x, enemy.y);
                    if (dist <= enemy.radius + 3) {
                        this.applyDamage(p, enemy, p.damage, p.damageType, false, false);
                        hit = true;
                        break;
                    }
                }
            } else {
                // Enemy projectile — blocked by shields (with tuning), then hits nodes

                // Check hub shield intercept
                if (hub.isHubShieldUp()) {
                    const dist = distanceBetween(p.x, p.y, hub.x, hub.y);
                    if (dist <= hub.hubShieldRadius) {
                        this.applyPlayerShieldDamage(hub, p.damage, p.damageType, false, false, p);
                        hit = true;
                    }
                }

                // Check player shield bubbles
                if (!hit) {
                    for (const shield of activeShields) {
                        const dist = distanceBetween(p.x, p.y, shield.x, shield.y);
                        if (dist <= shield.bubbleRadius) {
                            this.applyPlayerShieldDamage(shield, p.damage, p.damageType, false, false, p);
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
