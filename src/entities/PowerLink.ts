import Phaser from 'phaser';
import { GameNode } from './Node';
import { COLOUR_CYAN, COLOUR_AMBER, COLOUR_GREY } from '../utils/Constants';

type LinkState = 'healthy' | 'strained' | 'offline';

export class PowerLink {
    private graphics: Phaser.GameObjects.Graphics;
    private nodeA: GameNode;
    private nodeB: GameNode;
    private state: LinkState = 'healthy';
    private pulseOffset = 0;

    constructor(scene: Phaser.Scene, nodeA: GameNode, nodeB: GameNode) {
        this.nodeA = nodeA;
        this.nodeB = nodeB;
        this.graphics = scene.add.graphics();
        this.graphics.setDepth(-5);
        this.draw();
    }

    connects(node: GameNode): boolean {
        return this.nodeA === node || this.nodeB === node;
    }

    updateState(connectedNodes: Set<GameNode>): void {
        const aConnected = connectedNodes.has(this.nodeA);
        const bConnected = connectedNodes.has(this.nodeB);

        if (!aConnected || !bConnected) {
            this.state = 'offline';
        } else if (this.nodeA.nodeState === 'brownout' || this.nodeB.nodeState === 'brownout') {
            this.state = 'strained';
        } else {
            this.state = 'healthy';
        }
        this.draw();
    }

    animate(): void {
        if (this.state === 'offline') return;
        this.pulseOffset = (this.pulseOffset + 0.02) % 1;
        this.draw();
    }

    private draw(): void {
        this.graphics.clear();

        const ax = this.nodeA.x;
        const ay = this.nodeA.y;
        const bx = this.nodeB.x;
        const by = this.nodeB.y;

        let colour: number;
        let alpha: number;
        let lineWidth: number;

        switch (this.state) {
            case 'healthy':
                colour = COLOUR_CYAN;
                alpha = 0.7;
                lineWidth = 2;
                break;
            case 'strained':
                colour = COLOUR_AMBER;
                alpha = 0.6;
                lineWidth = 2;
                break;
            case 'offline':
                colour = COLOUR_GREY;
                alpha = 0.3;
                lineWidth = 1;
                break;
        }

        // Base line
        this.graphics.lineStyle(lineWidth, colour, alpha * 0.5);
        this.graphics.beginPath();
        this.graphics.moveTo(ax, ay);
        this.graphics.lineTo(bx, by);
        this.graphics.strokePath();

        // Glow line (thicker, more transparent)
        if (this.state !== 'offline') {
            this.graphics.lineStyle(lineWidth + 3, colour, alpha * 0.15);
            this.graphics.beginPath();
            this.graphics.moveTo(ax, ay);
            this.graphics.lineTo(bx, by);
            this.graphics.strokePath();
        }

        // Energy pulse particles along line
        if (this.state !== 'offline') {
            const pulseCount = 3;
            for (let i = 0; i < pulseCount; i++) {
                const t = (this.pulseOffset + i / pulseCount) % 1;
                const px = ax + (bx - ax) * t;
                const py = ay + (by - ay) * t;
                const pulseAlpha = Math.sin(t * Math.PI) * alpha;
                this.graphics.fillStyle(colour, pulseAlpha);
                this.graphics.fillCircle(px, py, 2);
            }
        }
    }

    destroy(): void {
        this.graphics.destroy();
    }
}
