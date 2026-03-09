import Phaser from 'phaser';
import {
    WORLD_WIDTH, WORLD_HEIGHT,
    CAMERA_SCROLL_SPEED,
    STAR_LAYER_COUNT, STARS_PER_LAYER, STAR_SIZES, STAR_ALPHAS,
    COLOUR_WHITE, COLOUR_PANEL, COLOUR_PANEL_BORDER,
    CAMERA_ZOOM_MIN, CAMERA_ZOOM_MAX, CAMERA_ZOOM_STEP,
    ASTEROID_COUNT, ASTEROID_MIN_HUB_DIST, ASTEROID_RADIUS
} from '../utils/Constants';
import { CommandHub } from '../entities/CommandHub';
import { MineralAsteroid } from '../entities/MineralAsteroid';
import { ResourceManager } from '../systems/ResourceManager';
import { PowerNetwork } from '../systems/PowerNetwork';
import { BuildSystem } from '../systems/BuildSystem';
import { CombatSystem } from '../systems/CombatSystem';
import { MineralManager } from '../systems/MineralManager';
import { HUD } from '../ui/HUD';
import { BuildMenu } from '../ui/BuildMenu';
import { SpawnPanel } from '../ui/SpawnPanel';

export class GameScene extends Phaser.Scene {
    wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
    commandHub!: CommandHub;
    resourceManager!: ResourceManager;
    powerNetwork!: PowerNetwork;
    buildSystem!: BuildSystem;
    combatSystem!: CombatSystem;
    mineralManager!: MineralManager;
    hud!: HUD;
    buildMenu!: BuildMenu;
    spawnPanel!: SpawnPanel;
    asteroids: MineralAsteroid[] = [];
    starLayers: Phaser.GameObjects.Graphics[] = [];
    private uiObjects: Set<Phaser.GameObjects.GameObject> = new Set();
    private isDragging = false;
    private dragStartX = 0;
    private dragStartY = 0;
    private dragCamStartX = 0;
    private dragCamStartY = 0;
    private isPaused = false;
    private pauseOverlay!: Phaser.GameObjects.Graphics;
    private pauseText!: Phaser.GameObjects.Text;
    private pauseButton!: Phaser.GameObjects.Text;
    private pauseButtonBg!: Phaser.GameObjects.Graphics;
    private pauseZone!: Phaser.GameObjects.Zone;
    private uiCam!: Phaser.Cameras.Scene2D.Camera;
    private readonly onScaleResize: (size: Phaser.Structs.Size) => void = (size: Phaser.Structs.Size) => {
        this.handleResize(size.width, size.height);
    };
    private readonly onAddedToScene: (child: Phaser.GameObjects.GameObject) => void = (child: Phaser.GameObjects.GameObject) => {
        if (!this.uiObjects.has(child)) {
            this.uiCam.ignore(child);
        }
    };

    constructor() {
        super({ key: 'GameScene' });
    }

    create(): void {
        // Set world bounds
        this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

        // Create starfield layers
        this.createStarfield();

        // Initialise systems
        this.resourceManager = new ResourceManager();
        this.powerNetwork = new PowerNetwork();

        // Place Command Hub at world center
        this.commandHub = new CommandHub(this, WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
        this.powerNetwork.setHub(this.commandHub);

        // Build system
        this.buildSystem = new BuildSystem(this, this.resourceManager, this.powerNetwork);

        // Combat system
        this.combatSystem = new CombatSystem(this, this.resourceManager, this.powerNetwork, this.buildSystem);

        // Mineral pickup manager
        this.mineralManager = new MineralManager(this, this.powerNetwork, this.resourceManager);
        this.combatSystem.setMineralManager(this.mineralManager);

        // Spawn mineral asteroids
        this.spawnAsteroids();

        // Cross-wire: build system needs combat system for turrets
        this.buildSystem.setCombatSystem(this.combatSystem);
        this.buildSystem.setMineralManager(this.mineralManager);
        this.buildSystem.setAsteroids(this.asteroids);

        // Game over when hub is destroyed
        this.events.once('hub-destroyed', () => {
            this.scene.start('GameOverScene');
        });

        // UI (fixed to camera)
        this.hud = new HUD(this, this.resourceManager, this.powerNetwork);
        this.buildMenu = new BuildMenu(this, this.buildSystem);
        this.spawnPanel = new SpawnPanel(this, this.combatSystem);

        // Camera setup
        this.cameras.main.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);

        // UI camera – separate from main so zoom doesn't affect HUD
        const uiObjectsList = [
            ...this.hud.getGameObjects(),
            ...this.buildMenu.getGameObjects(),
            ...this.spawnPanel.getGameObjects()
        ];
        this.uiObjects = new Set(uiObjectsList);
        this.cameras.main.ignore(uiObjectsList);
        this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
        this.uiCam.setScroll(0, 0);
        // UI camera only renders UI objects – ignore everything else
        this.children.each((child) => {
            if (!this.uiObjects.has(child)) {
                this.uiCam.ignore(child);
            }
        });
        // Auto-ignore new world objects on UI camera
        this.events.on('addedtoscene', this.onAddedToScene, this);

        // Keyboard input (WASD only)
        if (this.input.keyboard) {
            this.wasd = {
                W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
                A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
                S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
                D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D)
            };
        }

        // Mouse wheel zoom toward pointer position
        this.input.on('wheel', this.onWheel, this);

        // Middle-mouse drag to pan camera
        this.input.on('pointerdown', this.onPointerDown, this);
        this.input.on('pointermove', this.onPointerMove, this);
        this.input.on('pointerup', this.onPointerUp, this);

        // Pause button (top-right)
        this.createPauseButton();

        this.scale.on('resize', this.onScaleResize, this);
        this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.handleShutdown, this);

        // P key to toggle pause
        if (this.input.keyboard) {
            this.input.keyboard.on('keydown-P', this.onKeyDownP, this);
        }
    }

    private startDrag(pointer: Phaser.Input.Pointer): void {
        this.isDragging = true;
        this.dragStartX = pointer.x;
        this.dragStartY = pointer.y;
        this.dragCamStartX = this.cameras.main.scrollX;
        this.dragCamStartY = this.cameras.main.scrollY;
    }

    private createPauseButton(): void {
        const s = (window.devicePixelRatio || 1);

        // Pause button
        this.pauseButtonBg = this.add.graphics();
        this.pauseButtonBg.setScrollFactor(0).setDepth(200);

        this.pauseButton = this.add.text(0, 0, 'PAUSE', {
            fontFamily: 'monospace',
            fontSize: `${Math.round(11 * s)}px`,
            color: '#ffffff'
        }).setScrollFactor(0).setDepth(202).setOrigin(0.5);

        this.pauseZone = this.add.zone(0, 0, 0, 0)
            .setScrollFactor(0).setDepth(203).setInteractive({ useHandCursor: true });

        this.pauseZone.on('pointerdown', () => this.togglePause());
        this.pauseZone.on('pointerover', () => this.pauseButton.setColor('#00e5ff'));
        this.pauseZone.on('pointerout', () => this.pauseButton.setColor('#ffffff'));

        // Pause overlay (hidden by default)
        this.pauseOverlay = this.add.graphics();
        this.pauseOverlay.setScrollFactor(0).setDepth(300);
        this.pauseOverlay.setVisible(false);

        this.pauseText = this.add.text(0, 0, 'PAUSED', {
            fontFamily: 'monospace',
            fontSize: `${Math.round(48 * s)}px`,
            color: '#00e5ff',
            fontStyle: 'bold'
        }).setScrollFactor(0).setDepth(301).setOrigin(0.5).setVisible(false);

        // Register pause UI objects with the camera system
        const pauseUiObjects = [this.pauseButtonBg, this.pauseButton, this.pauseZone, this.pauseOverlay, this.pauseText];
        for (const obj of pauseUiObjects) {
            this.uiObjects.add(obj);
            this.cameras.main.ignore(obj);
        }

        this.rebuildUiCamera();
        this.handleResize(this.scale.width, this.scale.height);
    }

    private rebuildUiCamera(): void {
        this.cameras.remove(this.uiCam);
        this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
        this.uiCam.setScroll(0, 0);
        this.children.each((child) => {
            if (!this.uiObjects.has(child)) {
                this.uiCam.ignore(child);
            }
        });
    }

    private redrawPauseOverlay(width: number, height: number): void {
        this.pauseOverlay.clear();
        this.pauseOverlay.fillStyle(0x000000, 0.5);
        this.pauseOverlay.fillRect(0, 0, width, height);
    }

    private handleResize(width: number, height: number): void {
        this.uiCam.setViewport(0, 0, width, height);

        this.hud.relayout(width, height);
        this.buildMenu.relayout(width, height);
        this.spawnPanel.relayout(width, height);

        const s = (window.devicePixelRatio || 1);
        const btnX = width - 80 * s;
        const btnY = 4 * s;
        const btnW = 76 * s;
        const btnH = 28 * s;

        this.pauseButtonBg.clear();
        this.pauseButtonBg.fillStyle(COLOUR_PANEL, 0.85);
        this.pauseButtonBg.fillRoundedRect(btnX, btnY, btnW, btnH, 4 * s);
        this.pauseButtonBg.lineStyle(1 * s, COLOUR_PANEL_BORDER, 0.6);
        this.pauseButtonBg.strokeRoundedRect(btnX, btnY, btnW, btnH, 4 * s);

        this.pauseButton.setPosition(btnX + btnW / 2, btnY + btnH / 2);
        this.pauseZone.setPosition(btnX + btnW / 2, btnY + btnH / 2).setSize(btnW, btnH);
        this.pauseText.setPosition(width / 2, height / 2);

        if (this.isPaused) {
            this.redrawPauseOverlay(width, height);
        }
    }

    private togglePause(): void {
        this.isPaused = !this.isPaused;

        if (this.isPaused) {
            this.redrawPauseOverlay(this.scale.width, this.scale.height);
            this.pauseOverlay.setVisible(true);
            this.pauseText.setVisible(true);
            this.pauseButton.setText('RESUME');
        } else {
            this.pauseOverlay.setVisible(false);
            this.pauseText.setVisible(false);
            this.pauseButton.setText('PAUSE');
        }
    }


    private handleShutdown(): void {
        this.scale.off('resize', this.onScaleResize, this);
        this.events.off('addedtoscene', this.onAddedToScene, this);

        if (this.input.keyboard) {
            this.input.keyboard.off('keydown-P');
        }

        this.input.off('wheel');
        this.input.off('pointerdown');
        this.input.off('pointermove');
        this.input.off('pointerup');

        this.hud.destroy();
        this.buildMenu.destroy();
        this.spawnPanel.destroy();
    }

    update(_time: number, delta: number): void {
        // Camera movement always works, even when paused
        this.handleCameraMovement();

        if (!this.isPaused) {
            this.buildSystem.update();
            this.combatSystem.update(delta);
            this.mineralManager.update(delta);
            this.powerNetwork.update(delta);
        }

        this.hud.update();
        this.spawnPanel.update();
    }

    private spawnAsteroids(): void {
        const hubX = WORLD_WIDTH / 2;
        const hubY = WORLD_HEIGHT / 2;
        const margin = ASTEROID_RADIUS + 10;

        for (let i = 0; i < ASTEROID_COUNT; i++) {
            let x: number, y: number;
            let attempts = 0;
            do {
                x = margin + Math.random() * (WORLD_WIDTH - margin * 2);
                y = margin + Math.random() * (WORLD_HEIGHT - margin * 2);
                attempts++;
            } while (
                Math.sqrt((x - hubX) ** 2 + (y - hubY) ** 2) < ASTEROID_MIN_HUB_DIST &&
                attempts < 100
            );

            const asteroid = new MineralAsteroid(this, x, y);
            this.asteroids.push(asteroid);
        }
    }

    private createStarfield(): void {
        for (let layer = 0; layer < STAR_LAYER_COUNT; layer++) {
            const gfx = this.add.graphics();
            const count = STARS_PER_LAYER[layer];
            const size = STAR_SIZES[layer];
            const alpha = STAR_ALPHAS[layer];

            gfx.fillStyle(COLOUR_WHITE, alpha);
            for (let i = 0; i < count; i++) {
                const x = Math.random() * WORLD_WIDTH;
                const y = Math.random() * WORLD_HEIGHT;
                gfx.fillCircle(x, y, size);
            }
            gfx.setDepth(-10 + layer);
            // Store layer with its parallax scroll factor
            gfx.setScrollFactor(0.2 + layer * 0.3);
            this.starLayers.push(gfx);
        }
    }

    private handleCameraMovement(): void {
        const cam = this.cameras.main;

        let dx = 0;
        let dy = 0;

        // WASD only
        if (this.wasd?.A.isDown) dx -= CAMERA_SCROLL_SPEED;
        if (this.wasd?.D.isDown) dx += CAMERA_SCROLL_SPEED;
        if (this.wasd?.W.isDown) dy -= CAMERA_SCROLL_SPEED;
        if (this.wasd?.S.isDown) dy += CAMERA_SCROLL_SPEED;

        cam.scrollX += dx;
        cam.scrollY += dy;
    }
}
