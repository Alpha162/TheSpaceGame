import Phaser from 'phaser';
import {
    ENEMY_RADIUS, ENEMY_HEALTH, ENEMY_SPEED, ENEMY_DAMAGE,
    ENEMY_ATTACK_COOLDOWN, ENEMY_ATTACK_RANGE, ENEMY_MINERAL_REWARD,
    SCOUT_HEALTH, SCOUT_SPEED, SCOUT_DAMAGE, SCOUT_RADIUS, SCOUT_REWARD,
    TANK_HEALTH, TANK_SPEED, TANK_DAMAGE, TANK_RADIUS, TANK_REWARD,
    SWARM_HEALTH, SWARM_SPEED, SWARM_DAMAGE, SWARM_RADIUS, SWARM_REWARD,
    LANCER_HP, LANCER_SPEED, LANCER_BEAM_DPS, LANCER_BEAM_RANGE,
    LANCER_LOCK_TIME_MS, LANCER_REWARD, LANCER_RADIUS,
    TANK_SHIELD_RADIUS, TANK_SHIELD_HEAT_DECAY, TANK_SHIELD_HEAT_PER_DAMAGE, TANK_SHIELD_COOLDOWN_MS,
    SCOUT_SHIELD_RADIUS, SCOUT_SHIELD_HEAT_PER_DAMAGE,
    SHIELD_TUNE_DEFAULT, SHIELD_TUNE_MIN, SHIELD_TUNE_MAX,
    SHIELD_TUNE_DRIFT_PER_HIT,
    SHIELD_TUNE_BLEEDTHROUGH_MIN, SHIELD_TUNE_BLEEDTHROUGH_MAX,
    TUNING_DRIFT_MIN_INTERVAL_MS,
    COLOUR_RED, COLOUR_DARK_METAL, COLOUR_AMBER,
    COLOUR_SCOUT, COLOUR_TANK, COLOUR_SWARM, COLOUR_LANCER
} from '../utils/Constants';
import { getTuningVisual } from '../utils/Helpers';
import type { CombatSystem } from '../systems/CombatSystem';
import type { GameNode } from './Node';

export type EnemyType = 'drone' | 'scout' | 'tank' | 'swarm' | 'lancer';

export type LancerState = 'approach' | 'position' | 'lock' | 'fire';

export interface EnemyConfig {
    health: number;
    speed: number;
    damage: number;
    radius: number;
    reward: number;
    colour: number;
    attackCooldown: number;
    attackRange: number;
}

export const ENEMY_CONFIGS: Record<EnemyType, EnemyConfig> = {
    drone: {
        health: ENEMY_HEALTH, speed: ENEMY_SPEED, damage: ENEMY_DAMAGE,
        radius: ENEMY_RADIUS, reward: ENEMY_MINERAL_REWARD,
        colour: COLOUR_RED, attackCooldown: ENEMY_ATTACK_COOLDOWN, attackRange: ENEMY_ATTACK_RANGE
    },
    scout: {
        health: SCOUT_HEALTH, speed: SCOUT_SPEED, damage: SCOUT_DAMAGE,
        radius: SCOUT_RADIUS, reward: SCOUT_REWARD,
        colour: COLOUR_SCOUT, attackCooldown: 1500, attackRange: 80
    },
    tank: {
        health: TANK_HEALTH, speed: TANK_SPEED, damage: TANK_DAMAGE,
        radius: TANK_RADIUS, reward: TANK_REWARD,
        colour: COLOUR_TANK, attackCooldown: 3000, attackRange: 120
    },
    swarm: {
        health: SWARM_HEALTH, speed: SWARM_SPEED, damage: SWARM_DAMAGE,
        radius: SWARM_RADIUS, reward: SWARM_REWARD,
        colour: COLOUR_SWARM, attackCooldown: 1000, attackRange: 60
    },
    lancer: {
        health: LANCER_HP, speed: LANCER_SPEED, damage: LANCER_BEAM_DPS,
        radius: LANCER_RADIUS, reward: LANCER_REWARD,
        colour: COLOUR_LANCER, attackCooldown: 0, attackRange: LANCER_BEAM_RANGE
    }
};

/** Desired orbit distance — slightly inside attack range so they keep firing */
const STRAFE_SPEED_FACTOR = 0.6;
const RADIAL_CORRECTION_FACTOR = 0.3;

/** Projectile info passed by CombatSystem for avoidance */
export interface ProjectileInfo {
    x: number; y: number;
    vx: number; vy: number;
}

export class Enemy {
    readonly graphics: Phaser.GameObjects.Graphics;
    x: number;
    y: number;
    health: number;
    maxHealth: number;
    speed: number;
    damage: number;
    radius: number;
    reward: number;
    readonly enemyType: EnemyType;
    private colour: number;
    private attackCooldownMax: number;
    private attackRange: number;
    private attackCooldown = 0;
    targetX: number;
    targetY: number;
    alive = true;
    blockedByShield = false;
    moveClamp = Infinity;
    private orbitDir: 1 | -1;

    // Behavioral forces injected by CombatSystem each frame
    private evasionFx = 0;
    private evasionFy = 0;
    private flockFx = 0;
    private flockFy = 0;

    // Lancer-specific state
    private lancerState: LancerState = 'approach';
    private lancerLockTimer = 0;
    private lancerBeamGraphics: Phaser.GameObjects.Graphics | null = null;
    private lancerBeamPulse = 0;
    private lancerTarget: GameNode | null = null;
    private combatSystem: CombatSystem | null = null;

    // Enemy shield state (Tank and Scout only)
    hasShield = false;
    shieldActive = false;
    shieldHeat = 0;
    shieldRadius = 0;
    private shieldHeatDecay = 0;
    private shieldHeatPerDamage = 0;
    private shieldCooldownMs = 0;
    private shieldCooldownTimer = 0;
    private shieldOneShot = false;
    private shieldGraphics: Phaser.GameObjects.Graphics | null = null;
    /** Shield tuning (0.0 = kinetic, 0.5 = balanced, 1.0 = energy) */
    shieldTuning = SHIELD_TUNE_DEFAULT;
    private shieldLastDriftTime = 0;
    private shieldCollapseAnimTimer = 0;
    private shieldCollapseAnimRadius = 0;
    private shieldCollapseAnimColour = 0x00dcff;

    constructor(scene: Phaser.Scene, x: number, y: number, targetX: number, targetY: number, type: EnemyType = 'drone') {
        const config = ENEMY_CONFIGS[type];
        this.enemyType = type;
        this.x = x;
        this.y = y;
        this.targetX = targetX;
        this.targetY = targetY;
        this.health = config.health;
        this.maxHealth = config.health;
        this.speed = config.speed;
        this.damage = config.damage;
        this.radius = config.radius;
        this.reward = config.reward;
        this.colour = config.colour;
        this.attackCooldownMax = config.attackCooldown;
        this.attackRange = config.attackRange;
        this.orbitDir = Math.random() < 0.5 ? 1 : -1;

        this.graphics = scene.add.graphics();
        this.graphics.setDepth(5);

        if (type === 'lancer') {
            this.lancerBeamGraphics = scene.add.graphics();
            this.lancerBeamGraphics.setDepth(7);
        }

        // Initialize enemy shields
        if (type === 'tank') {
            this.hasShield = true;
            this.shieldActive = true;
            this.shieldRadius = TANK_SHIELD_RADIUS;
            this.shieldHeatDecay = TANK_SHIELD_HEAT_DECAY;
            this.shieldHeatPerDamage = TANK_SHIELD_HEAT_PER_DAMAGE;
            this.shieldCooldownMs = TANK_SHIELD_COOLDOWN_MS;
            this.shieldOneShot = false;
            this.shieldGraphics = scene.add.graphics();
            this.shieldGraphics.setDepth(4); // Below enemy body
        } else if (type === 'scout') {
            this.hasShield = true;
            this.shieldActive = true;
            this.shieldRadius = SCOUT_SHIELD_RADIUS;
            this.shieldHeatDecay = 0; // No decay — heat only goes up
            this.shieldHeatPerDamage = SCOUT_SHIELD_HEAT_PER_DAMAGE;
            this.shieldCooldownMs = 0;
            this.shieldOneShot = true; // Does not regenerate
            this.shieldGraphics = scene.add.graphics();
            this.shieldGraphics.setDepth(4);
        }

        this.draw();
    }

    getAttackRange(): number {
        return this.attackRange;
    }

    setTarget(x: number, y: number): void {
        this.targetX = x;
        this.targetY = y;
    }

    setCombatSystem(cs: CombatSystem): void {
        this.combatSystem = cs;
    }

    /** Set the Lancer's current beam target node (called by CombatSystem) */
    setLancerTarget(target: GameNode | null): void {
        if (this.enemyType !== 'lancer') return;
        if (target !== this.lancerTarget) {
            this.lancerTarget = target;
            this.lancerState = 'approach';
            this.lancerLockTimer = 0;
        }
    }

    getLancerState(): LancerState { return this.lancerState; }
    isLancerFiring(): boolean { return this.enemyType === 'lancer' && this.lancerState === 'fire'; }

    /** Is this enemy's shield currently blocking damage? */
    isShieldUp(): boolean {
        return this.hasShield && this.shieldActive;
    }

    /** Absorb damage on enemy shield with tuning bleedthrough. */
    absorbShieldDamage(damage: number, damageType: number = 0.0, isBeam: boolean = false): number {
        if (!this.isShieldUp()) return damage;

        // Calculate bleedthrough based on tuning mismatch
        const mismatch = Math.abs(this.shieldTuning - damageType);
        const bleedthrough = SHIELD_TUNE_BLEEDTHROUGH_MIN
            + (SHIELD_TUNE_BLEEDTHROUGH_MAX - SHIELD_TUNE_BLEEDTHROUGH_MIN)
            * mismatch;

        // Apply tuning drift (beam rate-capped)
        const now = performance.now();
        if (isBeam) {
            if (now - this.shieldLastDriftTime >= TUNING_DRIFT_MIN_INTERVAL_MS) {
                this.applyEnemyShieldDrift(damageType);
                this.shieldLastDriftTime = now;
            }
        } else {
            this.applyEnemyShieldDrift(damageType);
        }

        // Apply heat scaled by bleedthrough
        const heatIncrease = damage * bleedthrough * this.shieldHeatPerDamage;
        this.shieldHeat += heatIncrease;

        if (this.shieldHeat >= 1) {
            this.collapseEnemyShield();
        }

        return 0; // Fully absorbed
    }

    /** Auto-drift enemy shield tuning toward incoming damage type */
    private applyEnemyShieldDrift(incomingDamageType: number): void {
        if (incomingDamageType < this.shieldTuning) {
            this.shieldTuning = Math.max(SHIELD_TUNE_MIN, this.shieldTuning - SHIELD_TUNE_DRIFT_PER_HIT);
        } else if (incomingDamageType > this.shieldTuning) {
            this.shieldTuning = Math.min(SHIELD_TUNE_MAX, this.shieldTuning + SHIELD_TUNE_DRIFT_PER_HIT);
        }
    }

    private collapseEnemyShield(): void {
        const tuningVis = getTuningVisual(this.shieldTuning);
        this.shieldCollapseAnimRadius = this.shieldRadius;
        this.shieldCollapseAnimColour = tuningVis.colour;
        this.shieldCollapseAnimTimer = 200;

        this.shieldHeat = 1;
        this.shieldActive = false;

        if (this.shieldOneShot) {
            // Scout: shield gone for good
            this.shieldCooldownTimer = 0;
        } else {
            // Tank: start cooldown
            this.shieldCooldownTimer = this.shieldCooldownMs;
        }
    }

    private updateEnemyShield(delta: number): void {
        if (!this.hasShield) return;

        if (this.shieldActive) {
            // Heat decay
            if (this.shieldHeat > 0 && this.shieldHeatDecay > 0) {
                this.shieldHeat = Math.max(0, this.shieldHeat - this.shieldHeatDecay);
            }
        } else if (!this.shieldOneShot && this.shieldCooldownTimer > 0) {
            // Cooldown for redeploy (Tank only)
            this.shieldCooldownTimer -= delta;
            if (this.shieldCooldownTimer <= 0) {
                this.shieldCooldownTimer = 0;
                this.shieldHeat = 0;
                this.shieldActive = true;
                this.shieldTuning = SHIELD_TUNE_DEFAULT; // Reset tuning on redeploy
            }
        }

        if (this.shieldCollapseAnimTimer > 0) {
            this.shieldCollapseAnimTimer -= delta;
        }

        this.drawEnemyShield();
    }

    /** Scout evasion: dodge incoming friendly projectiles */
    computeScoutEvasion(projectiles: ProjectileInfo[]): void {
        this.evasionFx = 0;
        this.evasionFy = 0;
        if (this.enemyType !== 'scout') return;

        for (const p of projectiles) {
            const dx = this.x - p.x;
            const dy = this.y - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 120) continue;

            // Is projectile heading toward us?
            const dot = p.vx * dx + p.vy * dy;
            if (dot <= 0) continue;

            // How close will the projectile pass?
            const pvLen = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            if (pvLen < 0.1) continue;
            const nx = p.vx / pvLen;
            const ny = p.vy / pvLen;
            const projLen = dx * nx + dy * ny;
            const closestX = p.x + nx * projLen;
            const closestY = p.y + ny * projLen;
            const passDx = this.x - closestX;
            const passDy = this.y - closestY;
            const passDist = Math.sqrt(passDx * passDx + passDy * passDy);

            if (passDist < 25) {
                // Dodge perpendicular to projectile velocity
                const perpX = -ny;
                const perpY = nx;
                const side = (this.x - p.x) * perpY - (this.y - p.y) * perpX;
                const sign = side >= 0 ? 1 : -1;
                const strength = (25 - passDist) / 25;
                this.evasionFx += perpX * sign * strength * 2;
                this.evasionFy += perpY * sign * strength * 2;
            }
        }
    }

    /** Drone flocking: cohesion, separation, and projectile avoidance */
    computeDroneFlocking(drones: Enemy[], projectiles: ProjectileInfo[]): void {
        this.flockFx = 0;
        this.flockFy = 0;
        if (this.enemyType !== 'drone') return;

        let sepX = 0, sepY = 0;
        let cohX = 0, cohY = 0;
        let cohCount = 0;
        let alignVx = 0, alignVy = 0;

        for (const other of drones) {
            if (other === this || !other.alive) continue;
            const dx = this.x - other.x;
            const dy = this.y - other.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Separation — push away from nearby drones
            if (dist < 30) {
                if (dist < 0.1) {
                    // Overlapping: push in random direction to break degeneracy
                    const angle = Math.random() * Math.PI * 2;
                    sepX += Math.cos(angle);
                    sepY += Math.sin(angle);
                } else {
                    const strength = (30 - dist) / 30;
                    sepX += (dx / dist) * strength;
                    sepY += (dy / dist) * strength;
                }
            }

            // Cohesion + alignment with nearby drones
            if (dist < 120) {
                cohX += other.x;
                cohY += other.y;
                // Alignment: match neighbors' heading
                const otx = other.targetX - other.x;
                const oty = other.targetY - other.y;
                const otd = Math.sqrt(otx * otx + oty * oty);
                if (otd > 0.1) {
                    alignVx += otx / otd;
                    alignVy += oty / otd;
                }
                cohCount++;
            }
        }

        if (cohCount > 0) {
            // Cohesion: steer toward center of mass
            cohX = (cohX / cohCount - this.x);
            cohY = (cohY / cohCount - this.y);
            const cd = Math.sqrt(cohX * cohX + cohY * cohY);
            if (cd > 0.1) { cohX /= cd; cohY /= cd; }

            // Alignment: normalize accumulated heading
            const ad = Math.sqrt(alignVx * alignVx + alignVy * alignVy);
            if (ad > 0.1) { alignVx /= ad; alignVy /= ad; }
        }

        // Projectile avoidance — dodge incoming friendly projectiles
        let avoidX = 0, avoidY = 0;
        for (const p of projectiles) {
            const dx = this.x - p.x;
            const dy = this.y - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 80 || dist < 0.1) continue;

            // Only avoid if projectile is heading toward us
            const dot = p.vx * dx + p.vy * dy;
            if (dot <= 0) continue;

            const strength = (80 - dist) / 80;
            avoidX += (dx / dist) * strength;
            avoidY += (dy / dist) * strength;
        }

        this.flockFx = sepX * 1.2 + cohX * 0.3 + alignVx * 0.2 + avoidX * 0.8;
        this.flockFy = sepY * 1.2 + cohY * 0.3 + alignVy * 0.2 + avoidY * 0.8;
    }

    update(delta: number): void {
        if (!this.alive) return;

        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (this.enemyType === 'lancer') {
            this.updateLancer(delta, dx, dy, dist);
        } else {
            this.updateStandardMovement(delta, dx, dy, dist);
        }

        this.blockedByShield = false;
        this.moveClamp = Infinity;

        if (this.attackCooldown > 0) {
            this.attackCooldown -= delta;
        }

        this.updateEnemyShield(delta);
        this.draw();
    }

    private updateStandardMovement(delta: number, dx: number, dy: number, dist: number): void {
        const orbitRadius = this.attackRange * 0.85;

        if (dist > this.attackRange && !this.blockedByShield) {
            let moveAmount = this.speed * delta;
            if (this.moveClamp < Infinity) {
                moveAmount = Math.min(moveAmount, Math.max(0, this.moveClamp));
            }
            if (moveAmount > 0 && dist > 0) {
                this.x += (dx / dist) * moveAmount;
                this.y += (dy / dist) * moveAmount;
            }
        } else if (!this.blockedByShield && dist > 0) {
            const nx = dx / dist;
            const ny = dy / dist;
            const tx = -ny * this.orbitDir;
            const ty = nx * this.orbitDir;
            const radialError = dist - orbitRadius;
            const radialStrength = radialError * RADIAL_CORRECTION_FACTOR;
            const moveSpeed = this.speed * STRAFE_SPEED_FACTOR * delta;
            let vx = tx * moveSpeed + nx * radialStrength * this.speed * delta;
            let vy = ty * moveSpeed + ny * radialStrength * this.speed * delta;

            if (this.moveClamp < Infinity) {
                const mag = Math.sqrt(vx * vx + vy * vy);
                if (mag > this.moveClamp) {
                    const scale = Math.max(0, this.moveClamp) / mag;
                    vx *= scale;
                    vy *= scale;
                }
            }

            this.x += vx;
            this.y += vy;
        }

        // Apply type-specific behavioral forces
        if (this.enemyType === 'scout') {
            this.x += this.evasionFx * this.speed * delta;
            this.y += this.evasionFy * this.speed * delta;
        } else if (this.enemyType === 'drone') {
            this.x += this.flockFx * this.speed * delta;
            this.y += this.flockFy * this.speed * delta;
        }
    }

    /** Lancer-specific movement and beam state machine */
    private updateLancer(delta: number, dx: number, dy: number, dist: number): void {
        if (this.lancerBeamGraphics) this.lancerBeamGraphics.clear();
        this.lancerBeamPulse += delta * 0.005;

        if (!this.lancerTarget || this.lancerTarget.currentHealth <= 0) {
            this.lancerState = 'approach';
            this.lancerLockTimer = 0;
            // Just move toward target position
            if (dist > 1 && !this.blockedByShield) {
                let moveAmount = this.speed * delta;
                if (this.moveClamp < Infinity) {
                    moveAmount = Math.min(moveAmount, Math.max(0, this.moveClamp));
                }
                if (moveAmount > 0) {
                    this.x += (dx / dist) * moveAmount;
                    this.y += (dy / dist) * moveAmount;
                }
            }
            return;
        }

        // Distance to actual target node
        const tdx = this.lancerTarget.x - this.x;
        const tdy = this.lancerTarget.y - this.y;
        const targetDist = Math.sqrt(tdx * tdx + tdy * tdy);

        switch (this.lancerState) {
            case 'approach':
                // Move toward target, stop when within beam range
                if (targetDist > LANCER_BEAM_RANGE && !this.blockedByShield) {
                    let moveAmount = this.speed * delta;
                    if (this.moveClamp < Infinity) {
                        moveAmount = Math.min(moveAmount, Math.max(0, this.moveClamp));
                    }
                    if (moveAmount > 0 && targetDist > 0) {
                        this.x += (tdx / targetDist) * moveAmount;
                        this.y += (tdy / targetDist) * moveAmount;
                    }
                } else {
                    this.lancerState = 'position';
                }
                break;

            case 'position':
                // Hold at max beam range — maintain distance
                if (targetDist > 0) {
                    const idealDist = LANCER_BEAM_RANGE * 0.95;
                    const radialError = targetDist - idealDist;
                    if (Math.abs(radialError) > 5 && !this.blockedByShield) {
                        const moveAmount = Math.min(
                            Math.abs(radialError),
                            this.speed * delta
                        );
                        const dir = radialError > 0 ? 1 : -1;
                        this.x += (tdx / targetDist) * moveAmount * dir;
                        this.y += (tdy / targetDist) * moveAmount * dir;
                    }
                }
                this.lancerState = 'lock';
                this.lancerLockTimer = 0;
                break;

            case 'lock':
                // Aim at target for lock time, draw charge-up visual
                this.lancerLockTimer += delta;

                // Hold position at range
                if (targetDist > 0 && !this.blockedByShield) {
                    const idealDist = LANCER_BEAM_RANGE * 0.95;
                    const radialError = targetDist - idealDist;
                    if (Math.abs(radialError) > 5) {
                        const moveAmount = Math.min(Math.abs(radialError), this.speed * delta);
                        const dir = radialError > 0 ? 1 : -1;
                        this.x += (tdx / targetDist) * moveAmount * dir;
                        this.y += (tdy / targetDist) * moveAmount * dir;
                    }
                }

                // Draw lock-on indicator
                if (this.lancerBeamGraphics) {
                    const lockPct = this.lancerLockTimer / LANCER_LOCK_TIME_MS;
                    // Charge-up glow on the Lancer
                    this.lancerBeamGraphics.fillStyle(COLOUR_LANCER, lockPct * 0.4);
                    this.lancerBeamGraphics.fillCircle(this.x, this.y, this.radius + 3 + lockPct * 3);
                    // Faint targeting line
                    this.lancerBeamGraphics.lineStyle(1, COLOUR_LANCER, 0.1 + lockPct * 0.2);
                    this.lancerBeamGraphics.beginPath();
                    this.lancerBeamGraphics.moveTo(this.x, this.y);
                    this.lancerBeamGraphics.lineTo(this.lancerTarget.x, this.lancerTarget.y);
                    this.lancerBeamGraphics.strokePath();
                }

                if (this.lancerLockTimer >= LANCER_LOCK_TIME_MS) {
                    this.lancerState = 'fire';
                }

                // If target dies during lock, reset
                if (this.lancerTarget.currentHealth <= 0) {
                    this.lancerState = 'approach';
                    this.lancerLockTimer = 0;
                }
                break;

            case 'fire':
                // Continuous beam dealing LANCER_BEAM_DPS per second
                if (this.combatSystem && this.lancerTarget && this.lancerTarget.currentHealth > 0) {
                    const dmg = LANCER_BEAM_DPS * (delta / 1000);
                    this.combatSystem.applyDamage(
                        this,                // source: the Lancer
                        this.lancerTarget,   // target: the player node
                        dmg,
                        1.0,                 // damageType: pure energy
                        true,                // isBeam
                        false                // isAoE
                    );

                    // Hold position
                    if (targetDist > 0 && !this.blockedByShield) {
                        const idealDist = LANCER_BEAM_RANGE * 0.95;
                        const radialError = targetDist - idealDist;
                        if (Math.abs(radialError) > 5) {
                            const moveAmount = Math.min(Math.abs(radialError), this.speed * delta);
                            const dir = radialError > 0 ? 1 : -1;
                            this.x += (tdx / targetDist) * moveAmount * dir;
                            this.y += (tdy / targetDist) * moveAmount * dir;
                        }
                    }

                    // Draw beam
                    this.drawLancerBeam();
                }

                // If target dies or moves out of range, reset
                if (!this.lancerTarget || this.lancerTarget.currentHealth <= 0 || targetDist > LANCER_BEAM_RANGE * 1.2) {
                    this.lancerState = 'approach';
                    this.lancerLockTimer = 0;
                }
                break;
        }
    }

    /** Draw the Lancer's firing beam */
    private drawLancerBeam(): void {
        if (!this.lancerBeamGraphics || !this.lancerTarget) return;

        const tx = this.lancerTarget.x;
        const ty = this.lancerTarget.y;
        const pulse = 0.6 + Math.sin(this.lancerBeamPulse) * 0.3;

        // Core beam — amber/orange
        this.lancerBeamGraphics.lineStyle(2, COLOUR_LANCER, pulse);
        this.lancerBeamGraphics.beginPath();
        this.lancerBeamGraphics.moveTo(this.x, this.y);
        this.lancerBeamGraphics.lineTo(tx, ty);
        this.lancerBeamGraphics.strokePath();

        // Glow
        this.lancerBeamGraphics.lineStyle(6, COLOUR_LANCER, pulse * 0.12);
        this.lancerBeamGraphics.beginPath();
        this.lancerBeamGraphics.moveTo(this.x, this.y);
        this.lancerBeamGraphics.lineTo(tx, ty);
        this.lancerBeamGraphics.strokePath();

        // Impact glow at target
        this.lancerBeamGraphics.fillStyle(COLOUR_LANCER, pulse * 0.35);
        this.lancerBeamGraphics.fillCircle(tx, ty, 5);
    }

    canAttack(): boolean {
        return this.attackCooldown <= 0;
    }

    performAttack(): number {
        this.attackCooldown = this.attackCooldownMax;
        return this.damage;
    }

    takeDamage(amount: number): boolean {
        this.health -= amount;
        if (this.health <= 0) {
            this.health = 0;
            this.alive = false;
            return true;
        }
        this.draw();
        return false;
    }

    private draw(): void {
        this.graphics.clear();
        this.graphics.x = this.x;
        this.graphics.y = this.y;

        const healthPct = this.health / this.maxHealth;
        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const angle = Math.atan2(dy, dx);

        switch (this.enemyType) {
            case 'scout':
                this.drawScout(angle, healthPct);
                break;
            case 'tank':
                this.drawTank(angle, healthPct);
                break;
            case 'swarm':
                this.drawSwarm(angle, healthPct);
                break;
            case 'lancer':
                this.drawLancerBody(angle, healthPct);
                break;
            default:
                this.drawDrone(angle, healthPct);
                break;
        }

        // Attack flash
        if (this.attackCooldown > this.attackCooldownMax * 0.8) {
            this.graphics.fillStyle(COLOUR_AMBER, 0.5);
            this.graphics.fillCircle(0, 0, this.radius * 1.3);
        }

        // Health bar (when damaged)
        if (healthPct < 1) {
            const barW = this.radius * 2.5;
            const barH = 2;
            const barY = -this.radius - 5;
            this.graphics.fillStyle(0x333333, 0.8);
            this.graphics.fillRect(-barW / 2, barY, barW, barH);
            this.graphics.fillStyle(this.colour, 0.9);
            this.graphics.fillRect(-barW / 2, barY, barW * healthPct, barH);
        }
    }

    private drawDrone(angle: number, _healthPct: number): void {
        const barrelLen = this.radius + 3;
        this.graphics.lineStyle(1.5, this.colour, 0.7);
        this.graphics.beginPath();
        this.graphics.moveTo(0, 0);
        this.graphics.lineTo(Math.cos(angle) * barrelLen, Math.sin(angle) * barrelLen);
        this.graphics.strokePath();

        this.graphics.fillStyle(COLOUR_DARK_METAL, 0.8);
        this.graphics.fillCircle(0, 0, this.radius);
        this.graphics.lineStyle(1.5, this.colour, 0.9);
        this.graphics.strokeCircle(0, 0, this.radius);
        this.graphics.fillStyle(this.colour, 0.7);
        this.graphics.fillCircle(0, 0, this.radius * 0.4);
    }

    private drawScout(angle: number, _healthPct: number): void {
        // Pointed triangle shape
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const r = this.radius;

        const tipX = cos * (r + 3);
        const tipY = sin * (r + 3);
        const lx = cos * (-r) - sin * r * 0.6;
        const ly = sin * (-r) + cos * r * 0.6;
        const rx = cos * (-r) + sin * r * 0.6;
        const ry = sin * (-r) - cos * r * 0.6;

        this.graphics.fillStyle(COLOUR_DARK_METAL, 0.8);
        this.graphics.fillTriangle(tipX, tipY, lx, ly, rx, ry);
        this.graphics.lineStyle(1, this.colour, 0.9);
        this.graphics.beginPath();
        this.graphics.moveTo(tipX, tipY);
        this.graphics.lineTo(lx, ly);
        this.graphics.lineTo(rx, ry);
        this.graphics.closePath();
        this.graphics.strokePath();

        this.graphics.fillStyle(this.colour, 0.6);
        this.graphics.fillCircle(0, 0, 2);
    }

    private drawTank(angle: number, _healthPct: number): void {
        // Thick double-ringed circle
        this.graphics.fillStyle(COLOUR_DARK_METAL, 0.9);
        this.graphics.fillCircle(0, 0, this.radius);
        this.graphics.lineStyle(2.5, this.colour, 0.9);
        this.graphics.strokeCircle(0, 0, this.radius);
        this.graphics.lineStyle(1, this.colour, 0.4);
        this.graphics.strokeCircle(0, 0, this.radius - 3);

        // Heavy barrel
        const barrelLen = this.radius + 5;
        this.graphics.lineStyle(3, this.colour, 0.8);
        this.graphics.beginPath();
        this.graphics.moveTo(0, 0);
        this.graphics.lineTo(Math.cos(angle) * barrelLen, Math.sin(angle) * barrelLen);
        this.graphics.strokePath();

        this.graphics.fillStyle(this.colour, 0.5);
        this.graphics.fillCircle(0, 0, this.radius * 0.3);
    }

    private drawSwarm(angle: number, _healthPct: number): void {
        // Tiny simple dot
        this.graphics.fillStyle(COLOUR_DARK_METAL, 0.7);
        this.graphics.fillCircle(0, 0, this.radius);
        this.graphics.lineStyle(1, this.colour, 0.9);
        this.graphics.strokeCircle(0, 0, this.radius);
        this.graphics.fillStyle(this.colour, 0.8);
        this.graphics.fillCircle(0, 0, 1.5);

        // Tiny barrel
        const barrelLen = this.radius + 2;
        this.graphics.lineStyle(1, this.colour, 0.6);
        this.graphics.beginPath();
        this.graphics.moveTo(0, 0);
        this.graphics.lineTo(Math.cos(angle) * barrelLen, Math.sin(angle) * barrelLen);
        this.graphics.strokePath();
    }

    private drawLancerBody(angle: number, _healthPct: number): void {
        // Elongated, angular "sniper" profile — diamond/chevron shape
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const r = this.radius;

        // Long front tip
        const tipX = cos * (r + 5);
        const tipY = sin * (r + 5);
        // Side points — narrow
        const lx = cos * (-r * 0.3) - sin * r * 0.5;
        const ly = sin * (-r * 0.3) + cos * r * 0.5;
        const rx = cos * (-r * 0.3) + sin * r * 0.5;
        const ry = sin * (-r * 0.3) - cos * r * 0.5;
        // Rear point — extended tail
        const tailX = cos * (-r - 2);
        const tailY = sin * (-r - 2);

        // Fill
        this.graphics.fillStyle(COLOUR_DARK_METAL, 0.85);
        this.graphics.fillTriangle(tipX, tipY, lx, ly, tailX, tailY);
        this.graphics.fillTriangle(tipX, tipY, rx, ry, tailX, tailY);

        // Outline
        this.graphics.lineStyle(1, this.colour, 0.9);
        this.graphics.beginPath();
        this.graphics.moveTo(tipX, tipY);
        this.graphics.lineTo(lx, ly);
        this.graphics.lineTo(tailX, tailY);
        this.graphics.lineTo(rx, ry);
        this.graphics.closePath();
        this.graphics.strokePath();

        // Center energy core — glows when locking/firing
        const coreAlpha = this.lancerState === 'fire' ? 0.9 :
            this.lancerState === 'lock' ? 0.4 + (this.lancerLockTimer / LANCER_LOCK_TIME_MS) * 0.5 : 0.3;
        this.graphics.fillStyle(this.colour, coreAlpha);
        this.graphics.fillCircle(0, 0, 2);
    }

    private drawEnemyShield(): void {
        if (!this.shieldGraphics) return;
        this.shieldGraphics.clear();
        this.shieldGraphics.x = this.x;
        this.shieldGraphics.y = this.y;

        // Collapse animation (renders even when shield is down)
        if (this.shieldCollapseAnimTimer > 0) {
            const t = 1 - this.shieldCollapseAnimTimer / 200;
            const flashR = this.shieldCollapseAnimRadius * (1 + t * 0.5);
            const flashAlpha = (1 - t) * 0.6;
            this.shieldGraphics.lineStyle(3, this.shieldCollapseAnimColour, flashAlpha);
            this.shieldGraphics.strokeCircle(0, 0, flashR);
            this.shieldGraphics.lineStyle(1, 0xffffff, flashAlpha * 0.5);
            this.shieldGraphics.strokeCircle(0, 0, flashR * 0.8);
        }

        if (!this.shieldActive || this.shieldRadius <= 0) return;

        // Tuning-based colour and opacity
        const tuningVis = getTuningVisual(this.shieldTuning);
        const colour = this.shieldHeat > 0.5
            ? this.blendColour(tuningVis.colour, COLOUR_RED, (this.shieldHeat - 0.5) * 2)
            : tuningVis.colour;
        const alpha = tuningVis.opacity;

        // Outer glow
        this.shieldGraphics.lineStyle(2, colour, alpha * 0.3);
        this.shieldGraphics.strokeCircle(0, 0, this.shieldRadius + 2);

        // Main bubble
        this.shieldGraphics.lineStyle(1.5, colour, alpha * 0.6);
        this.shieldGraphics.strokeCircle(0, 0, this.shieldRadius);

        // Heat glow
        if (this.shieldHeat > 0.1) {
            const heatGlowRadius = this.shieldRadius * 0.4 * this.shieldHeat;
            this.shieldGraphics.fillStyle(COLOUR_RED, this.shieldHeat * 0.2);
            this.shieldGraphics.fillCircle(0, 0, heatGlowRadius);
        }
    }

    private blendColour(a: number, b: number, f: number): number {
        const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
        const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
        const r = Math.round(ar + (br - ar) * f);
        const g = Math.round(ag + (bg - ag) * f);
        const bl = Math.round(ab + (bb - ab) * f);
        return (r << 16) | (g << 8) | bl;
    }

    destroy(): void {
        if (this.lancerBeamGraphics) this.lancerBeamGraphics.destroy();
        if (this.shieldGraphics) this.shieldGraphics.destroy();
        this.graphics.destroy();
    }
}
