import Phaser from 'phaser';
import { GameNode } from '../entities/Node';
import { PowerRelay } from '../entities/support/PowerRelay';
import { Capacitor } from '../entities/support/Capacitor';
import { Shield } from '../entities/defence/Shield';
import { Blaster } from '../entities/turrets/Blaster';
import { ResourceManager } from './ResourceManager';
import { CombatSystem } from './CombatSystem';
import { PowerNetwork } from './PowerNetwork';
import {
    MAX_POWER_LINK_LENGTH, MIN_NODE_DISTANCE,
    RELAY_COST, RELAY_RADIUS, RELAY_POWER,
    SHIELD_COST, SHIELD_RADIUS, SHIELD_POWER_DEPLOY,
    CAPACITOR_COST, CAPACITOR_RADIUS, CAPACITOR_POWER_CHARGE,
    BLASTER_COST, BLASTER_RADIUS, BLASTER_POWER,
    COLOUR_CYAN, COLOUR_RED, COLOUR_GREY,
    VIEWPORT_WIDTH, VIEWPORT_HEIGHT
} from '../utils/Constants';
import { distanceBetween } from '../utils/Helpers';

export type BuildableType = 'relay' | 'shield' | 'capacitor' | 'blaster';

interface BuildableConfig {
    cost: number;
    radius: number;
    powerConsumption: number;
    label: string;
}

export const BUILDABLE_CONFIGS: Record<BuildableType, BuildableConfig> = {
    relay: { cost: RELAY_COST, radius: RELAY_RADIUS, powerConsumption: RELAY_POWER, label: 'Power Relay' },
    shield: { cost: SHIELD_COST, radius: SHIELD_RADIUS, powerConsumption: SHIELD_POWER_DEPLOY, label: 'Shield' },
    capacitor: { cost: CAPACITOR_COST, radius: CAPACITOR_RADIUS, powerConsumption: CAPACITOR_POWER_CHARGE, label: 'Capacitor' },
    blaster: { cost: BLASTER_COST, radius: BLASTER_RADIUS, powerConsumption: BLASTER_POWER, label: 'Blaster' }
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
    private selectedNode: GameNode | null = null;
    private combatSystem: CombatSystem | null = null;

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

        // Click to place or select (blocked over UI)
        scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (this.isPointerOverUI(pointer)) return;

            if (pointer.leftButtonDown()) {
                if (this.activeBuildType) {
                    this.tryPlace(pointer);
                } else {
                    this.trySelect(pointer);
                }
            }
            if (pointer.rightButtonDown()) {
                if (this.activeBuildType) {
                    this.cancelBuild();
                } else {
                    this.deselectNode();
                }
            }
        });

        // ESC / Q to cancel build or deselect
        if (scene.input.keyboard) {
            scene.input.keyboard.on('keydown-ESC', () => {
                if (this.activeBuildType) {
                    this.cancelBuild();
                } else {
                    this.deselectNode();
                }
            });
            scene.input.keyboard.on('keydown-Q', () => {
                if (this.activeBuildType) {
                    this.cancelBuild();
                } else {
                    this.deselectNode();
                }
            });

            // Delete/Backspace/X to remove selected node
            scene.input.keyboard.on('keydown-DELETE', () => {
                this.deleteSelected();
            });
            scene.input.keyboard.on('keydown-BACKSPACE', () => {
                this.deleteSelected();
            });
            scene.input.keyboard.on('keydown-X', () => {
                this.deleteSelected();
            });
        }
    }

    private isPointerOverUI(pointer: Phaser.Input.Pointer): boolean {
        const x = pointer.x;
        const y = pointer.y;

        // HUD top bar
        if (x >= 4 && x <= VIEWPORT_WIDTH - 4 && y >= 4 && y <= 56) return true;

        // Build menu bottom-left panel
        if (x >= 4 && x <= 378 && y >= VIEWPORT_HEIGHT - 70 && y <= VIEWPORT_HEIGHT - 6) return true;

        // Spawn panel bottom-right
        if (x >= VIEWPORT_WIDTH - 174 && x <= VIEWPORT_WIDTH - 4 && y >= VIEWPORT_HEIGHT - 70 && y <= VIEWPORT_HEIGHT - 6) return true;

        return false;
    }

    setCombatSystem(combatSystem: CombatSystem): void {
        this.combatSystem = combatSystem;
    }

    startBuild(type: BuildableType): void {
        this.deselectNode();
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

    getSelectedNode(): GameNode | null {
        return this.selectedNode;
    }

    update(): void {
        // Update construction progress for all placed nodes
        for (const node of this.placedNodes) {
            if (!node.isFullyConstructed()) {
                const justFinished = node.updateConstruction();
                if (justFinished) {
                    // Node just finished constructing, integrate into power network
                    this.powerNetwork.updateConnectivity();
                }
            }
        }

        if (!this.activeBuildType) return;

        const pointer = this.scene.input.activePointer;
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);

        this.drawGhost(worldPoint.x, worldPoint.y);
    }

    private trySelect(pointer: Phaser.Input.Pointer): void {
        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);

        // Find the closest placed node within click range
        let closest: GameNode | null = null;
        let closestDist = Infinity;

        for (const node of this.placedNodes) {
            const dist = distanceBetween(worldPoint.x, worldPoint.y, node.x, node.y);
            if (dist <= node.nodeRadius + 8 && dist < closestDist) {
                closest = node;
                closestDist = dist;
            }
        }

        if (closest) {
            this.deselectNode();
            this.selectedNode = closest;
            closest.setSelected(true);
        } else {
            this.deselectNode();
        }
    }

    private deselectNode(): void {
        if (this.selectedNode) {
            this.selectedNode.setSelected(false);
            this.selectedNode = null;
        }
    }

    private deleteSelected(): void {
        if (!this.selectedNode) return;

        const node = this.selectedNode;

        // Determine refund based on node type
        let refundCost = RELAY_COST; // default
        if (node instanceof Shield) {
            refundCost = SHIELD_COST;
        } else if (node instanceof Capacitor) {
            refundCost = CAPACITOR_COST;
        } else if (node instanceof Blaster) {
            refundCost = BLASTER_COST;
        }
        this.resourceManager.earn(refundCost);

        // Remove from power network
        this.powerNetwork.removeNode(node);

        // Remove from placed nodes
        const idx = this.placedNodes.indexOf(node);
        if (idx >= 0) this.placedNodes.splice(idx, 1);

        // Destroy the game object
        this.selectedNode = null;
        node.destroy();
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
            case 'shield':
                node = new Shield(this.scene, worldPoint.x, worldPoint.y);
                break;
            case 'capacitor':
                node = new Capacitor(this.scene, worldPoint.x, worldPoint.y);
                break;
            case 'blaster': {
                const blaster = new Blaster(this.scene, worldPoint.x, worldPoint.y);
                if (this.combatSystem) blaster.setCombatSystem(this.combatSystem);
                node = blaster;
                break;
            }
        }

        // Start construction delay
        node.startConstruction();

        // Register in power network (links are created but node won't receive power until constructed)
        this.powerNetwork.addNode(node);
        this.placedNodes.push(node);

        // Keep building mode active for rapid placement
    }
}
