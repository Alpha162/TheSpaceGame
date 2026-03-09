import Phaser from 'phaser';
import { BuildSystem, BUILDABLE_CONFIGS, BuildableType } from '../systems/BuildSystem';
import { COLOUR_PANEL, COLOUR_PANEL_BORDER, COLOUR_CYAN, UI_SCALE } from '../utils/Constants';

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

const BUILD_ORDER: BuildableType[] = ['relay', 'shield', 'capacitor', 'blaster', 'miner', 'laser', 'missile'];
const KEY_NAMES = ['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN'];

export class BuildMenu {
    private scene: Phaser.Scene;
    private buildSystem: BuildSystem;
    private buttons: MenuButton[] = [];
    private bgGraphics: Phaser.GameObjects.Graphics;
    private allObjects: Phaser.GameObjects.GameObject[] = [];

    constructor(scene: Phaser.Scene, buildSystem: BuildSystem) {
        this.scene = scene;
        this.buildSystem = buildSystem;

        // Background panel
        this.bgGraphics = scene.add.graphics();
        this.bgGraphics.setScrollFactor(0);
        this.bgGraphics.setDepth(200);

        const s = UI_SCALE;
        const panelY = scene.scale.height - 70 * s;
        const btnW = 84 * s;
        const gap = 6 * s;
        const panelW = BUILD_ORDER.length * (btnW + gap) + gap;
        this.bgGraphics.fillStyle(COLOUR_PANEL, 0.85);
        this.bgGraphics.fillRoundedRect(4 * s, panelY, panelW, 64 * s, 4 * s);
        this.bgGraphics.lineStyle(1 * s, COLOUR_PANEL_BORDER, 0.6);
        this.bgGraphics.strokeRoundedRect(4 * s, panelY, panelW, 64 * s, 4 * s);
        this.allObjects.push(this.bgGraphics);

        // Build buttons
        const btnH = 52 * s;
        let bx = 12 * s;
        for (const type of BUILD_ORDER) {
            this.createButton(type, bx, panelY + 6 * s, btnW, btnH);
            bx += btnW + gap;
        }

        // Keyboard shortcuts 1-7
        if (scene.input.keyboard) {
            for (let i = 0; i < BUILD_ORDER.length; i++) {
                const type = BUILD_ORDER[i];
                scene.input.keyboard.on(`keydown-${KEY_NAMES[i]}`, () => {
                    this.buildSystem.startBuild(type);
                    this.updateButtonStates();
                });
            }
            scene.input.keyboard.on('keydown-Q', () => {
                this.updateButtonStates();
            });
            scene.input.keyboard.on('keydown-ESC', () => {
                this.updateButtonStates();
            });
        }
    }

    private createButton(type: BuildableType, x: number, y: number, width: number, height: number): void {
        const config = BUILDABLE_CONFIGS[type];

        const bg = this.scene.add.graphics();
        bg.setScrollFactor(0);
        bg.setDepth(201);

        const s = UI_SCALE;
        const text = this.scene.add.text(x + width / 2, y + 14 * s, config.label, {
            fontFamily: 'monospace',
            fontSize: `${Math.round(11 * s)}px`,
            color: '#ffffff'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);

        const costText = this.scene.add.text(x + width / 2, y + 32 * s, `${config.cost}m / ${config.powerConsumption}pw`, {
            fontFamily: 'monospace',
            fontSize: `${Math.round(9 * s)}px`,
            color: '#888888'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);

        const button: MenuButton = { bg, text, costText, type, x, y, width, height };
        this.buttons.push(button);
        this.allObjects.push(bg, text, costText);

        const zone = this.scene.add.zone(x + width / 2, y + height / 2, width, height)
            .setScrollFactor(0)
            .setDepth(203)
            .setInteractive({ useHandCursor: true });
        this.allObjects.push(zone);

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
        button.bg.fillRoundedRect(button.x, button.y, button.width, button.height, 3 * UI_SCALE);
        button.bg.lineStyle(1 * UI_SCALE, colour, 0.6);
        button.bg.strokeRoundedRect(button.x, button.y, button.width, button.height, 3 * UI_SCALE);
    }

    private updateButtonStates(): void {
        const activeType = this.buildSystem.getActiveBuildType();
        for (const button of this.buttons) {
            const isActive = button.type === activeType;
            this.drawButton(button, isActive);
            button.text.setColor(isActive ? '#00e5ff' : '#ffffff');
        }
    }

    getGameObjects(): Phaser.GameObjects.GameObject[] {
        return this.allObjects;
    }
}
