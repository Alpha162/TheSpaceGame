import Phaser from 'phaser';
import { GameNode } from './Node';
import {
    COMMAND_HUB_HEALTH, COMMAND_HUB_POWER_GEN, COMMAND_HUB_RADIUS,
    COMMAND_HUB_SHIELD_RADIUS, COMMAND_HUB_SHIELD_HEAT_DECAY,
    SHIELD_ABSORB_HEAT_PER_DAMAGE, SHIELD_DEPLOY_SPEED,
    SHIELD_TUNE_DEFAULT, SHIELD_TUNE_MIN, SHIELD_TUNE_MAX,
    SHIELD_TUNE_DRIFT_PER_HIT, SHIELD_TUNE_MANUAL_DRIFT_MULT,
    SHIELD_TUNE_DRIFT_DECAY,
    COLOUR_CYAN, COLOUR_DARK_METAL, COLOUR_RED, COLOUR_SELECTION
} from '../utils/Constants';
import { hexagonPoints, getTuningVisual } from '../utils/Helpers';
import type { Shield } from './defence/Shield';
import type { IClusterShield, ShieldClusterManager } from '../systems/ShieldClusterManager';

export class CommandHub extends GameNode implements IClusterShield {
    readonly isHub = true;
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
    clusterCenterX = 0;
    clusterCenterY = 0;
    /** Shield tuning (0.0 = kinetic, 0.5 = balanced, 1.0 = energy) */
    tuning = SHIELD_TUNE_DEFAULT;
    manualLock = false;
    lastTuningDriftTime = 0;
    private collapseAnimTimer = 0;
    private collapseAnimRadius = 0;
    private collapseAnimColour = 0x00dcff;

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
        const tuningVis = getTuningVisual(this.tuning);
        this.collapseAnimRadius = this.hubShieldRadius;
        this.collapseAnimColour = tuningVis.colour;
        this.collapseAnimTimer = 200;

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
                this.tuning = SHIELD_TUNE_DEFAULT; // Reset tuning on redeploy
            }
            this.drawShieldBubble();
            return;
        }

        // Tick collapse animation
        if (this.collapseAnimTimer > 0) {
            this.collapseAnimTimer -= delta;
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
            // Idle tuning decay (only if not in a cluster — cluster manages its own)
            if (!this.inCluster) {
                this.updateTuningDecay();
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

    isFullyConstructed(): boolean {
        return true; // Hub is always fully constructed
    }

    setManualTuning(value: number): void {
        this.tuning = Math.max(SHIELD_TUNE_MIN, Math.min(SHIELD_TUNE_MAX, value));
        this.manualLock = true;
    }

    clearManualLock(): void {
        this.manualLock = false;
    }

    /** Auto-drift tuning toward incoming damage type */
    applyTuningDrift(incomingDamageType: number): void {
        const driftRate = this.manualLock
            ? SHIELD_TUNE_DRIFT_PER_HIT * SHIELD_TUNE_MANUAL_DRIFT_MULT
            : SHIELD_TUNE_DRIFT_PER_HIT;

        if (incomingDamageType < this.tuning) {
            this.tuning = Math.max(SHIELD_TUNE_MIN, this.tuning - driftRate);
        } else if (incomingDamageType > this.tuning) {
            this.tuning = Math.min(SHIELD_TUNE_MAX, this.tuning + driftRate);
        }
    }

    /** Idle decay: relax tuning toward 0.5 each frame (skipped when manualLock is true) */
    updateTuningDecay(): void {
        if (this.manualLock) return;
        if (this.tuning > 0.5) {
            this.tuning = Math.max(0.5, this.tuning - SHIELD_TUNE_DRIFT_DECAY);
        } else if (this.tuning < 0.5) {
            this.tuning = Math.min(0.5, this.tuning + SHIELD_TUNE_DRIFT_DECAY);
        }
    }

    private drawShieldBubble(): void {
        this.shieldGraphics.clear();
        this.shieldGraphics.x = this.x;
        this.shieldGraphics.y = this.y;

        if (this.hubShieldRadius <= 0 && this.collapseAnimTimer <= 0) return;

        // Tuning-based colour and opacity
        const effectiveTuning = (this.inCluster && this.clusterManager)
            ? (this.clusterManager.getClusterFor(this)?.clusterTuning ?? this.tuning)
            : this.tuning;
        const tuningVis = getTuningVisual(effectiveTuning);
        const colour = this.hubShieldHeat > 0.5
            ? this.blendColour(tuningVis.colour, COLOUR_RED, (this.hubShieldHeat - 0.5) * 2)
            : tuningVis.colour;
        const alpha = tuningVis.opacity;
        const membraneAlphaScale = this.inCluster ? 0.35 : 1;
        const segments = 64;

        // Outer glow
        this.drawRing(segments, this.hubShieldRadius + 4, colour, alpha * 0.08 * membraneAlphaScale, 3);
        // Main membrane
        this.drawRing(segments, this.hubShieldRadius, colour, alpha * 0.12 * membraneAlphaScale, 1.5);
        // Inner shimmer
        if (this.hubShieldRadius > 5) {
            this.drawRing(segments, this.hubShieldRadius - 3, colour, alpha * 0.06 * membraneAlphaScale, 1);
        }

        // Ripple rings (with cluster delay from barycenter)
        let clusterDelay = 0;
        if (this.inCluster) {
            const dcx = this.x - this.clusterCenterX;
            const dcy = this.y - this.clusterCenterY;
            clusterDelay = Math.sqrt(dcx * dcx + dcy * dcy) * 0.005;
        }
        for (let i = 0; i < 3; i++) {
            const rawT = ((this.ripplePhase - clusterDelay) + i / 3) % 1;
            const t = rawT < 0 ? rawT + 1 : rawT;
            const r = this.hubShieldRadius * (0.15 + t * t * 0.85);
            const a = (1 - t) * alpha * 0.1;
            if (a > 0.01) {
                this.drawRing(segments, r, colour, a, 1);
            }
        }

        // Heat glow
        if (this.hubShieldHeat > 0.1 && this.hubShieldRadius > 0) {
            this.shieldGraphics.fillStyle(COLOUR_RED, this.hubShieldHeat * 0.25);
            this.shieldGraphics.fillCircle(0, 0, this.hubShieldRadius * 0.4 * this.hubShieldHeat);
        }

        // Collapse animation
        if (this.collapseAnimTimer > 0) {
            const t = 1 - this.collapseAnimTimer / 200;
            const flashR = this.collapseAnimRadius * (1 + t * 0.5);
            const flashAlpha = (1 - t) * 0.6;
            this.shieldGraphics.lineStyle(3, this.collapseAnimColour, flashAlpha);
            this.shieldGraphics.strokeCircle(0, 0, flashR);
            this.shieldGraphics.lineStyle(1, 0xffffff, flashAlpha * 0.5);
            this.shieldGraphics.strokeCircle(0, 0, flashR * 0.8);
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

            // Cluster deformation: pull toward nearby player shields
            let pull = 0;
            if (this.inCluster) {
                for (const sib of this.siblingShields) {
                    if (sib.bubbleRadius <= 0) continue;
                    const dx = sib.x - this.x;
                    const dy = sib.y - this.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 1) continue;
                    const sibAngle = Math.atan2(dy, dx);
                    let angleDiff = angle - sibAngle;
                    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                    const alignment = Math.max(0, Math.cos(angleDiff));
                    const lobe = alignment * alignment;
                    const gap = dist - this.hubShieldRadius - sib.bubbleRadius;
                    const reach = gap < 20 ? (20 - gap) : 0;
                    if (reach > 0) {
                        pull += reach * 0.6 * lobe;
                    }
                }
            }

            const r = radius * wobble + pull;
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

    private blendColour(a: number, b: number, f: number): number {
        const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
        const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
        const r = Math.round(ar + (br - ar) * f);
        const g = Math.round(ag + (bg - ag) * f);
        const bl = Math.round(ab + (bb - ab) * f);
        return (r << 16) | (g << 8) | bl;
    }

    protected drawNode(): void {
        this.graphics.clear();

        const colour = this.getStateColour();
        const alpha = this.nodeState === 'offline' ? 0.4 : 1;

        // Selection ring
        if (this.selected) {
            this.graphics.lineStyle(2, COLOUR_SELECTION, 0.8);
            this.graphics.strokeCircle(0, 0, this.nodeRadius + 6);
        }

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
