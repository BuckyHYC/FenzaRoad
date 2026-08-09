const CHORD_PROGRESSION = [
  { root: 45, intervals: [0, 3, 7] },
  { root: 41, intervals: [0, 4, 7] },
  { root: 48, intervals: [0, 4, 7] },
  { root: 43, intervals: [0, 4, 7] },
] as const;

const STEP_SECONDS = 0.24;
const LOOKAHEAD_SECONDS = 0.3;
const BASS_NOTE = -12;
const ARP_OFFSETS = [0, 12, 19, 24, 19, 12, 7, 12] as const;

export class MusicSystem {
  private readonly ctx: AudioContext;
  private readonly master: GainNode;
  private timer: number | null = null;
  private step = 0;
  private nextStepTime = 0;
  private muted = false;
  private volume = 1;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
  }

  start(): void {
    if (this.timer !== null) return;
    this.nextStepTime = this.ctx.currentTime + 0.08;
    this.step = 0;
    this.apply();
    this.timer = window.setInterval(() => this.schedule(), 90);
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
      this.muted ? 0 : 0.11 * this.volume,
      this.ctx.currentTime,
      0.08,
    );
  }

  private schedule(): void {
    while (this.nextStepTime < this.ctx.currentTime + LOOKAHEAD_SECONDS) {
      const chordIndex = Math.floor(this.step / 8) % CHORD_PROGRESSION.length;
      const chord = CHORD_PROGRESSION[chordIndex];
      const stepInBar = this.step % 8;
      this.scheduleStep(chord, stepInBar, this.nextStepTime);
      this.step += 1;
      this.nextStepTime += STEP_SECONDS;
    }
  }

  private scheduleStep(
    chord: (typeof CHORD_PROGRESSION)[number],
    stepInBar: number,
    time: number,
  ): void {
    if (stepInBar === 0 || stepInBar === 4) {
      const midi = chord.root + BASS_NOTE;
      this.playTone(midiToFreq(midi), time, 0.9, 0.16, 'triangle');
      this.playTone(midiToFreq(midi + 12), time + 0.01, 0.7, 0.06, 'sine');
    }
    if (stepInBar % 2 === 0) {
      const arpMidi = chord.root + ARP_OFFSETS[stepInBar / 2];
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
