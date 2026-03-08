import Phaser from 'phaser';
import { ResourceManager } from '../systems/ResourceManager';
import { PowerNetwork } from '../systems/PowerNetwork';
import { VIEWPORT_WIDTH, COLOUR_PANEL, COLOUR_PANEL_BORDER, COLOUR_CYAN, COLOUR_AMBER } from '../utils/Constants';

export class HUD {
    private resourceManager: ResourceManager;
    private powerNetwork: PowerNetwork;
    private mineralText: Phaser.GameObjects.Text;
    private powerText: Phaser.GameObjects.Text;
    private powerBar: Phaser.GameObjects.Graphics;
    private bgGraphics: Phaser.GameObjects.Graphics;

    private allObjects: Phaser.GameObjects.GameObject[] = [];

    constructor(scene: Phaser.Scene, resourceManager: ResourceManager, powerNetwork: PowerNetwork) {
        this.resourceManager = resourceManager;
        this.powerNetwork = powerNetwork;

        // Background panel (fixed to camera)
        this.bgGraphics = scene.add.graphics();
        this.bgGraphics.setScrollFactor(0);
        this.bgGraphics.setDepth(200);
        this.bgGraphics.fillStyle(COLOUR_PANEL, 0.85);
        this.bgGraphics.fillRoundedRect(4, 4, VIEWPORT_WIDTH - 8, 36, 4);
        this.bgGraphics.lineStyle(1, COLOUR_PANEL_BORDER, 0.6);
        this.bgGraphics.strokeRoundedRect(4, 4, VIEWPORT_WIDTH - 8, 36, 4);

        // Mineral display
        this.mineralText = scene.add.text(16, 10, '', {
            fontFamily: 'monospace',
            fontSize: '16px',
            color: '#ffab00'
        }).setScrollFactor(0).setDepth(201);

        // Power display
        this.powerText = scene.add.text(240, 10, '', {
            fontFamily: 'monospace',
            fontSize: '16px',
            color: '#00e5ff'
        }).setScrollFactor(0).setDepth(201);

        // Power bar
        this.powerBar = scene.add.graphics();
        this.powerBar.setScrollFactor(0);
        this.powerBar.setDepth(201);

        this.allObjects = [this.bgGraphics, this.mineralText, this.powerText, this.powerBar];
    }

    getGameObjects(): Phaser.GameObjects.GameObject[] {
        return this.allObjects;
    }

    update(): void {
        // Minerals
        const minerals = this.resourceManager.getMinerals();
        this.mineralText.setText(`Minerals: ${minerals}`);

        // Power
        const used = this.powerNetwork.getPowerUsage();
        const capacity = this.powerNetwork.getPowerCapacity();
        this.powerText.setText(`Power: ${used}/${capacity}`);

        // Power bar
        this.powerBar.clear();
        const barX = 400;
        const barY = 14;
        const barW = 150;
        const barH = 14;

        // Background
        this.powerBar.fillStyle(0x222222, 0.8);
        this.powerBar.fillRect(barX, barY, barW, barH);

        // Fill
        const pct = capacity > 0 ? Math.min(used / capacity, 1) : 0;
        const barColour = pct > 0.8 ? COLOUR_AMBER : COLOUR_CYAN;
        this.powerBar.fillStyle(barColour, 0.8);
        this.powerBar.fillRect(barX, barY, barW * pct, barH);

        // Border
        this.powerBar.lineStyle(1, COLOUR_PANEL_BORDER, 0.6);
        this.powerBar.strokeRect(barX, barY, barW, barH);
    }
}
