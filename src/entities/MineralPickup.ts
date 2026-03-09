import {
    MINERAL_PICKUP_SCATTER_SPEED, MINERAL_PICKUP_FRICTION,
    MINERAL_PICKUP_LIFETIME,
    COLOUR_AMBER
} from '../utils/Constants';

export type PickupState = 'floating' | 'tractored' | 'transiting' | 'absorbed';

export class MineralPickup {
    x: number;
    y: number;
    vx: number;
    vy: number;
    value: number;
    state: PickupState = 'floating';
    alive = true;

    /** Node currently tractoring this pickup (set by MineralManager) */
    tractorTarget: { x: number; y: number } | null = null;
    /** Current transit target node on the path to hub */
    transitTarget: { x: number; y: number } | null = null;

    readonly graphics: Phaser.GameObjects.Graphics;
    private age = 0;
    private bobPhase: number;
    private rotAngle: number;

    constructor(scene: Phaser.Scene, x: number, y: number, value: number) {
        this.x = x;
        this.y = y;
        this.value = value;

        // Random scatter velocity
        const angle = Math.random() * Math.PI * 2;
        const speed = MINERAL_PICKUP_SCATTER_SPEED * (0.5 + Math.random() * 0.5);
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;

        this.bobPhase = Math.random() * Math.PI * 2;
        this.rotAngle = Math.random() * Math.PI * 2;

        this.graphics = scene.add.graphics();
        this.graphics.setDepth(4);
    }

    update(delta: number): void {
        if (!this.alive) return;

        this.age += delta;
        this.bobPhase += delta * 0.003;
        this.rotAngle += delta * 0.001;

        if (this.state === 'floating') {
            // Apply velocity with friction
            this.x += this.vx * delta;
            this.y += this.vy * delta;
            this.vx *= MINERAL_PICKUP_FRICTION;
            this.vy *= MINERAL_PICKUP_FRICTION;

            // Lifetime expiry
            if (this.age >= MINERAL_PICKUP_LIFETIME) {
                this.alive = false;
                return;
            }
        }

        this.draw();
    }

    private draw(): void {
        this.graphics.clear();

        // Fade out near end of lifetime
        let lifeAlpha = 1;
        if (this.state === 'floating') {
            const remaining = MINERAL_PICKUP_LIFETIME - this.age;
            if (remaining < 3000) {
                lifeAlpha = remaining / 3000;
            }
        }

        // Shrink during transit for a smaller dot look
        const isTransit = this.state === 'transiting';
        const baseSize = isTransit ? 3 : 5;
        const bob = isTransit ? 0 : Math.sin(this.bobPhase) * 1.5;

        const alpha = lifeAlpha * (0.7 + Math.sin(this.bobPhase * 1.5) * 0.3);

        // Outer glow
        this.graphics.fillStyle(COLOUR_AMBER, alpha * 0.15);
        this.graphics.fillCircle(this.x, this.y + bob, baseSize + 4);

        // Crystal diamond shape
        const s = baseSize;
        const cos = Math.cos(this.rotAngle);
        const sin = Math.sin(this.rotAngle);
        const pts = [
            { x: 0, y: -s },      // top
            { x: s * 0.6, y: 0 }, // right
            { x: 0, y: s },       // bottom
            { x: -s * 0.6, y: 0 } // left
        ].map(p => ({
            x: this.x + p.x * cos - p.y * sin,
            y: this.y + bob + p.x * sin + p.y * cos
        }));

        this.graphics.fillStyle(COLOUR_AMBER, alpha * 0.9);
        this.graphics.fillTriangle(
            pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y
        );
        this.graphics.fillTriangle(
            pts[0].x, pts[0].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y
        );

        // Inner bright core
        this.graphics.fillStyle(0xffffff, alpha * 0.6);
        this.graphics.fillCircle(this.x, this.y + bob, isTransit ? 1.5 : 2);
    }

    destroy(): void {
        this.graphics.destroy();
    }
}
