import Phaser from 'phaser';
import {
    ENEMY_RADIUS, ENEMY_HEALTH, ENEMY_SPEED, ENEMY_DAMAGE,
    ENEMY_ATTACK_COOLDOWN, ENEMY_ATTACK_RANGE,
    COLOUR_RED, COLOUR_DARK_METAL, COLOUR_AMBER
} from '../utils/Constants';

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
    /** Set by CombatSystem when enemy is blocked by a shield */
    blockedByShield = false;
    /** How far the enemy can move this frame (set externally to clamp at shield edge) */
    moveClamp = Infinity;

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

        if (dist > ENEMY_ATTACK_RANGE && !this.blockedByShield) {
            let moveAmount = this.speed * delta;
            // Clamp movement so enemy doesn't penetrate shield boundary
            if (this.moveClamp < Infinity) {
                moveAmount = Math.min(moveAmount, Math.max(0, this.moveClamp));
            }
            if (moveAmount > 0 && dist > 0) {
                this.x += (dx / dist) * moveAmount;
                this.y += (dy / dist) * moveAmount;
            }
        }

        // Reset per-frame flags
        this.blockedByShield = false;
        this.moveClamp = Infinity;

        // Cooldown
        if (this.attackCooldown > 0) {
            this.attackCooldown -= delta;
        }

        this.draw();
    }

    /** Returns true if this enemy is in range and ready to attack */
    canAttack(): boolean {
        return this.attackCooldown <= 0;
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

        // Barrel pointing toward target
        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const angle = Math.atan2(dy, dx);
        const barrelLen = this.radius + 3;

        this.graphics.lineStyle(1.5, COLOUR_RED, 0.7);
        this.graphics.beginPath();
        this.graphics.moveTo(0, 0);
        this.graphics.lineTo(Math.cos(angle) * barrelLen, Math.sin(angle) * barrelLen);
        this.graphics.strokePath();

        // Body — red circle with dark fill
        this.graphics.fillStyle(COLOUR_DARK_METAL, 0.8);
        this.graphics.fillCircle(0, 0, this.radius);
        this.graphics.lineStyle(1.5, COLOUR_RED, 0.9);
        this.graphics.strokeCircle(0, 0, this.radius);

        // Inner red core
        this.graphics.fillStyle(COLOUR_RED, 0.7);
        this.graphics.fillCircle(0, 0, this.radius * 0.4);

        // Attack flash when cooldown just started
        if (this.attackCooldown > ENEMY_ATTACK_COOLDOWN * 0.8) {
            this.graphics.fillStyle(COLOUR_AMBER, 0.5);
            this.graphics.fillCircle(0, 0, this.radius * 1.3);
        }

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
