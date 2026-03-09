import Phaser from 'phaser';
import { VIEWPORT_WIDTH, VIEWPORT_HEIGHT, COLOUR_WHITE, COLOUR_RED } from '../utils/Constants';

export class GameOverScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameOverScene' });
    }

    create(): void {
        const cx = VIEWPORT_WIDTH / 2;
        const cy = VIEWPORT_HEIGHT / 2;

        // Starfield background
        const gfx = this.add.graphics();
        for (let i = 0; i < 100; i++) {
            const x = Math.random() * VIEWPORT_WIDTH;
            const y = Math.random() * VIEWPORT_HEIGHT;
            gfx.fillStyle(COLOUR_WHITE, 0.15 + Math.random() * 0.3);
            gfx.fillCircle(x, y, 0.5 + Math.random());
        }
        gfx.setDepth(-1);

        // Title
        this.add.text(cx, cy - 60, 'COMMAND HUB DESTROYED', {
            fontFamily: 'monospace',
            fontSize: '32px',
            color: '#' + COLOUR_RED.toString(16).padStart(6, '0'),
            fontStyle: 'bold'
        }).setOrigin(0.5);

        this.add.text(cx, cy, 'Your network has fallen.', {
            fontFamily: 'monospace',
            fontSize: '16px',
            color: '#888888'
        }).setOrigin(0.5);

        // Restart button
        const restartButton = this.add.text(cx, cy + 70, '[ RESTART ]', {
            fontFamily: 'monospace',
            fontSize: '24px',
            color: '#ffffff',
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        restartButton.on('pointerover', () => restartButton.setColor('#00e5ff'));
        restartButton.on('pointerout', () => restartButton.setColor('#ffffff'));
        restartButton.on('pointerdown', () => {
            this.scene.start('GameScene');
        });

        // Menu button
        const menuButton = this.add.text(cx, cy + 120, '[ MAIN MENU ]', {
            fontFamily: 'monospace',
            fontSize: '18px',
            color: '#666666',
            padding: { x: 20, y: 10 }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        menuButton.on('pointerover', () => menuButton.setColor('#00e5ff'));
        menuButton.on('pointerout', () => menuButton.setColor('#666666'));
        menuButton.on('pointerdown', () => {
            this.scene.start('MenuScene');
        });
    }
}
