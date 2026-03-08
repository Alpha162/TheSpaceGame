import { GameNode } from '../Node';
import {
    CAPACITOR_HEALTH, CAPACITOR_RADIUS, CAPACITOR_POWER_CHARGE,
    CAPACITOR_MAX_STORAGE, CAPACITOR_DISCHARGE_RATE,
    COLOUR_CYAN, COLOUR_DARK_METAL, COLOUR_AMBER, COLOUR_SELECTION, COLOUR_PURPLE,
    PowerPriority
} from '../../utils/Constants';

export class Capacitor extends GameNode {
    maxStorage: number = CAPACITOR_MAX_STORAGE;
    currentStorage = 0;
    chargeRate: number = CAPACITOR_POWER_CHARGE;
    dischargeRate: number = CAPACITOR_DISCHARGE_RATE;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, CAPACITOR_HEALTH, CAPACITOR_POWER_CHARGE, CAPACITOR_RADIUS);
        this.powerPriority = PowerPriority.LOW;
        this.drawNode();
    }

    getCurrentPowerDraw(): number {
        // Only draw power to charge — if already full, draw nothing
        if (this.currentStorage >= this.maxStorage) return 0;
        // Draw up to chargeRate, but no more than remaining capacity
        const remaining = this.maxStorage - this.currentStorage;
        return Math.min(this.chargeRate, remaining);
    }

    /** Called by PowerNetwork to charge the capacitor */
    charge(amount: number): void {
        this.currentStorage = Math.min(this.maxStorage, this.currentStorage + amount);
        this.drawNode();
    }

    /** Called by PowerNetwork to discharge stored energy. Returns actual amount discharged. */
    discharge(requested: number): number {
        const available = Math.min(requested, this.dischargeRate, this.currentStorage);
        this.currentStorage -= available;
        this.drawNode();
        return available;
    }

    getStorageRatio(): number {
        return this.currentStorage / this.maxStorage;
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
        }

        // Outer ring
        this.graphics.lineStyle(2, colour, alpha);
        this.graphics.strokeCircle(0, 0, this.nodeRadius);

        // Fill
        this.graphics.fillStyle(COLOUR_DARK_METAL, alpha * 0.7);
        this.graphics.fillCircle(0, 0, this.nodeRadius - 1);

        // Battery icon — vertical bar that fills based on storage
        if (!isConstructing) {
            const barW = 6;
            const barH = 10;
            const fillH = barH * this.getStorageRatio();

            // Battery outline
            this.graphics.lineStyle(1, colour, alpha * 0.6);
            this.graphics.strokeRect(-barW / 2, -barH / 2, barW, barH);
            // Battery terminal nub
            this.graphics.fillStyle(colour, alpha * 0.6);
            this.graphics.fillRect(-2, -barH / 2 - 2, 4, 2);

            // Fill level
            if (fillH > 0) {
                const fillColour = this.getStorageRatio() > 0.6 ? COLOUR_PURPLE : COLOUR_CYAN;
                this.graphics.fillStyle(fillColour, alpha * 0.8);
                this.graphics.fillRect(-barW / 2 + 1, barH / 2 - fillH, barW - 2, fillH);
            }
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

        // Health bar (if damaged, only when not constructing)
        if (!isConstructing && this.currentHealth < this.maxHealth) {
            const barWidth = this.nodeRadius * 2;
            const barHeight = 3;
            const barY = -this.nodeRadius - 8;
            const healthPct = this.currentHealth / this.maxHealth;

            this.graphics.fillStyle(0x333333, 0.8);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth, barHeight);
            this.graphics.fillStyle(healthPct > 0.3 ? COLOUR_CYAN : 0xff3d00, 0.9);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth * healthPct, barHeight);
        }
    }
}
