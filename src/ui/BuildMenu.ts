import Phaser from 'phaser';
import { BuildSystem, BUILDABLE_CONFIGS, BuildableType } from '../systems/BuildSystem';
import { VIEWPORT_HEIGHT, COLOUR_PANEL, COLOUR_PANEL_BORDER, COLOUR_CYAN } from '../utils/Constants';

interface MenuButton {
    bg: Phaser.GameObjects.Graphics;
    text: Phaser.GameObjects.Text;
    costText: Phaser.GameObjects.Text;
    type: BuildableType;
    x: number;
    y: number;
    width: number;
    height: number;
}

export class BuildMenu {
    private scene: Phaser.Scene;
    private buildSystem: BuildSystem;
    private buttons: MenuButton[] = [];
    private bgGraphics: Phaser.GameObjects.Graphics;

    constructor(scene: Phaser.Scene, buildSystem: BuildSystem) {
        this.scene = scene;
        this.buildSystem = buildSystem;

        // Background panel
        this.bgGraphics = scene.add.graphics();
        this.bgGraphics.setScrollFactor(0);
        this.bgGraphics.setDepth(200);

        const panelY = VIEWPORT_HEIGHT - 70;
        this.bgGraphics.fillStyle(COLOUR_PANEL, 0.85);
        this.bgGraphics.fillRoundedRect(4, panelY, 200, 64, 4);
        this.bgGraphics.lineStyle(1, COLOUR_PANEL_BORDER, 0.6);
        this.bgGraphics.strokeRoundedRect(4, panelY, 200, 64, 4);

        // Build buttons
        this.createButton('relay', 12, panelY + 6, 80, 52);

        // Keyboard shortcut
        if (scene.input.keyboard) {
            scene.input.keyboard.on('keydown-ONE', () => {
                this.buildSystem.startBuild('relay');
                this.updateButtonStates();
            });
        }
    }

    private createButton(type: BuildableType, x: number, y: number, width: number, height: number): void {
        const config = BUILDABLE_CONFIGS[type];

        const bg = this.scene.add.graphics();
        bg.setScrollFactor(0);
        bg.setDepth(201);

        const text = this.scene.add.text(x + width / 2, y + 14, config.label, {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#ffffff'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);

        const costText = this.scene.add.text(x + width / 2, y + 32, `${config.cost}m / ${config.powerConsumption}pw`, {
            fontFamily: 'monospace',
            fontSize: '9px',
            color: '#888888'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);

        const button: MenuButton = { bg, text, costText, type, x, y, width, height };
        this.buttons.push(button);

        // Make interactive via zone
        const zone = this.scene.add.zone(x + width / 2, y + height / 2, width, height)
            .setScrollFactor(0)
            .setDepth(203)
            .setInteractive({ useHandCursor: true });

        zone.on('pointerdown', () => {
            this.buildSystem.startBuild(type);
            this.updateButtonStates();
        });

        zone.on('pointerover', () => {
            text.setColor('#00e5ff');
        });

        zone.on('pointerout', () => {
            const isActive = this.buildSystem.getActiveBuildType() === type;
            text.setColor(isActive ? '#00e5ff' : '#ffffff');
        });

        this.drawButton(button, false);
    }

    private drawButton(button: MenuButton, active: boolean): void {
        button.bg.clear();
        const colour = active ? COLOUR_CYAN : COLOUR_PANEL_BORDER;
        const fillAlpha = active ? 0.2 : 0.4;

        button.bg.fillStyle(COLOUR_PANEL, fillAlpha);
        button.bg.fillRoundedRect(button.x, button.y, button.width, button.height, 3);
        button.bg.lineStyle(1, colour, 0.6);
        button.bg.strokeRoundedRect(button.x, button.y, button.width, button.height, 3);
    }

    private updateButtonStates(): void {
        const activeType = this.buildSystem.getActiveBuildType();
        for (const button of this.buttons) {
            const isActive = button.type === activeType;
            this.drawButton(button, isActive);
            button.text.setColor(isActive ? '#00e5ff' : '#ffffff');
        }
    }
}
