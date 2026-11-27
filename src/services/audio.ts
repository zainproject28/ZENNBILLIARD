class BilliardAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private sfxEnabled = true;
  private musicEnabled = false;
  private musicVolume = 0.35;
  private musicTimer: number | null = null;
  private stepIndex = 0;
  private unlockBound = false;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();

      // Master dynamics compressor prevents harsh clipping during break shots
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-12, this.ctx.currentTime);
      compressor.knee.setValueAtTime(18, this.ctx.currentTime);
      compressor.ratio.setValueAtTime(4, this.ctx.currentTime);
      compressor.attack.setValueAtTime(0.004, this.ctx.currentTime);
      compressor.release.setValueAtTime(0.18, this.ctx.currentTime);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.92, this.ctx.currentTime);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.setValueAtTime(this.musicEnabled ? this.getEffectiveMusicGain() : 0.0, this.ctx.currentTime);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.setValueAtTime(0.9, this.ctx.currentTime);

      this.musicBus.connect(compressor);
      this.sfxBus.connect(compressor);
      compressor.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);

      this.bindGestureUnlock();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private getEffectiveMusicGain(): number {
    return Math.max(0, Math.min(1, this.musicVolume)) * 0.65;
  }

  private bindGestureUnlock(): void {
    if (this.unlockBound || typeof window === 'undefined') return;
    this.unlockBound = true;
    const unlock = () => {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume().then(() => {
          if (this.musicEnabled && this.musicTimer === null) {
            this.startLoungeLoop();
          }
        }).catch(() => {});
      } else if (this.musicEnabled && this.musicTimer === null) {
        this.startLoungeLoop();
      }
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const len = Math.floor(ctx.sampleRate * 0.4);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
  }

  setSfxEnabled(enabled: boolean): void {
    this.sfxEnabled = enabled;
    if (this.sfxBus && this.ctx) {
      this.sfxBus.gain.setTargetAtTime(enabled ? 0.9 : 0.0, this.ctx.currentTime, 0.03);
    }
  }

  setMusicVolume(volume: number): void {
    this.musicVolume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0.35));
    if (this.musicBus && this.ctx) {
      const target = this.musicEnabled ? this.getEffectiveMusicGain() : 0.0;
      this.musicBus.gain.setTargetAtTime(target, this.ctx.currentTime, 0.05);
    }
  }

  setMusicEnabled(enabled: boolean): void {
    this.musicEnabled = enabled;
    if (enabled) {
      this.bindGestureUnlock();
      const ctx = this.ensureContext();
      if (this.musicBus && ctx) {
        this.musicBus.gain.setTargetAtTime(this.getEffectiveMusicGain(), ctx.currentTime, 0.08);
      }
      this.startLoungeLoop();
    } else {
      if (this.musicBus && this.ctx) {
        this.musicBus.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.08);
      }
      this.stopLoungeLoop();
    }
  }

  private startLoungeLoop(): void {
    if (this.musicTimer !== null || typeof window === 'undefined') return;

    // Smooth chill lounge neo-soul / bossa progression (16-step bar loop @ 450ms per beat = ~133 BPM eighth-groove)
    const progression = [
      { bass: 110.0, chord: [220.0, 261.63, 329.63, 392.0, 493.88], melody: 659.25 }, // Am9
      { bass: 146.83, chord: [220.0, 261.63, 349.23, 440.0, 523.25], melody: 587.33 }, // Dm9
      { bass: 98.0, chord: [196.0, 246.94, 293.66, 349.23, 440.0], melody: 523.25 },  // G13
      { bass: 130.81, chord: [196.0, 246.94, 293.66, 329.63, 440.0], melody: 659.25 }, // Cmaj9
    ];

    const playBeat = () => {
      if (!this.musicEnabled) return;
      const ctx = this.ensureContext();
      if (!ctx || !this.musicBus || ctx.state !== 'running') return;

      const now = ctx.currentTime;
      const stepInBar = this.stepIndex % 8;
      const barIdx = Math.floor(this.stepIndex / 8) % progression.length;
      const bar = progression[barIdx];
      this.stepIndex += 1;

      // 1. Warm Rhodes Electric Piano chord stab on beat 0 and syncopated beat 3
      if (stepInBar === 0 || stepInBar === 3) {
        const dur = stepInBar === 0 ? 1.45 : 1.05;
        const peak = stepInBar === 0 ? 0.036 : 0.024;
        for (const freq of bar.chord) {
          const osc = ctx.createOscillator();
          const sub = ctx.createOscillator();
          const filter = ctx.createBiquadFilter();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now);
          sub.type = 'triangle';
          sub.frequency.setValueAtTime(freq * 2, now);

          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(1400, now);
          filter.frequency.exponentialRampToValueAtTime(520, now + dur);

          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.linearRampToValueAtTime(peak, now + 0.045);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

          osc.connect(filter);
          sub.connect(filter);
          filter.connect(gain);
          gain.connect(this.musicBus);

          osc.start(now);
          sub.start(now);
          osc.stop(now + dur + 0.05);
          sub.stop(now + dur + 0.05);
        }
      }

      // 2. Deep Walking Sub Bass (beats 0, 2, 4, 6)
      if (stepInBar % 2 === 0) {
        const bassOsc = ctx.createOscillator();
        const bassGain = ctx.createGain();
        const mult = stepInBar === 4 ? 1.498 : stepInBar === 6 ? 1.122 : 1.0;
        bassOsc.type = 'triangle';
        bassOsc.frequency.setValueAtTime(bar.bass * mult, now);

        bassGain.gain.setValueAtTime(0.0001, now);
        bassGain.gain.linearRampToValueAtTime(0.085, now + 0.02);
        bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.44);

        bassOsc.connect(bassGain);
        bassGain.connect(this.musicBus);
        bassOsc.start(now);
        bassOsc.stop(now + 0.46);
      }

      // 3. Soft Lounge Brush Hi-Hat & Rim Click groove
      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoiseBuffer(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(stepInBar % 2 === 1 ? 5200 : 3800, now);

      const brushGain = ctx.createGain();
      const brushVol = stepInBar % 2 === 1 ? 0.022 : 0.011;
      brushGain.gain.setValueAtTime(brushVol, now);
      brushGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);

      noise.connect(hp);
      hp.connect(brushGain);
      brushGain.connect(this.musicBus);
      noise.start(now);
      noise.stop(now + 0.075);

      // 4. Delicate vibraphone bell accent on step 5
      if (stepInBar === 5 && barIdx % 2 === 1) {
        const bell = ctx.createOscillator();
        const bellGain = ctx.createGain();
        bell.type = 'sine';
        bell.frequency.setValueAtTime(bar.melody, now);
        bellGain.gain.setValueAtTime(0.0001, now);
        bellGain.gain.linearRampToValueAtTime(0.026, now + 0.012);
        bellGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
        bell.connect(bellGain);
        bellGain.connect(this.musicBus);
        bell.start(now);
        bell.stop(now + 0.58);
      }
    };

    playBeat();
    this.musicTimer = window.setInterval(playBeat, 360);
  }

  private stopLoungeLoop(): void {
    if (this.musicTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  playCueHit(power: number): void {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;
    const clampedPower = Math.max(0.05, Math.min(1, power));

    // 1. Leather tip transient thump
    const bodyOsc = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    bodyOsc.type = 'triangle';
    bodyOsc.frequency.setValueAtTime(240 + clampedPower * 220, now);
    bodyOsc.frequency.exponentialRampToValueAtTime(72, now + 0.075);
    bodyGain.gain.setValueAtTime(0.14 + clampedPower * 0.34, now);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    bodyOsc.connect(bodyGain);
    bodyGain.connect(this.sfxBus);
    bodyOsc.start(now);
    bodyOsc.stop(now + 0.085);

    // 2. Crisp chalk-tip pop noise burst
    const noise = ctx.createBufferSource();
    noise.buffer = this.getNoiseBuffer(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1600 + clampedPower * 900, now);
    bp.Q.setValueAtTime(1.8, now);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.08 + clampedPower * 0.22, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(this.sfxBus);
    noise.start(now);
    noise.stop(now + 0.04);
  }

  playBallCollision(intensity: number): void {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;
    const lvl = Math.max(0.08, Math.min(1, intensity));
    const vol = Math.min(0.46, 0.07 + lvl * 0.38);

    // Phenolic resin click: crisp transient + resonant pair
    const freqs = [2150 + Math.random() * 140, 3850 + Math.random() * 240];
    for (let i = 0; i < freqs.length; i++) {
      const f = freqs[i];
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(f, now);
      osc.frequency.exponentialRampToValueAtTime(f * 0.62, now + 0.028);
      gain.gain.setValueAtTime(vol * (i === 0 ? 0.58 : 0.42), now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.032);
      osc.connect(gain);
      gain.connect(this.sfxBus);
      osc.start(now);
      osc.stop(now + 0.036);
    }

    // Short sharp click transient for strong breaks
    if (lvl > 0.35) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.getNoiseBuffer(ctx);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(2800, now);
      const nGain = ctx.createGain();
      nGain.gain.setValueAtTime(vol * 0.28, now);
      nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);
      noise.connect(hp);
      hp.connect(nGain);
      nGain.connect(this.sfxBus);
      noise.start(now);
      noise.stop(now + 0.02);
    }
  }

  playCushionHit(intensity: number): void {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;
    const vol = Math.min(0.36, 0.05 + Math.min(1, intensity) * 0.28);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(155, now);
    osc.frequency.exponentialRampToValueAtTime(52, now + 0.09);
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  playPocketDrop(): void {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;

    // 1. Jaw rattle tap
    const rattle = ctx.createOscillator();
    const rGain = ctx.createGain();
    rattle.type = 'triangle';
    rattle.frequency.setValueAtTime(340, now);
    rattle.frequency.exponentialRampToValueAtTime(140, now + 0.045);
    rGain.gain.setValueAtTime(0.16, now);
    rGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    rattle.connect(rGain);
    rGain.connect(this.sfxBus);
    rattle.start(now);
    rattle.stop(now + 0.055);

    // 2. Deep leather pocket cup drop
    const cup = ctx.createOscillator();
    const cGain = ctx.createGain();
    cup.type = 'sine';
    cup.frequency.setValueAtTime(210, now + 0.055);
    cup.frequency.exponentialRampToValueAtTime(68, now + 0.21);
    cGain.gain.setValueAtTime(0.28, now + 0.055);
    cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    cup.connect(cGain);
    cGain.connect(this.sfxBus);
    cup.start(now + 0.055);
    cup.stop(now + 0.23);
  }

  playAimTick(): void {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1180, now);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.015);
    gain.gain.setValueAtTime(0.032, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 0.02);
  }

  playCoinCollect(): void {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;
    const notes = [987.77, 1318.51, 1567.98];
    notes.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + idx * 0.065;
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.14, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
      osc.connect(gain);
      gain.connect(this.sfxBus!);
      osc.start(t);
      osc.stop(t + 0.28);
    });
  }

  playVictory(): void {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.1;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.connect(gain);
      gain.connect(this.sfxBus!);
      osc.start(t);
      osc.stop(t + 0.52);
    });
  }

  playDefeat(): void {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;
    const notes = [392.0, 349.23, 311.13, 261.63];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + idx * 0.14;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      osc.connect(gain);
      gain.connect(this.sfxBus!);
      osc.start(t);
      osc.stop(t + 0.44);
    });
  }

  playClick(): void {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(740, now);
    osc.frequency.exponentialRampToValueAtTime(360, now + 0.025);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + 0.032);
  }

  playNotification(): void {
    if (!this.sfxEnabled) return;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxBus) return;
    const now = ctx.currentTime;
    [587.33, 880, 1174.66].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      const t = now + i * 0.075;
      osc.frequency.setValueAtTime(f, t);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
      osc.connect(gain);
      gain.connect(this.sfxBus!);
      osc.start(t);
      osc.stop(t + 0.26);
    });
  }
}

export const audioEngine = new BilliardAudioEngine();

export function triggerHaptic(enabled: boolean, ms: number = 15): void {
  if (!enabled || typeof navigator === 'undefined' || !navigator.vibrate) return;
  try {
    navigator.vibrate(ms);
  } catch {
    // Ignore on unsupported browsers
  }
}
