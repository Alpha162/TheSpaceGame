import Phaser from 'phaser';
import {
    ENEMY_RADIUS, ENEMY_HEALTH, ENEMY_SPEED, ENEMY_DAMAGE,
    ENEMY_ATTACK_COOLDOWN, ENEMY_ATTACK_RANGE,
    COLOUR_RED, COLOUR_DARK_METAL
} from '../utils/Constants';
import { distanceBetween } from '../utils/Helpers';

export class Enemy {
    readonly graphics: Phaser.GameObjects.Graphics;
    x: number;
    y: number;
    health: number;
    maxHealth: number;
    speed: number;
    damage: number;
    radius: number;
    private attackCooldown = 0;
    private targetX: number;
    private targetY: number;
    alive = true;

    constructor(scene: Phaser.Scene, x: number, y: number, targetX: number, targetY: number) {
        this.x = x;
        this.y = y;
        this.targetX = targetX;
        this.targetY = targetY;
        this.health = ENEMY_HEALTH;
        this.maxHealth = ENEMY_HEALTH;
        this.speed = ENEMY_SPEED;
        this.damage = ENEMY_DAMAGE;
        this.radius = ENEMY_RADIUS;

        this.graphics = scene.add.graphics();
        this.graphics.setDepth(5);
        this.draw();
    }

    setTarget(x: number, y: number): void {
        this.targetX = x;
        this.targetY = y;
    }

    update(delta: number): void {
        if (!this.alive) return;

        // Move toward target
        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > ENEMY_ATTACK_RANGE) {
            const moveAmount = this.speed * delta;
            this.x += (dx / dist) * moveAmount;
            this.y += (dy / dist) * moveAmount;
        }

        // Cooldown
        if (this.attackCooldown > 0) {
            this.attackCooldown -= delta;
        }

        this.draw();
    }

    /** Returns true if this enemy is in range and ready to attack */
    canAttack(targetX: number, targetY: number): boolean {
        if (this.attackCooldown > 0) return false;
        return distanceBetween(this.x, this.y, targetX, targetY) <= ENEMY_ATTACK_RANGE + this.radius;
    }

    /** Consume the attack — resets cooldown, returns damage */
    performAttack(): number {
        this.attackCooldown = ENEMY_ATTACK_COOLDOWN;
        return this.damage;
    }

    takeDamage(amount: number): boolean {
        this.health -= amount;
        if (this.health <= 0) {
            this.health = 0;
            this.alive = false;
            return true; // died
        }
        this.draw();
        return false;
    }

    private draw(): void {
        this.graphics.clear();
        this.graphics.x = this.x;
        this.graphics.y = this.y;

        const healthPct = this.health / this.maxHealth;

        // Body — red circle with dark fill
        this.graphics.fillStyle(COLOUR_DARK_METAL, 0.8);
        this.graphics.fillCircle(0, 0, this.radius);
        this.graphics.lineStyle(1.5, COLOUR_RED, 0.9);
        this.graphics.strokeCircle(0, 0, this.radius);

        // Inner red core
        this.graphics.fillStyle(COLOUR_RED, 0.7);
        this.graphics.fillCircle(0, 0, this.radius * 0.4);

        // Health bar (only when damaged)
        if (healthPct < 1) {
            const barW = this.radius * 2.5;
            const barH = 2;
            const barY = -this.radius - 5;
            this.graphics.fillStyle(0x333333, 0.8);
            this.graphics.fillRect(-barW / 2, barY, barW, barH);
            this.graphics.fillStyle(COLOUR_RED, 0.9);
            this.graphics.fillRect(-barW / 2, barY, barW * healthPct, barH);
        }
    }

    destroy(): void {
        this.graphics.destroy();
    }
}
