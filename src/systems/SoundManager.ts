/**
 * Procedural sound effects for Node Defence.
 * All sounds are synthesized via the Web Audio API — no audio files needed.
 */

type SoundName =
    | 'blasterFire'
    | 'laserHum'
    | 'laserLock'
    | 'missileLaunch'
    | 'explosion'
    | 'hit'
    | 'shieldHit'
    | 'enemyDeath'
    | 'build'
    | 'constructionComplete'
    | 'mineralPickup'
    | 'uiClick'
    | 'uiHover'
    | 'gameOver'
    | 'waveSpawn'
    | 'nodeDestroyed';

class SoundManagerImpl {
    private ctx: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private _volume = 0.3;
    private _muted = false;
    private initialized = false;

    /** Lazily create the AudioContext on first user interaction */
    private ensureContext(): AudioContext | null {
        if (this.ctx) return this.ctx;
        try {
            this.ctx = new AudioContext();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this._muted ? 0 : this._volume;
            this.masterGain.connect(this.ctx.destination);
            this.initialized = true;
            return this.ctx;
        } catch {
            return null;
        }
    }

    get volume(): number { return this._volume; }
    set volume(v: number) {
        this._volume = Math.max(0, Math.min(1, v));
        if (this.masterGain) {
            this.masterGain.gain.value = this._muted ? 0 : this._volume;
        }
    }

    get muted(): boolean { return this._muted; }
    set muted(m: boolean) {
        this._muted = m;
        if (this.masterGain) {
            this.masterGain.gain.value = m ? 0 : this._volume;
        }
    }

    play(name: SoundName): void {
        const ctx = this.ensureContext();
        if (!ctx || !this.masterGain) return;
        if (ctx.state === 'suspended') ctx.resume();

        switch (name) {
            case 'blasterFire': this.playBlasterFire(ctx); break;
            case 'laserHum': this.playLaserHum(ctx); break;
            case 'laserLock': this.playLaserLock(ctx); break;
            case 'missileLaunch': this.playMissileLaunch(ctx); break;
            case 'explosion': this.playExplosion(ctx); break;
            case 'hit': this.playHit(ctx); break;
            case 'shieldHit': this.playShieldHit(ctx); break;
            case 'enemyDeath': this.playEnemyDeath(ctx); break;
            case 'build': this.playBuild(ctx); break;
            case 'constructionComplete': this.playConstructionComplete(ctx); break;
            case 'mineralPickup': this.playMineralPickup(ctx); break;
            case 'uiClick': this.playUIClick(ctx); break;
            case 'uiHover': this.playUIHover(ctx); break;
            case 'gameOver': this.playGameOver(ctx); break;
            case 'waveSpawn': this.playWaveSpawn(ctx); break;
            case 'nodeDestroyed': this.playNodeDestroyed(ctx); break;
        }
    }

    // ─── Sound Generators ───────────────────────────────────

    /** Quick "pew" — short frequency sweep down */
    private playBlasterFire(ctx: AudioContext): void {
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(1200 + Math.random() * 200, t);
        osc.frequency.exponentialRampToValueAtTime(300, t + 0.08);

        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);

        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.09);
    }

    /** Short buzz for laser continuous damage tick */
    private playLaserHum(ctx: AudioContext): void {
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.linearRampToValueAtTime(260, t + 0.1);

        gain.gain.setValueAtTime(0.06, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.11);
    }

    /** Rising tone when laser locks on */
    private playLaserLock(ctx: AudioContext): void {
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, t);
        osc.frequency.exponentialRampToValueAtTime(1200, t + 0.15);

        gain.gain.setValueAtTime(0.12, t);
        gain.gain.linearRampToValueAtTime(0.15, t + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);

        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.21);
    }

    /** Low whoosh for missile launch */
    private playMissileLaunch(ctx: AudioContext): void {
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const noise = this.createNoiseBurst(ctx, t, 0.15, 0.06);
        const gain = ctx.createGain();

        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(600, t + 0.12);

        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

        osc.connect(gain);
        gain.connect(this.masterGain!);
        noise.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.16);
    }

    /** Booming explosion — noise burst + low rumble */
    private playExplosion(ctx: AudioContext): void {
        const t = ctx.currentTime;

        // Noise burst
        this.createNoiseBurst(ctx, t, 0.3, 0.2).connect(this.masterGain!);

        // Low rumble
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(80, t);
        osc.frequency.exponentialRampToValueAtTime(30, t + 0.3);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.36);
    }

    /** Small impact — projectile hitting an enemy */
    private playHit(ctx: AudioContext): void {
        const t = ctx.currentTime;
        this.createNoiseBurst(ctx, t, 0.05, 0.08).connect(this.masterGain!);
    }

    /** Dull thud with shimmer — shield absorbing damage */
    private playShieldHit(ctx: AudioContext): void {
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, t);
        osc.frequency.exponentialRampToValueAtTime(200, t + 0.12);

        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.16);
    }

    /** Short crackle for enemy death */
    private playEnemyDeath(ctx: AudioContext): void {
        const t = ctx.currentTime;
        this.createNoiseBurst(ctx, t, 0.1, 0.1).connect(this.masterGain!);

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(600, t);
        osc.frequency.exponentialRampToValueAtTime(100, t + 0.1);
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.13);
    }

    /** Placement thunk */
    private playBuild(ctx: AudioContext): void {
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(300, t);
        osc.frequency.exponentialRampToValueAtTime(500, t + 0.06);

        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.11);
    }

    /** Rising chime — construction done */
    private playConstructionComplete(ctx: AudioContext): void {
        const t = ctx.currentTime;
        const notes = [600, 800, 1000];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            const start = t + i * 0.07;
            osc.frequency.setValueAtTime(freq, start);
            gain.gain.setValueAtTime(0.1, start);
            gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);
            osc.connect(gain);
            gain.connect(this.masterGain!);
            osc.start(start);
            osc.stop(start + 0.13);
        });
    }

    /** Small bright ding — mineral collected */
    private playMineralPickup(ctx: AudioContext): void {
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(1000 + Math.random() * 200, t);
        osc.frequency.exponentialRampToValueAtTime(1400, t + 0.06);

        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);

        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.11);
    }

    /** Soft click for UI buttons */
    private playUIClick(ctx: AudioContext): void {
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(700, t);

        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.05);
    }

    /** Very soft high blip for hover */
    private playUIHover(ctx: AudioContext): void {
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(1100, t);

        gain.gain.setValueAtTime(0.03, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);

        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.04);
    }

    /** Descending tone — game over */
    private playGameOver(ctx: AudioContext): void {
        const t = ctx.currentTime;
        const notes = [500, 400, 300, 150];
        notes.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sawtooth';
            const start = t + i * 0.15;
            osc.frequency.setValueAtTime(freq, start);
            osc.frequency.exponentialRampToValueAtTime(freq * 0.8, start + 0.15);
            gain.gain.setValueAtTime(0.1, start);
            gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
            osc.connect(gain);
            gain.connect(this.masterGain!);
            osc.start(start);
            osc.stop(start + 0.21);
        });
    }

    /** Alert siren — enemy wave incoming */
    private playWaveSpawn(ctx: AudioContext): void {
        const t = ctx.currentTime;
        for (let i = 0; i < 2; i++) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            const start = t + i * 0.15;
            osc.frequency.setValueAtTime(600, start);
            osc.frequency.linearRampToValueAtTime(900, start + 0.07);
            osc.frequency.linearRampToValueAtTime(600, start + 0.14);
            gain.gain.setValueAtTime(0.1, start);
            gain.gain.exponentialRampToValueAtTime(0.001, start + 0.14);
            osc.connect(gain);
            gain.connect(this.masterGain!);
            osc.start(start);
            osc.stop(start + 0.15);
        }
    }

    /** Structure destroyed — low crunch */
    private playNodeDestroyed(ctx: AudioContext): void {
        const t = ctx.currentTime;
        this.createNoiseBurst(ctx, t, 0.2, 0.15).connect(this.masterGain!);

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, t);
        osc.frequency.exponentialRampToValueAtTime(50, t + 0.25);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(t);
        osc.stop(t + 0.31);
    }

    // ─── Helpers ────────────────────────────────────────────

    /** Create a short white-noise burst and return the gain node for connecting */
    private createNoiseBurst(ctx: AudioContext, startTime: number, duration: number, volume: number): GainNode {
        const bufferSize = Math.ceil(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1);
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(volume, startTime);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

        source.connect(gain);
        source.start(startTime);
        source.stop(startTime + duration + 0.01);

        return gain;
    }
}

/** Global singleton */
export const SoundManager = new SoundManagerImpl();
