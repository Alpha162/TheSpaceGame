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
    private targetX: number;
    private targetY: number;
    alive = true;
    blockedByShield = false;
    moveClamp = Infinity;
    private orbitDir: 1 | -1;

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
