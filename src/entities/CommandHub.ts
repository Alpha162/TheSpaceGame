import Phaser from 'phaser';
import { GameNode } from './Node';
import {
    COMMAND_HUB_HEALTH, COMMAND_HUB_POWER_GEN, COMMAND_HUB_RADIUS,
    COLOUR_CYAN, COLOUR_DARK_METAL
} from '../utils/Constants';
import { hexagonPoints } from '../utils/Helpers';

export class CommandHub extends GameNode {
    powerGeneration: number;
    private glowTween: Phaser.Tweens.Tween | null = null;
    private glowAlpha = 0.6;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, COMMAND_HUB_HEALTH, 0, COMMAND_HUB_RADIUS);
        this.powerGeneration = COMMAND_HUB_POWER_GEN;
        this.drawNode();

        // Pulsing glow animation
        this.glowTween = scene.tweens.add({
            targets: this,
            glowAlpha: { from: 0.4, to: 0.8 },
            duration: 1500,
            yoyo: true,
            repeat: -1,
            onUpdate: () => {
                this.drawNode();
            }
        });
    }

    protected drawNode(): void {
        this.graphics.clear();

        const colour = this.getStateColour();
        const alpha = this.nodeState === 'offline' ? 0.4 : 1;

        // Outer glow
        this.graphics.fillStyle(colour, this.glowAlpha * 0.2 * alpha);
        this.graphics.fillCircle(0, 0, this.nodeRadius + 12);

        // Hexagon body
        const pts = hexagonPoints(0, 0, this.nodeRadius);
        this.graphics.fillStyle(COLOUR_DARK_METAL, alpha * 0.9);
        this.graphics.fillPoints(
            pts.reduce<Phaser.Geom.Point[]>((acc, val, i) => {
                if (i % 2 === 0) acc.push(new Phaser.Geom.Point(val, pts[i + 1]));
                return acc;
            }, []),
            true
        );

        // Hexagon outline
        this.graphics.lineStyle(2, colour, alpha);
        this.graphics.strokePoints(
            pts.reduce<Phaser.Geom.Point[]>((acc, val, i) => {
                if (i % 2 === 0) acc.push(new Phaser.Geom.Point(val, pts[i + 1]));
                return acc;
            }, []),
            true
        );

        // Inner glow core
        this.graphics.fillStyle(colour, this.glowAlpha * alpha);
        this.graphics.fillCircle(0, 0, 8);

        // Health bar (if damaged)
        if (this.currentHealth < this.maxHealth) {
            const barWidth = this.nodeRadius * 2;
            const barHeight = 4;
            const barY = -this.nodeRadius - 10;
            const healthPct = this.currentHealth / this.maxHealth;

            this.graphics.fillStyle(0x333333, 0.8);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth, barHeight);
            this.graphics.fillStyle(healthPct > 0.3 ? COLOUR_CYAN : 0xff3d00, 0.9);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth * healthPct, barHeight);
        }
    }

    destroy(fromScene?: boolean): void {
        if (this.glowTween) {
            this.glowTween.destroy();
        }
        super.destroy(fromScene);
    }
}
