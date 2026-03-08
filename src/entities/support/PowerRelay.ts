import { GameNode } from '../Node';
import { RELAY_HEALTH, RELAY_POWER, RELAY_RADIUS, COLOUR_CYAN, COLOUR_DARK_METAL } from '../../utils/Constants';

export class PowerRelay extends GameNode {
    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, RELAY_HEALTH, RELAY_POWER, RELAY_RADIUS);
        this.drawNode();
    }

    protected drawNode(): void {
        this.graphics.clear();

        const colour = this.getStateColour();
        const alpha = this.nodeState === 'offline' ? 0.4 : 1;

        // Outer ring
        this.graphics.lineStyle(2, colour, alpha);
        this.graphics.strokeCircle(0, 0, this.nodeRadius);

        // Fill
        this.graphics.fillStyle(COLOUR_DARK_METAL, alpha * 0.7);
        this.graphics.fillCircle(0, 0, this.nodeRadius - 1);

        // Cross pattern (relay icon)
        this.graphics.lineStyle(1.5, colour, alpha * 0.8);
        this.graphics.beginPath();
        this.graphics.moveTo(-4, 0);
        this.graphics.lineTo(4, 0);
        this.graphics.moveTo(0, -4);
        this.graphics.lineTo(0, 4);
        this.graphics.strokePath();

        // Health bar (if damaged)
        if (this.currentHealth < this.maxHealth) {
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
