import { GameNode } from '../Node';
import { Enemy } from '../Enemy';
import { CombatSystem } from '../../systems/CombatSystem';
import {
    BLASTER_HEALTH, BLASTER_RADIUS, BLASTER_POWER, BLASTER_RANGE,
    BLASTER_FIRE_RATE, BLASTER_DAMAGE, BLASTER_PROJECTILE_SPEED,
    COLOUR_CYAN, COLOUR_DARK_METAL, COLOUR_AMBER, COLOUR_RED, COLOUR_SELECTION, COLOUR_GREEN,
    PowerPriority, NODE_REPAIR_POWER_COST
} from '../../utils/Constants';
import { distanceBetween } from '../../utils/Helpers';

export class Blaster extends GameNode {
    private fireCooldown = 0;
    private combatSystem: CombatSystem | null = null;
    private turretAngle = 0; // current barrel direction
    private currentTarget: Enemy | null = null;
    private rangeGraphics: Phaser.GameObjects.Graphics;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, BLASTER_HEALTH, BLASTER_POWER, BLASTER_RADIUS);
        this.powerPriority = PowerPriority.HIGH;

        this.rangeGraphics = scene.add.graphics();
        this.rangeGraphics.setDepth(-1);

        this.drawNode();
    }

    setCombatSystem(combatSystem: CombatSystem): void {
        this.combatSystem = combatSystem;
    }

    /** Only draw power when actively targeting an enemy */
    getCurrentPowerDraw(): number {
        if (!this.currentTarget) return 0;
        let draw = this.powerConsumption;
        if (this.isRepairing) {
            draw += NODE_REPAIR_POWER_COST;
        }
        return draw;
    }

    update(_time: number, delta: number): void {
        if (this.nodeState !== 'online' || !this.isFullyConstructed()) return;
        if (!this.combatSystem) return;

        // Cooldown
        if (this.fireCooldown > 0) {
            this.fireCooldown -= delta;
        }

        // Find target
        const enemies = this.combatSystem.getEnemies();
        let bestTarget: Enemy | null = null;
        let bestDist = Infinity;

        for (const enemy of enemies) {
            if (!enemy.alive) continue;
            const dist = distanceBetween(this.x, this.y, enemy.x, enemy.y);
            if (dist <= BLASTER_RANGE && dist < bestDist) {
                bestDist = dist;
                bestTarget = enemy;
            }
        }

        this.currentTarget = bestTarget;

        if (bestTarget) {
            // Rotate barrel toward target
            const dx = bestTarget.x - this.x;
            const dy = bestTarget.y - this.y;
            this.turretAngle = Math.atan2(dy, dx);

            // Fire if ready
            if (this.fireCooldown <= 0) {
                this.fireCooldown = 1000 / BLASTER_FIRE_RATE;
                this.combatSystem.fireProjectile(
                    this.x, this.y,
                    bestTarget,
                    BLASTER_DAMAGE,
                    BLASTER_PROJECTILE_SPEED
                );
            }
        }

        this.drawNode();
    }

    protected drawNode(): void {
        this.graphics.clear();

        const colour = this.getStateColour();
        const isConstructing = this.nodeState === 'constructing';
        const alpha = (this.nodeState === 'offline' || isConstructing) ? 0.4 : 1;

        // Selection ring
        if (this.selected) {
            this.graphics.lineStyle(2, COLOUR_SELECTION, 0.8);
            this.graphics.strokeCircle(0, 0, this.nodeRadius + 4);

            // Show range circle when selected
            if (this.rangeGraphics) {
                this.rangeGraphics.clear();
                this.rangeGraphics.x = this.x;
                this.rangeGraphics.y = this.y;
                this.rangeGraphics.lineStyle(1, COLOUR_CYAN, 0.15);
                this.rangeGraphics.strokeCircle(0, 0, BLASTER_RANGE);
            }
        } else if (this.rangeGraphics) {
            this.rangeGraphics.clear();
        }

        // Outer ring
        this.graphics.lineStyle(2, colour, alpha);
        this.graphics.strokeCircle(0, 0, this.nodeRadius);

        // Fill
        this.graphics.fillStyle(COLOUR_DARK_METAL, alpha * 0.7);
        this.graphics.fillCircle(0, 0, this.nodeRadius - 1);

        // Turret barrel
        if (!isConstructing) {
            const barrelLen = this.nodeRadius + 4;
            const barrelW = 2;
            const cos = Math.cos(this.turretAngle);
            const sin = Math.sin(this.turretAngle);

            // Barrel colour: cyan normally, amber when firing
            const barrelColour = this.fireCooldown > (1000 / BLASTER_FIRE_RATE) * 0.7
                ? COLOUR_AMBER : colour;

            this.graphics.lineStyle(barrelW, barrelColour, alpha);
            this.graphics.beginPath();
            this.graphics.moveTo(0, 0);
            this.graphics.lineTo(cos * barrelLen, sin * barrelLen);
            this.graphics.strokePath();

            // Center hub
            this.graphics.fillStyle(colour, alpha * 0.9);
            this.graphics.fillCircle(0, 0, 3);

            // Targeting indicator when has target
            if (this.currentTarget) {
                const tipX = cos * barrelLen;
                const tipY = sin * barrelLen;
                this.graphics.fillStyle(COLOUR_RED, 0.8);
                this.graphics.fillCircle(tipX, tipY, 1.5);
            }
        }

        // Repair indicator
        if (this.isRepairing) {
            this.graphics.fillStyle(COLOUR_GREEN, 0.9);
            this.graphics.fillRect(-1, -this.nodeRadius - 4, 2, 5);
            this.graphics.fillRect(-2.5, -this.nodeRadius - 2.5, 5, 2);
        }

        // Construction progress bar
        if (isConstructing) {
            const barWidth = this.nodeRadius * 2;
            const barHeight = 3;
            const barY = this.nodeRadius + 6;

            this.graphics.fillStyle(0x333333, 0.8);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth, barHeight);
            this.graphics.fillStyle(COLOUR_AMBER, 0.9);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth * this.constructionProgress, barHeight);
        }

        // Health bar (if damaged)
        if (!isConstructing && this.currentHealth < this.maxHealth) {
            const barWidth = this.nodeRadius * 2;
            const barHeight = 3;
            const barY = -this.nodeRadius - 8;
            const healthPct = this.currentHealth / this.maxHealth;

            this.graphics.fillStyle(0x333333, 0.8);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth, barHeight);
            this.graphics.fillStyle(healthPct > 0.3 ? COLOUR_CYAN : COLOUR_RED, 0.9);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth * healthPct, barHeight);
        }
    }

    destroy(fromScene?: boolean): void {
        this.rangeGraphics.destroy();
        super.destroy(fromScene);
    }
}
