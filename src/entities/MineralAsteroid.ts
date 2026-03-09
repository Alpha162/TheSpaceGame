import {
    ASTEROID_MINERALS, ASTEROID_RADIUS,
    COLOUR_AMBER, COLOUR_DARK_METAL, COLOUR_GREY
} from '../utils/Constants';

export class MineralAsteroid {
    readonly graphics: Phaser.GameObjects.Graphics;
    x: number;
    y: number;
    radius: number;
    minerals: number;
    maxMinerals: number;
    depleted = false;
    /** Pre-generated irregular shape vertices */
    private vertices: Array<{ angle: number; r: number }> = [];
    /** Crystal vein positions */
    private veins: Array<{ angle: number; r: number; size: number }> = [];

    constructor(scene: Phaser.Scene, x: number, y: number) {
        this.x = x;
        this.y = y;
        this.radius = ASTEROID_RADIUS;
        this.minerals = ASTEROID_MINERALS;
        this.maxMinerals = ASTEROID_MINERALS;

        // Generate irregular rock shape
        const vertexCount = 8 + Math.floor(Math.random() * 4);
        for (let i = 0; i < vertexCount; i++) {
            const angle = (i / vertexCount) * Math.PI * 2;
            const r = this.radius * (0.7 + Math.random() * 0.3);
            this.vertices.push({ angle, r });
        }

        // Generate crystal veins
        const veinCount = 3 + Math.floor(Math.random() * 3);
        for (let i = 0; i < veinCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const r = Math.random() * this.radius * 0.6;
            const size = 2 + Math.random() * 2;
            this.veins.push({ angle, r, size });
        }

        this.graphics = scene.add.graphics();
        this.graphics.setDepth(1);
        this.draw();
    }

    /** Extract minerals. Returns amount actually extracted. */
    extract(amount: number): number {
        const extracted = Math.min(amount, this.minerals);
        this.minerals -= extracted;
        if (this.minerals <= 0) {
            this.minerals = 0;
            this.depleted = true;
        }
        this.draw();
        return extracted;
    }

    private draw(): void {
        this.graphics.clear();
        this.graphics.x = this.x;
        this.graphics.y = this.y;

        if (this.depleted) return;

        const reservePct = this.minerals / this.maxMinerals;
        const alpha = 0.4 + reservePct * 0.6;

        // Rocky body
        this.graphics.fillStyle(COLOUR_DARK_METAL, alpha * 0.8);
        this.graphics.beginPath();
        const first = this.vertices[0];
        this.graphics.moveTo(
            Math.cos(first.angle) * first.r,
            Math.sin(first.angle) * first.r
        );
        for (let i = 1; i < this.vertices.length; i++) {
            const v = this.vertices[i];
            this.graphics.lineTo(
                Math.cos(v.angle) * v.r,
                Math.sin(v.angle) * v.r
            );
        }
        this.graphics.closePath();
        this.graphics.fillPath();

        // Rock outline
        this.graphics.lineStyle(1.5, COLOUR_GREY, alpha * 0.6);
        this.graphics.beginPath();
        this.graphics.moveTo(
            Math.cos(first.angle) * first.r,
            Math.sin(first.angle) * first.r
        );
        for (let i = 1; i < this.vertices.length; i++) {
            const v = this.vertices[i];
            this.graphics.lineTo(
                Math.cos(v.angle) * v.r,
                Math.sin(v.angle) * v.r
            );
        }
        this.graphics.closePath();
        this.graphics.strokePath();

        // Crystal veins — amber glow spots
        for (const vein of this.veins) {
            const vx = Math.cos(vein.angle) * vein.r;
            const vy = Math.sin(vein.angle) * vein.r;
            this.graphics.fillStyle(COLOUR_AMBER, alpha * 0.5 * reservePct);
            this.graphics.fillCircle(vx, vy, vein.size * reservePct);
            this.graphics.fillStyle(COLOUR_AMBER, alpha * 0.15);
            this.graphics.fillCircle(vx, vy, vein.size * 2 * reservePct);
        }

        // Reserve indicator — small text-less bar below
        const barW = this.radius * 1.5;
        const barH = 2;
        const barY = this.radius + 4;
        this.graphics.fillStyle(0x333333, 0.5);
        this.graphics.fillRect(-barW / 2, barY, barW, barH);
        this.graphics.fillStyle(COLOUR_AMBER, 0.6);
        this.graphics.fillRect(-barW / 2, barY, barW * reservePct, barH);
    }

    destroy(): void {
        this.graphics.destroy();
    }
}
