import { GameNode } from '../Node';
import { Enemy } from '../Enemy';
import { CombatSystem } from '../../systems/CombatSystem';
import {
    MISSILE_HEALTH, MISSILE_RADIUS, MISSILE_POWER, MISSILE_RANGE,
    MISSILE_DAMAGE, MISSILE_AOE_RADIUS, MISSILE_FIRE_RATE, MISSILE_PROJECTILE_SPEED,
    COLOUR_CYAN, COLOUR_DARK_METAL, COLOUR_AMBER, COLOUR_RED, COLOUR_SELECTION, COLOUR_GREEN,
    PowerPriority, NODE_REPAIR_POWER_COST
} from '../../utils/Constants';
import { distanceBetween } from '../../utils/Helpers';
import { SoundManager } from '../../systems/SoundManager';

interface MissileProjectile {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    graphics: Phaser.GameObjects.Graphics;
}

interface Explosion {
    x: number;
    y: number;
    age: number;
    maxAge: number;
    graphics: Phaser.GameObjects.Graphics;
}

export class Missile extends GameNode {
    private combatSystem: CombatSystem | null = null;
    private currentTarget: Enemy | null = null;
    private fireCooldown = 0;
    private turretAngle = 0;
    private rangeGraphics: Phaser.GameObjects.Graphics;
    private missiles: MissileProjectile[] = [];
    private explosions: Explosion[] = [];

    constructor(scene: Phaser.Scene, x: number, y: number) {
        super(scene, x, y, MISSILE_HEALTH, MISSILE_POWER, MISSILE_RADIUS);
        this.powerPriority = PowerPriority.HIGH;

        this.rangeGraphics = scene.add.graphics();
        this.rangeGraphics.setDepth(-1);

        this.drawNode();
    }

    setCombatSystem(combatSystem: CombatSystem): void {
        this.combatSystem = combatSystem;
    }

    getCurrentPowerDraw(): number {
        let draw = this.currentTarget ? this.powerConsumption : 0;
        if (this.isRepairing) draw += NODE_REPAIR_POWER_COST;
        return draw;
    }

    update(_time: number, delta: number): void {
        if (this.nodeState !== 'online' || !this.isFullyConstructed()) {
            this.updateProjectiles(delta);
            this.updateExplosions(delta);
            return;
        }
        if (!this.combatSystem) return;

        // Cooldown
        if (this.fireCooldown > 0) this.fireCooldown -= delta;

        // Find target — prefer clusters of enemies (pick enemy with most neighbors in AoE)
        const enemies = this.combatSystem.getEnemies();
        let bestTarget: Enemy | null = null;
        let bestScore = -1;

        for (const enemy of enemies) {
            if (!enemy.alive) continue;
            const dist = distanceBetween(this.x, this.y, enemy.x, enemy.y);
            if (dist > MISSILE_RANGE) continue;

            // Score: count nearby enemies for AoE value
            let nearbyCount = 0;
            for (const other of enemies) {
                if (!other.alive || other === enemy) continue;
                if (distanceBetween(enemy.x, enemy.y, other.x, other.y) <= MISSILE_AOE_RADIUS) {
                    nearbyCount++;
                }
            }
            const score = nearbyCount + 1; // +1 for the target itself
            if (score > bestScore) {
                bestScore = score;
                bestTarget = enemy;
            }
        }

        this.currentTarget = bestTarget;

        if (bestTarget) {
            const dx = bestTarget.x - this.x;
            const dy = bestTarget.y - this.y;
            this.turretAngle = Math.atan2(dy, dx);

            if (this.fireCooldown <= 0) {
                this.fireCooldown = 1000 / MISSILE_FIRE_RATE;
                this.fireMissile(bestTarget);
                SoundManager.play('missileLaunch');
            }
        }

        this.updateProjectiles(delta);
        this.updateExplosions(delta);
        this.drawNode();
    }

    private fireMissile(target: Enemy): void {
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;

        const gfx = this.scene.add.graphics();
        gfx.setDepth(8);

        this.missiles.push({
            x: this.x, y: this.y,
            vx: (dx / dist) * MISSILE_PROJECTILE_SPEED,
            vy: (dy / dist) * MISSILE_PROJECTILE_SPEED,
            life: 3000,
            graphics: gfx
        });
    }

    private updateProjectiles(delta: number): void {
        if (!this.combatSystem) return;
        const enemies = this.combatSystem.getEnemies();

        for (let i = this.missiles.length - 1; i >= 0; i--) {
            const m = this.missiles[i];
            m.life -= delta;

            if (m.life <= 0) {
                m.graphics.destroy();
                this.missiles.splice(i, 1);
                continue;
            }

            m.x += m.vx * (delta / 1000);
            m.y += m.vy * (delta / 1000);

            // Check collision with any enemy
            let hit = false;
            for (const enemy of enemies) {
                if (!enemy.alive) continue;
                if (distanceBetween(m.x, m.y, enemy.x, enemy.y) <= enemy.radius + 5) {
                    hit = true;
                    break;
                }
            }

            if (hit) {
                // AoE damage
                for (const enemy of enemies) {
                    if (!enemy.alive) continue;
                    if (distanceBetween(m.x, m.y, enemy.x, enemy.y) <= MISSILE_AOE_RADIUS) {
                        enemy.takeDamage(MISSILE_DAMAGE);
                    }
                }
                SoundManager.play('explosion');

                // Spawn explosion
                const expGfx = this.scene.add.graphics();
                expGfx.setDepth(9);
                this.explosions.push({
                    x: m.x, y: m.y,
                    age: 0, maxAge: 400,
                    graphics: expGfx
                });

                m.graphics.destroy();
                this.missiles.splice(i, 1);
                continue;
            }

            // Draw missile
            m.graphics.clear();
            m.graphics.x = m.x;
            m.graphics.y = m.y;
            m.graphics.fillStyle(COLOUR_AMBER, 0.9);
            m.graphics.fillCircle(0, 0, 3);
            m.graphics.fillStyle(COLOUR_RED, 0.4);
            m.graphics.fillCircle(0, 0, 5);
        }
    }

    private updateExplosions(delta: number): void {
        for (let i = this.explosions.length - 1; i >= 0; i--) {
            const exp = this.explosions[i];
            exp.age += delta;

            if (exp.age >= exp.maxAge) {
                exp.graphics.destroy();
                this.explosions.splice(i, 1);
                continue;
            }

            const t = exp.age / exp.maxAge;
            const radius = MISSILE_AOE_RADIUS * t;
            const alpha = (1 - t) * 0.5;

            exp.graphics.clear();
            exp.graphics.x = exp.x;
            exp.graphics.y = exp.y;
            // Expanding ring
            exp.graphics.lineStyle(2, COLOUR_AMBER, alpha);
            exp.graphics.strokeCircle(0, 0, radius);
            // Inner flash
            if (t < 0.3) {
                exp.graphics.fillStyle(COLOUR_RED, (1 - t / 0.3) * 0.3);
                exp.graphics.fillCircle(0, 0, radius * 0.5);
            }
        }
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
            if (this.rangeGraphics) {
                this.rangeGraphics.clear();
                this.rangeGraphics.x = this.x;
                this.rangeGraphics.y = this.y;
                this.rangeGraphics.lineStyle(1, COLOUR_AMBER, 0.15);
                this.rangeGraphics.strokeCircle(0, 0, MISSILE_RANGE);
                // Show AoE radius
                this.rangeGraphics.lineStyle(1, COLOUR_RED, 0.1);
                this.rangeGraphics.strokeCircle(0, 0, MISSILE_AOE_RADIUS);
            }
        } else if (this.rangeGraphics) {
            this.rangeGraphics.clear();
        }

        // Outer ring
        this.graphics.lineStyle(2, colour, alpha);
        this.graphics.strokeCircle(0, 0, this.nodeRadius);

        // Fill
        this.graphics.fillStyle(COLOUR_DARK_METAL, alpha * 0.7);
        this.graphics.fillCircle(0, 0, this.nodeRadius - 1);

        // Missile icon — stub barrel + warhead
        if (!isConstructing) {
            const barrelColour = this.fireCooldown > (1000 / MISSILE_FIRE_RATE) * 0.5
                ? COLOUR_AMBER : colour;

            const cos = Math.cos(this.turretAngle);
            const sin = Math.sin(this.turretAngle);

            // Shorter, wider barrel
            this.graphics.lineStyle(2.5, barrelColour, alpha);
            this.graphics.beginPath();
            this.graphics.moveTo(0, 0);
            this.graphics.lineTo(cos * (this.nodeRadius + 3), sin * (this.nodeRadius + 3));
            this.graphics.strokePath();

            // Center
            this.graphics.fillStyle(colour, alpha * 0.9);
            this.graphics.fillCircle(0, 0, 3.5);

            if (this.currentTarget) {
                this.graphics.fillStyle(COLOUR_RED, 0.8);
                this.graphics.fillCircle(cos * (this.nodeRadius + 3), sin * (this.nodeRadius + 3), 2);
            }
        }

        // Upgrade chevron
        if (this.upgraded) {
            this.graphics.lineStyle(1, COLOUR_AMBER, alpha * 0.8);
            this.graphics.beginPath();
            this.graphics.moveTo(-3, -this.nodeRadius - 3);
            this.graphics.lineTo(0, -this.nodeRadius - 6);
            this.graphics.lineTo(3, -this.nodeRadius - 3);
            this.graphics.strokePath();
        }

        // Repair indicator
        if (this.isRepairing) {
            this.graphics.fillStyle(COLOUR_GREEN, 0.9);
            this.graphics.fillRect(-1, -this.nodeRadius - 4, 2, 5);
            this.graphics.fillRect(-2.5, -this.nodeRadius - 2.5, 5, 2);
        }

        // Construction bar
        if (isConstructing) {
            const barWidth = this.nodeRadius * 2;
            const barHeight = 3;
            const barY = this.nodeRadius + 6;
            this.graphics.fillStyle(0x333333, 0.8);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth, barHeight);
            this.graphics.fillStyle(COLOUR_AMBER, 0.9);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth * this.constructionProgress, barHeight);
        }

        // Health bar
        if (!isConstructing && this.currentHealth < this.maxHealth) {
            const barWidth = this.nodeRadius * 2;
            const barHeight = 3;
            const barY = -this.nodeRadius - 8;
            const healthPct = this.currentHealth / this.maxHealth;
            this.graphics.fillStyle(0x333333, 0.8);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth, barHeight);
            this.graphics.fillStyle(healthPct > 0.3 ? COLOUR_CYAN : COLOUR_RED, 0.9);
            this.graphics.fillRect(-barWidth / 2, barY, barWidth * healthPct, barHeight);
        }
    }

    destroy(fromScene?: boolean): void {
        for (const m of this.missiles) m.graphics.destroy();
        for (const e of this.explosions) e.graphics.destroy();
        this.rangeGraphics.destroy();
        super.destroy(fromScene);
    }
}
