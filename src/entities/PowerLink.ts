import Phaser from 'phaser';
import { GameNode } from './Node';
import { COLOUR_CYAN, COLOUR_AMBER, COLOUR_GREY, POWER_PULSE_SPEED } from '../utils/Constants';

type LinkState = 'healthy' | 'strained' | 'offline';

export class PowerLink {
    private graphics: Phaser.GameObjects.Graphics;
    private nodeA: GameNode;
    private nodeB: GameNode;
    private state: LinkState = 'healthy';
    private pulseOffset = 0;
    private _showPulses = true;
    // Direction: power flows from sourceNode toward sinkNode
    // sourceNode is the node closer to the hub (lower BFS distance)
    private sourceNode: GameNode;
    private sinkNode: GameNode;
    /** True if both endpoints are anchor nodes (relay/hub) — backbone link */
    isBackbone = false;

    constructor(scene: Phaser.Scene, nodeA: GameNode, nodeB: GameNode) {
        this.nodeA = nodeA;
        this.nodeB = nodeB;
        this.sourceNode = nodeA;
        this.sinkNode = nodeB;
        this.graphics = scene.add.graphics();
        this.graphics.setDepth(-5);
        this.draw();
    }

    connects(node: GameNode): boolean {
        return this.nodeA === node || this.nodeB === node;
    }

    getNodeA(): GameNode {
        return this.nodeA;
    }

    getNodeB(): GameNode {
        return this.nodeB;
    }

    /** Set which direction power flows based on BFS distances from hub */
    setFlowDirection(bfsDistances: Map<GameNode, number>): void {
        const distA = bfsDistances.get(this.nodeA) ?? Infinity;
        const distB = bfsDistances.get(this.nodeB) ?? Infinity;

        // Power flows from the node closer to hub (lower distance) to the one further away
        if (distA <= distB) {
            this.sourceNode = this.nodeA;
            this.sinkNode = this.nodeB;
        } else {
            this.sourceNode = this.nodeB;
            this.sinkNode = this.nodeA;
        }
    }

    /** Whether this link should show animated power pulses */
    setShowPulses(show: boolean): void {
        this._showPulses = show;
    }

    updateState(connectedNodes: Set<GameNode>): void {
        const aConnected = connectedNodes.has(this.nodeA);
        const bConnected = connectedNodes.has(this.nodeB);

        if (!aConnected || !bConnected) {
            this.state = 'offline';
        } else if (this.nodeA.nodeState === 'brownout' || this.nodeB.nodeState === 'brownout'
                || this.nodeA.nodeState === 'constructing' || this.nodeB.nodeState === 'constructing') {
            this.state = 'strained';
        } else {
            this.state = 'healthy';
        }
        this.draw();
    }

    animate(): void {
        if (this.state === 'offline') return;
        // Much slower pulse speed for visible power flow
        this.pulseOffset = (this.pulseOffset + POWER_PULSE_SPEED) % 1;
        this.draw();
    }

    private draw(): void {
        this.graphics.clear();

        // Power flows from source (closer to hub) to sink (further from hub)
        const ax = this.sourceNode.x;
        const ay = this.sourceNode.y;
        const bx = this.sinkNode.x;
        const by = this.sinkNode.y;

        let colour: number;
        let alpha: number;
        let lineWidth: number;

        switch (this.state) {
            case 'healthy':
                colour = COLOUR_CYAN;
                alpha = this.isBackbone ? 0.85 : 0.5;
                lineWidth = this.isBackbone ? 2.5 : 1.5;
                break;
            case 'strained':
                colour = COLOUR_AMBER;
                alpha = this.isBackbone ? 0.7 : 0.45;
                lineWidth = this.isBackbone ? 2.5 : 1.5;
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

        // Glow line (thicker, more transparent) — wider for backbone
        if (this.state !== 'offline') {
            const glowExtra = this.isBackbone ? 4 : 3;
            this.graphics.lineStyle(lineWidth + glowExtra, colour, alpha * 0.15);
            this.graphics.beginPath();
            this.graphics.moveTo(ax, ay);
            this.graphics.lineTo(bx, by);
            this.graphics.strokePath();
        }

        // Energy pulse particles flowing from source to sink
        // Only show pulses on links that carry power to a downstream consumer
        if (this.state !== 'offline' && this._showPulses) {
            const pulseCount = this.isBackbone ? 3 : 2;
            const pulseSize = this.isBackbone ? 3.5 : 2.5;
            for (let i = 0; i < pulseCount; i++) {
                const t = (this.pulseOffset + i / pulseCount) % 1;
                const px = ax + (bx - ax) * t;
                const py = ay + (by - ay) * t;
                const pulseAlpha = Math.sin(t * Math.PI) * alpha;
                this.graphics.fillStyle(colour, pulseAlpha);
                this.graphics.fillCircle(px, py, pulseSize);
            }
        }
    }

    destroy(): void {
        this.graphics.destroy();
    }
}
