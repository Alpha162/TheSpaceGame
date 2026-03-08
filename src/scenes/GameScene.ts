import Phaser from 'phaser';
import {
    WORLD_WIDTH, WORLD_HEIGHT,
    CAMERA_SCROLL_SPEED, CAMERA_EDGE_ZONE,
    STAR_LAYER_COUNT, STARS_PER_LAYER, STAR_SIZES, STAR_ALPHAS,
    COLOUR_WHITE
} from '../utils/Constants';
import { CommandHub } from '../entities/CommandHub';
import { ResourceManager } from '../systems/ResourceManager';
import { PowerNetwork } from '../systems/PowerNetwork';
import { BuildSystem } from '../systems/BuildSystem';
import { HUD } from '../ui/HUD';
import { BuildMenu } from '../ui/BuildMenu';

export class GameScene extends Phaser.Scene {
    cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
    wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
    commandHub!: CommandHub;
    resourceManager!: ResourceManager;
    powerNetwork!: PowerNetwork;
    buildSystem!: BuildSystem;
    hud!: HUD;
    buildMenu!: BuildMenu;
    starLayers: Phaser.GameObjects.Graphics[] = [];

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

        // UI (fixed to camera)
        this.hud = new HUD(this, this.resourceManager, this.powerNetwork);
        this.buildMenu = new BuildMenu(this, this.buildSystem);

        // Camera setup
        this.cameras.main.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);

        // Keyboard input
        if (this.input.keyboard) {
            this.cursors = this.input.keyboard.createCursorKeys();
            this.wasd = {
                W: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
                A: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
                S: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
                D: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D)
            };
        }
    }

    update(_time: number, _delta: number): void {
        this.handleCameraMovement();
        this.buildSystem.update();
        this.powerNetwork.update();
        this.hud.update();
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
        const pointer = this.input.activePointer;

        let dx = 0;
        let dy = 0;

        // Keyboard
        if (this.cursors?.left.isDown || this.wasd?.A.isDown) dx -= CAMERA_SCROLL_SPEED;
        if (this.cursors?.right.isDown || this.wasd?.D.isDown) dx += CAMERA_SCROLL_SPEED;
        if (this.cursors?.up.isDown || this.wasd?.W.isDown) dy -= CAMERA_SCROLL_SPEED;
        if (this.cursors?.down.isDown || this.wasd?.S.isDown) dy += CAMERA_SCROLL_SPEED;

        // Mouse edge scrolling
        if (pointer.x < CAMERA_EDGE_ZONE) dx -= CAMERA_SCROLL_SPEED;
        if (pointer.x > cam.width - CAMERA_EDGE_ZONE) dx += CAMERA_SCROLL_SPEED;
        if (pointer.y < CAMERA_EDGE_ZONE) dy -= CAMERA_SCROLL_SPEED;
        if (pointer.y > cam.height - CAMERA_EDGE_ZONE) dy += CAMERA_SCROLL_SPEED;

        cam.scrollX += dx;
        cam.scrollY += dy;
    }
}
