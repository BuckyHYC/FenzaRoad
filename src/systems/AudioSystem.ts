import { AUDIO_CONFIG } from '../core/Constants';
import { MusicSystem } from './MusicSystem';

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private music: MusicSystem | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private bgmVolume = 1;
  private sfxVolume = 1;

  init(): void {
    if (this.ctx) return;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    this.ctx = ctx;
    this.music = new MusicSystem(ctx);

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineGain.connect(ctx.destination);
    this.engineGain = engineGain;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.connect(engineGain);

    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = AUDIO_CONFIG.ENGINE_BASE_FREQ;
    this.engineOsc.connect(filter);
    this.engineOsc.start();

    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.value = AUDIO_CONFIG.ENGINE_BASE_FREQ / 2;
    this.engineOsc2.connect(filter);
    this.engineOsc2.start();

    const seconds = 0.4;
    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.music?.setMuted(muted);
    this.applyEngineGain();
  }

  setVolumes(bgmVolume: number, sfxVolume: number): void {
    this.bgmVolume = Math.max(0, Math.min(1, bgmVolume));
    this.sfxVolume = Math.max(0, Math.min(1, sfxVolume));
    this.music?.setVolume(this.bgmVolume);
    this.applyEngineGain();
  }

  private applyEngineGain(): void {
    if (this.ctx && this.engineGain) {
      this.engineGain.gain.setTargetAtTime(
        this.muted ? 0 : AUDIO_CONFIG.ENGINE_BASE_GAIN * this.sfxVolume,
        this.ctx.currentTime,
        0.08,
      );
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  startBgm(): void {
    this.music?.start();
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  updateEngine(rpmRatio: number, _rpm: number, throttle: number): void {
    if (!this.ctx || !this.engineOsc || !this.engineOsc2 || !this.engineGain) return;
    const freq =
      AUDIO_CONFIG.ENGINE_BASE_FREQ +
      rpmRatio * AUDIO_CONFIG.ENGINE_MAX_ADD +
      throttle * 26;
    this.engineOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(freq / 2, this.ctx.currentTime, 0.05);
    const gain = this.muted
      ? 0
      : (AUDIO_CONFIG.ENGINE_BASE_GAIN +
          throttle * AUDIO_CONFIG.ENGINE_THROTTLE_GAIN +
          rpmRatio * 0.01) *
        this.sfxVolume;
    this.engineGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.06);
  }

  playCollision(intensity: number): void {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const t = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0;
    if (t < 0.25) return;
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 220;
    filter.Q.value = 0.8;
    const gain = this.ctx.createGain();
    const peak = Math.min(0.5, (0.12 + t * 0.25) * this.sfxVolume);
    gain.gain.setValueAtTime(peak, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.22);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    source.start();
    source.stop(this.ctx.currentTime + 0.25);
  }
}
