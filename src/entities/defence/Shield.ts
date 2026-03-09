import { GameNode } from '../Node';
import {
    SHIELD_HEALTH, SHIELD_RADIUS, SHIELD_POWER_DEPLOY, SHIELD_POWER_MAINTAIN,
    SHIELD_BUBBLE_MAX_RADIUS, SHIELD_DEPLOY_SPEED, SHIELD_HEAT_DECAY,
    SHIELD_COLLAPSE_COOLDOWN_MS, SHIELD_ABSORB_HEAT_PER_DAMAGE,
    SHIELD_RESERVE_MAX, SHIELD_RESERVE_DRAIN_RATE, SHIELD_RESERVE_FIRE_MULTIPLIER,
    SHIELD_RESERVE_CHARGE_RATE,
    COLOUR_CYAN, COLOUR_DARK_METAL, COLOUR_AMBER, COLOUR_RED, COLOUR_SELECTION,
    PowerPriority
} from '../../utils/Constants';
import type { IClusterShield, ShieldClusterManager } from '../../systems/ShieldClusterManager';

export type ShieldState = 'deploying' | 'maintaining' | 'collapsed' | 'cooldown';

export class Shield extends GameNode implements IClusterShield {
    shieldState: ShieldState = 'deploying';
    bubbleRadius = 0;
    maxBubbleRadius: number = SHIELD_BUBBLE_MAX_RADIUS;
    heatLevel = 0; // 0..1
    internalReserve = 0; // 0..1 — sustains shield briefly when disconnected
    private cooldownTimer = 0;
    private ripplePhase = 0;
    private bubbleGraphics: Phaser.GameObjects.Graphics;
    /** Other active shields for merged rendering */
    siblingShields: Shield[] = [];
    /** Reference to the hub for merged rendering with its built-in shield */
    hubRef: import('../CommandHub').CommandHub | null = null;
    /** Cluster manager for shared heat distribution */
    clusterManager: ShieldClusterManager | null = null;
    inCluster = false;
    clusterSyncPhase = 0;
    clusterCenterX = 0;
    clusterCenterY = 0;

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, SHIELD_HEALTH, SHIELD_POWER_DEPLOY, SHIELD_RADIUS);
        this.powerPriority = PowerPriority.CRITICAL;

        // Separate graphics layer for bubble so it renders behind/around other nodes
        this.bubbleGraphics = scene.add.graphics();
        this.bubbleGraphics.setDepth(-2);

        this.drawNode();
    }

    getCurrentPowerDraw(): number {
        switch (this.shieldState) {
            case 'deploying': return SHIELD_POWER_DEPLOY;
            case 'maintaining': return SHIELD_POWER_MAINTAIN;
            case 'collapsed':
            case 'cooldown': return 0;
        }
    }

    onPowerTick(_delta: number): void {
        // Heat decay
        if (this.heatLevel > 0) {
            this.heatLevel = Math.max(0, this.heatLevel - SHIELD_HEAT_DECAY * 16); // ~16ms per frame equivalent
        }
    }

    private heatDecayMultiplier = 1;

    upgrade(): boolean {
        if (!super.upgrade()) return false;
        this.maxBubbleRadius = Math.round(SHIELD_BUBBLE_MAX_RADIUS * 1.2);
        this.heatDecayMultiplier = 1.5;
        return true;
    }

    // IClusterShield interface
    getShieldRadius(): number { return this.bubbleRadius; }
    getHeat(): number { return this.heatLevel; }
    setHeat(value: number): void { this.heatLevel = value; }
    collapseShield(): void {
        this.heatLevel = 1;
        this.shieldState = 'collapsed';
    }

    update(_time: number, delta: number): void {
        if (this.inCluster) {
            this.ripplePhase = this.clusterSyncPhase;
        } else {
            this.ripplePhase += delta * 0.0008;
        }

        const powered = this.nodeState === 'online';

        // Manage internal reserve
        if (powered) {
            // Charge reserve while receiving power
            this.internalReserve = Math.min(
                SHIELD_RESERVE_MAX,
                this.internalReserve + SHIELD_RESERVE_CHARGE_RATE * delta
            );
        } else if (this.isShieldActive()) {
            // Drain reserve when not powered but shield is still up
            let drain = SHIELD_RESERVE_DRAIN_RATE * delta;
            if (this.heatLevel > 0) {
                drain *= 1 + (SHIELD_RESERVE_FIRE_MULTIPLIER - 1) * this.heatLevel;
            }
            this.internalReserve = Math.max(0, this.internalReserve - drain);
        }

        // Determine if we have any energy to sustain the shield
        const hasEnergy = powered || this.internalReserve > 0;

        if (!hasEnergy) {
            // No power and no reserve — collapse
            if (this.shieldState === 'deploying' || this.shieldState === 'maintaining') {
                this.bubbleRadius = Math.max(0, this.bubbleRadius - SHIELD_DEPLOY_SPEED * 3);
                if (this.bubbleRadius <= 0) {
                    this.shieldState = 'collapsed';
                }
            }
            this.drawBubble();
            return;
        }

        switch (this.shieldState) {
            case 'deploying':
                if (powered) {
                    // Only grow when receiving hub/network power
                    this.bubbleRadius = Math.min(
                        this.maxBubbleRadius,
                        this.bubbleRadius + SHIELD_DEPLOY_SPEED
                    );
                }
                if (this.bubbleRadius >= this.maxBubbleRadius) {
                    this.shieldState = 'maintaining';
                }
                break;

            case 'maintaining':
                // Heat decay (slower when running on reserve only)
                if (this.heatLevel > 0) {
                    const decayMult = (powered ? 1 : 0.3) * this.heatDecayMultiplier;
                    this.heatLevel = Math.max(0, this.heatLevel - SHIELD_HEAT_DECAY * decayMult);
                }
                break;

            case 'collapsed':
                // Start cooldown
                this.shieldState = 'cooldown';
                this.cooldownTimer = SHIELD_COLLAPSE_COOLDOWN_MS;
                this.bubbleRadius = 0;
                break;

            case 'cooldown':
                this.cooldownTimer -= delta;
                if (this.cooldownTimer <= 0) {
                    this.cooldownTimer = 0;
                    this.heatLevel = 0;
                    this.shieldState = 'deploying';
                }
                break;
        }

        this.drawBubble();
    }

    /** Absorb incoming damage. Returns the amount of damage that passed through. */
    absorbDamage(damage: number): number {
        if (!this.isShieldActive()) {
            return damage; // shield is down, all damage passes through
        }

        const heatIncrease = damage * SHIELD_ABSORB_HEAT_PER_DAMAGE;

        if (this.clusterManager) {
            this.clusterManager.distributeHeat(this, heatIncrease);
        } else {
            this.heatLevel += heatIncrease;
            if (this.heatLevel >= 1) {
                this.collapseShield();
            }
        }

        return 0; // fully absorbed
    }

    isShieldActive(): boolean {
        return this.shieldState === 'deploying' || this.shieldState === 'maintaining';
    }

    private drawBubble(): void {
        this.bubbleGraphics.clear();
        this.bubbleGraphics.x = this.x;
        this.bubbleGraphics.y = this.y;

        if (this.bubbleRadius <= 0) return;

        // Colour shifts from cyan to amber to red based on heat
        const baseColour = this.getShieldColour();
        const onReserve = this.nodeState !== 'online' && this.internalReserve > 0;
        // Dim when on reserve (proportional to remaining reserve), very dim on brownout
        const alpha = onReserve
            ? 0.2 + 0.3 * this.internalReserve
            : this.nodeState === 'brownout' ? 0.3 : 0.6;

        // Organic bubble — multiple layers with sine-wave radius perturbation
        const segments = 64;

        // Outer glow
        this.drawOrganicRing(segments, this.bubbleRadius + 4, baseColour, alpha * 0.08, 3, 0);

        // Main bubble membrane
        this.drawOrganicRing(segments, this.bubbleRadius, baseColour, alpha * 0.15, 1.5, 0);

        // Inner shimmer ring
        const shimmerRadius = this.bubbleRadius - 3;
        if (shimmerRadius > 0) {
            this.drawOrganicRing(segments, shimmerRadius, baseColour, alpha * 0.08, 1, Math.PI);
        }

        // Ripple rings — concentric waves that pulse outward (ease-in: slow near center, fast at edge)
        const rippleCount = 3;
        for (let i = 0; i < rippleCount; i++) {
            const rippleLinearT = (this.ripplePhase + i / rippleCount) % 1;
            // Quadratic ease-in: starts slow, accelerates outward
            const rippleT = rippleLinearT * rippleLinearT;
            const rippleR = this.bubbleRadius * (0.15 + rippleT * 0.85);
            const rippleAlpha = (1 - rippleLinearT) * alpha * 0.12;
            if (rippleAlpha > 0.01) {
                this.drawOrganicRing(segments, rippleR, baseColour, rippleAlpha, 1, i * 1.5);
            }
        }

        // Heat glow at the center when absorbing damage
        if (this.heatLevel > 0.1) {
            const heatGlowRadius = this.bubbleRadius * 0.4 * this.heatLevel;
            this.bubbleGraphics.fillStyle(COLOUR_RED, this.heatLevel * 0.3);
            this.bubbleGraphics.fillCircle(0, 0, heatGlowRadius);
        }
    }

    private drawOrganicRing(
        segments: number, radius: number, colour: number,
        alpha: number, lineWidth: number, phaseOffset: number
    ): void {
        this.bubbleGraphics.lineStyle(lineWidth, colour, alpha);

        // Build array of points with inside-sibling flags for clipping
        const points: Array<{ px: number; py: number; inside: boolean }> = [];
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            const wobble = 1 +
                Math.sin(angle * 3 + this.ripplePhase * 2 + phaseOffset) * 0.02 +
                Math.sin(angle * 7 - this.ripplePhase * 1.3 + phaseOffset) * 0.01 +
                Math.sin(angle * 5 + this.ripplePhase * 3.7) * 0.015;

            // Cluster deformation: pull bubble edge toward nearby siblings (merging drops)
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
                    // Smooth lobe toward sibling (cos^4 falloff for soft shape)
                    const alignment = Math.max(0, Math.cos(angleDiff));
                    const lobe = alignment * alignment * alignment * alignment;
                    const overlap = this.bubbleRadius + sib.bubbleRadius - dist;
                    if (overlap > 0) {
                        pull += overlap * 0.35 * lobe;
                    }
                }
                // Also pull toward hub shield
                if (this.hubRef && this.hubRef.isHubShieldUp()) {
                    const dx = this.hubRef.x - this.x;
                    const dy = this.hubRef.y - this.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist > 1) {
                        const sibAngle = Math.atan2(dy, dx);
                        let angleDiff = angle - sibAngle;
                        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                        const alignment = Math.max(0, Math.cos(angleDiff));
                        const lobe = alignment * alignment * alignment * alignment;
                        const overlap = this.bubbleRadius + this.hubRef.hubShieldRadius - dist;
                        if (overlap > 0) {
                            pull += overlap * 0.35 * lobe;
                        }
                    }
                }
            }

            const r = radius * wobble + pull;
            const px = Math.cos(angle) * r;
            const py = Math.sin(angle) * r;

            // Check if this point (in world space) falls inside a sibling shield's bubble
            // Use the sibling's deformed radius (base + pull allowance) for smoother merge
            const worldX = this.x + px;
            const worldY = this.y + py;
            let inside = false;
            for (const sib of this.siblingShields) {
                if (sib.bubbleRadius <= 0) continue;
                const dx = worldX - sib.x;
                const dy = worldY - sib.y;
                // Slightly shrink clip radius so the merge seam disappears
                const clipR = sib.bubbleRadius * 0.92;
                if (dx * dx + dy * dy < clipR * clipR) {
                    inside = true;
                    break;
                }
            }
            // Also check the hub's built-in shield
            if (!inside && this.hubRef && this.hubRef.isHubShieldUp()) {
                const dx = worldX - this.hubRef.x;
                const dy = worldY - this.hubRef.y;
                const clipR = this.hubRef.hubShieldRadius * 0.92;
                if (dx * dx + dy * dy < clipR * clipR) {
                    inside = true;
                }
            }
            points.push({ px, py, inside });
        }

        // Draw only segments that are outside sibling bubbles (split into sub-paths)
        let inPath = false;
        for (let i = 0; i < points.length; i++) {
            const pt = points[i];
            if (pt.inside) {
                // End current sub-path if we were drawing
                if (inPath) {
                    this.bubbleGraphics.strokePath();
                    inPath = false;
                }
            } else {
                if (!inPath) {
                    this.bubbleGraphics.beginPath();
                    this.bubbleGraphics.moveTo(pt.px, pt.py);
                    inPath = true;
                } else {
                    this.bubbleGraphics.lineTo(pt.px, pt.py);
                }
            }
        }
        if (inPath) {
            this.bubbleGraphics.strokePath();
        }
    }

    private getShieldColour(): number {
        if (this.heatLevel < 0.3) return COLOUR_CYAN;
        if (this.heatLevel < 0.7) return COLOUR_AMBER;
        return COLOUR_RED;
    }

    protected drawNode(): void {
        this.graphics.clear();

        const colour = this.getStateColour();
        const isConstructing = this.nodeState === 'constructing';
        const alpha = (this.nodeState === 'offline' || isConstructing) ? 0.4 : 1;

        // Selection ring
        if (this.selected) {
            this.graphics.lineStyle(2, COLOUR_SELECTION, 0.8);
            this.graphics.strokeCircle(0, 0, this.nodeRadius + 4);
        }

        // Outer ring
        this.graphics.lineStyle(2, colour, alpha);
        this.graphics.strokeCircle(0, 0, this.nodeRadius);

        // Fill
        this.graphics.fillStyle(COLOUR_DARK_METAL, alpha * 0.7);
        this.graphics.fillCircle(0, 0, this.nodeRadius - 1);

        // Shield icon — arc segments
        if (!isConstructing) {
            const iconColour = this.isShieldActive() ? this.getShieldColour() : colour;
            this.graphics.lineStyle(1.5, iconColour, alpha * 0.9);
            // Draw a small shield shape: dome arc + base
            this.graphics.beginPath();
            this.graphics.arc(0, 1, 5, -Math.PI * 0.8, -Math.PI * 0.2);
            this.graphics.strokePath();
            this.graphics.beginPath();
            this.graphics.arc(0, 1, 5, Math.PI * 0.2, Math.PI * 0.8);
            this.graphics.strokePath();
        }

        // Heat bar (when shield is active and has heat)
        if (!isConstructing && this.heatLevel > 0 && this.isShieldActive()) {
            const barWidth = this.nodeRadius * 2;
            const barHeight = 3;
            const barY = this.nodeRadius + 6;

            this.graphics.fillStyle(0x333333, 0.8);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth, barHeight);
            const heatColour = this.heatLevel < 0.7 ? COLOUR_AMBER : COLOUR_RED;
            this.graphics.fillStyle(heatColour, 0.9);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth * this.heatLevel, barHeight);
        }

        // Cooldown bar
        if (this.shieldState === 'cooldown') {
            const barWidth = this.nodeRadius * 2;
            const barHeight = 3;
            const barY = this.nodeRadius + 6;
            const cooldownPct = this.cooldownTimer / SHIELD_COLLAPSE_COOLDOWN_MS;

            this.graphics.fillStyle(0x333333, 0.8);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth, barHeight);
            this.graphics.fillStyle(COLOUR_RED, 0.6);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth * cooldownPct, barHeight);
        }

        // Reserve bar (when shield is running on internal reserve)
        if (!isConstructing && this.nodeState !== 'online' && this.internalReserve > 0 && this.isShieldActive()) {
            const barWidth = this.nodeRadius * 2;
            const barHeight = 3;
            const barY = this.nodeRadius + 6;

            this.graphics.fillStyle(0x333333, 0.8);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth, barHeight);
            this.graphics.fillStyle(COLOUR_AMBER, 0.7);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth * this.internalReserve, barHeight);
        }

        // Construction progress bar
        if (isConstructing) {
            const barWidth = this.nodeRadius * 2;
            const barHeight = 3;
            const barY = this.nodeRadius + 6;

            this.graphics.fillStyle(0x333333, 0.8);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth, barHeight);
            this.graphics.fillStyle(COLOUR_AMBER, 0.9);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth * this.constructionProgress, barHeight);
        }

        // Health bar (if damaged, only when not constructing)
        if (!isConstructing && this.currentHealth < this.maxHealth) {
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

    destroy(fromScene?: boolean): void {
        this.bubbleGraphics.destroy();
        super.destroy(fromScene);
    }
}
