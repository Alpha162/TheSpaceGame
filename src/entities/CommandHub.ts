import Phaser from 'phaser';
import { GameNode } from './Node';
import {
    COMMAND_HUB_HEALTH, COMMAND_HUB_POWER_GEN, COMMAND_HUB_RADIUS,
    COMMAND_HUB_SHIELD_RADIUS, COMMAND_HUB_SHIELD_HEAT_DECAY,
    SHIELD_ABSORB_HEAT_PER_DAMAGE, SHIELD_DEPLOY_SPEED,
    COLOUR_CYAN, COLOUR_DARK_METAL, COLOUR_AMBER, COLOUR_RED
} from '../utils/Constants';
import { hexagonPoints } from '../utils/Helpers';
import type { Shield } from './defence/Shield';
import type { IClusterShield, ShieldClusterManager } from '../systems/ShieldClusterManager';

export class CommandHub extends GameNode implements IClusterShield {
    powerGeneration: number;
    private glowTween: Phaser.Tweens.Tween | null = null;
    private glowAlpha = 0.6;

    // Built-in shield
    hubShieldRadius = 0;
    hubShieldMaxRadius = COMMAND_HUB_SHIELD_RADIUS;
    hubShieldHeat = 0; // 0..1
    hubShieldActive = true;
    private hubShieldCooldown = 0;
    private shieldGraphics: Phaser.GameObjects.Graphics;
    private ripplePhase = 0;
    /** Active player shields — used to clip overlapping ring segments */
    siblingShields: Shield[] = [];
    /** Cluster manager for shared heat distribution */
    clusterManager: ShieldClusterManager | null = null;
    inCluster = false;
    clusterSyncPhase = 0;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, COMMAND_HUB_HEALTH, 0, COMMAND_HUB_RADIUS);
        this.powerGeneration = COMMAND_HUB_POWER_GEN;

        this.shieldGraphics = scene.add.graphics();
        this.shieldGraphics.setDepth(-2);

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

    // IClusterShield interface
    getShieldRadius(): number { return this.hubShieldRadius; }
    getHeat(): number { return this.hubShieldHeat; }
    setHeat(value: number): void { this.hubShieldHeat = value; }
    collapseShield(): void {
        this.hubShieldHeat = 1;
        this.hubShieldActive = false;
        this.hubShieldRadius = 0;
        this.hubShieldCooldown = 5000;
    }

    /** Called each frame by PowerNetwork to update the hub shield */
    updateHubShield(delta: number): void {
        if (this.inCluster) {
            this.ripplePhase = this.clusterSyncPhase;
        } else {
            this.ripplePhase += delta * 0.0008;
        }

        if (this.hubShieldCooldown > 0) {
            this.hubShieldCooldown -= delta;
            if (this.hubShieldCooldown <= 0) {
                this.hubShieldCooldown = 0;
                this.hubShieldHeat = 0;
                this.hubShieldActive = true;
            }
            this.drawShieldBubble();
            return;
        }

        if (this.hubShieldActive) {
            // Deploy
            if (this.hubShieldRadius < this.hubShieldMaxRadius) {
                this.hubShieldRadius = Math.min(
                    this.hubShieldMaxRadius,
                    this.hubShieldRadius + SHIELD_DEPLOY_SPEED
                );
            }
            // Heat decay
            if (this.hubShieldHeat > 0) {
                this.hubShieldHeat = Math.max(0, this.hubShieldHeat - COMMAND_HUB_SHIELD_HEAT_DECAY);
            }
        }

        this.drawShieldBubble();
    }

    /** Absorb damage on the hub's built-in shield. Returns damage that passed through. */
    absorbShieldDamage(damage: number): number {
        if (!this.hubShieldActive || this.hubShieldRadius <= 0) {
            return damage;
        }

        const heatIncrease = damage * SHIELD_ABSORB_HEAT_PER_DAMAGE;

        if (this.clusterManager) {
            this.clusterManager.distributeHeat(this, heatIncrease);
        } else {
            this.hubShieldHeat += heatIncrease;
            if (this.hubShieldHeat >= 1) {
                this.collapseShield();
            }
        }

        return 0;
    }

    isHubShieldUp(): boolean {
        return this.hubShieldActive && this.hubShieldRadius > 0;
    }

    isShieldActive(): boolean {
        return this.isHubShieldUp();
    }

    private drawShieldBubble(): void {
        this.shieldGraphics.clear();
        this.shieldGraphics.x = this.x;
        this.shieldGraphics.y = this.y;

        if (this.hubShieldRadius <= 0) return;

        const colour = this.getShieldColour();
        const alpha = 0.5;
        const segments = 64;

        // Outer glow
        this.drawRing(segments, this.hubShieldRadius + 4, colour, alpha * 0.08, 3);
        // Main membrane
        this.drawRing(segments, this.hubShieldRadius, colour, alpha * 0.12, 1.5);
        // Inner shimmer
        if (this.hubShieldRadius > 5) {
            this.drawRing(segments, this.hubShieldRadius - 3, colour, alpha * 0.06, 1);
        }

        // Ripple rings
        for (let i = 0; i < 3; i++) {
            const t = (this.ripplePhase + i / 3) % 1;
            const r = this.hubShieldRadius * (0.15 + t * t * 0.85);
            const a = (1 - t) * alpha * 0.1;
            if (a > 0.01) {
                this.drawRing(segments, r, colour, a, 1);
            }
        }

        // Heat glow
        if (this.hubShieldHeat > 0.1) {
            this.shieldGraphics.fillStyle(COLOUR_RED, this.hubShieldHeat * 0.25);
            this.shieldGraphics.fillCircle(0, 0, this.hubShieldRadius * 0.4 * this.hubShieldHeat);
        }
    }

    private drawRing(segments: number, radius: number, colour: number, alpha: number, lineWidth: number): void {
        this.shieldGraphics.lineStyle(lineWidth, colour, alpha);

        const points: Array<{ px: number; py: number; inside: boolean }> = [];
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const wobble = 1 +
                Math.sin(angle * 3 + this.ripplePhase * 2) * 0.02 +
                Math.sin(angle * 7 - this.ripplePhase * 1.3) * 0.01;
            const r = radius * wobble;
            const px = Math.cos(angle) * r;
            const py = Math.sin(angle) * r;

            // Check if point falls inside a player shield bubble
            const worldX = this.x + px;
            const worldY = this.y + py;
            let inside = false;
            for (const sib of this.siblingShields) {
                if (sib.bubbleRadius <= 0) continue;
                const dx = worldX - sib.x;
                const dy = worldY - sib.y;
                if (dx * dx + dy * dy < sib.bubbleRadius * sib.bubbleRadius) {
                    inside = true;
                    break;
                }
            }
            points.push({ px, py, inside });
        }

        // Draw only segments outside sibling bubbles
        let inPath = false;
        for (const pt of points) {
            if (pt.inside) {
                if (inPath) {
                    this.shieldGraphics.strokePath();
                    inPath = false;
                }
            } else {
                if (!inPath) {
                    this.shieldGraphics.beginPath();
                    this.shieldGraphics.moveTo(pt.px, pt.py);
                    inPath = true;
                } else {
                    this.shieldGraphics.lineTo(pt.px, pt.py);
                }
            }
        }
        if (inPath) {
            this.shieldGraphics.strokePath();
        }
    }

    private getShieldColour(): number {
        if (this.hubShieldHeat < 0.3) return COLOUR_CYAN;
        if (this.hubShieldHeat < 0.7) return COLOUR_AMBER;
        return COLOUR_RED;
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
        this.shieldGraphics.destroy();
        super.destroy(fromScene);
    }
}
