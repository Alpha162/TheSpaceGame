import Phaser from 'phaser';
import { NODE_RADIUS, COLOUR_CYAN, COLOUR_GREY, COLOUR_DARK_METAL, COLOUR_AMBER } from '../utils/Constants';

export type NodeState = 'online' | 'offline' | 'brownout';

export class GameNode extends Phaser.GameObjects.Container {
    nodeRadius: number;
    maxHealth: number;
    currentHealth: number;
    powerConsumption: number;
    nodeState: NodeState = 'online';
    protected graphics: Phaser.GameObjects.Graphics;

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        health: number,
        powerConsumption: number,
        radius: number = NODE_RADIUS
    ) {
        super(scene, x, y);
        this.nodeRadius = radius;
        this.maxHealth = health;
        this.currentHealth = health;
        this.powerConsumption = powerConsumption;

        this.graphics = scene.add.graphics();
        this.add(this.graphics);

        scene.add.existing(this as Phaser.GameObjects.Container);
        this.drawNode();
    }

    setNodeState(newState: NodeState): void {
        if (this.nodeState !== newState) {
            this.nodeState = newState;
            this.drawNode();
        }
    }

    takeDamage(amount: number): boolean {
        this.currentHealth = Math.max(0, this.currentHealth - amount);
        this.drawNode();
        return this.currentHealth <= 0;
    }

    protected drawNode(): void {
        this.graphics.clear();

        const colour = this.getStateColour();
        const alpha = this.nodeState === 'offline' ? 0.4 : 1;

        // Outer ring
        this.graphics.lineStyle(2, colour, alpha);
        this.graphics.strokeCircle(0, 0, this.nodeRadius);

        // Fill
        this.graphics.fillStyle(COLOUR_DARK_METAL, alpha * 0.8);
        this.graphics.fillCircle(0, 0, this.nodeRadius - 2);

        // Center dot
        this.graphics.fillStyle(colour, alpha);
        this.graphics.fillCircle(0, 0, 3);
    }

    protected getStateColour(): number {
        switch (this.nodeState) {
            case 'online': return COLOUR_CYAN;
            case 'brownout': return COLOUR_AMBER;
            case 'offline': return COLOUR_GREY;
        }
    }

    destroy(fromScene?: boolean): void {
        this.graphics.destroy();
        super.destroy(fromScene);
    }
}
