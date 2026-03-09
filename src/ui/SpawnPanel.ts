import Phaser from 'phaser';
import { CombatSystem } from '../systems/CombatSystem';
import {
    COLOUR_PANEL, COLOUR_PANEL_BORDER, COLOUR_RED, UI_SCALE
} from '../utils/Constants';

export class SpawnPanel {
    private scene: Phaser.Scene;
    private combatSystem: CombatSystem;
    private allObjects: Phaser.GameObjects.GameObject[] = [];
    private countText: Phaser.GameObjects.Text;
    private enemyCountText: Phaser.GameObjects.Text;
    private spawnCount = 5;

    private bg: Phaser.GameObjects.Graphics;
    private title: Phaser.GameObjects.Text;
    private minusZone: Phaser.GameObjects.Zone;
    private minusGfx: Phaser.GameObjects.Graphics;
    private minusText: Phaser.GameObjects.Text;
    private plusZone: Phaser.GameObjects.Zone;
    private plusGfx: Phaser.GameObjects.Graphics;
    private plusText: Phaser.GameObjects.Text;
    private spawnZone: Phaser.GameObjects.Zone;
    private spawnGfx: Phaser.GameObjects.Graphics;
    private spawnText: Phaser.GameObjects.Text;
    private readonly handleResize: (size: Phaser.Structs.Size) => void;

    constructor(scene: Phaser.Scene, combatSystem: CombatSystem) {
        this.scene = scene;
        this.combatSystem = combatSystem;

        // Background panel
        this.bg = scene.add.graphics();
        this.bg.setScrollFactor(0);
        this.bg.setDepth(200);
        this.allObjects.push(this.bg);

        // Title
        const s = UI_SCALE;
        this.title = scene.add.text(0, 0, 'ENEMIES', {
            fontFamily: 'monospace',
            fontSize: `${Math.round(9 * s)}px`,
            color: '#ff3d00'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
        this.allObjects.push(this.title);

        // Minus button
        this.minusZone = scene.add.zone(0, 0, 0, 0)
            .setScrollFactor(0).setDepth(203).setInteractive({ useHandCursor: true });
        this.allObjects.push(this.minusZone);

        this.minusGfx = scene.add.graphics();
        this.minusGfx.setScrollFactor(0).setDepth(201);
        this.allObjects.push(this.minusGfx);

        this.minusText = scene.add.text(0, 0, '-', {
            fontFamily: 'monospace', fontSize: `${Math.round(14 * s)}px`, color: '#ffffff'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
        this.allObjects.push(this.minusText);

        this.minusZone.on('pointerdown', () => {
            this.spawnCount = Math.max(1, this.spawnCount - 1);
            this.updateCountDisplay();
        });

        // Count display
        this.countText = scene.add.text(0, 0, `${this.spawnCount}`, {
            fontFamily: 'monospace', fontSize: `${Math.round(14 * s)}px`, color: '#ffffff'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
        this.allObjects.push(this.countText);

        // Plus button
        this.plusZone = scene.add.zone(0, 0, 0, 0)
            .setScrollFactor(0).setDepth(203).setInteractive({ useHandCursor: true });
        this.allObjects.push(this.plusZone);

        this.plusGfx = scene.add.graphics();
        this.plusGfx.setScrollFactor(0).setDepth(201);
        this.allObjects.push(this.plusGfx);

        this.plusText = scene.add.text(0, 0, '+', {
            fontFamily: 'monospace', fontSize: `${Math.round(14 * s)}px`, color: '#ffffff'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
        this.allObjects.push(this.plusText);

        this.plusZone.on('pointerdown', () => {
            this.spawnCount = Math.min(50, this.spawnCount + 1);
            this.updateCountDisplay();
        });

        // Spawn button
        this.spawnGfx = scene.add.graphics();
        this.spawnGfx.setScrollFactor(0).setDepth(201);
        this.allObjects.push(this.spawnGfx);

        this.spawnText = scene.add.text(0, 0, 'SPAWN', {
            fontFamily: 'monospace', fontSize: `${Math.round(10 * s)}px`, color: '#ff3d00'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
        this.allObjects.push(this.spawnText);

        this.spawnZone = scene.add.zone(0, 0, 0, 0)
            .setScrollFactor(0).setDepth(203).setInteractive({ useHandCursor: true });
        this.allObjects.push(this.spawnZone);

        this.spawnZone.on('pointerdown', () => {
            this.combatSystem.spawnWave(this.spawnCount);
        });
        this.spawnZone.on('pointerover', () => this.spawnText.setColor('#ffffff'));
        this.spawnZone.on('pointerout', () => this.spawnText.setColor('#ff3d00'));

        // Active enemy count display
        this.enemyCountText = scene.add.text(0, 0, 'Active: 0', {
            fontFamily: 'monospace', fontSize: `${Math.round(9 * s)}px`, color: '#888888'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
        this.allObjects.push(this.enemyCountText);

        this.relayout(scene.scale.width, scene.scale.height);

        this.handleResize = (size: Phaser.Structs.Size) => {
            this.relayout(size.width, size.height);
        };
        this.scene.scale.on('resize', this.handleResize, this);
    }

    relayout(width: number, height: number): void {
        const s = UI_SCALE;
        const panelX = width - 174 * s;
        const panelY = height - 70 * s;
        const panelW = 170 * s;
        const panelH = 64 * s;
        const btnY = panelY + 22 * s;
        const btnSize = 20 * s;

        this.bg.clear();
        this.bg.fillStyle(COLOUR_PANEL, 0.85);
        this.bg.fillRoundedRect(panelX, panelY, panelW, panelH, 4 * s);
        this.bg.lineStyle(1 * s, COLOUR_PANEL_BORDER, 0.6);
        this.bg.strokeRoundedRect(panelX, panelY, panelW, panelH, 4 * s);

        this.title.setPosition(panelX + panelW / 2, panelY + 8 * s);

        const minusBtnX = panelX + 8 * s;
        this.minusZone.setPosition(minusBtnX + btnSize / 2, btnY + btnSize / 2).setSize(btnSize, btnSize);
        this.minusGfx.clear();
        this.minusGfx.fillStyle(COLOUR_PANEL_BORDER, 0.6);
        this.minusGfx.fillRoundedRect(minusBtnX, btnY, btnSize, btnSize, 2 * s);
        this.minusGfx.lineStyle(1 * s, COLOUR_PANEL_BORDER, 0.8);
        this.minusGfx.strokeRoundedRect(minusBtnX, btnY, btnSize, btnSize, 2 * s);
        this.minusText.setPosition(minusBtnX + btnSize / 2, btnY + btnSize / 2);

        this.countText.setPosition(panelX + panelW / 2 - 16 * s, btnY + btnSize / 2);

        const plusBtnX = panelX + panelW / 2 - 16 * s + 18 * s;
        this.plusZone.setPosition(plusBtnX + btnSize / 2, btnY + btnSize / 2).setSize(btnSize, btnSize);
        this.plusGfx.clear();
        this.plusGfx.fillStyle(COLOUR_PANEL_BORDER, 0.6);
        this.plusGfx.fillRoundedRect(plusBtnX, btnY, btnSize, btnSize, 2 * s);
        this.plusGfx.lineStyle(1 * s, COLOUR_PANEL_BORDER, 0.8);
        this.plusGfx.strokeRoundedRect(plusBtnX, btnY, btnSize, btnSize, 2 * s);
        this.plusText.setPosition(plusBtnX + btnSize / 2, btnY + btnSize / 2);

        const spawnBtnX = plusBtnX + btnSize + 8 * s;
        const spawnBtnW = panelX + panelW - spawnBtnX - 8 * s;
        this.spawnZone.setPosition(spawnBtnX + spawnBtnW / 2, btnY + btnSize / 2).setSize(spawnBtnW, btnSize);
        this.spawnGfx.clear();
        this.spawnGfx.fillStyle(COLOUR_RED, 0.3);
        this.spawnGfx.fillRoundedRect(spawnBtnX, btnY, spawnBtnW, btnSize, 2 * s);
        this.spawnGfx.lineStyle(1 * s, COLOUR_RED, 0.6);
        this.spawnGfx.strokeRoundedRect(spawnBtnX, btnY, spawnBtnW, btnSize, 2 * s);
        this.spawnText.setPosition(spawnBtnX + spawnBtnW / 2, btnY + btnSize / 2);

        this.enemyCountText.setPosition(panelX + panelW / 2, panelY + panelH - 12 * s);
    }

    private updateCountDisplay(): void {
        this.countText.setText(`${this.spawnCount}`);
    }

    update(): void {
        this.enemyCountText.setText(`Active: ${this.combatSystem.getEnemyCount()}`);
    }

    destroy(): void {
        this.scene.scale.off('resize', this.handleResize, this);
    }

    getGameObjects(): Phaser.GameObjects.GameObject[] {
        return this.allObjects;
    }
}
