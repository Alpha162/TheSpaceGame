import { GameNode } from '../Node';
import { MineralAsteroid } from '../MineralAsteroid';
import {
    MINER_HEALTH, MINER_RADIUS, MINER_POWER, MINER_RANGE,
    MINER_RATE, MINER_TICK_MS,
    COLOUR_CYAN, COLOUR_DARK_METAL, COLOUR_AMBER, COLOUR_SELECTION, COLOUR_GREEN,
    PowerPriority, NODE_REPAIR_POWER_COST
} from '../../utils/Constants';
import { distanceBetween } from '../../utils/Helpers';
import type { MineralManager } from '../../systems/MineralManager';

export class MineralMiner extends GameNode {
    private tickAccumulator = 0;
    private targetAsteroid: MineralAsteroid | null = null;
    private mineralManager: MineralManager | null = null;
    private asteroids: MineralAsteroid[] = [];
    private beamGraphics: Phaser.GameObjects.Graphics;
    private miningPhase = 0;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, MINER_HEALTH, MINER_POWER, MINER_RADIUS);
        this.powerPriority = PowerPriority.NORMAL;

        this.beamGraphics = scene.add.graphics();
        this.beamGraphics.setDepth(2);

        this.drawNode();
    }

    setMineralManager(mm: MineralManager): void {
        this.mineralManager = mm;
    }

    setAsteroids(asteroids: MineralAsteroid[]): void {
        this.asteroids = asteroids;
    }

    getCurrentPowerDraw(): number {
        let draw = this.targetAsteroid ? this.powerConsumption : 0;
        if (this.isRepairing) draw += NODE_REPAIR_POWER_COST;
        return draw;
    }

    update(_time: number, delta: number): void {
        if (this.nodeState !== 'online' || !this.isFullyConstructed()) {
            this.beamGraphics.clear();
            return;
        }

        this.miningPhase += delta * 0.003;

        // Find nearest non-depleted asteroid in range
        this.targetAsteroid = null;
        let bestDist = MINER_RANGE;
        for (const asteroid of this.asteroids) {
            if (asteroid.depleted) continue;
            const dist = distanceBetween(this.x, this.y, asteroid.x, asteroid.y);
            if (dist < bestDist) {
                bestDist = dist;
                this.targetAsteroid = asteroid;
            }
        }

        // Mining tick
        if (this.targetAsteroid && this.mineralManager) {
            this.tickAccumulator += delta;
            if (this.tickAccumulator >= MINER_TICK_MS) {
                this.tickAccumulator -= MINER_TICK_MS;
                const extracted = this.targetAsteroid.extract(MINER_RATE);
                if (extracted > 0) {
                    this.mineralManager.spawnPickup(this.x, this.y, extracted);
                }
            }

            // Draw mining beam
            this.beamGraphics.clear();
            const pulse = 0.3 + Math.sin(this.miningPhase) * 0.2;
            this.beamGraphics.lineStyle(1.5, COLOUR_AMBER, pulse);
            this.beamGraphics.beginPath();
            this.beamGraphics.moveTo(this.x, this.y);
            this.beamGraphics.lineTo(this.targetAsteroid.x, this.targetAsteroid.y);
            this.beamGraphics.strokePath();

            // Sparkle at asteroid end
            const sparkleR = 3 + Math.sin(this.miningPhase * 2) * 2;
            this.beamGraphics.fillStyle(COLOUR_AMBER, pulse * 0.5);
            this.beamGraphics.fillCircle(this.targetAsteroid.x, this.targetAsteroid.y, sparkleR);
        } else {
            this.beamGraphics.clear();
            this.tickAccumulator = 0;
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

            // Show mining range when selected
            this.graphics.lineStyle(1, COLOUR_AMBER, 0.15);
            this.graphics.strokeCircle(0, 0, MINER_RANGE);
        }

        // Outer ring
        this.graphics.lineStyle(2, colour, alpha);
        this.graphics.strokeCircle(0, 0, this.nodeRadius);

        // Fill
        this.graphics.fillStyle(COLOUR_DARK_METAL, alpha * 0.7);
        this.graphics.fillCircle(0, 0, this.nodeRadius - 1);

        // Miner icon — pickaxe shape
        if (!isConstructing) {
            const iconColour = this.targetAsteroid ? COLOUR_AMBER : colour;
            this.graphics.lineStyle(1.5, iconColour, alpha * 0.9);
            // Diagonal line
            this.graphics.beginPath();
            this.graphics.moveTo(-4, 4);
            this.graphics.lineTo(4, -4);
            this.graphics.strokePath();
            // Pick head
            this.graphics.beginPath();
            this.graphics.moveTo(2, -6);
            this.graphics.lineTo(6, -2);
            this.graphics.strokePath();
        }

        // Upgrade chevron
        if (this.upgraded) {
            this.graphics.lineStyle(1, COLOUR_AMBER, alpha * 0.8);
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

        // Health bar
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

    destroy(fromScene?: boolean): void {
        this.beamGraphics.destroy();
        super.destroy(fromScene);
    }
}
