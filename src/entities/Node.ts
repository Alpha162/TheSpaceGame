import Phaser from 'phaser';
import {
    NODE_RADIUS, COLOUR_CYAN, COLOUR_GREY, COLOUR_DARK_METAL, COLOUR_AMBER,
    COLOUR_SELECTION, CONSTRUCTION_TIME_MS
} from '../utils/Constants';

export type NodeState = 'online' | 'offline' | 'brownout' | 'constructing';

export class GameNode extends Phaser.GameObjects.Container {
    nodeRadius: number;
    maxHealth: number;
    currentHealth: number;
    powerConsumption: number;
    nodeState: NodeState = 'online';
    selected = false;
    constructionProgress = 1; // 0..1, 1 = complete
    private constructionStartTime = 0;
    private isConstructing = false;
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

    startConstruction(): void {
        this.isConstructing = true;
        this.constructionProgress = 0;
        this.constructionStartTime = this.scene.time.now;
        this.nodeState = 'constructing';
        this.drawNode();
    }

    isFullyConstructed(): boolean {
        return !this.isConstructing;
    }

    updateConstruction(): boolean {
        if (!this.isConstructing) return false;

        const elapsed = this.scene.time.now - this.constructionStartTime;
        this.constructionProgress = Math.min(elapsed / CONSTRUCTION_TIME_MS, 1);

        if (this.constructionProgress >= 1) {
            this.isConstructing = false;
            this.constructionProgress = 1;
            this.drawNode();
            return true; // just finished
        }

        this.drawNode();
        return false;
    }

    setNodeState(newState: NodeState): void {
        if (this.isConstructing && newState !== 'constructing') return;
        if (this.nodeState !== newState) {
            this.nodeState = newState;
            this.drawNode();
        }
    }

    setSelected(value: boolean): void {
        if (this.selected !== value) {
            this.selected = value;
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
        const alpha = this.nodeState === 'offline' || this.nodeState === 'constructing' ? 0.4 : 1;

        // Selection ring
        if (this.selected) {
            this.graphics.lineStyle(2, COLOUR_SELECTION, 0.8);
            this.graphics.strokeCircle(0, 0, this.nodeRadius + 4);
        }

        // Outer ring
        this.graphics.lineStyle(2, colour, alpha);
        this.graphics.strokeCircle(0, 0, this.nodeRadius);

        // Fill
        this.graphics.fillStyle(COLOUR_DARK_METAL, alpha * 0.8);
        this.graphics.fillCircle(0, 0, this.nodeRadius - 2);

        // Center dot
        this.graphics.fillStyle(colour, alpha);
        this.graphics.fillCircle(0, 0, 3);

        // Construction progress bar
        if (this.isConstructing) {
            const barWidth = this.nodeRadius * 2;
            const barHeight = 3;
            const barY = this.nodeRadius + 6;

            this.graphics.fillStyle(0x333333, 0.8);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth, barHeight);
            this.graphics.fillStyle(COLOUR_AMBER, 0.9);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth * this.constructionProgress, barHeight);
        }
    }

    protected getStateColour(): number {
        switch (this.nodeState) {
            case 'online': return COLOUR_CYAN;
            case 'brownout': return COLOUR_AMBER;
            case 'offline': return COLOUR_GREY;
            case 'constructing': return COLOUR_GREY;
        }
    }

    destroy(fromScene?: boolean): void {
        this.graphics.destroy();
        super.destroy(fromScene);
    }
}
