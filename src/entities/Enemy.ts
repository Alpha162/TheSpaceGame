import Phaser from 'phaser';
import {
    ENEMY_RADIUS, ENEMY_HEALTH, ENEMY_SPEED, ENEMY_DAMAGE,
    ENEMY_ATTACK_COOLDOWN, ENEMY_ATTACK_RANGE, ENEMY_MINERAL_REWARD,
    SCOUT_HEALTH, SCOUT_SPEED, SCOUT_DAMAGE, SCOUT_RADIUS, SCOUT_REWARD,
    TANK_HEALTH, TANK_SPEED, TANK_DAMAGE, TANK_RADIUS, TANK_REWARD,
    SWARM_HEALTH, SWARM_SPEED, SWARM_DAMAGE, SWARM_RADIUS, SWARM_REWARD,
    COLOUR_RED, COLOUR_DARK_METAL, COLOUR_AMBER,
    COLOUR_SCOUT, COLOUR_TANK, COLOUR_SWARM
} from '../utils/Constants';

export type EnemyType = 'drone' | 'scout' | 'tank' | 'swarm';

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
        this.draw();
    }

    getAttackRange(): number {
        return this.attackRange;
    }

    setTarget(x: number, y: number): void {
        this.targetX = x;
        this.targetY = y;
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

            // Separation — push away from nearby drones (soft, wider radius)
            if (dist < 30 && dist > 0.1) {
                const strength = (30 - dist) / 30;
                sepX += (dx / dist) * strength;
                sepY += (dy / dist) * strength;
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

        this.flockFx = sepX * 0.5 + cohX * 0.4 + alignVx * 0.25 + avoidX * 0.8;
        this.flockFy = sepY * 0.5 + cohY * 0.4 + alignVy * 0.25 + avoidY * 0.8;
    }

    update(delta: number): void {
        if (!this.alive) return;

        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
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

        this.blockedByShield = false;
        this.moveClamp = Infinity;

        if (this.attackCooldown > 0) {
            this.attackCooldown -= delta;
        }

        this.draw();
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

    destroy(): void {
        this.graphics.destroy();
    }
}
