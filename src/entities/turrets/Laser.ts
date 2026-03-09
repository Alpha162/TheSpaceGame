import { GameNode } from '../Node';
import { Enemy } from '../Enemy';
import { CombatSystem } from '../../systems/CombatSystem';
import {
    LASER_HEALTH, LASER_RADIUS, LASER_POWER, LASER_RANGE,
    LASER_DPS, LASER_LOCK_TIME_MS,
    COLOUR_CYAN, COLOUR_DARK_METAL, COLOUR_AMBER, COLOUR_RED, COLOUR_SELECTION, COLOUR_GREEN,
    PowerPriority, NODE_REPAIR_POWER_COST
} from '../../utils/Constants';
import { distanceBetween } from '../../utils/Helpers';

export class Laser extends GameNode {
    private combatSystem: CombatSystem | null = null;
    private currentTarget: Enemy | null = null;
    private lockTimer = 0;        // ms spent locking onto current target
    private isLocked = false;
    private turretAngle = 0;
    private beamGraphics: Phaser.GameObjects.Graphics;
    private rangeGraphics: Phaser.GameObjects.Graphics;
    private beamPulse = 0;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, LASER_HEALTH, LASER_POWER, LASER_RADIUS);
        this.powerPriority = PowerPriority.HIGH;

        this.beamGraphics = scene.add.graphics();
        this.beamGraphics.setDepth(7);
        this.rangeGraphics = scene.add.graphics();
        this.rangeGraphics.setDepth(-1);

        this.drawNode();
    }

    setCombatSystem(combatSystem: CombatSystem): void {
        this.combatSystem = combatSystem;
    }

    getCurrentPowerDraw(): number {
        let draw = this.currentTarget ? this.powerConsumption : 0;
        if (this.isRepairing) draw += NODE_REPAIR_POWER_COST;
        return draw;
    }

    update(_time: number, delta: number): void {
        this.beamGraphics.clear();

        if (this.nodeState !== 'online' || !this.isFullyConstructed()) return;
        if (!this.combatSystem) return;

        this.beamPulse += delta * 0.005;

        // Find closest enemy in range
        const enemies = this.combatSystem.getEnemies();
        let bestTarget: Enemy | null = null;
        let bestDist = LASER_RANGE;

        for (const enemy of enemies) {
            if (!enemy.alive) continue;
            const dist = distanceBetween(this.x, this.y, enemy.x, enemy.y);
            if (dist <= LASER_RANGE && dist < bestDist) {
                bestDist = dist;
                bestTarget = enemy;
            }
        }

        // Handle target switching
        if (bestTarget !== this.currentTarget) {
            this.currentTarget = bestTarget;
            this.lockTimer = 0;
            this.isLocked = false;
        }

        if (this.currentTarget) {
            // Track target angle
            const dx = this.currentTarget.x - this.x;
            const dy = this.currentTarget.y - this.y;
            this.turretAngle = Math.atan2(dy, dx);

            // Lock-on timer
            if (!this.isLocked) {
                this.lockTimer += delta;
                if (this.lockTimer >= LASER_LOCK_TIME_MS) {
                    this.isLocked = true;
                }
            }

            if (this.isLocked) {
                // Deal continuous damage
                const dmg = LASER_DPS * (delta / 1000);
                this.currentTarget.takeDamage(dmg);

                // Check if target died
                if (!this.currentTarget.alive) {
                    this.currentTarget = null;
                    this.isLocked = false;
                    this.lockTimer = 0;
                }
            }

            // Draw beam
            if (this.currentTarget) {
                this.drawBeam();
            }
        }

        this.drawNode();
    }

    private drawBeam(): void {
        if (!this.currentTarget) return;

        const tx = this.currentTarget.x;
        const ty = this.currentTarget.y;

        if (this.isLocked) {
            // Full power beam — bright cyan
            const pulse = 0.6 + Math.sin(this.beamPulse) * 0.3;
            // Core beam
            this.beamGraphics.lineStyle(2, COLOUR_CYAN, pulse);
            this.beamGraphics.beginPath();
            this.beamGraphics.moveTo(this.x, this.y);
            this.beamGraphics.lineTo(tx, ty);
            this.beamGraphics.strokePath();
            // Glow
            this.beamGraphics.lineStyle(6, COLOUR_CYAN, pulse * 0.15);
            this.beamGraphics.beginPath();
            this.beamGraphics.moveTo(this.x, this.y);
            this.beamGraphics.lineTo(tx, ty);
            this.beamGraphics.strokePath();
            // Impact glow
            this.beamGraphics.fillStyle(COLOUR_CYAN, pulse * 0.4);
            this.beamGraphics.fillCircle(tx, ty, 5);
        } else {
            // Locking — faint dashed look (dim line)
            const lockPct = this.lockTimer / LASER_LOCK_TIME_MS;
            this.beamGraphics.lineStyle(1, COLOUR_CYAN, 0.15 + lockPct * 0.2);
            this.beamGraphics.beginPath();
            this.beamGraphics.moveTo(this.x, this.y);
            this.beamGraphics.lineTo(tx, ty);
            this.beamGraphics.strokePath();
        }
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
            if (this.rangeGraphics) {
                this.rangeGraphics.clear();
                this.rangeGraphics.x = this.x;
                this.rangeGraphics.y = this.y;
                this.rangeGraphics.lineStyle(1, COLOUR_CYAN, 0.15);
                this.rangeGraphics.strokeCircle(0, 0, LASER_RANGE);
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

        // Laser icon — narrow long barrel
        if (!isConstructing) {
            const barrelLen = this.nodeRadius + 6;
            const barrelColour = this.isLocked ? COLOUR_CYAN : colour;

            this.graphics.lineStyle(1.5, barrelColour, alpha);
            this.graphics.beginPath();
            this.graphics.moveTo(0, 0);
            this.graphics.lineTo(
                Math.cos(this.turretAngle) * barrelLen,
                Math.sin(this.turretAngle) * barrelLen
            );
            this.graphics.strokePath();

            // Center lens
            this.graphics.fillStyle(barrelColour, alpha * 0.8);
            this.graphics.fillCircle(0, 0, 3);

            // Targeting dot
            if (this.currentTarget) {
                const tipX = Math.cos(this.turretAngle) * barrelLen;
                const tipY = Math.sin(this.turretAngle) * barrelLen;
                this.graphics.fillStyle(COLOUR_RED, 0.8);
                this.graphics.fillCircle(tipX, tipY, 1.5);
            }
        }

        // Upgrade chevron
        if (this.upgraded) {
            this.graphics.lineStyle(1, COLOUR_CYAN, alpha * 0.8);
            this.graphics.beginPath();
            this.graphics.moveTo(-3, -this.nodeRadius - 3);
            this.graphics.lineTo(0, -this.nodeRadius - 6);
            this.graphics.lineTo(3, -this.nodeRadius - 3);
            this.graphics.strokePath();
        }

        // Repair indicator
        if (this.isRepairing) {
            this.graphics.fillStyle(COLOUR_GREEN, 0.9);
            this.graphics.fillRect(-1, -this.nodeRadius - 4, 2, 5);
            this.graphics.fillRect(-2.5, -this.nodeRadius - 2.5, 5, 2);
        }

        // Construction bar
        if (isConstructing) {
            const barWidth = this.nodeRadius * 2;
            const barHeight = 3;
            const barY = this.nodeRadius + 6;
            this.graphics.fillStyle(0x333333, 0.8);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth, barHeight);
            this.graphics.fillStyle(COLOUR_AMBER, 0.9);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth * this.constructionProgress, barHeight);
        }

        // Health bar
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
        this.beamGraphics.destroy();
        this.rangeGraphics.destroy();
        super.destroy(fromScene);
    }
}
