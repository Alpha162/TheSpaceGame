import Phaser from 'phaser';
import { Shield } from '../entities/defence/Shield';
import { CommandHub } from '../entities/CommandHub';
import { BuildSystem } from '../systems/BuildSystem';
import { PowerNetwork } from '../systems/PowerNetwork';
import type { ShieldCluster } from '../systems/ShieldClusterManager';
import { getTuningVisual } from '../utils/Helpers';
import {
    COLOUR_PANEL, COLOUR_PANEL_BORDER, COLOUR_AMBER, COLOUR_RED,
    UI_SCALE
} from '../utils/Constants';

type TunableShield = Shield | CommandHub;

// Panel layout constants (before DPI scaling)
const PANEL_W = 160;
const PANEL_H = 100;
const PANEL_MARGIN = 8;
const SLIDER_TRACK_W = 120;
const SLIDER_TRACK_H = 6;
const SLIDER_TRACK_Y = 30; // relative to panel top
const MARKER_W = 4;
const MARKER_H = 14;
const LOCK_BTN_Y = 54;
const HEAT_BAR_Y = 76;
const HEAT_BAR_W = 120;
const HEAT_BAR_H = 4;

export class ShieldTuningPanel {
    private buildSystem: BuildSystem;
    private powerNetwork: PowerNetwork;
    private allObjects: Phaser.GameObjects.GameObject[] = [];

    private bgGraphics: Phaser.GameObjects.Graphics;
    private sliderGraphics: Phaser.GameObjects.Graphics;
    private lockBtnGraphics: Phaser.GameObjects.Graphics;
    private kineticLabel: Phaser.GameObjects.Text;
    private energyLabel: Phaser.GameObjects.Text;
    private tuningText: Phaser.GameObjects.Text;
    private lockText: Phaser.GameObjects.Text;
    private lockZone: Phaser.GameObjects.Zone;
    private clusterText: Phaser.GameObjects.Text;
    private heatLabel: Phaser.GameObjects.Text;

    private sliderZone: Phaser.GameObjects.Zone;
    private isDragging = false;
    private visible = false;

    // Computed screen positions
    private panelX = 0;
    private panelY = 0;
    private s: number;

    constructor(scene: Phaser.Scene, buildSystem: BuildSystem, powerNetwork: PowerNetwork) {
        this.buildSystem = buildSystem;
        this.powerNetwork = powerNetwork;
        this.s = UI_SCALE;

        const s = this.s;
        const viewW = scene.scale.width;
        const viewH = scene.scale.height;

        // Position: right side, vertically centered
        this.panelX = viewW - (PANEL_W + PANEL_MARGIN) * s;
        this.panelY = Math.round(viewH / 2 - (PANEL_H / 2) * s);

        // Background
        this.bgGraphics = scene.add.graphics();
        this.bgGraphics.setScrollFactor(0).setDepth(200);
        this.allObjects.push(this.bgGraphics);

        // Slider graphics (redrawn each frame)
        this.sliderGraphics = scene.add.graphics();
        this.sliderGraphics.setScrollFactor(0).setDepth(201);
        this.allObjects.push(this.sliderGraphics);

        // Lock button graphics
        this.lockBtnGraphics = scene.add.graphics();
        this.lockBtnGraphics.setScrollFactor(0).setDepth(201);
        this.allObjects.push(this.lockBtnGraphics);

        const textStyle = {
            fontFamily: 'monospace',
            fontSize: `${Math.round(9 * s)}px`,
            color: '#aaaaaa'
        };

        // Kinetic / Energy labels flanking slider
        const sliderLeft = this.panelX + (PANEL_W - SLIDER_TRACK_W) / 2 * s;
        const sliderRight = sliderLeft + SLIDER_TRACK_W * s;
        const sliderCenterY = this.panelY + SLIDER_TRACK_Y * s + SLIDER_TRACK_H * s / 2;

        this.kineticLabel = scene.add.text(sliderLeft - 4 * s, sliderCenterY, 'K', {
            ...textStyle, color: '#b49664'
        }).setScrollFactor(0).setDepth(202).setOrigin(1, 0.5);
        this.allObjects.push(this.kineticLabel);

        this.energyLabel = scene.add.text(sliderRight + 4 * s, sliderCenterY, 'E', {
            ...textStyle, color: '#b478ff'
        }).setScrollFactor(0).setDepth(202).setOrigin(0, 0.5);
        this.allObjects.push(this.energyLabel);

        // Tuning value readout
        this.tuningText = scene.add.text(
            this.panelX + PANEL_W * s / 2,
            this.panelY + 10 * s,
            'Tuning: 0.50',
            { ...textStyle, fontSize: `${Math.round(10 * s)}px`, color: '#00e5ff' }
        ).setScrollFactor(0).setDepth(202).setOrigin(0.5, 0);
        this.allObjects.push(this.tuningText);

        // Lock button text + zone
        const lockCenterX = this.panelX + PANEL_W * s / 2;
        const lockCenterY = this.panelY + LOCK_BTN_Y * s + 10 * s;

        this.lockText = scene.add.text(lockCenterX, lockCenterY, 'AUTO', {
            ...textStyle, fontSize: `${Math.round(9 * s)}px`, color: '#888888'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);
        this.allObjects.push(this.lockText);

        this.lockZone = scene.add.zone(lockCenterX, lockCenterY, 50 * s, 16 * s)
            .setScrollFactor(0).setDepth(203).setInteractive({ useHandCursor: true });
        this.allObjects.push(this.lockZone);

        this.lockZone.on('pointerdown', () => this.onLockToggle());

        // Cluster info text
        this.clusterText = scene.add.text(
            this.panelX + PANEL_W * s / 2,
            this.panelY + (LOCK_BTN_Y + 22) * s,
            '',
            { ...textStyle, fontSize: `${Math.round(8 * s)}px`, color: '#9966ff' }
        ).setScrollFactor(0).setDepth(202).setOrigin(0.5, 0);
        this.allObjects.push(this.clusterText);

        // Heat label
        this.heatLabel = scene.add.text(
            this.panelX + (PANEL_W - HEAT_BAR_W) / 2 * s - 2 * s,
            this.panelY + HEAT_BAR_Y * s,
            '',
            { ...textStyle, fontSize: `${Math.round(8 * s)}px`, color: '#ffab00' }
        ).setScrollFactor(0).setDepth(202).setOrigin(0, 0.5);
        this.allObjects.push(this.heatLabel);

        // Slider drag zone (covers slider track area with padding)
        const sliderZoneX = sliderLeft + SLIDER_TRACK_W * s / 2;
        const sliderZoneY = this.panelY + SLIDER_TRACK_Y * s + SLIDER_TRACK_H * s / 2;
        this.sliderZone = scene.add.zone(sliderZoneX, sliderZoneY, SLIDER_TRACK_W * s, 20 * s)
            .setScrollFactor(0).setDepth(203).setInteractive({ useHandCursor: true, draggable: true });
        this.allObjects.push(this.sliderZone);

        this.sliderZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            this.isDragging = true;
            this.applySliderDrag(pointer);
        });

        scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            if (this.isDragging) {
                this.applySliderDrag(pointer);
            }
        });

        scene.input.on('pointerup', () => {
            this.isDragging = false;
        });

        // Start hidden
        this.setVisible(false);
    }

    private isTunableShield(node: unknown): node is TunableShield {
        return node instanceof Shield || node instanceof CommandHub;
    }

    private applySliderDrag(pointer: Phaser.Input.Pointer): void {
        const s = this.s;
        const sliderLeft = this.panelX + (PANEL_W - SLIDER_TRACK_W) / 2 * s;
        const sliderWidth = SLIDER_TRACK_W * s;
        const tuning = Math.max(0, Math.min(1, (pointer.x - sliderLeft) / sliderWidth));

        const selected = this.buildSystem.getSelectedNode();
        if (!this.isTunableShield(selected)) return;

        const clusterMgr = this.powerNetwork.getShieldClusterManager();
        const cluster = clusterMgr.getClusterFor(selected);

        if (cluster) {
            clusterMgr.setClusterManualTuning(cluster, tuning);
        } else {
            selected.setManualTuning(tuning);
        }
    }

    private onLockToggle(): void {
        const selected = this.buildSystem.getSelectedNode();
        if (!this.isTunableShield(selected)) return;

        const clusterMgr = this.powerNetwork.getShieldClusterManager();
        const cluster = clusterMgr.getClusterFor(selected);

        if (cluster) {
            if (cluster.clusterManualLock) {
                clusterMgr.clearClusterManualLock(cluster);
            } else {
                clusterMgr.setClusterManualTuning(cluster, cluster.clusterTuning);
            }
        } else {
            if (selected.manualLock) {
                selected.clearManualLock();
            } else {
                selected.setManualTuning(selected.tuning);
            }
        }
    }

    private setVisible(vis: boolean): void {
        this.visible = vis;
        for (const obj of this.allObjects) {
            if ('setVisible' in obj) {
                (obj as unknown as Phaser.GameObjects.Components.Visible).setVisible(vis);
            }
        }
    }

    /** Returns true if the given screen-space point is over this panel. */
    isPointOverPanel(x: number, y: number): boolean {
        if (!this.visible) return false;
        const s = this.s;
        return x >= this.panelX && x <= this.panelX + PANEL_W * s &&
               y >= this.panelY && y <= this.panelY + PANEL_H * s;
    }

    update(): void {
        const selected = this.buildSystem.getSelectedNode();

        if (!this.isTunableShield(selected) || !selected.isFullyConstructed()) {
            if (this.visible) this.setVisible(false);
            this.isDragging = false;
            return;
        }

        if (!this.visible) this.setVisible(true);

        const shield = selected;
        const clusterMgr = this.powerNetwork.getShieldClusterManager();
        const cluster: ShieldCluster | undefined = clusterMgr.getClusterFor(shield);

        // Effective tuning and lock state
        const tuning = cluster ? cluster.clusterTuning : shield.tuning;
        const locked = cluster ? cluster.clusterManualLock : shield.manualLock;

        // Heat: average across cluster or individual
        let heat: number;
        if (cluster) {
            const active = cluster.members.filter(m => m.isShieldActive());
            heat = active.length > 0
                ? active.reduce((sum, m) => sum + m.getHeat(), 0) / active.length
                : 0;
        } else if (shield instanceof Shield) {
            heat = shield.heatLevel;
        } else {
            heat = (shield as CommandHub).hubShieldHeat;
        }

        const s = this.s;
        const tuningVis = getTuningVisual(tuning);

        // -- Redraw background --
        this.bgGraphics.clear();
        this.bgGraphics.fillStyle(COLOUR_PANEL, 0.8);
        this.bgGraphics.fillRoundedRect(this.panelX, this.panelY, PANEL_W * s, PANEL_H * s, 4 * s);
        this.bgGraphics.lineStyle(1 * s, COLOUR_PANEL_BORDER, 0.5);
        this.bgGraphics.strokeRoundedRect(this.panelX, this.panelY, PANEL_W * s, PANEL_H * s, 4 * s);

        // -- Tuning text --
        this.tuningText.setText(`Tuning: ${tuning.toFixed(2)}`);

        // -- Slider track --
        this.sliderGraphics.clear();
        const sliderLeft = this.panelX + (PANEL_W - SLIDER_TRACK_W) / 2 * s;
        const sliderTop = this.panelY + SLIDER_TRACK_Y * s;

        // Track background
        this.sliderGraphics.fillStyle(0x222233, 0.9);
        this.sliderGraphics.fillRect(sliderLeft, sliderTop, SLIDER_TRACK_W * s, SLIDER_TRACK_H * s);

        // Gradient fill: draw in segments
        const segs = 20;
        const segW = SLIDER_TRACK_W * s / segs;
        for (let i = 0; i < segs; i++) {
            const t = i / segs;
            const vis = getTuningVisual(t);
            this.sliderGraphics.fillStyle(vis.colour, 0.4);
            this.sliderGraphics.fillRect(sliderLeft + i * segW, sliderTop, segW + 1, SLIDER_TRACK_H * s);
        }

        // Track border
        this.sliderGraphics.lineStyle(1, COLOUR_PANEL_BORDER, 0.6);
        this.sliderGraphics.strokeRect(sliderLeft, sliderTop, SLIDER_TRACK_W * s, SLIDER_TRACK_H * s);

        // Marker
        const markerX = sliderLeft + tuning * SLIDER_TRACK_W * s - MARKER_W * s / 2;
        const markerY = sliderTop + SLIDER_TRACK_H * s / 2 - MARKER_H * s / 2;
        this.sliderGraphics.fillStyle(tuningVis.colour, 1);
        this.sliderGraphics.fillRect(markerX, markerY, MARKER_W * s, MARKER_H * s);
        // Marker outline
        this.sliderGraphics.lineStyle(1, 0xffffff, 0.7);
        this.sliderGraphics.strokeRect(markerX, markerY, MARKER_W * s, MARKER_H * s);

        // -- Lock button --
        this.lockBtnGraphics.clear();
        const lockW = 48 * s;
        const lockH = 16 * s;
        const lockLeft = this.panelX + PANEL_W * s / 2 - lockW / 2;
        const lockTop = this.panelY + LOCK_BTN_Y * s + 2 * s;

        if (locked) {
            this.lockBtnGraphics.fillStyle(COLOUR_AMBER, 0.25);
            this.lockBtnGraphics.fillRoundedRect(lockLeft, lockTop, lockW, lockH, 3 * s);
            this.lockBtnGraphics.lineStyle(1, COLOUR_AMBER, 0.6);
            this.lockBtnGraphics.strokeRoundedRect(lockLeft, lockTop, lockW, lockH, 3 * s);
            this.lockText.setText('LOCKED');
            this.lockText.setColor('#ffab00');
        } else {
            this.lockBtnGraphics.fillStyle(COLOUR_PANEL_BORDER, 0.3);
            this.lockBtnGraphics.fillRoundedRect(lockLeft, lockTop, lockW, lockH, 3 * s);
            this.lockBtnGraphics.lineStyle(1, COLOUR_PANEL_BORDER, 0.5);
            this.lockBtnGraphics.strokeRoundedRect(lockLeft, lockTop, lockW, lockH, 3 * s);
            this.lockText.setText('AUTO');
            this.lockText.setColor('#888888');
        }

        // -- Cluster info --
        if (cluster) {
            const count = cluster.members.length;
            const heatShare = Math.round((1 - 1 / count) * 100);
            this.clusterText.setText(`Cluster: ${count} | ${heatShare}% shared`);
            this.clusterText.setVisible(true);
        } else {
            this.clusterText.setText('Solo');
            this.clusterText.setVisible(true);
        }

        // -- Heat bar --
        const heatBarLeft = this.panelX + (PANEL_W - HEAT_BAR_W) / 2 * s;
        const heatBarTop = this.panelY + HEAT_BAR_Y * s - HEAT_BAR_H * s / 2;

        this.sliderGraphics.fillStyle(0x222233, 0.9);
        this.sliderGraphics.fillRect(heatBarLeft, heatBarTop, HEAT_BAR_W * s, HEAT_BAR_H * s);

        if (heat > 0.01) {
            const heatColour = heat < 0.7 ? COLOUR_AMBER : COLOUR_RED;
            this.sliderGraphics.fillStyle(heatColour, 0.8);
            this.sliderGraphics.fillRect(heatBarLeft, heatBarTop, HEAT_BAR_W * s * heat, HEAT_BAR_H * s);
        }

        this.heatLabel.setText(`Heat: ${Math.round(heat * 100)}%`);
    }

    getGameObjects(): Phaser.GameObjects.GameObject[] {
        return this.allObjects;
    }
}
