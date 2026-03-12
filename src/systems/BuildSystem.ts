import Phaser from 'phaser';
import { GameNode } from '../entities/Node';
import { PowerRelay } from '../entities/support/PowerRelay';
import { Capacitor } from '../entities/support/Capacitor';
import { Shield } from '../entities/defence/Shield';
import { Blaster } from '../entities/turrets/Blaster';
import { Laser } from '../entities/turrets/Laser';
import { Missile } from '../entities/turrets/Missile';
import { MineralMiner } from '../entities/miners/MineralMiner';
import { MineralAsteroid } from '../entities/MineralAsteroid';
import { ResourceManager } from './ResourceManager';
import { CombatSystem } from './CombatSystem';
import { MineralManager } from './MineralManager';
import { PowerNetwork } from './PowerNetwork';
import {
    MAX_POWER_LINK_LENGTH, MIN_NODE_DISTANCE,
    RELAY_COST, RELAY_RADIUS, RELAY_POWER,
    SHIELD_COST, SHIELD_RADIUS, SHIELD_POWER_DEPLOY,
    CAPACITOR_COST, CAPACITOR_RADIUS, CAPACITOR_POWER_CHARGE,
    BLASTER_COST, BLASTER_RADIUS, BLASTER_POWER,
    LASER_COST, LASER_RADIUS, LASER_POWER,
    MISSILE_COST, MISSILE_RADIUS, MISSILE_POWER,
    MINER_COST, MINER_RADIUS, MINER_POWER, MINER_RANGE,
    UPGRADE_COST_FRACTION,
    COLOUR_CYAN, COLOUR_RED, COLOUR_GREY, COLOUR_AMBER,
    SHIELD_BUBBLE_MAX_RADIUS, SHIELD_CLUSTER_OVERLAP_MARGIN,
    COLOUR_CLUSTER_VIOLET,
    RELAY_MAX_CONNECTIONS, HUB_MAX_CONNECTIONS,
    UI_SCALE
} from '../utils/Constants';
import { CommandHub } from '../entities/CommandHub';
import { distanceBetween } from '../utils/Helpers';
import { SoundManager } from './SoundManager';
import type { ShieldTuningPanel } from '../ui/ShieldTuningPanel';

export type BuildableType = 'relay' | 'shield' | 'capacitor' | 'blaster' | 'laser' | 'missile' | 'miner';

interface BuildableConfig {
    cost: number;
    radius: number;
    powerConsumption: number;
    label: string;
}

export const BUILDABLE_CONFIGS: Record<BuildableType, BuildableConfig> = {
    relay: { cost: RELAY_COST, radius: RELAY_RADIUS, powerConsumption: RELAY_POWER, label: 'Relay' },
    shield: { cost: SHIELD_COST, radius: SHIELD_RADIUS, powerConsumption: SHIELD_POWER_DEPLOY, label: 'Shield' },
    capacitor: { cost: CAPACITOR_COST, radius: CAPACITOR_RADIUS, powerConsumption: CAPACITOR_POWER_CHARGE, label: 'Capacitor' },
    blaster: { cost: BLASTER_COST, radius: BLASTER_RADIUS, powerConsumption: BLASTER_POWER, label: 'Blaster' },
    miner: { cost: MINER_COST, radius: MINER_RADIUS, powerConsumption: MINER_POWER, label: 'Miner' },
    laser: { cost: LASER_COST, radius: LASER_RADIUS, powerConsumption: LASER_POWER, label: 'Laser' },
    missile: { cost: MISSILE_COST, radius: MISSILE_RADIUS, powerConsumption: MISSILE_POWER, label: 'Missile' }
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
    private mineralManager: MineralManager | null = null;
    private asteroids: MineralAsteroid[] = [];
    private shieldInfoText: Phaser.GameObjects.Text;
    private shieldTuningPanel: ShieldTuningPanel | null = null;
    private suppressNextRightDrag = false;

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

        this.shieldInfoText = scene.add.text(0, 0, '', {
            fontFamily: 'monospace',
            fontSize: '11px',
            color: '#00e5ff',
            backgroundColor: '#1a1a2e',
            padding: { x: 4, y: 2 }
        }).setDepth(101).setVisible(false).setOrigin(0.5, 0);

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
                    this.suppressNextRightDrag = true;
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

            // U to upgrade selected node
            scene.input.keyboard.on('keydown-U', () => {
                this.upgradeSelected();
            });
        }
    }

    private isPointerOverUI(pointer: Phaser.Input.Pointer): boolean {
        const x = pointer.x;
        const y = pointer.y;
        const viewW = this.scene.scale.width;
        const viewH = this.scene.scale.height;
        const s = UI_SCALE;

        // HUD top bar
        if (x >= 4 * s && x <= viewW - 4 * s && y >= 4 * s && y <= 56 * s) return true;

        // Build menu bottom-left panel (wider now with 7 buttons)
        if (x >= 4 * s && x <= 640 * s && y >= viewH - 70 * s && y <= viewH - 6 * s) return true;

        // Spawn panel bottom-right
        if (x >= viewW - 174 * s && x <= viewW - 4 * s && y >= viewH - 70 * s && y <= viewH - 6 * s) return true;

        // Shield tuning panel
        if (this.shieldTuningPanel && this.shieldTuningPanel.isPointOverPanel(x, y)) return true;

        return false;
    }

    setCombatSystem(combatSystem: CombatSystem): void {
        this.combatSystem = combatSystem;
    }

    setMineralManager(mm: MineralManager): void {
        this.mineralManager = mm;
    }

    setAsteroids(asteroids: MineralAsteroid[]): void {
        this.asteroids = asteroids;
    }

    setShieldTuningPanel(panel: ShieldTuningPanel): void {
        this.shieldTuningPanel = panel;
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
        this.shieldInfoText.setVisible(false);
    }

    isBuilding(): boolean {
        return this.activeBuildType !== null;
    }

    consumeRightDragSuppression(): boolean {
        const shouldSuppress = this.suppressNextRightDrag;
        this.suppressNextRightDrag = false;
        return shouldSuppress;
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
                    this.powerNetwork.updateConnectivity();
                    SoundManager.play('constructionComplete');
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

        let closest: GameNode | null = null;
        let closestDist = Infinity;

        for (const node of this.placedNodes) {
            const dist = distanceBetween(worldPoint.x, worldPoint.y, node.x, node.y);
            if (dist <= node.nodeRadius + 8 && dist < closestDist) {
                closest = node;
                closestDist = dist;
            }
        }

        // If no node hit by radius, check if click is inside a shield bubble
        if (!closest) {
            for (const node of this.placedNodes) {
                if (node instanceof Shield && node.isShieldActive() && node.bubbleRadius > 0) {
                    const dist = distanceBetween(worldPoint.x, worldPoint.y, node.x, node.y);
                    if (dist <= node.bubbleRadius && dist < closestDist) {
                        closest = node;
                        closestDist = dist;
                    }
                }
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

    private getNodeBuildCost(node: GameNode): number {
        if (node instanceof Shield) return SHIELD_COST;
        if (node instanceof Capacitor) return CAPACITOR_COST;
        if (node instanceof Blaster) return BLASTER_COST;
        if (node instanceof Laser) return LASER_COST;
        if (node instanceof Missile) return MISSILE_COST;
        if (node instanceof MineralMiner) return MINER_COST;
        return RELAY_COST;
    }

    private deleteSelected(): void {
        if (!this.selectedNode) return;

        const node = this.selectedNode;
        const refundCost = this.getNodeBuildCost(node);
        this.resourceManager.earn(refundCost);

        this.powerNetwork.removeNode(node);

        const idx = this.placedNodes.indexOf(node);
        if (idx >= 0) this.placedNodes.splice(idx, 1);

        this.selectedNode = null;
        node.destroy();
    }

    private upgradeSelected(): void {
        if (!this.selectedNode) return;
        const node = this.selectedNode;

        if (!node.canUpgrade()) return;

        const upgradeCost = Math.round(this.getNodeBuildCost(node) * UPGRADE_COST_FRACTION);
        if (!this.resourceManager.spend(upgradeCost)) return;

        node.upgrade();
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

        // Shield preview: show expected bubble and cluster info
        if (this.activeBuildType === 'shield') {
            this.drawShieldPreview(wx, wy, colour);
        } else {
            this.shieldInfoText.setVisible(false);
        }

        // For miners, show mining range and highlight nearby asteroids
        if (this.activeBuildType === 'miner') {
            this.rangeGraphics.lineStyle(1, COLOUR_AMBER, 0.2);
            this.rangeGraphics.strokeCircle(wx, wy, MINER_RANGE);

            for (const asteroid of this.asteroids) {
                if (asteroid.depleted) continue;
                const dist = distanceBetween(wx, wy, asteroid.x, asteroid.y);
                if (dist <= MINER_RANGE) {
                    this.rangeGraphics.lineStyle(1.5, COLOUR_AMBER, 0.5);
                    this.rangeGraphics.beginPath();
                    this.rangeGraphics.moveTo(wx, wy);
                    this.rangeGraphics.lineTo(asteroid.x, asteroid.y);
                    this.rangeGraphics.strokePath();
                }
            }
        }

        // Draw potential connections matching actual addNode() logic
        const allNodes = this.powerNetwork.getAllNodes();
        const isPlacingRelay = this.activeBuildType === 'relay';

        // Collect in-range candidates sorted by distance (mirrors PowerNetwork.addNode)
        const candidates: Array<{ node: GameNode; dist: number }> = [];
        for (const node of allNodes) {
            const dist = distanceBetween(wx, wy, node.x, node.y);
            if (dist <= MAX_POWER_LINK_LENGTH) {
                candidates.push({ node, dist });
            }
        }
        candidates.sort((a, b) => a.dist - b.dist);

        const connectedSet = new Set<GameNode>();

        if (isPlacingRelay) {
            // Backbone: all anchors in range
            for (const { node } of candidates) {
                if (this.powerNetwork.isAnchorNode(node)) {
                    connectedSet.add(node);
                }
            }
            // Orphan non-anchors up to capacity
            let slots = RELAY_MAX_CONNECTIONS;
            for (const { node } of candidates) {
                if (this.powerNetwork.isAnchorNode(node)) continue;
                const neighbors = this.powerNetwork.getNeighbors(node);
                let hasAnchor = false;
                if (neighbors) {
                    for (const n of neighbors) {
                        if (this.powerNetwork.isAnchorNode(n)) { hasAnchor = true; break; }
                    }
                }
                if (hasAnchor) continue;
                if (slots <= 0) break;
                connectedSet.add(node);
                slots--;
            }
        } else {
            // Non-anchor: nearest single anchor with capacity
            for (const { node } of candidates) {
                if (!this.powerNetwork.isAnchorNode(node)) continue;
                const capacity = node instanceof CommandHub ? HUB_MAX_CONNECTIONS : RELAY_MAX_CONNECTIONS;
                if (this.powerNetwork.getNonRelayConnectionCount(node) < capacity) {
                    connectedSet.add(node);
                    break;
                }
            }
        }

        for (const { node } of candidates) {
            if (connectedSet.has(node)) {
                const linkColour = this.isValidPlacement ? COLOUR_CYAN : COLOUR_RED;
                this.rangeGraphics.lineStyle(1, linkColour, 0.3);
                this.rangeGraphics.beginPath();
                this.rangeGraphics.moveTo(wx, wy);
                this.rangeGraphics.lineTo(node.x, node.y);
                this.rangeGraphics.strokePath();
            } else if (this.powerNetwork.isAnchorNode(node)) {
                // Show full/skipped anchors in dim red
                this.rangeGraphics.lineStyle(1, COLOUR_RED, 0.15);
                this.rangeGraphics.beginPath();
                this.rangeGraphics.moveTo(wx, wy);
                this.rangeGraphics.lineTo(node.x, node.y);
                this.rangeGraphics.strokePath();
            }
        }
    }

    private drawShieldPreview(wx: number, wy: number, colour: number): void {
        const bubbleR = SHIELD_BUBBLE_MAX_RADIUS;

        // Find existing shields that would directly cluster with this one
        const clusterShields: { x: number; y: number; r: number }[] = [];
        const directTouchNodes: Set<object> = new Set();
        for (const node of this.powerNetwork.getAllNodes()) {
            if (node instanceof Shield && node.isShieldActive() && node.bubbleRadius > 0) {
                const dist = distanceBetween(wx, wy, node.x, node.y);
                if (dist < bubbleR + node.bubbleRadius + SHIELD_CLUSTER_OVERLAP_MARGIN) {
                    clusterShields.push({ x: node.x, y: node.y, r: node.bubbleRadius });
                    directTouchNodes.add(node);
                }
            }
        }
        // Also check hub shield
        const hub = this.powerNetwork.getHub();
        if (hub && hub.isHubShieldUp()) {
            const dist = distanceBetween(wx, wy, hub.x, hub.y);
            if (dist < bubbleR + hub.hubShieldRadius + SHIELD_CLUSTER_OVERLAP_MARGIN) {
                clusterShields.push({ x: hub.x, y: hub.y, r: hub.hubShieldRadius });
                directTouchNodes.add(hub);
            }
        }

        // Expand count to include shields already clustered with any
        // directly-touching shield (even if they don't touch the new one)
        let fullClusterCount = clusterShields.length + 1; // +1 for the new shield
        if (directTouchNodes.size > 0) {
            const clusterMgr = this.powerNetwork.getShieldClusterManager();
            const counted = new Set<object>(directTouchNodes);
            for (const touchedNode of directTouchNodes) {
                const cluster = clusterMgr.getClusterFor(touchedNode as any);
                if (cluster) {
                    for (const member of cluster.members) {
                        if (!counted.has(member)) {
                            counted.add(member);
                            fullClusterCount++;
                        }
                    }
                }
            }
        }

        const willCluster = clusterShields.length > 0;

        // Draw preview bubble with organic ring (deformed if clustering)
        const segments = 48;
        this.ghostGraphics.lineStyle(1.5, colour, 0.25);
        this.ghostGraphics.beginPath();
        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;

            // Deformation toward cluster siblings
            let pull = 0;
            if (willCluster) {
                for (const sib of clusterShields) {
                    const dx = sib.x - wx;
                    const dy = sib.y - wy;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 1) continue;
                    const sibAngle = Math.atan2(dy, dx);
                    let angleDiff = angle - sibAngle;
                    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                    const alignment = Math.max(0, Math.cos(angleDiff));
                    const lobe = alignment * alignment;
                    const gap = dist - bubbleR - sib.r;
                    const reach = gap < 20 ? (20 - gap) : 0;
                    if (reach > 0) {
                        pull += reach * 0.6 * lobe;
                    }
                }
            }

            const r = bubbleR + pull;
            const px = wx + Math.cos(angle) * r;
            const py = wy + Math.sin(angle) * r;

            // Clip inside existing sibling bubbles
            let inside = false;
            for (const sib of clusterShields) {
                const dx = px - sib.x;
                const dy = py - sib.y;
                if (dx * dx + dy * dy < sib.r * sib.r) {
                    inside = true;
                    break;
                }
            }

            if (inside) {
                this.ghostGraphics.strokePath();
                this.ghostGraphics.beginPath();
            } else if (i === 0) {
                this.ghostGraphics.moveTo(px, py);
            } else {
                this.ghostGraphics.lineTo(px, py);
            }
        }
        this.ghostGraphics.strokePath();

        // Fill preview bubble (very faint)
        this.ghostGraphics.fillStyle(colour, 0.04);
        this.ghostGraphics.fillCircle(wx, wy, bubbleR);

        // Draw cluster connection preview lines in violet
        if (willCluster) {
            for (const sib of clusterShields) {
                this.ghostGraphics.lineStyle(2, COLOUR_CLUSTER_VIOLET, 0.15);
                this.ghostGraphics.beginPath();
                this.ghostGraphics.moveTo(wx, wy);
                this.ghostGraphics.lineTo(sib.x, sib.y);
                this.ghostGraphics.strokePath();
            }
        }

        // Info text
        if (willCluster) {
            const totalMembers = fullClusterCount;
            // Heat resistance scales with cluster size (damage split across members)
            const heatResist = Math.round((1 - 1 / totalMembers) * 100);
            this.shieldInfoText.setText(`Cluster: ${totalMembers} shields | ${heatResist}% heat shared`);
            this.shieldInfoText.setColor('#9966ff');
        } else {
            this.shieldInfoText.setText('Solo shield');
            this.shieldInfoText.setColor('#888888');
        }
        this.shieldInfoText.setPosition(wx, wy - bubbleR - 14);
        this.shieldInfoText.setVisible(true);
    }

    private validatePlacement(x: number, y: number, config: BuildableConfig): boolean {
        if (!this.resourceManager.canAfford(config.cost)) return false;

        const allNodes = this.powerNetwork.getAllNodes();
        for (const node of allNodes) {
            const dist = distanceBetween(x, y, node.x, node.y);
            if (dist < MIN_NODE_DISTANCE) return false;
        }

        const isPlacingRelay = this.activeBuildType === 'relay';

        // Check connection: relays can connect to any node, others need a relay/hub with capacity
        let hasConnection = false;
        for (const node of allNodes) {
            const dist = distanceBetween(x, y, node.x, node.y);
            if (dist > MAX_POWER_LINK_LENGTH) continue;

            if (isPlacingRelay) {
                // Relays can connect to anything in range
                hasConnection = true;
                break;
            } else {
                // Non-relay nodes need a relay or hub with available capacity
                if (this.powerNetwork.isAnchorNode(node)) {
                    const capacity = node instanceof CommandHub ? HUB_MAX_CONNECTIONS : RELAY_MAX_CONNECTIONS;
                    if (this.powerNetwork.getNonRelayConnectionCount(node) < capacity) {
                        hasConnection = true;
                        break;
                    }
                }
            }
        }
        if (!hasConnection) return false;

        // Miners must be near an asteroid
        if (this.activeBuildType === 'miner') {
            let nearAsteroid = false;
            for (const asteroid of this.asteroids) {
                if (asteroid.depleted) continue;
                if (distanceBetween(x, y, asteroid.x, asteroid.y) <= MINER_RANGE) {
                    nearAsteroid = true;
                    break;
                }
            }
            if (!nearAsteroid) return false;
        }

        return true;
    }

    private tryPlace(pointer: Phaser.Input.Pointer): void {
        if (!this.activeBuildType || !this.isValidPlacement) return;

        const worldPoint = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
        const config = BUILDABLE_CONFIGS[this.activeBuildType];

        if (!this.validatePlacement(worldPoint.x, worldPoint.y, config)) return;
        if (!this.resourceManager.spend(config.cost)) return;

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
            case 'laser': {
                const laser = new Laser(this.scene, worldPoint.x, worldPoint.y);
                if (this.combatSystem) laser.setCombatSystem(this.combatSystem);
                node = laser;
                break;
            }
            case 'missile': {
                const missile = new Missile(this.scene, worldPoint.x, worldPoint.y);
                if (this.combatSystem) missile.setCombatSystem(this.combatSystem);
                node = missile;
                break;
            }
            case 'miner': {
                const miner = new MineralMiner(this.scene, worldPoint.x, worldPoint.y);
                if (this.mineralManager) miner.setMineralManager(this.mineralManager);
                miner.setAsteroids(this.asteroids);
                node = miner;
                break;
            }
        }

        node.startConstruction();
        this.powerNetwork.addNode(node);
        this.placedNodes.push(node);
        SoundManager.play('build');
    }
}
