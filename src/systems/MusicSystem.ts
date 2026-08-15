import { MUSIC_CONFIG } from '../core/Constants';

interface ChordDef {
  root: number;
  intervals: readonly number[];
}

interface MusicMode {
  stepSeconds: number;
  gain: number;
  chords: readonly ChordDef[];
  /** true = 竞速风格：八分音符贝斯、每拍琶音、打击乐 */
  race: boolean;
}

const CALM_MODE: MusicMode = {
  stepSeconds: 0.24,
  gain: MUSIC_CONFIG.NORMAL_GAIN,
  chords: [
    { root: 45, intervals: [0, 3, 7] },
    { root: 41, intervals: [0, 4, 7] },
    { root: 48, intervals: [0, 4, 7] },
    { root: 43, intervals: [0, 4, 7] },
  ],
  race: false,
};

const RACE_MODE: MusicMode = {
  stepSeconds: 0.15,
  gain: MUSIC_CONFIG.RACE_GAIN,
  chords: [
    { root: 45, intervals: [0, 3, 7] },
    { root: 43, intervals: [0, 3, 7] },
    { root: 41, intervals: [0, 3, 7] },
    { root: 40, intervals: [0, 3, 7] },
  ],
  race: true,
};

const LOOKAHEAD_SECONDS = 0.3;
const BASS_NOTE = -12;
const CALM_ARP_OFFSETS = [0, 12, 19, 24, 19, 12, 7, 12] as const;
const RACE_ARP_OFFSETS = [0, 12, 7, 19, 12, 7, 15, 10] as const;

export class MusicSystem {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private readonly noiseBuffer: AudioBuffer;
  private timer: number | null = null;
  private step = 0;
  private nextStepTime = 0;
  private muted = false;
  private volume = 1;
  private mode: MusicMode = CALM_MODE;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // 打击乐噪声（竞速模式的底鼓/军鼓/镲片）
    const seconds = 0.3;
    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  start(): void {
    if (this.timer !== null) return;
    this.nextStepTime = this.ctx.currentTime + 0.08;
    this.step = 0;
    this.apply();
    this.timer = window.setInterval(() => this.schedule(), 80);
  }

  /** 竞速模式：更快的节奏、更紧张的和声与打击乐 */
  setRaceMode(race: boolean): void {
    const next = race ? RACE_MODE : CALM_MODE;
    if (next === this.mode) return;
    this.mode = next;
    this.apply();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.apply();
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    this.apply();
  }

  private apply(): void {
    this.master.gain.setTargetAtTime(
      this.muted ? 0 : this.mode.gain * this.volume,
      this.ctx.currentTime,
      0.08,
    );
  }

  private schedule(): void {
    const stepSeconds = this.mode.stepSeconds;
    while (this.nextStepTime < this.ctx.currentTime + LOOKAHEAD_SECONDS) {
      const chordIndex = Math.floor(this.step / 8) % this.mode.chords.length;
      const chord = this.mode.chords[chordIndex];
      const stepInBar = this.step % 8;
      this.scheduleStep(chord, stepInBar, this.nextStepTime);
      this.step += 1;
      this.nextStepTime += stepSeconds;
    }
  }

  private scheduleStep(
    chord: ChordDef,
    stepInBar: number,
    time: number,
  ): void {
    const race = this.mode.race;
    if (race) {
      // 竞速：每拍贝斯 + 底鼓，反拍军鼓/镲片，每拍琶音
      const bassMidi = chord.root + BASS_NOTE;
      this.playTone(midiToFreq(bassMidi), time, 0.16, 0.22, 'sawtooth');
      this.playTone(midiToFreq(bassMidi), time + 0.005, 0.14, 0.16, 'square');
      if (stepInBar % 2 === 0) {
        this.playKick(time, stepInBar === 0 ? 0.5 : 0.34);
      } else {
        this.playSnare(time);
      }
      const arpMidi = chord.root + RACE_ARP_OFFSETS[stepInBar];
      this.playTone(midiToFreq(arpMidi), time, 0.09, 0.16, 'square');
      if (stepInBar === 0 || stepInBar === 4) {
        for (const interval of chord.intervals) {
          this.playTone(
            midiToFreq(chord.root + 12 + interval),
            time,
            0.2,
            0.05,
            'sawtooth',
          );
        }
      }
      return;
    }

    // 巡航：原有人声氛围
    if (stepInBar === 0 || stepInBar === 4) {
      const midi = chord.root + BASS_NOTE;
      this.playTone(midiToFreq(midi), time, 0.9, 0.16, 'triangle');
      this.playTone(midiToFreq(midi + 12), time + 0.01, 0.7, 0.06, 'sine');
    }
    if (stepInBar % 2 === 0) {
      const arpMidi = chord.root + CALM_ARP_OFFSETS[stepInBar / 2];
      this.playTone(midiToFreq(arpMidi), time, 0.4, 0.05, 'square');
    }
    if (stepInBar === 0) {
      for (const interval of chord.intervals) {
        this.playTone(
          midiToFreq(chord.root + 12 + interval),
          time,
          1.7,
          0.022,
          'sine',
        );
      }
    }
  }

  private playKick(time: number, gain: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.11);
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(gain, time);
    envelope.gain.exponentialRampToValueAtTime(0.001, time + 0.13);
    osc.connect(envelope);
    envelope.connect(this.master);
    osc.start(time);
    osc.stop(time + 0.16);
  }

  private playSnare(time: number): void {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1500;
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(0.12, time);
    envelope.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    source.start(time);
    source.stop(time + 0.1);
  }

  private playTone(
    frequency: number,
    time: number,
    duration: number,
    gain: number,
    type: OscillatorType,
  ): void {
    if (this.muted) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    const envelope = this.ctx.createGain();
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(gain, time + 0.035);
    envelope.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc.connect(envelope);
    envelope.connect(this.master);
    osc.start(time);
    osc.stop(time + duration + 0.06);
  }
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}
