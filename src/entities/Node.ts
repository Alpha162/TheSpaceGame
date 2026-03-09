import Phaser from 'phaser';
import {
    NODE_RADIUS, COLOUR_CYAN, COLOUR_GREY, COLOUR_DARK_METAL, COLOUR_AMBER,
    COLOUR_SELECTION, COLOUR_GREEN, CONSTRUCTION_TIME_MS, PowerPriority,
    NODE_REPAIR_DELAY_MS, NODE_REPAIR_RATE, NODE_REPAIR_POWER_COST
} from '../utils/Constants';

export type NodeState = 'online' | 'offline' | 'brownout' | 'constructing';

export class GameNode extends Phaser.GameObjects.Container {
    nodeRadius: number;
    maxHealth: number;
    currentHealth: number;
    powerConsumption: number;
    powerPriority: PowerPriority = PowerPriority.NORMAL;
    nodeState: NodeState = 'online';
    selected = false;
    constructionProgress = 1; // 0..1, 1 = complete
    private isConstructing = false;
    private lastConstructionTime = 0;
    constructionPowered = true; // whether this node has a valid powered path for construction
    protected graphics: Phaser.GameObjects.Graphics;

    // Repair state
    private lastDamageTime = 0;
    private _isRepairing = false;

    // Upgrade state
    upgraded = false;

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
        this.lastConstructionTime = this.scene.time.now;
        this.nodeState = 'constructing';
        this.drawNode();
    }

    isFullyConstructed(): boolean {
        return !this.isConstructing;
    }

    updateConstruction(): boolean {
        if (!this.isConstructing) return false;

        const now = this.scene.time.now;

        // Only accumulate progress when powered (valid path to hub)
        if (this.constructionPowered) {
            const delta = now - this.lastConstructionTime;
            this.constructionProgress = Math.min(this.constructionProgress + delta / CONSTRUCTION_TIME_MS, 1);
        }

        this.lastConstructionTime = now;

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

    /** Returns the current power draw for this tick. Override for dynamic consumption. */
    getCurrentPowerDraw(): number {
        let draw = this.powerConsumption;
        if (this._isRepairing) {
            draw += NODE_REPAIR_POWER_COST;
        }
        return draw;
    }

    /** Whether this node is currently self-repairing */
    get isRepairing(): boolean {
        return this._isRepairing;
    }

    /** Called each power tick when node is online. Override for per-tick behaviour. */
    onPowerTick(_delta: number): void {
        // Base class: handle repair
        this.updateRepair(_delta);
    }

    /** Update repair state. Called during power tick when online. */
    protected updateRepair(delta: number): void {
        if (this.currentHealth >= this.maxHealth) {
            this._isRepairing = false;
            return;
        }

        const now = this.scene.time.now;
        const timeSinceDamage = now - this.lastDamageTime;

        if (timeSinceDamage >= NODE_REPAIR_DELAY_MS && this.nodeState === 'online') {
            this._isRepairing = true;
            this.currentHealth = Math.min(
                this.maxHealth,
                this.currentHealth + NODE_REPAIR_RATE * delta
            );
            if (this.currentHealth >= this.maxHealth) {
                this.currentHealth = this.maxHealth;
                this._isRepairing = false;
            }
            this.drawNode();
        } else {
            this._isRepairing = false;
        }
    }

    /** Override in subclasses to apply stat boosts. Returns true if upgrade was applied. */
    upgrade(): boolean {
        if (this.upgraded) return false;
        this.upgraded = true;
        this.drawNode();
        return true;
    }

    canUpgrade(): boolean {
        return !this.upgraded && this.isFullyConstructed() && this.nodeState !== 'offline';
    }

    /** Force a visual refresh. Use when external state changes affect rendering. */
    refreshVisuals(): void {
        this.drawNode();
    }

    takeDamage(amount: number): boolean {
        this.currentHealth = Math.max(0, this.currentHealth - amount);
        this.lastDamageTime = this.scene.time.now;
        this._isRepairing = false;
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

        // Repair indicator (small green + near node)
        if (this._isRepairing) {
            this.graphics.fillStyle(COLOUR_GREEN, 0.9);
            this.graphics.fillRect(-1, -this.nodeRadius - 4, 2, 5);
            this.graphics.fillRect(-2.5, -this.nodeRadius - 2.5, 5, 2);
        }

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
