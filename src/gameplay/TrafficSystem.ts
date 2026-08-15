import * as THREE from 'three';
import { DENSITY_CONFIG, TRAFFIC_CONFIG, VEHICLES } from '../core/Constants';
import { gameState } from '../core/GameState';
import type { City } from '../level/CityBuilder';
import { PlayerVehicle } from './PlayerVehicle';

/**
 * NPC 交通系统
 * - 路径：路口转向使用 Catmull-Rom 样条生成连续轨迹，并按曲率限制弯道速度
 * - 运动：速度线性逼近（限加速度/减速度），转向角度每帧限幅平滑过渡
 * - 碰撞：有限状态机 巡航 → 碰撞偏移 → 路径回归 → 巡航，
 *   撞击后按动量自然偏移，随后缓动回归车道，杜绝瞬移与硬拉回
 * - 生成/回收：出生渐入、远离渐出，消除突然出现/消失
 */

type NpcState = 'cruise' | 'offset' | 'return';

interface TurnPath {
  /** 样条采样折线 */
  pts: { x: number; z: number }[];
  /** 累计弧长 */
  cum: number[];
  /** 各采样点的曲率限速 */
  speed: number[];
  total: number;
}

interface Npc {
  vehicle: PlayerVehicle;
  edgeId: number;
  fromNode: number;
  toNode: number;
  laneOffset: number;
  /** 当前路段弧长进度（0..1） */
  t: number;
  speed: number;
  desiredSpeed: number;
  radius: number;
  state: NpcState;
  /** -1 = 直线巡航；0..1 = 路口样条转向进度 */
  turnProgress: number;
  turnPath: TurnPath | null;
  nextEdgeId: number;
  nextToNode: number;
  nextLaneOffset: number;
  /** 相对路径基点的偏移（碰撞/回归用） */
  offsetX: number;
  offsetZ: number;
  /** 碰撞后的偏移速度 */
  offVX: number;
  offVZ: number;
  offsetTimer: number;
  /** 回归后的短暂免打扰：期间被撞不打断巡航，避免被后方车流钉住反复偏移 */
  returnCooldown: number;
  /** 出生/消失淡入淡出 */
  fade: number;
  fading: boolean;
}

interface Outgoing {
  edgeId: number;
  toNode: number;
  axis: 'x' | 'z';
  dirX: number;
  dirZ: number;
}

const TURN_SAMPLES = 28;
const TURN_LATERAL_ACCEL = 6;
const MAX_TURN_RATE = 2.3;
const ACCEL = 5.5;
const BRAKE = 9;

function approach(current: number, target: number, maxUp: number, maxDown: number): number {
  if (current < target) return Math.min(current + maxUp, target);
  return Math.max(current - maxDown, target);
}

function smoothAngle(from: number, to: number, maxDelta: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (Math.abs(delta) <= maxDelta) return to;
  return from + Math.sign(delta) * maxDelta;
}

function catmullRomPoint(
  p0: { x: number; z: number },
  p1: { x: number; z: number },
  p2: { x: number; z: number },
  p3: { x: number; z: number },
  t: number,
): { x: number; z: number } {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1.x +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const z =
    0.5 *
    (2 * p1.z +
      (-p0.z + p2.z) * t +
      (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
      (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);
  return { x, z };
}

export class TrafficSystem {
  readonly npcs: Npc[] = [];
  private city: City;
  private readonly scene: THREE.Scene;
  private spawnTimer = 0;
  private active = false;

  constructor(city: City, scene: THREE.Scene) {
    this.city = city;
    this.scene = scene;
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.clear();
  }

  setCity(city: City): void {
    this.city = city;
    this.clear();
  }

  rebindCity(): void {
    for (let i = this.npcs.length - 1; i >= 0; i -= 1) {
      const npc = this.npcs[i];
      // 碰撞偏移/回归中的车保持原路径锚点（边数据本身未变），
      // 先让它们平滑回车道，回巡航后再重新锚定；避免被区块重建误删（瞬移/消失）
      if (npc.state !== 'cruise') continue;
      if (!this.rebindNpc(npc)) {
        this.scene.remove(npc.vehicle.visuals.group);
        this.npcs.splice(i, 1);
      }
    }
  }

  /**
   * 区块重建后把 NPC 重新锚定到最近的路径。
   * 不直接搬位置：新基点与当前位置的差写入偏移，由「路径回归」状态缓动归位，
   * 从根源消除重绑定导致的瞬移。
   */
  private rebindNpc(npc: Npc): boolean {
    const x = npc.vehicle.x;
    const z = npc.vehicle.z;
    let bestDist = Infinity;
    let best:
      | {
          edgeId: number;
          fromNode: number;
          toNode: number;
          t: number;
          laneOffset: number;
        }
      | null = null;
    for (const edge of this.city.edges) {
      const a = this.city.intersections[edge.from];
      const b = this.city.intersections[edge.to];
      const len = edge.length;
      const ux = (b.x - a.x) / len;
      const uz = (b.z - a.z) / len;
      const t = Math.max(
        0,
        Math.min(1, ((x - a.x) * ux + (z - a.z) * uz) / len),
      );
      const px = a.x + ux * t * len;
      const pz = a.z + uz * t * len;
      const lateral = -(x - px) * uz + (z - pz) * ux;
      const dist = Math.hypot(x - px, z - pz);
      if (dist < bestDist && Math.abs(lateral) <= 8) {
        bestDist = dist;
        best = {
          edgeId: edge.id,
          fromNode: edge.from,
          toNode: edge.to,
          t,
          laneOffset: lateral,
        };
      }
    }
    if (!best || bestDist > 20) return false;
    const lane =
      Math.abs(best.laneOffset) < 4
        ? Math.sign(best.laneOffset || 1) * 2.75
        : Math.sign(best.laneOffset) * 5.75;
    npc.edgeId = best.edgeId;
    npc.fromNode = best.fromNode;
    npc.toNode = best.toNode;
    npc.t = best.t;
    npc.laneOffset = lane;
    npc.turnProgress = -1;
    npc.turnPath = null;
    const base = this.pathBase(npc, best.t, lane);
    npc.offsetX = npc.vehicle.x - base.x;
    npc.offsetZ = npc.vehicle.z - base.z;
    npc.state = Math.hypot(npc.offsetX, npc.offsetZ) > 1.2 ? 'return' : 'cruise';
    return true;
  }

  clear(): void {
    for (const npc of this.npcs) {
      this.scene.remove(npc.vehicle.visuals.group);
    }
    this.npcs.length = 0;
  }

  getNpcs(): { x: number; z: number; radius: number; vehicle: PlayerVehicle }[] {
    return this.npcs.map((npc) => ({
      x: npc.vehicle.x,
      z: npc.vehicle.z,
      radius: npc.radius,
      vehicle: npc.vehicle,
    }));
  }

  syncVehicleSpeed(vehicle: PlayerVehicle): void {
    for (const npc of this.npcs) {
      if (npc.vehicle !== vehicle) continue;
      npc.speed = vehicle.speed;
      return;
    }
  }

  /**
   * 车辆受到撞击（玩家或其它 NPC）后进入「碰撞偏移」状态：
   * 记录当前速度矢量，接下来按阻尼滑行，之后平滑回归路径。
   * 连续碰撞只刷新速度、不刷新回归计时，避免被反复推挤时永远回不了车道。
   */
  onVehicleHit(vehicle: PlayerVehicle): void {
    for (const npc of this.npcs) {
      if (npc.vehicle !== vehicle) continue;
      const velocity = vehicle.getVelocity();
      // 正在路口转向时被打断：取消转向，冻结在路口前，从偏移状态恢复
      if (npc.turnProgress >= 0) {
        npc.turnProgress = -1;
        npc.turnPath = null;
        npc.t = Math.min(npc.t, 0.999);
      }
      // 回归中再次被轻碰：不打断回归（回归逻辑已含收敛），避免抖动
      if (npc.state === 'return') {
        npc.offVX = velocity.vx;
        npc.offVZ = velocity.vz;
        return;
      }
      // 刚回归巡航的免打扰期：被碰不进入偏移，避免与后方车流反复互顶
      if (npc.returnCooldown > 0) {
        return;
      }
      if (npc.state !== 'offset') {
        npc.offsetTimer = 0.8;
      }
      npc.state = 'offset';
      npc.offVX = velocity.vx;
      npc.offVZ = velocity.vz;
      npc.speed = Math.hypot(velocity.vx, velocity.vz);
      return;
    }
  }

  update(dt: number, timeSec: number, playerX: number, playerZ: number): void {
    if (!this.active) return;
    const density = DENSITY_CONFIG[gameState.settings.density];
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = density.trafficSpawnInterval;
      this.trySpawn(playerX, playerZ);
    }

    for (let i = this.npcs.length - 1; i >= 0; i -= 1) {
      const npc = this.npcs[i];
      this.updateNpc(npc, dt, timeSec);

      // 淡入 / 淡出
      if (npc.fading) {
        npc.fade -= dt / 0.4;
        if (npc.fade <= 0) {
          this.scene.remove(npc.vehicle.visuals.group);
          this.npcs.splice(i, 1);
          continue;
        }
      } else if (npc.fade < 1) {
        npc.fade = Math.min(1, npc.fade + dt / 0.45);
      }
      npc.vehicle.visuals.group.scale.setScalar(Math.max(0.01, npc.fade));

      if (!npc.fading) {
        const dx = npc.vehicle.x - playerX;
        const dz = npc.vehicle.z - playerZ;
        if (dx * dx + dz * dz > TRAFFIC_CONFIG.DESPAWN_DISTANCE ** 2) {
          npc.fading = true;
          npc.fade = 1;
        }
      }
    }
  }

  private updateNpc(npc: Npc, dt: number, timeSec: number): void {
    if (npc.edgeId < 0 || npc.edgeId >= this.city.edges.length) {
      // 边已失效（无尽流式重建）：尝试重新锚定到现存道路，失败则移除
      if (!this.rebindNpc(npc)) {
        this.scene.remove(npc.vehicle.visuals.group);
        const index = this.npcs.indexOf(npc);
        if (index >= 0) this.npcs.splice(index, 1);
      }
      return;
    }
    if (npc.state === 'offset') {
      this.updateOffset(npc, dt);
    } else if (npc.state === 'return') {
      this.updateReturn(npc, dt, timeSec);
    } else if (npc.turnProgress >= 0) {
      this.updateTurning(npc, dt);
    } else {
      this.updateCruise(npc, dt, timeSec);
    }
  }

  /** 当前路段在弧长进度 t 处、车道 laneOffset 的路径基点 */
  private pathBase(npc: Npc, t: number, laneOffset: number): { x: number; z: number } {
    const edge = this.city.edges[npc.edgeId];
    const a = this.city.intersections[npc.fromNode];
    const b = this.city.intersections[npc.toNode];
    const len = edge.length;
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    const rx = -uz;
    const rz = ux;
    return {
      x: a.x + ux * t * len + rx * laneOffset,
      z: a.z + uz * t * len + rz * laneOffset,
    };
  }

  private edgeHeading(npc: Npc): number {
    const edge = this.city.edges[npc.edgeId];
    const a = this.city.intersections[npc.fromNode];
    const b = this.city.intersections[npc.toNode];
    const len = edge.length;
    return Math.atan2((b.x - a.x) / len, (b.z - a.z) / len);
  }

  private updateCruise(npc: Npc, dt: number, timeSec: number): void {
    const edge = this.city.edges[npc.edgeId];
    const len = edge.length;
    const targetHeading = this.edgeHeading(npc);
    npc.returnCooldown = Math.max(0, npc.returnCooldown - dt);

    let targetSpeed = npc.desiredSpeed;
    const distToEnd = (1 - npc.t) * len;
    if (distToEnd < TRAFFIC_CONFIG.STOP_MARGIN) {
      const green = this.city.lightGreen(edge.axis, timeSec, npc.toNode);
      if (!green) targetSpeed = 0;
    }
    // 接近路口提前减速（为转弯曲率限速做准备）
    if (distToEnd < 32) {
      targetSpeed = Math.min(targetSpeed, 7.5);
    }

    // 同车道前车跟车
    for (const other of this.npcs) {
      if (
        other === npc ||
        other.edgeId !== npc.edgeId ||
        other.fromNode !== npc.fromNode ||
        other.toNode !== npc.toNode ||
        Math.abs(other.laneOffset - npc.laneOffset) > 0.4 ||
        other.t <= npc.t
      ) {
        continue;
      }
      const gap = (other.t - npc.t) * len;
      if (gap < TRAFFIC_CONFIG.FOLLOW_GAP) {
        targetSpeed = Math.min(targetSpeed, other.speed * 0.92);
      }
      if (gap < 5) targetSpeed = 0;
    }

    // 速度平滑逼近（无突变）
    npc.speed = approach(npc.speed, targetSpeed, ACCEL * dt, BRAKE * dt);

    npc.t += (npc.speed * dt) / len;
    if (npc.t >= 1) {
      this.advanceThroughIntersection(npc);
      if (npc.turnProgress >= 0) {
        this.syncTurnStart(npc);
        npc.vehicle.rollWheels(dt);
        return;
      }
    }

    // 偏移残余平滑衰减（从回归状态刚切回巡航时）
    const decay = Math.exp(-6 * dt);
    npc.offsetX *= decay;
    npc.offsetZ *= decay;
    if (Math.hypot(npc.offsetX, npc.offsetZ) < 0.12) {
      npc.offsetX = 0;
      npc.offsetZ = 0;
    }

    const t = Math.min(npc.t, 1);
    const base = this.pathBase(npc, t, npc.laneOffset);
    const px = base.x + npc.offsetX;
    const pz = base.z + npc.offsetZ;
    const heading = smoothAngle(npc.vehicle.heading, targetHeading, MAX_TURN_RATE * dt);
    npc.vehicle.setKinematic(px, pz, heading, npc.speed);
    npc.vehicle.rollWheels(dt);
  }

  /** 碰撞偏移：按动量滑行，阻尼减速，随后进入回归 */
  private updateOffset(npc: Npc, dt: number): void {
    const damp = Math.exp(-1.6 * dt);
    npc.offVX *= damp;
    npc.offVZ *= damp;
    npc.offsetX += npc.offVX * dt;
    npc.offsetZ += npc.offVZ * dt;
    npc.offsetTimer -= dt;

    const speed = Math.hypot(npc.offVX, npc.offVZ);
    npc.speed = speed;
    if (speed > 0.4) {
      const velocityHeading = Math.atan2(npc.offVX, npc.offVZ);
      npc.vehicle.heading = smoothAngle(
        npc.vehicle.heading,
        velocityHeading,
        2.6 * dt,
      );
    }

    const base = this.pathBase(npc, Math.min(npc.t, 0.999), npc.laneOffset);
    const px = base.x + npc.offsetX;
    const pz = base.z + npc.offsetZ;
    this.clampIntoBuildings(npc, px, pz, base);
    npc.vehicle.setKinematic(
      base.x + npc.offsetX,
      base.z + npc.offsetZ,
      npc.vehicle.heading,
      npc.speed,
    );
    npc.vehicle.rollWheels(dt);

    if (npc.offsetTimer <= 0 || (speed < 1.0 && npc.offsetTimer <= 0.45)) {
      npc.state = 'return';
    }
  }

  /** 路径回归：偏移与航向缓动归位，速度平滑恢复 */
  private updateReturn(npc: Npc, dt: number, timeSec: number): void {
    const edge = this.city.edges[npc.edgeId];
    const len = edge.length;
    const targetHeading = this.edgeHeading(npc);

    const ease = Math.exp(-2.8 * dt);
    npc.offsetX *= ease;
    npc.offsetZ *= ease;

    // 信号与跟车同样生效
    let targetSpeed = npc.desiredSpeed;
    const distToEnd = (1 - npc.t) * len;
    if (distToEnd < TRAFFIC_CONFIG.STOP_MARGIN) {
      const green = this.city.lightGreen(edge.axis, timeSec, npc.toNode);
      if (!green) targetSpeed = 0;
    }
    if (distToEnd < 32) targetSpeed = Math.min(targetSpeed, 7.5);
    npc.speed = approach(npc.speed, targetSpeed, ACCEL * 0.8 * dt, BRAKE * 0.8 * dt);

    npc.t = Math.min(0.999, npc.t + (npc.speed * dt) / len);

    const base = this.pathBase(npc, npc.t, npc.laneOffset);
    const px = base.x + npc.offsetX;
    const pz = base.z + npc.offsetZ;
    this.clampIntoBuildings(npc, px, pz, base);
    const heading = smoothAngle(npc.vehicle.heading, targetHeading, MAX_TURN_RATE * dt);
    npc.vehicle.setKinematic(base.x + npc.offsetX, base.z + npc.offsetZ, heading, npc.speed);
    npc.vehicle.rollWheels(dt);

    if (Math.hypot(npc.offsetX, npc.offsetZ) < 0.15) {
      npc.offsetX = 0;
      npc.offsetZ = 0;
      npc.state = 'cruise';
      npc.returnCooldown = 0.7;
    }
  }

  /** 偏移/回归期间防止穿入建筑 */
  private clampIntoBuildings(
    npc: Npc,
    px: number,
    pz: number,
    _base: { x: number; z: number },
  ): void {
    const radius = npc.radius;
    for (const box of this.city.buildingColliders) {
      const closestX = Math.max(box.minX, Math.min(px, box.maxX));
      const closestZ = Math.max(box.minZ, Math.min(pz, box.maxZ));
      const dx = px - closestX;
      const dz = pz - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq >= radius * radius || distSq < 1e-6) continue;
      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const nz = dz / dist;
      const push = radius - dist;
      npc.offsetX += nx * push;
      npc.offsetZ += nz * push;
      px += nx * push;
      pz += nz * push;
    }
  }

  /**
   * 路口转向：用 Catmull-Rom 样条把「当前车道末端 → 路口 → 下一车道起点」
   * 连成连续轨迹，并按曲率计算限速曲线，转弯时自然减速。
   */
  advanceThroughIntersection(npc: Npc): void {
    const candidates = this.outgoingCandidates(npc.toNode, npc.edgeId, npc.fromNode);
    if (candidates.length === 0) {
      npc.t = 0.999;
      npc.speed = 0;
      return;
    }
    const edge = this.city.edges[npc.edgeId];
    const a = this.city.intersections[npc.fromNode];
    const b = this.city.intersections[npc.toNode];
    const curX = (b.x - a.x) / edge.length;
    const curZ = (b.z - a.z) / edge.length;
    const straight = candidates.filter(
      (c) => c.dirX * curX + c.dirZ * curZ > 0.9,
    );
    const pool = straight.length > 0 && Math.random() < 0.55 ? straight : candidates;
    const next = pool[Math.floor(Math.random() * pool.length)];
    const nextEdge = this.city.edges[next.edgeId];
    const nextA = this.city.intersections[npc.toNode];
    const nextB = this.city.intersections[next.toNode];
    const nextLen = nextEdge.length;
    const nextLaneOffset = Math.random() < 0.5 ? 2.75 : 5.75;

    const rx = -curZ;
    const rz = curX;
    const entry = {
      x: b.x + rx * npc.laneOffset,
      z: b.z + rz * npc.laneOffset,
    };
    const corner = { x: b.x, z: b.z };
    const nrx = -(nextB.x - nextA.x) / nextLen;
    const nrz = (nextB.z - nextA.z) / nextLen;
    const exit = {
      x: nextA.x + nrx * nextLaneOffset,
      z: nextA.z + nrz * nextLaneOffset,
    };

    npc.turnPath = this.buildTurnPath(entry, corner, exit, npc.desiredSpeed);
    npc.turnProgress = 0;
    npc.nextEdgeId = next.edgeId;
    npc.nextToNode = next.toNode;
    npc.nextLaneOffset = nextLaneOffset;
    const entrySpeed = npc.turnPath.speed[0];
    npc.speed = Math.min(npc.speed, entrySpeed + 1);
    this.syncTurnStart(npc);
  }

  private buildTurnPath(
    entry: { x: number; z: number },
    corner: { x: number; z: number },
    exit: { x: number; z: number },
    desiredSpeed: number,
  ): TurnPath {
    const dIn = Math.hypot(entry.x - corner.x, entry.z - corner.z) || 1;
    const dOut = Math.hypot(exit.x - corner.x, exit.z - corner.z) || 1;
    const p0 = {
      x: entry.x + ((entry.x - corner.x) / dIn) * dIn,
      z: entry.z + ((entry.z - corner.z) / dIn) * dIn,
    };
    const p3 = {
      x: exit.x + ((exit.x - corner.x) / dOut) * dOut,
      z: exit.z + ((exit.z - corner.z) / dOut) * dOut,
    };
    const N = TURN_SAMPLES;
    const pts: { x: number; z: number }[] = [];
    for (let i = 0; i <= N; i += 1) {
      let t: number;
      let pts4: { x: number; z: number }[];
      if (i <= N / 2) {
        t = i / (N / 2);
        pts4 = [p0, entry, corner, exit];
      } else {
        t = (i - N / 2) / (N / 2);
        pts4 = [entry, corner, exit, p3];
      }
      pts.push(catmullRomPoint(pts4[0], pts4[1], pts4[2], pts4[3], t));
    }
    const cum: number[] = [0];
    for (let i = 1; i < pts.length; i += 1) {
      cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    }
    const total = cum[cum.length - 1] || 1;
    // 曲率 → 限速：v = sqrt(aLat / κ)
    const speed: number[] = [];
    const cap = desiredSpeed * 0.78;
    for (let i = 0; i < pts.length; i += 1) {
      const prev = pts[Math.max(0, i - 1)];
      const next = pts[Math.min(pts.length - 1, i + 1)];
      const h1 = Math.atan2(pts[i].x - prev.x, pts[i].z - prev.z);
      const h2 = Math.atan2(next.x - pts[i].x, next.z - pts[i].z);
      let d = h2 - h1;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const seg = Math.max(0.01, (cum[i] - (cum[i - 1] ?? 0)) + (cum[Math.min(pts.length - 1, i + 1)] - cum[i]));
      const kappa = Math.abs(d) / seg;
      const limit = Math.sqrt(TURN_LATERAL_ACCEL / Math.max(kappa, 0.02));
      speed.push(Math.max(3.2, Math.min(cap, limit)));
    }
    return { pts, cum, speed, total };
  }

  private syncTurnStart(npc: Npc): void {
    const base = this.pathBase(npc, 1, npc.laneOffset);
    npc.vehicle.setKinematic(base.x, base.z, this.edgeHeading(npc), npc.speed);
  }

  private updateTurning(npc: Npc, dt: number): void {
    const path = npc.turnPath;
    if (!path) {
      npc.turnProgress = -1;
      npc.state = 'cruise';
      return;
    }
    const index = Math.min(
      path.pts.length - 2,
      Math.max(0, Math.floor(npc.turnProgress * (path.pts.length - 1))),
    );
    const targetSpeed = path.speed[index];
    npc.speed = approach(npc.speed, targetSpeed, ACCEL * dt, BRAKE * dt);

    npc.turnProgress += (npc.speed * dt) / path.total;
    if (npc.turnProgress >= 1) {
      npc.edgeId = npc.nextEdgeId;
      npc.fromNode = npc.toNode;
      npc.toNode = npc.nextToNode;
      npc.laneOffset = npc.nextLaneOffset;
      npc.t = 0.02;
      npc.turnProgress = -1;
      npc.turnPath = null;
      npc.state = 'cruise';
      return;
    }

    const pos = this.sampleTurn(path, npc.turnProgress);
    const heading = this.turnTangent(path, npc.turnProgress);
    const smoothed = smoothAngle(npc.vehicle.heading, heading, MAX_TURN_RATE * dt);
    npc.vehicle.setKinematic(pos.x, pos.z, smoothed, npc.speed);
    npc.vehicle.rollWheels(dt);
  }

  private sampleTurn(path: TurnPath, t: number): { x: number; z: number } {
    const arc = t * path.total;
    let i = 0;
    while (i < path.cum.length - 2 && path.cum[i + 1] < arc) i += 1;
    const segLen = path.cum[i + 1] - path.cum[i];
    const f = segLen > 0 ? Math.max(0, Math.min(1, (arc - path.cum[i]) / segLen)) : 0;
    return {
      x: path.pts[i].x + (path.pts[i + 1].x - path.pts[i].x) * f,
      z: path.pts[i].z + (path.pts[i + 1].z - path.pts[i].z) * f,
    };
  }

  private turnTangent(path: TurnPath, t: number): number {
    const arc = t * path.total;
    let i = 0;
    while (i < path.cum.length - 2 && path.cum[i + 1] < arc) i += 1;
    return Math.atan2(
      path.pts[i + 1].x - path.pts[i].x,
      path.pts[i + 1].z - path.pts[i].z,
    );
  }

  private outgoingCandidates(
    nodeIndex: number,
    excludeEdgeId: number,
    excludeToNode: number,
  ): Outgoing[] {
    const result: Outgoing[] = [];
    for (const edge of this.city.edges) {
      let to: number | null = null;
      if (edge.from === nodeIndex) to = edge.to;
      else if (edge.to === nodeIndex) to = edge.from;
      if (to === null) continue;
      if (edge.id === excludeEdgeId && to === excludeToNode) continue;
      const a = this.city.intersections[nodeIndex];
      const b = this.city.intersections[to];
      const len = edge.length;
      result.push({
        edgeId: edge.id,
        toNode: to,
        axis: edge.axis,
        dirX: (b.x - a.x) / len,
        dirZ: (b.z - a.z) / len,
      });
    }
    return result;
  }

  private trySpawn(playerX: number, playerZ: number): void {
    if (this.npcs.length >= DENSITY_CONFIG[gameState.settings.density].trafficMax) return;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const edge = this.city.edges[Math.floor(Math.random() * this.city.edges.length)];
      const reverse = Math.random() < 0.5;
      const fromNode = reverse ? edge.to : edge.from;
      const toNode = reverse ? edge.from : edge.to;
      const laneOffset = (Math.random() < 0.5 ? 2.75 : 5.75) * (reverse ? -1 : 1);
      const t = 0.08 + Math.random() * 0.38;
      const a = this.city.intersections[fromNode];
      const b = this.city.intersections[toNode];
      const len = edge.length;
      const ux = (b.x - a.x) / len;
      const uz = (b.z - a.z) / len;
      const rx = -uz;
      const rz = ux;
      const px = a.x + ux * t * len + rx * laneOffset;
      const pz = a.z + uz * t * len + rz * laneOffset;
      const dx = px - playerX;
      const dz = pz - playerZ;
      if (dx * dx + dz * dz < TRAFFIC_CONFIG.SPAWN_MIN_PLAYER_DISTANCE ** 2) continue;
      let tooClose = false;
      for (const other of this.npcs) {
        const ox = other.vehicle.x - px;
        const oz = other.vehicle.z - pz;
        if (ox * ox + oz * oz < 25 * 25) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      const spec = VEHICLES[Math.floor(Math.random() * VEHICLES.length)];
      const color = spec.colorOptions[Math.floor(Math.random() * spec.colorOptions.length)];
      const vehicle = new PlayerVehicle(spec, color, this.scene, false, false);
      const heading = Math.atan2(ux, uz);
      vehicle.setKinematic(px, pz, heading, 0);
      vehicle.visuals.group.scale.setScalar(0.01);
      this.npcs.push({
        vehicle,
        edgeId: edge.id,
        fromNode,
        toNode,
        laneOffset,
        t,
        speed: 0,
        desiredSpeed:
          TRAFFIC_CONFIG.BASE_SPEED +
          (Math.random() - 0.5) * TRAFFIC_CONFIG.SPEED_VARIATION,
        radius: spec.width / 2 + 0.15,
        state: 'cruise',
        turnProgress: -1,
        turnPath: null,
        nextEdgeId: 0,
        nextToNode: 0,
        nextLaneOffset: 0,
        offsetX: 0,
        offsetZ: 0,
        offVX: 0,
        offVZ: 0,
        offsetTimer: 0,
        returnCooldown: 0,
        fade: 0,
        fading: false,
      });
      return;
    }
  }
}
