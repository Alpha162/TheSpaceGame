import Phaser from 'phaser';
import { VIEWPORT_WIDTH, VIEWPORT_HEIGHT, COLOUR_WHITE } from '../utils/Constants';

export class MenuScene extends Phaser.Scene {
    constructor() {
        super({ key: 'MenuScene' });
    }

    create(): void {
        const cx = VIEWPORT_WIDTH / 2;
        const cy = VIEWPORT_HEIGHT / 2;

        this.add.text(cx, cy - 80, 'NODE DEFENCE', {
            fontFamily: 'monospace',
            fontSize: '48px',
            color: '#00e5ff',
            fontStyle: 'bold'
        }).setOrigin(0.5);

        this.add.text(cx, cy - 30, 'A Space Strategy Game', {
            fontFamily: 'monospace',
            fontSize: '16px',
            color: '#888888'
        }).setOrigin(0.5);

        const startButton = this.add.text(cx, cy + 60, '[ START GAME ]', {
            fontFamily: 'monospace',
            fontSize: '24px',
            color: '#ffffff',
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        startButton.on('pointerover', () => {
            startButton.setColor('#00e5ff');
        });

        startButton.on('pointerout', () => {
            startButton.setColor('#ffffff');
        });

        startButton.on('pointerdown', () => {
            this.scene.start('GameScene');
        });

        // Decorative stars in menu background
        const gfx = this.add.graphics();
        for (let i = 0; i < 100; i++) {
            const x = Math.random() * VIEWPORT_WIDTH;
            const y = Math.random() * VIEWPORT_HEIGHT;
            const alpha = 0.2 + Math.random() * 0.5;
            gfx.fillStyle(COLOUR_WHITE, alpha);
            gfx.fillCircle(x, y, 0.5 + Math.random());
        }
        gfx.setDepth(-1);
    }
}
