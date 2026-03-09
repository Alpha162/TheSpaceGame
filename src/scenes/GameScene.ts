import Phaser from 'phaser';
import {
    WORLD_WIDTH, WORLD_HEIGHT,
    CAMERA_SCROLL_SPEED,
    STAR_LAYER_COUNT, STARS_PER_LAYER, STAR_SIZES, STAR_ALPHAS,
    COLOUR_WHITE,
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
        const uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
        uiCam.setScroll(0, 0);
        // UI camera only renders UI objects – ignore everything else
        this.children.each((child) => {
            if (!this.uiObjects.has(child)) {
                uiCam.ignore(child);
            }
        });
        // Auto-ignore new world objects on UI camera
        this.events.on('addedtoscene', (child: Phaser.GameObjects.GameObject) => {
            if (!this.uiObjects.has(child)) {
                uiCam.ignore(child);
            }
        });

        // Keyboard input (WASD only)
        if (this.input.keyboard) {
            this.wasd = {
                W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
                A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
                S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
                D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D)
            };
        }

        // Mouse wheel zoom
        this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gos: unknown[], _dx: number, dy: number) => {
            const cam = this.cameras.main;
            if (dy > 0) {
                cam.zoom = Math.max(CAMERA_ZOOM_MIN, cam.zoom - CAMERA_ZOOM_STEP);
            } else if (dy < 0) {
                cam.zoom = Math.min(CAMERA_ZOOM_MAX, cam.zoom + CAMERA_ZOOM_STEP);
            }
        });
    }

    update(_time: number, delta: number): void {
        this.handleCameraMovement();
        this.buildSystem.update();
        this.combatSystem.update(delta);
        this.mineralManager.update(delta);
        this.powerNetwork.update(delta);
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
