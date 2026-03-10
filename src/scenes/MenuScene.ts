import Phaser from 'phaser';
import { COLOUR_WHITE, UI_SCALE } from '../utils/Constants';
import { SoundManager } from '../systems/SoundManager';

export class MenuScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MenuScene' });
    }

    create(): void {
        const cx = this.scale.width / 2;
        const cy = this.scale.height / 2;
        const s = UI_SCALE;

        this.add.text(cx, cy - 80 * s, 'NODE DEFENCE', {
            fontFamily: 'monospace',
            fontSize: `${Math.round(48 * s)}px`,
            color: '#00e5ff',
            fontStyle: 'bold'
        }).setOrigin(0.5);

        this.add.text(cx, cy - 30 * s, 'A Space Strategy Game', {
            fontFamily: 'monospace',
            fontSize: `${Math.round(16 * s)}px`,
            color: '#888888'
        }).setOrigin(0.5);

        this.add.text(cx, cy + 8 * s, 'Controls: WASD move · Wheel zoom · Right-drag pan · Right-click cancel build', {
            fontFamily: 'monospace',
            fontSize: `${Math.round(12 * s)}px`,
            color: '#00e5ff'
        }).setOrigin(0.5);

        const startButton = this.add.text(cx, cy + 60 * s, '[ START GAME ]', {
            fontFamily: 'monospace',
            fontSize: `${Math.round(24 * s)}px`,
            color: '#ffffff',
            padding: { x: 20 * s, y: 10 * s }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        startButton.on('pointerover', () => {
            startButton.setColor('#00e5ff');
            SoundManager.play('uiHover');
        });

        startButton.on('pointerout', () => {
            startButton.setColor('#ffffff');
        });

        startButton.on('pointerdown', () => {
            SoundManager.play('uiClick');
            this.scene.start('GameScene');
        });

        // Decorative stars in menu background
        const gfx = this.add.graphics();
        for (let i = 0; i < 100; i++) {
            const x = Math.random() * this.scale.width;
            const y = Math.random() * this.scale.height;
            const alpha = 0.2 + Math.random() * 0.5;
            gfx.fillStyle(COLOUR_WHITE, alpha);
            gfx.fillCircle(x, y, (0.5 + Math.random()) * s);
        }
        gfx.setDepth(-1);
    }
}
