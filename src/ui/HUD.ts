import Phaser from 'phaser';
import { ResourceManager } from '../systems/ResourceManager';
import { PowerNetwork } from '../systems/PowerNetwork';
import {
    COLOUR_PANEL, COLOUR_PANEL_BORDER,
    COLOUR_CYAN, COLOUR_AMBER, COLOUR_RED, COLOUR_PURPLE,
    UI_SCALE
} from '../utils/Constants';

export class HUD {
    private scene: Phaser.Scene;
    private resourceManager: ResourceManager;
    private powerNetwork: PowerNetwork;
    private mineralText: Phaser.GameObjects.Text;
    private powerGenText: Phaser.GameObjects.Text;
    private powerDemandText: Phaser.GameObjects.Text;
    private capacitorText: Phaser.GameObjects.Text;
    private powerBar: Phaser.GameObjects.Graphics;
    private capacitorBar: Phaser.GameObjects.Graphics;
    private bgGraphics: Phaser.GameObjects.Graphics;
    private powerBarLayout = { x: 0, y: 0, width: 0, height: 0 };
    private capacitorBarLayout = { x: 0, y: 0, width: 0, height: 0 };
    private readonly handleResize: (size: Phaser.Structs.Size) => void;

    private allObjects: Phaser.GameObjects.GameObject[] = [];

    constructor(scene: Phaser.Scene, resourceManager: ResourceManager, powerNetwork: PowerNetwork) {
        this.scene = scene;
        this.resourceManager = resourceManager;
        this.powerNetwork = powerNetwork;

        // Background panel (taller to fit two rows)
        this.bgGraphics = scene.add.graphics();
        this.bgGraphics.setScrollFactor(0);
        this.bgGraphics.setDepth(200);

        // Row 1: Minerals + Power generation/demand
        const s = UI_SCALE;
        this.mineralText = scene.add.text(0, 0, '', {
            fontFamily: 'monospace',
            fontSize: `${Math.round(14 * s)}px`,
            color: '#ffab00'
        }).setScrollFactor(0).setDepth(201);

        this.powerGenText = scene.add.text(0, 0, '', {
            fontFamily: 'monospace',
            fontSize: `${Math.round(14 * s)}px`,
            color: '#00e5ff'
        }).setScrollFactor(0).setDepth(201);

        this.powerDemandText = scene.add.text(0, 0, '', {
            fontFamily: 'monospace',
            fontSize: `${Math.round(14 * s)}px`,
            color: '#00e5ff'
        }).setScrollFactor(0).setDepth(201);

        // Power bar (generation vs demand)
        this.powerBar = scene.add.graphics();
        this.powerBar.setScrollFactor(0);
        this.powerBar.setDepth(201);

        // Row 2: Capacitor storage
        this.capacitorText = scene.add.text(0, 0, '', {
            fontFamily: 'monospace',
            fontSize: `${Math.round(12 * s)}px`,
            color: '#aa44ff'
        }).setScrollFactor(0).setDepth(201);

        this.capacitorBar = scene.add.graphics();
        this.capacitorBar.setScrollFactor(0);
        this.capacitorBar.setDepth(201);

        this.allObjects = [
            this.bgGraphics, this.mineralText, this.powerGenText,
            this.powerDemandText, this.powerBar,
            this.capacitorText, this.capacitorBar
        ];

        this.relayout(scene.scale.width, scene.scale.height);

        this.handleResize = (size: Phaser.Structs.Size) => {
            this.relayout(size.width, size.height);
        };
        this.scene.scale.on('resize', this.handleResize, this);
    }

    relayout(width: number, _height: number): void {
        const s = UI_SCALE;

        this.bgGraphics.clear();
        this.bgGraphics.fillStyle(COLOUR_PANEL, 0.85);
        this.bgGraphics.fillRoundedRect(4 * s, 4 * s, width - 8 * s, 52 * s, 4 * s);
        this.bgGraphics.lineStyle(1 * s, COLOUR_PANEL_BORDER, 0.6);
        this.bgGraphics.strokeRoundedRect(4 * s, 4 * s, width - 8 * s, 52 * s, 4 * s);

        this.mineralText.setPosition(16 * s, 10 * s);
        this.powerGenText.setPosition(160 * s, 10 * s);
        this.powerDemandText.setPosition(310 * s, 10 * s);
        this.capacitorText.setPosition(16 * s, 33 * s);

        this.powerBarLayout = { x: 470 * s, y: 11 * s, width: 150 * s, height: 14 * s };
        this.capacitorBarLayout = { x: 160 * s, y: 35 * s, width: 120 * s, height: 10 * s };
    }

    getGameObjects(): Phaser.GameObjects.GameObject[] {
        return this.allObjects;
    }

    update(): void {
        // Minerals
        const minerals = this.resourceManager.getMinerals();
        this.mineralText.setText(`Minerals: ${minerals}`);

        // Power economy
        const gen = this.powerNetwork.totalGeneration;
        const demand = this.powerNetwork.totalDemand;
        const surplus = gen - demand;
        const discharging = this.powerNetwork.capacitorDischarging;

        this.powerGenText.setText(`Gen: ${gen}`);

        // Demand text with colour coding
        let demandColour = '#00e5ff'; // cyan - fine
        if (demand > gen && discharging > 0) {
            demandColour = '#aa44ff'; // purple - capacitor supplementing
        } else if (demand > gen) {
            demandColour = '#ff3d00'; // red - over budget
        } else if (demand > gen * 0.8) {
            demandColour = '#ffab00'; // amber - getting close
        }
        this.powerDemandText.setColor(demandColour);
        this.powerDemandText.setText(`Demand: ${demand}`);

        // Power bar
        this.powerBar.clear();
        const { x: barX, y: barY, width: barW, height: barH } = this.powerBarLayout;

        // Background
        this.powerBar.fillStyle(0x222222, 0.8);
        this.powerBar.fillRect(barX, barY, barW, barH);

        // Fill — demand as proportion of generation
        const pct = gen > 0 ? Math.min(demand / gen, 1) : 0;
        let barColour = COLOUR_CYAN;
        if (pct > 0.95) barColour = COLOUR_RED;
        else if (pct > 0.8) barColour = COLOUR_AMBER;

        this.powerBar.fillStyle(barColour, 0.8);
        this.powerBar.fillRect(barX, barY, barW * pct, barH);

        // If capacitors are supplementing, show discharge indicator
        if (discharging > 0 && gen > 0) {
            const dischargePct = Math.min(discharging / gen, 1 - pct);
            this.powerBar.fillStyle(COLOUR_PURPLE, 0.6);
            this.powerBar.fillRect(barX + barW * pct, barY, barW * dischargePct, barH);
        }

        // Surplus/deficit indicator
        if (surplus >= 0) {
            this.powerGenText.setText(`Gen: ${gen} (+${surplus})`);
        } else {
            this.powerGenText.setText(`Gen: ${gen} (${surplus})`);
        }

        // Border
        this.powerBar.lineStyle(1, COLOUR_PANEL_BORDER, 0.6);
        this.powerBar.strokeRect(barX, barY, barW, barH);

        // Capacitor row
        const capStored = Math.floor(this.powerNetwork.capacitorStored);
        const capMax = this.powerNetwork.capacitorMax;

        this.capacitorBar.clear();

        if (capMax > 0) {
            this.capacitorText.setText(`Cap: ${capStored}/${capMax}`);
            this.capacitorText.setVisible(true);

            const { x: capBarX, y: capBarY, width: capBarW, height: capBarH } = this.capacitorBarLayout;

            // Background
            this.capacitorBar.fillStyle(0x222222, 0.8);
            this.capacitorBar.fillRect(capBarX, capBarY, capBarW, capBarH);

            // Fill
            const capPct = capMax > 0 ? capStored / capMax : 0;
            const capColour = capPct > 0.6 ? COLOUR_PURPLE : COLOUR_CYAN;
            this.capacitorBar.fillStyle(capColour, 0.7);
            this.capacitorBar.fillRect(capBarX, capBarY, capBarW * capPct, capBarH);

            // Border
            this.capacitorBar.lineStyle(1, COLOUR_PANEL_BORDER, 0.6);
            this.capacitorBar.strokeRect(capBarX, capBarY, capBarW, capBarH);
        } else {
            this.capacitorText.setText('');
            this.capacitorText.setVisible(false);
        }
    }

    destroy(): void {
        this.scene.scale.off('resize', this.handleResize, this);
    }
}
