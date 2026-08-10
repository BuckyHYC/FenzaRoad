import * as THREE from 'three';
import { RACE_CONFIG } from '../core/Constants';
import { eventBus, Events } from '../core/EventBus';
import type { Aabb, CircleCollider, Difficulty, RacePhase } from '../core/types';
import type { PlayerVehicle } from './PlayerVehicle';
import {
  buildAabbGrid,
  buildCircleGrid,
  queryAabbGrid,
  queryCircleGrid,
  type AabbGrid,
  type CircleGrid,
} from './SpatialGrid';

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
  routePoints?: { x: number; z: number }[];
  avoidBoxes?: Aabb[];
  avoidCircles?: CircleCollider[];
}

function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function rayHitAabb(
  x: number,
  z: number,
  fx: number,
  fz: number,
  box: Aabb,
  radius: number,
): number | null {
  const minX = box.minX - radius;
  const maxX = box.maxX + radius;
  const minZ = box.minZ - radius;
  const maxZ = box.maxZ + radius;
  let tMin = 0;
  let tMax = Infinity;
  if (Math.abs(fx) < 1e-6) {
    if (x < minX || x > maxX) return null;
  } else {
    let t1 = (minX - x) / fx;
    let t2 = (maxX - x) / fx;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  if (Math.abs(fz) < 1e-6) {
    if (z < minZ || z > maxZ) return null;
  } else {
    let t1 = (minZ - z) / fz;
    let t2 = (maxZ - z) / fz;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin > 0.5 ? tMin : null;
}

function rayHitCircle(
  x: number,
  z: number,
  fx: number,
  fz: number,
  circle: CircleCollider,
  radius: number,
): { hit: number; lateral: number } | null {
  const ocx = circle.x - x;
  const ocz = circle.z - z;
  const proj = ocx * fx + ocz * fz;
  const perp2 = ocx * ocx + ocz * ocz - proj * proj;
  const rr = (circle.radius + radius) * (circle.radius + radius);
  if (perp2 > rr) return null;
  const dt = Math.sqrt(rr - perp2);
  const hit = proj - dt;
  if (hit < 0.5 || hit > 60) return null;
  const lateral = ocx * fz - ocz * fx;
  return { hit, lateral };
}

export class RaceManager {
  readonly checkpoints: THREE.Vector3[];
  readonly routePoints: { x: number; z: number }[];
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
  private readonly avoidBoxGrid: AabbGrid | null;
  private readonly avoidCircleGrid: CircleGrid | null;
  private readonly routeCumulative: number[] = [];
  private readonly checkpointParams: number[] = [];
  private readonly routeTotal: number;

  constructor(checkpoints: THREE.Vector3[], options?: Partial<RaceManagerOptions>) {
    this.checkpoints = checkpoints;
    this.checkpointRadius =
      options?.checkpointRadius ?? RACE_CONFIG.CHECKPOINT_RADIUS;
    this.corridorWidth =
      options?.corridorWidth ?? RACE_CONFIG.CORRIDOR_WIDTH;
    this.routePoints =
      options?.routePoints ??
      checkpoints.map((point) => ({ x: point.x, z: point.z }));
    this.avoidBoxGrid = options?.avoidBoxes?.length
      ? buildAabbGrid(options.avoidBoxes, 40)
      : null;
    this.avoidCircleGrid = options?.avoidCircles?.length
      ? buildCircleGrid(options.avoidCircles, 32)
      : null;
    this.routeTotal = this.buildRouteParams();
  }

  private buildRouteParams(): number {
    const points = this.routePoints;
    if (points.length < 2) return 0;
    const cumulative: number[] = [0];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      cumulative.push(
        cumulative[i] + Math.hypot(b.x - a.x, b.z - a.z),
      );
    }
    const total = cumulative[cumulative.length - 1];
    const checkpointParams = this.checkpoints.map((checkpoint) => {
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const len = cumulative[i + 1] - cumulative[i];
        const abx = b.x - a.x;
        const abz = b.z - a.z;
        const t =
          len > 0
            ? Math.max(
                0,
                Math.min(
                  1,
                  ((checkpoint.x - a.x) * abx + (checkpoint.z - a.z) * abz) /
                    (len * len),
                ),
              )
            : 0;
        const dx = checkpoint.x - (a.x + abx * t);
        const dz = checkpoint.z - (a.z + abz * t);
        const dist = Math.hypot(dx, dz);
        if (dist < bestDist) {
          bestDist = dist;
          best = cumulative[i] + len * t;
        }
      }
      return best;
    });
    this.routeCumulative.push(...cumulative);
    this.checkpointParams.push(...checkpointParams);
    return total;
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
    const fraction =
      this.routeTotal > 0
        ? Math.max(
            0,
            Math.min(1, this.closestRouteParam(racer.vehicle.x, racer.vehicle.z) / this.routeTotal),
          )
        : 0;
    return racer.lap * W + fraction * W;
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
      const W = this.checkpoints.length;
      const nextIndex = (racer.checkpoint + 1) % W;
      const currentParam = this.closestRouteParam(vehicle.x, vehicle.z);
      let delta = this.checkpointParams[nextIndex] - currentParam;
      if (delta < 0) delta += this.routeTotal;
      const lookahead = Math.max(35, Math.min(75, vehicle.speed * 1.8));
      const targetParam = currentParam + Math.min(delta, lookahead);
      const wp =
        this.routeTotal > 0
          ? this.routePointAtParam(targetParam)
          : this.checkpoints[nextIndex];
      const dx = wp.x - vehicle.x;
      const dz = wp.z - vehicle.z;
      const dist = Math.hypot(dx, dz);
      const targetHeading = Math.atan2(dx, dz);
      const angleDiff = normalizeAngle(targetHeading - vehicle.heading);
      const avoidance = this.computeAvoidance(vehicle);
      const steer = Math.max(
        -1,
        Math.min(1, angleDiff * 2.1 + avoidance.steer),
      );

      const progress = this.getProgress(racer);
      let rubber = 1;
      if (playerProgress - progress > 1.2) rubber = config.rubberband;
      else if (progress - playerProgress > 1.2) rubber = 1 / config.rubberband;

      const nearCorner = dist < 55 ? config.cornerScale : 1;
      const speedLimit = vehicle.spec.topSpeedMs * config.speedScale * nearCorner * rubber;
      const sharp = Math.abs(angleDiff) > 0.95;
      const throttle = !sharp && vehicle.speed < speedLimit * 0.98 ? 1 : 0;
      const braking =
        sharp || avoidance.brake > 0 || vehicle.speed > speedLimit * 1.04;
      const brake = braking
        ? Math.max(sharp || vehicle.speed > speedLimit * 1.04 ? 1 : 0, avoidance.brake)
        : 0;
      vehicle.update(dt, { throttle, brake, steer, handbrake: false });
    }
  }

  private computeAvoidance(
    vehicle: PlayerVehicle,
  ): { steer: number; brake: number } {
    const fx = Math.sin(vehicle.heading);
    const fz = Math.cos(vehicle.heading);
    const rx = fz;
    const rz = -fx;
    const lookAhead = 46;
    const lateralRange = 7.5;
    const vehicleRadius = vehicle.spec.width / 2 + 0.65;
    let steer = 0;
    let brake = 0;
    if (this.avoidBoxGrid) {
      for (const box of queryAabbGrid(
        this.avoidBoxGrid,
        vehicle.x,
        vehicle.z,
        lookAhead + 8,
      )) {
        const hit = rayHitAabb(
          vehicle.x,
          vehicle.z,
          fx,
          fz,
          box,
          vehicleRadius,
        );
        if (hit === null || hit > lookAhead) continue;
        const closestX = Math.max(box.minX, Math.min(vehicle.x, box.maxX));
        const closestZ = Math.max(box.minZ, Math.min(vehicle.z, box.maxZ));
        const lateral =
          (closestX - vehicle.x) * rx + (closestZ - vehicle.z) * rz;
        if (Math.abs(lateral) > lateralRange) continue;
        const weight =
          (1 - hit / lookAhead) * (1 - Math.abs(lateral) / lateralRange);
        steer += -Math.sign(lateral || 1) * weight * 1.25;
        if (hit < 16 && Math.abs(lateral) < 5.5) {
          brake = Math.max(brake, weight);
        }
      }
    }
    if (this.avoidCircleGrid) {
      for (const circle of queryCircleGrid(
        this.avoidCircleGrid,
        vehicle.x,
        vehicle.z,
        lookAhead + 10,
      )) {
        const hitInfo = rayHitCircle(
          vehicle.x,
          vehicle.z,
          fx,
          fz,
          circle,
          vehicleRadius,
        );
        if (!hitInfo || hitInfo.hit > lookAhead) continue;
        const lateralRangeForCircle = lateralRange + circle.radius;
        if (Math.abs(hitInfo.lateral) > lateralRangeForCircle) continue;
        const weight =
          (1 - hitInfo.hit / lookAhead) *
          (1 - Math.abs(hitInfo.lateral) / lateralRangeForCircle);
        steer += -Math.sign(hitInfo.lateral || 1) * weight * 1.35;
        if (hitInfo.hit < 18 && Math.abs(hitInfo.lateral) < circle.radius + 5.5) {
          brake = Math.max(brake, weight);
        }
      }
    }
    return {
      steer: Math.max(-1, Math.min(1, steer)),
      brake: Math.max(0, Math.min(1, brake)),
    };
  }

  private closestRouteParam(px: number, pz: number): number {
    const points = this.routePoints;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const len = this.routeCumulative[i + 1] - this.routeCumulative[i];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const t =
        len > 0
          ? Math.max(
              0,
              Math.min(
                1,
                ((px - a.x) * abx + (pz - a.z) * abz) / (len * len),
              ),
            )
          : 0;
      const dx = px - (a.x + abx * t);
      const dz = pz - (a.z + abz * t);
      const dist = Math.hypot(dx, dz);
      if (dist < bestDist) {
        bestDist = dist;
        best = this.routeCumulative[i] + len * t;
      }
    }
    return best;
  }

  private routePointAtParam(param: number): { x: number; z: number } {
    const points = this.routePoints;
    const total = this.routeTotal;
    if (total <= 0 || points.length === 0) {
      return { x: points[0]?.x ?? 0, z: points[0]?.z ?? 0 };
    }
    const p = ((param % total) + total) % total;
    for (let i = 0; i < points.length; i += 1) {
      const start = this.routeCumulative[i];
      const end = this.routeCumulative[i + 1];
      if (p < start || p > end) continue;
      const len = end - start;
      const t = len > 0 ? (p - start) / len : 0;
      const a = points[i];
      const b = points[(i + 1) % points.length];
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    }
    return { x: points[0].x, z: points[0].z };
  }

  private distToRouteRange(
    px: number,
    pz: number,
    from: number,
    to: number,
  ): number {
    const points = this.routePoints;
    let min = Infinity;
    const overlaps = (start: number, end: number): [number, number] | null => {
      if (from <= to) {
        const lo = Math.max(start, from);
        const hi = Math.min(end, to);
        return lo <= hi ? [lo, hi] : null;
      }
      const tailLo = Math.max(start, from);
      if (tailLo <= end) return [tailLo, end];
      const headHi = Math.min(end, to);
      if (start <= headHi) return [start, headHi];
      return null;
    };
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const startParam = this.routeCumulative[i];
      const endParam = this.routeCumulative[i + 1];
      const overlap = overlaps(startParam, endParam);
      if (!overlap) continue;
      const len = endParam - startParam;
      if (len <= 0) continue;
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      let t = ((px - a.x) * abx + (pz - a.z) * abz) / (len * len);
      const localLo = (overlap[0] - startParam) / len;
      const localHi = (overlap[1] - startParam) / len;
      t = Math.max(localLo, Math.min(localHi, t));
      const dx = px - (a.x + abx * t);
      const dz = pz - (a.z + abz * t);
      min = Math.min(min, Math.hypot(dx, dz));
    }
    return min;
  }

  private updateProgress(racer: RacerState, nowMs: number): void {
    if (racer.finished) return;
    const W = this.checkpoints.length;
    const next = this.checkpoints[(racer.checkpoint + 1) % W];
    const dx = next.x - racer.vehicle.x;
    const dz = next.z - racer.vehicle.z;
    const distToCheckpoint = Math.hypot(dx, dz);
    const fromParam = this.checkpointParams[racer.checkpoint];
    const toParam = this.checkpointParams[(racer.checkpoint + 1) % W];
    const corridor = this.distToRouteRange(
      racer.vehicle.x,
      racer.vehicle.z,
      fromParam,
      toParam,
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
