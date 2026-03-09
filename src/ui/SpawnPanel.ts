import Phaser from 'phaser';
import { CombatSystem } from '../systems/CombatSystem';
import {
    VIEWPORT_WIDTH, VIEWPORT_HEIGHT,
    COLOUR_PANEL, COLOUR_PANEL_BORDER, COLOUR_RED
} from '../utils/Constants';

export class SpawnPanel {
    private combatSystem: CombatSystem;
    private allObjects: Phaser.GameObjects.GameObject[] = [];
    private countText: Phaser.GameObjects.Text;
    private enemyCountText: Phaser.GameObjects.Text;
    private spawnCount = 5;

    constructor(scene: Phaser.Scene, combatSystem: CombatSystem) {
        this.combatSystem = combatSystem;

        const panelX = VIEWPORT_WIDTH - 174;
        const panelY = VIEWPORT_HEIGHT - 70;
        const panelW = 170;
        const panelH = 64;

        // Background panel
        const bg = scene.add.graphics();
        bg.setScrollFactor(0);
        bg.setDepth(200);
        bg.fillStyle(COLOUR_PANEL, 0.85);
        bg.fillRoundedRect(panelX, panelY, panelW, panelH, 4);
        bg.lineStyle(1, COLOUR_PANEL_BORDER, 0.6);
        bg.strokeRoundedRect(panelX, panelY, panelW, panelH, 4);
        this.allObjects.push(bg);

        // Title
        const title = scene.add.text(panelX + panelW / 2, panelY + 8, 'ENEMIES', {
            fontFamily: 'monospace',
            fontSize: '9px',
            color: '#ff3d00'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
        this.allObjects.push(title);

        // Minus button
        const minusBtnX = panelX + 8;
        const btnY = panelY + 22;
        const btnSize = 20;

        const minusZone = scene.add.zone(minusBtnX + btnSize / 2, btnY + btnSize / 2, btnSize, btnSize)
            .setScrollFactor(0).setDepth(203).setInteractive({ useHandCursor: true });
        this.allObjects.push(minusZone);

        const minusGfx = scene.add.graphics();
        minusGfx.setScrollFactor(0).setDepth(201);
        minusGfx.fillStyle(COLOUR_PANEL_BORDER, 0.6);
        minusGfx.fillRoundedRect(minusBtnX, btnY, btnSize, btnSize, 2);
        minusGfx.lineStyle(1, COLOUR_PANEL_BORDER, 0.8);
        minusGfx.strokeRoundedRect(minusBtnX, btnY, btnSize, btnSize, 2);
        this.allObjects.push(minusGfx);

        const minusText = scene.add.text(minusBtnX + btnSize / 2, btnY + btnSize / 2, '-', {
            fontFamily: 'monospace', fontSize: '14px', color: '#ffffff'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
        this.allObjects.push(minusText);

        minusZone.on('pointerdown', () => {
            this.spawnCount = Math.max(1, this.spawnCount - 1);
            this.updateCountDisplay();
        });

        // Count display
        this.countText = scene.add.text(panelX + panelW / 2 - 16, btnY + btnSize / 2, `${this.spawnCount}`, {
            fontFamily: 'monospace', fontSize: '14px', color: '#ffffff'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
        this.allObjects.push(this.countText);

        // Plus button
        const plusBtnX = panelX + panelW / 2 - 16 + 18;

        const plusZone = scene.add.zone(plusBtnX + btnSize / 2, btnY + btnSize / 2, btnSize, btnSize)
            .setScrollFactor(0).setDepth(203).setInteractive({ useHandCursor: true });
        this.allObjects.push(plusZone);

        const plusGfx = scene.add.graphics();
        plusGfx.setScrollFactor(0).setDepth(201);
        plusGfx.fillStyle(COLOUR_PANEL_BORDER, 0.6);
        plusGfx.fillRoundedRect(plusBtnX, btnY, btnSize, btnSize, 2);
        plusGfx.lineStyle(1, COLOUR_PANEL_BORDER, 0.8);
        plusGfx.strokeRoundedRect(plusBtnX, btnY, btnSize, btnSize, 2);
        this.allObjects.push(plusGfx);

        const plusText = scene.add.text(plusBtnX + btnSize / 2, btnY + btnSize / 2, '+', {
            fontFamily: 'monospace', fontSize: '14px', color: '#ffffff'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
        this.allObjects.push(plusText);

        plusZone.on('pointerdown', () => {
            this.spawnCount = Math.min(50, this.spawnCount + 1);
            this.updateCountDisplay();
        });

        // Spawn button
        const spawnBtnX = plusBtnX + btnSize + 8;
        const spawnBtnW = panelX + panelW - spawnBtnX - 8;

        const spawnGfx = scene.add.graphics();
        spawnGfx.setScrollFactor(0).setDepth(201);
        spawnGfx.fillStyle(COLOUR_RED, 0.3);
        spawnGfx.fillRoundedRect(spawnBtnX, btnY, spawnBtnW, btnSize, 2);
        spawnGfx.lineStyle(1, COLOUR_RED, 0.6);
        spawnGfx.strokeRoundedRect(spawnBtnX, btnY, spawnBtnW, btnSize, 2);
        this.allObjects.push(spawnGfx);

        const spawnText = scene.add.text(spawnBtnX + spawnBtnW / 2, btnY + btnSize / 2, 'SPAWN', {
            fontFamily: 'monospace', fontSize: '10px', color: '#ff3d00'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
        this.allObjects.push(spawnText);

        const spawnZone = scene.add.zone(spawnBtnX + spawnBtnW / 2, btnY + btnSize / 2, spawnBtnW, btnSize)
            .setScrollFactor(0).setDepth(203).setInteractive({ useHandCursor: true });
        this.allObjects.push(spawnZone);

        spawnZone.on('pointerdown', () => {
            this.combatSystem.spawnWave(this.spawnCount);
        });
        spawnZone.on('pointerover', () => spawnText.setColor('#ffffff'));
        spawnZone.on('pointerout', () => spawnText.setColor('#ff3d00'));

        // Active enemy count display
        this.enemyCountText = scene.add.text(panelX + panelW / 2, panelY + panelH - 12, 'Active: 0', {
            fontFamily: 'monospace', fontSize: '9px', color: '#888888'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
        this.allObjects.push(this.enemyCountText);
    }

    private updateCountDisplay(): void {
        this.countText.setText(`${this.spawnCount}`);
    }

    update(): void {
        this.enemyCountText.setText(`Active: ${this.combatSystem.getEnemyCount()}`);
    }

    getGameObjects(): Phaser.GameObjects.GameObject[] {
        return this.allObjects;
    }
}
