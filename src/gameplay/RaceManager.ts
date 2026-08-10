import * as THREE from 'three';
import { RACE_CONFIG } from '../core/Constants';
import { eventBus, Events } from '../core/EventBus';
import type { Difficulty, RacePhase } from '../core/types';
import type { PlayerVehicle } from './PlayerVehicle';

export interface RacerState {
  vehicle: PlayerVehicle;
  checkpoint: number;
  lap: number;
  finished: boolean;
  finishTimeMs: number;
}

export interface RaceManagerOptions {
  checkpointRadius: number;
  corridorWidth: number;
}

function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function distToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const lenSq = abx * abx + abz * abz;
  let t = lenSq > 0 ? ((px - ax) * abx + (pz - az) * abz) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + abx * t);
  const dz = pz - (az + abz * t);
  return Math.hypot(dx, dz);
}

export class RaceManager {
  readonly checkpoints: THREE.Vector3[];
  racers: RacerState[] = [];
  phase: RacePhase = 'idle';
  countdown: number = RACE_CONFIG.COUNTDOWN_SECONDS;
  elapsedMs = 0;
  playerIndex = 0;
  difficulty: Difficulty = 'normal';
  bestLapMs = Infinity;
  totalLaps: number = RACE_CONFIG.TOTAL_LAPS;

  private lapStartMs = 0;
  private countdownElapsed = 0;
  private lastCountdownValue = RACE_CONFIG.COUNTDOWN_SECONDS + 1;
  private positionEmitTimer = 0;
  private raceStartMs = 0;
  private readonly checkpointRadius: number;
  private readonly corridorWidth: number;

  constructor(checkpoints: THREE.Vector3[], options?: Partial<RaceManagerOptions>) {
    this.checkpoints = checkpoints;
    this.checkpointRadius =
      options?.checkpointRadius ?? RACE_CONFIG.CHECKPOINT_RADIUS;
    this.corridorWidth =
      options?.corridorWidth ?? RACE_CONFIG.CORRIDOR_WIDTH;
  }

  init(
    player: PlayerVehicle,
    aiVehicles: PlayerVehicle[],
    difficulty: Difficulty,
    totalLaps: number,
    startPositions: THREE.Vector3[],
    startHeading: number,
  ): void {
    this.difficulty = difficulty;
    this.totalLaps = Math.max(
      RACE_CONFIG.MIN_LAPS,
      Math.min(RACE_CONFIG.MAX_LAPS, Math.round(totalLaps)),
    );
    this.phase = 'idle';
    this.countdown = RACE_CONFIG.COUNTDOWN_SECONDS;
    this.elapsedMs = 0;
    this.bestLapMs = Infinity;
    this.countdownElapsed = 0;
    this.lastCountdownValue = RACE_CONFIG.COUNTDOWN_SECONDS + 1;
    this.positionEmitTimer = 0;
    this.racers = [];
    this.playerIndex = 0;
    const all = [player, ...aiVehicles];
    for (let i = 0; i < all.length; i += 1) {
      const vehicle = all[i];
      vehicle.reset(startPositions[i].x, startPositions[i].z, startHeading);
      this.racers.push({
        vehicle,
        checkpoint: 0,
        lap: 0,
        finished: false,
        finishTimeMs: 0,
      });
    }
  }

  startCountdown(): void {
    this.phase = 'countdown';
    this.countdownElapsed = 0;
    this.lastCountdownValue = RACE_CONFIG.COUNTDOWN_SECONDS + 1;
  }

  update(dt: number, nowMs: number): void {
    this.elapsedMs += dt * 1000;
    if (this.phase === 'countdown') {
      this.countdownElapsed += dt;
      this.countdown = Math.max(
        0,
        RACE_CONFIG.COUNTDOWN_SECONDS - this.countdownElapsed,
      );
      const whole = Math.ceil(this.countdown);
      if (whole !== this.lastCountdownValue && whole > 0) {
        this.lastCountdownValue = whole;
        eventBus.emit(Events.RACE_COUNTDOWN, { value: whole });
      }
      if (this.countdownElapsed >= RACE_CONFIG.COUNTDOWN_SECONDS + 0.8) {
        this.phase = 'racing';
        this.lapStartMs = nowMs;
        this.raceStartMs = nowMs;
        eventBus.emit(Events.RACE_COUNTDOWN, { value: 0 });
        this.emitPositions();
      }
    } else if (this.phase === 'racing') {
      this.updateAi(dt);
      for (let i = 0; i < this.racers.length; i += 1) {
        this.updateProgress(this.racers[i], nowMs);
      }
      this.positionEmitTimer += dt;
      if (this.positionEmitTimer >= 0.25) {
        this.positionEmitTimer = 0;
        this.emitPositions();
      }
    }
  }

  getPlayerPosition(): number {
    const ranks = this.computeRanks();
    return ranks[this.playerIndex];
  }

  getProgress(racer: RacerState): number {
    const W = this.checkpoints.length;
    if (racer.finished) return racer.lap * W + W;
    const a = this.checkpoints[racer.checkpoint];
    const b = this.checkpoints[(racer.checkpoint + 1) % W];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const lenSq = abx * abx + abz * abz;
    let t = lenSq > 0 ? ((racer.vehicle.x - a.x) * abx + (racer.vehicle.z - a.z) * abz) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    return racer.lap * W + racer.checkpoint + t;
  }

  debugFinish(): void {
    if (this.phase !== 'racing' && this.phase !== 'countdown') return;
    const player = this.racers[this.playerIndex];
    player.lap = this.totalLaps;
    player.checkpoint = this.checkpoints.length - 1;
    player.finished = true;
    player.finishTimeMs = this.elapsedMs;
    this.phase = 'finished';
    for (let i = 0; i < this.racers.length; i += 1) {
      const racer = this.racers[i];
      if (!racer.finished) {
        racer.finished = true;
        racer.finishTimeMs = this.elapsedMs + 1500 + i * 420;
      }
    }
    this.emitFinish();
  }

  private updateAi(dt: number): void {
    const config = RACE_CONFIG.DIFFICULTIES[this.difficulty];
    const playerProgress = this.getProgress(this.racers[this.playerIndex]);
    for (let i = 1; i < this.racers.length; i += 1) {
      const racer = this.racers[i];
      if (racer.finished) continue;
      const vehicle = racer.vehicle;
      const wp = this.checkpoints[(racer.checkpoint + 1) % this.checkpoints.length];
      const dx = wp.x - vehicle.x;
      const dz = wp.z - vehicle.z;
      const dist = Math.hypot(dx, dz);
      const targetHeading = Math.atan2(dx, dz);
      const angleDiff = normalizeAngle(targetHeading - vehicle.heading);
      const steer = Math.max(-1, Math.min(1, angleDiff * 2.1));

      const progress = this.getProgress(racer);
      let rubber = 1;
      if (playerProgress - progress > 1.2) rubber = config.rubberband;
      else if (progress - playerProgress > 1.2) rubber = 1 / config.rubberband;

      const nearCorner = dist < 55 ? config.cornerScale : 1;
      const speedLimit = vehicle.spec.topSpeedMs * config.speedScale * nearCorner * rubber;
      const sharp = Math.abs(angleDiff) > 0.95;
      const throttle = !sharp && vehicle.speed < speedLimit * 0.98 ? 1 : 0;
      const brake = sharp || vehicle.speed > speedLimit * 1.04 ? 1 : 0;
      vehicle.update(dt, { throttle, brake, steer, handbrake: false });
    }
  }

  private updateProgress(racer: RacerState, nowMs: number): void {
    if (racer.finished) return;
    const W = this.checkpoints.length;
    const next = this.checkpoints[(racer.checkpoint + 1) % W];
    const a = this.checkpoints[racer.checkpoint];
    const b = this.checkpoints[(racer.checkpoint + 1) % W];
    const dx = next.x - racer.vehicle.x;
    const dz = next.z - racer.vehicle.z;
    const distToCheckpoint = Math.hypot(dx, dz);
    const corridor = distToSegment(
      racer.vehicle.x,
      racer.vehicle.z,
      a.x,
      a.z,
      b.x,
      b.z,
    );
    if (
      distToCheckpoint < this.checkpointRadius &&
      corridor < this.corridorWidth
    ) {
      racer.checkpoint = (racer.checkpoint + 1) % W;
      if (racer.checkpoint === 0) {
        racer.lap += 1;
        const lapMs = nowMs - this.lapStartMs;
        this.lapStartMs = nowMs;
        if (racer === this.racers[this.playerIndex] && lapMs < this.bestLapMs) {
          this.bestLapMs = lapMs;
        }
        if (racer === this.racers[this.playerIndex]) {
          eventBus.emit(Events.RACE_LAP, {
            lap: racer.lap,
            lapMs,
            bestLapMs: this.bestLapMs,
          });
        }
        if (racer.lap >= this.totalLaps) {
          racer.finished = true;
          racer.finishTimeMs = nowMs - this.raceStartMs;
          if (racer === this.racers[this.playerIndex]) {
            this.phase = 'finished';
            this.emitFinish();
          }
        }
      }
    }
  }

  private emitPositions(): void {
    const ranks = this.computeRanks();
    const position = ranks[this.playerIndex];
    eventBus.emit(Events.RACE_POSITION, {
      position,
      totalRacers: this.racers.length,
    });
  }

  private computeRanks(): number[] {
    const order = this.racers
      .map((racer, index) => ({ index, progress: this.getProgress(racer), time: racer.finishTimeMs }))
      .sort((a, b) => {
        const diff = b.progress - a.progress;
        if (Math.abs(diff) > 0.0001) return diff;
        return a.time - b.time;
      });
    const ranks = new Array<number>(this.racers.length);
    for (let i = 0; i < order.length; i += 1) {
      ranks[order[i].index] = i + 1;
    }
    return ranks;
  }

  private emitFinish(): void {
    const ranks = this.computeRanks();
    const position = ranks[this.playerIndex];
    const totalMs = this.elapsedMs;
    eventBus.emit(Events.RACE_FINISHED, {
      position,
      totalRacers: this.racers.length,
      bestLapMs: Number.isFinite(this.bestLapMs) ? this.bestLapMs : 0,
      totalMs,
      difficulty: this.difficulty,
    });
  }
}
