import Phaser from 'phaser';
import { BuildSystem, BUILDABLE_CONFIGS, BuildableType } from '../systems/BuildSystem';
import { COLOUR_PANEL, COLOUR_PANEL_BORDER, COLOUR_CYAN, UI_SCALE } from '../utils/Constants';

interface MenuButton {
    bg: Phaser.GameObjects.Graphics;
    text: Phaser.GameObjects.Text;
    costText: Phaser.GameObjects.Text;
    zone: Phaser.GameObjects.Zone;
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
    private readonly handleResize: (size: Phaser.Structs.Size) => void;
    private readonly keyboardBindings: Array<{ event: string; handler: () => void }> = [];

    constructor(scene: Phaser.Scene, buildSystem: BuildSystem) {
        this.scene = scene;
        this.buildSystem = buildSystem;

        // Background panel
        this.bgGraphics = scene.add.graphics();
        this.bgGraphics.setScrollFactor(0);
        this.bgGraphics.setDepth(200);
        this.allObjects.push(this.bgGraphics);

        // Build buttons
        for (const type of BUILD_ORDER) {
            this.createButton(type);
        }

        this.relayout(scene.scale.width, scene.scale.height);

        this.handleResize = (size: Phaser.Structs.Size) => {
            this.relayout(size.width, size.height);
        };
        this.scene.scale.on('resize', this.handleResize, this);

        // Keyboard shortcuts 1-7
        if (scene.input.keyboard) {
            for (let i = 0; i < BUILD_ORDER.length; i++) {
                const type = BUILD_ORDER[i];
                const event = `keydown-${KEY_NAMES[i]}`;
                const handler = () => {
                    this.buildSystem.startBuild(type);
                    this.updateButtonStates();
                };
                this.keyboardBindings.push({ event, handler });
                scene.input.keyboard.on(event, handler);
            }

            const refreshEvents = ['keydown-Q', 'keydown-ESC'];
            for (const event of refreshEvents) {
                const handler = () => {
                    this.updateButtonStates();
                };
                this.keyboardBindings.push({ event, handler });
                scene.input.keyboard.on(event, handler);
            }
        }
    }

    relayout(_width: number, height: number): void {
        const s = UI_SCALE;
        const panelY = height - 70 * s;
        const btnW = 84 * s;
        const gap = 6 * s;
        const panelW = BUILD_ORDER.length * (btnW + gap) + gap;
        const btnH = 52 * s;

        this.bgGraphics.clear();
        this.bgGraphics.fillStyle(COLOUR_PANEL, 0.85);
        this.bgGraphics.fillRoundedRect(4 * s, panelY, panelW, 64 * s, 4 * s);
        this.bgGraphics.lineStyle(1 * s, COLOUR_PANEL_BORDER, 0.6);
        this.bgGraphics.strokeRoundedRect(4 * s, panelY, panelW, 64 * s, 4 * s);

        let bx = 12 * s;
        for (const button of this.buttons) {
            button.x = bx;
            button.y = panelY + 6 * s;
            button.width = btnW;
            button.height = btnH;

            button.text.setPosition(button.x + button.width / 2, button.y + 14 * s);
            button.costText.setPosition(button.x + button.width / 2, button.y + 32 * s);
            button.zone.setPosition(button.x + button.width / 2, button.y + button.height / 2);
            button.zone.setSize(button.width, button.height);

            bx += btnW + gap;
        }

        this.updateButtonStates();
    }

    private createButton(type: BuildableType): void {
        const config = BUILDABLE_CONFIGS[type];

        const bg = this.scene.add.graphics();
        bg.setScrollFactor(0);
        bg.setDepth(201);

        const s = UI_SCALE;
        const text = this.scene.add.text(0, 0, config.label, {
            fontFamily: 'monospace',
            fontSize: `${Math.round(11 * s)}px`,
            color: '#ffffff'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);

        const costText = this.scene.add.text(0, 0, `${config.cost}m / ${config.powerConsumption}pw`, {
            fontFamily: 'monospace',
            fontSize: `${Math.round(9 * s)}px`,
            color: '#888888'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);

        const zone = this.scene.add.zone(0, 0, 0, 0)
            .setScrollFactor(0)
            .setDepth(203)
            .setInteractive({ useHandCursor: true });

        const button: MenuButton = { bg, text, costText, zone, type, x: 0, y: 0, width: 0, height: 0 };
        this.buttons.push(button);
        this.allObjects.push(bg, text, costText, zone);

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

    destroy(): void {
        this.scene.scale.off('resize', this.handleResize, this);
        if (this.scene.input.keyboard) {
            for (const binding of this.keyboardBindings) {
                this.scene.input.keyboard.off(binding.event, binding.handler);
            }
        }
    }

    getGameObjects(): Phaser.GameObjects.GameObject[] {
        return this.allObjects;
    }
}
