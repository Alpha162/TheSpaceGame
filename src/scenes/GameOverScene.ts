import Phaser from 'phaser';
import { COLOUR_WHITE, COLOUR_RED, UI_SCALE } from '../utils/Constants';
import { SoundManager } from '../systems/SoundManager';

export class GameOverScene extends Phaser.Scene {
    constructor() {
        super({ key: 'GameOverScene' });
    }

    create(): void {
        const cx = this.scale.width / 2;
        const cy = this.scale.height / 2;
        const s = UI_SCALE;

        // Starfield background
        const gfx = this.add.graphics();
        for (let i = 0; i < 100; i++) {
            const x = Math.random() * this.scale.width;
            const y = Math.random() * this.scale.height;
            gfx.fillStyle(COLOUR_WHITE, 0.15 + Math.random() * 0.3);
            gfx.fillCircle(x, y, (0.5 + Math.random()) * s);
        }
        gfx.setDepth(-1);

        // Title
        this.add.text(cx, cy - 60 * s, 'COMMAND HUB DESTROYED', {
            fontFamily: 'monospace',
            fontSize: `${Math.round(32 * s)}px`,
            color: '#' + COLOUR_RED.toString(16).padStart(6, '0'),
            fontStyle: 'bold'
        }).setOrigin(0.5);

        this.add.text(cx, cy, 'Your network has fallen.', {
            fontFamily: 'monospace',
            fontSize: `${Math.round(16 * s)}px`,
            color: '#888888'
        }).setOrigin(0.5);

        // Restart button
        const restartButton = this.add.text(cx, cy + 70 * s, '[ RESTART ]', {
            fontFamily: 'monospace',
            fontSize: `${Math.round(24 * s)}px`,
            color: '#ffffff',
            padding: { x: 20 * s, y: 10 * s }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        restartButton.on('pointerover', () => { restartButton.setColor('#00e5ff'); SoundManager.play('uiHover'); });
        restartButton.on('pointerout', () => restartButton.setColor('#ffffff'));
        restartButton.on('pointerdown', () => {
            SoundManager.play('uiClick');
            this.scene.start('GameScene');
        });

        // Menu button
        const menuButton = this.add.text(cx, cy + 120 * s, '[ MAIN MENU ]', {
            fontFamily: 'monospace',
            fontSize: `${Math.round(18 * s)}px`,
            color: '#666666',
            padding: { x: 20 * s, y: 10 * s }
        }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        menuButton.on('pointerover', () => { menuButton.setColor('#00e5ff'); SoundManager.play('uiHover'); });
        menuButton.on('pointerout', () => menuButton.setColor('#666666'));
        menuButton.on('pointerdown', () => {
            SoundManager.play('uiClick');
            this.scene.start('MenuScene');
        });
    }
}
