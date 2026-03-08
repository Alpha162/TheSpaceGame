import Phaser from 'phaser';
import { GameNode } from '../entities/Node';
import { PowerRelay } from '../entities/support/PowerRelay';
import { ResourceManager } from './ResourceManager';
import { PowerNetwork } from './PowerNetwork';
import {
    MAX_POWER_LINK_LENGTH, MIN_NODE_DISTANCE,
    RELAY_COST, RELAY_RADIUS,
    COLOUR_CYAN, COLOUR_RED, COLOUR_GREY
} from '../utils/Constants';
import { distanceBetween } from '../utils/Helpers';

export type BuildableType = 'relay';

interface BuildableConfig {
    cost: number;
    radius: number;
    powerConsumption: number;
    label: string;
}

export const BUILDABLE_CONFIGS: Record<BuildableType, BuildableConfig> = {
    relay: { cost: RELAY_COST, radius: RELAY_RADIUS, powerConsumption: 2, label: 'Power Relay' }
};

export class BuildSystem {
    private scene: Phaser.Scene;
    private resourceManager: ResourceManager;
    private powerNetwork: PowerNetwork;
    private ghostGraphics: Phaser.GameObjects.Graphics;
    private rangeGraphics: Phaser.GameObjects.Graphics;
    private activeBuildType: BuildableType | null = null;
    private isValidPlacement = false;
    private placedNodes: GameNode[] = [];

    constructor(scene: Phaser.Scene, resourceManager: ResourceManager, powerNetwork: PowerNetwork) {
        this.scene = scene;
        this.resourceManager = resourceManager;
        this.powerNetwork = powerNetwork;

        this.ghostGraphics = scene.add.graphics();
        this.ghostGraphics.setDepth(100);
        this.ghostGraphics.setVisible(false);

        this.rangeGraphics = scene.add.graphics();
        this.rangeGraphics.setDepth(99);
        this.rangeGraphics.setVisible(false);

        // Click to place
        scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (pointer.leftButtonDown() && this.activeBuildType) {
                this.tryPlace(pointer);
            }
            if (pointer.rightButtonDown()) {
                this.cancelBuild();
            }
        });

        // ESC to cancel
        if (scene.input.keyboard) {
            scene.input.keyboard.on('keydown-ESC', () => {
                this.cancelBuild();
            });
        }
    }

    startBuild(type: BuildableType): void {
        this.activeBuildType = type;
        this.ghostGraphics.setVisible(true);
        this.rangeGraphics.setVisible(true);
    }

    cancelBuild(): void {
        this.activeBuildType = null;
        this.ghostGraphics.setVisible(false);
        this.ghostGraphics.clear();
        this.rangeGraphics.setVisible(false);
        this.rangeGraphics.clear();
    }

    isBuilding(): boolean {
        return this.activeBuildType !== null;
    }

    getActiveBuildType(): BuildableType | null {
        return this.activeBuildType;
    }

    getPlacedNodes(): GameNode[] {
        return this.placedNodes;
    }

    update(): void {
        if (!this.activeBuildType) return;

        const pointer = this.scene.input.activePointer;
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);

        this.drawGhost(worldPoint.x, worldPoint.y);
    }

    private drawGhost(wx: number, wy: number): void {
        if (!this.activeBuildType) return;

        const config = BUILDABLE_CONFIGS[this.activeBuildType];
        this.isValidPlacement = this.validatePlacement(wx, wy, config);

        this.ghostGraphics.clear();
        this.rangeGraphics.clear();

        const colour = this.isValidPlacement ? COLOUR_CYAN : COLOUR_RED;
        const alpha = 0.5;

        // Ghost structure
        this.ghostGraphics.lineStyle(2, colour, alpha);
        this.ghostGraphics.strokeCircle(wx, wy, config.radius);
        this.ghostGraphics.fillStyle(colour, alpha * 0.3);
        this.ghostGraphics.fillCircle(wx, wy, config.radius);

        // Connection range ring
        this.rangeGraphics.lineStyle(1, COLOUR_GREY, 0.2);
        this.rangeGraphics.strokeCircle(wx, wy, MAX_POWER_LINK_LENGTH);

        // Draw potential connections
        const allNodes = this.powerNetwork.getAllNodes();
        for (const node of allNodes) {
            const dist = distanceBetween(wx, wy, node.x, node.y);
            if (dist <= MAX_POWER_LINK_LENGTH) {
                const linkColour = this.isValidPlacement ? COLOUR_CYAN : COLOUR_RED;
                this.rangeGraphics.lineStyle(1, linkColour, 0.3);
                this.rangeGraphics.beginPath();
                this.rangeGraphics.moveTo(wx, wy);
                this.rangeGraphics.lineTo(node.x, node.y);
                this.rangeGraphics.strokePath();
            }
        }
    }

    private validatePlacement(x: number, y: number, config: BuildableConfig): boolean {
        // Check cost
        if (!this.resourceManager.canAfford(config.cost)) return false;

        // Check overlap with existing nodes
        const allNodes = this.powerNetwork.getAllNodes();
        for (const node of allNodes) {
            const dist = distanceBetween(x, y, node.x, node.y);
            if (dist < MIN_NODE_DISTANCE) return false;
        }

        // Check connection range — must be within range of at least one existing node
        let hasConnection = false;
        for (const node of allNodes) {
            const dist = distanceBetween(x, y, node.x, node.y);
            if (dist <= MAX_POWER_LINK_LENGTH) {
                hasConnection = true;
                break;
            }
        }

        return hasConnection;
    }

    private tryPlace(pointer: Phaser.Input.Pointer): void {
        if (!this.activeBuildType || !this.isValidPlacement) return;

        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const config = BUILDABLE_CONFIGS[this.activeBuildType];

        // Re-validate at exact click position
        if (!this.validatePlacement(worldPoint.x, worldPoint.y, config)) return;

        // Spend resources
        if (!this.resourceManager.spend(config.cost)) return;

        // Create node
        let node: GameNode;
        switch (this.activeBuildType) {
            case 'relay':
                node = new PowerRelay(this.scene, worldPoint.x, worldPoint.y);
                break;
        }

        // Register in power network
        this.powerNetwork.addNode(node);
        this.placedNodes.push(node);

        // Keep building mode active for rapid placement
        // (user can right-click or ESC to cancel)
    }
}
