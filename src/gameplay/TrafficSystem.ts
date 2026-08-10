import * as THREE from 'three';
import { DENSITY_CONFIG, TRAFFIC_CONFIG, VEHICLES } from '../core/Constants';
import { gameState } from '../core/GameState';
import type { City } from '../level/CityBuilder';
import { PlayerVehicle } from './PlayerVehicle';

interface Npc {
  vehicle: PlayerVehicle;
  edgeId: number;
  fromNode: number;
  toNode: number;
  laneOffset: number;
  t: number;
  speed: number;
  desiredSpeed: number;
  radius: number;
  turnProgress: number;
  turnDuration: number;
  turnStartX: number;
  turnStartZ: number;
  turnStartHeading: number;
  turnEndHeading: number;
  nextEdgeId: number;
  nextToNode: number;
  nextLaneOffset: number;
}

interface Outgoing {
  edgeId: number;
  toNode: number;
  axis: 'x' | 'z';
  dirX: number;
  dirZ: number;
}

export class TrafficSystem {
  private readonly npcs: Npc[] = [];
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
      if (!this.rebindNpc(this.npcs[i])) {
        this.scene.remove(this.npcs[i].vehicle.visuals.group);
        this.npcs.splice(i, 1);
      }
    }
  }

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
    if (!best || bestDist > 12) return false;
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
    npc.turnDuration = 0;
    npc.nextEdgeId = 0;
    npc.nextToNode = 0;
    npc.nextLaneOffset = 0;
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
      const dx = npc.vehicle.x - playerX;
      const dz = npc.vehicle.z - playerZ;
      if (dx * dx + dz * dz > TRAFFIC_CONFIG.DESPAWN_DISTANCE ** 2) {
        this.scene.remove(npc.vehicle.visuals.group);
        this.npcs.splice(i, 1);
      }
    }

    for (let i = 0; i < this.npcs.length; i += 1) {
      for (let j = i + 1; j < this.npcs.length; j += 1) {
        const a = this.npcs[i];
        const b = this.npcs[j];
        const dx = b.vehicle.x - a.vehicle.x;
        const dz = b.vehicle.z - a.vehicle.z;
        const minDist = a.radius + b.radius;
        const distSq = dx * dx + dz * dz;
        if (distSq > minDist * minDist || distSq < 0.0001) continue;
        const dist = Math.sqrt(distSq);
        const overlap = (minDist - dist) / 2;
        const nx = dx / dist;
        const nz = dz / dist;
        a.vehicle.x -= nx * overlap;
        a.vehicle.z -= nz * overlap;
        b.vehicle.x += nx * overlap;
        b.vehicle.z += nz * overlap;
        a.speed *= 0.94;
        b.speed *= 0.94;
      }
    }
  }

  private updateNpc(npc: Npc, dt: number, timeSec: number): void {
    if (npc.turnProgress >= 0) {
      this.updateTurning(npc, dt);
      npc.vehicle.rollWheels(dt);
      return;
    }
    const edge = this.city.edges[npc.edgeId];
    const a = this.city.intersections[npc.fromNode];
    const b = this.city.intersections[npc.toNode];
    const len = edge.length;
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    const rx = -uz;
    const rz = ux;

    let targetSpeed = npc.desiredSpeed;

    const distToEnd = (1 - npc.t) * len;
    if (distToEnd < TRAFFIC_CONFIG.STOP_MARGIN) {
      const green = this.city.lightGreen(edge.axis, timeSec, npc.toNode);
      if (!green) targetSpeed = 0;
    }

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
        targetSpeed = Math.min(targetSpeed, other.speed * 0.9);
      }
      if (gap < 4) targetSpeed = 0;
    }

    if (npc.speed < targetSpeed) {
      npc.speed = Math.min(npc.speed + 5.5 * dt, targetSpeed);
    } else {
      npc.speed = Math.max(npc.speed - 9 * dt, targetSpeed);
    }

    npc.t += (npc.speed * dt) / len;
    if (npc.t >= 1) {
      this.advanceThroughIntersection(npc);
      if (npc.turnProgress >= 0) {
        this.syncTurnStart(npc);
        npc.vehicle.rollWheels(dt);
        return;
      }
    }

    const t = Math.min(npc.t, 1);
    const px = a.x + ux * t * len + rx * npc.laneOffset;
    const pz = a.z + uz * t * len + rz * npc.laneOffset;
    const heading = Math.atan2(ux, uz);
    npc.vehicle.setKinematic(px, pz, heading, npc.speed);
    npc.vehicle.rollWheels(dt);
  }

  private advanceThroughIntersection(npc: Npc): void {
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
    npc.turnDuration = 0.5 + Math.random() * 0.35;
    npc.turnProgress = 0;
    npc.turnStartHeading = Math.atan2(curX, curZ);
    npc.turnEndHeading = Math.atan2(
      (nextB.x - nextA.x) / nextLen,
      (nextB.z - nextA.z) / nextLen,
    );
    npc.nextEdgeId = next.edgeId;
    npc.nextToNode = next.toNode;
    npc.nextLaneOffset = Math.random() < 0.5 ? 2.75 : 5.75;
    npc.speed = Math.max(4, Math.min(npc.speed, npc.desiredSpeed * 0.8));
    this.syncTurnStart(npc);
  }

  private syncTurnStart(npc: Npc): void {
    const edge = this.city.edges[npc.edgeId];
    const a = this.city.intersections[npc.fromNode];
    const b = this.city.intersections[npc.toNode];
    const len = edge.length;
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    const rx = -uz;
    const rz = ux;
    const px = b.x + rx * npc.laneOffset;
    const pz = b.z + rz * npc.laneOffset;
    npc.turnStartX = px;
    npc.turnStartZ = pz;
    npc.vehicle.setKinematic(px, pz, npc.turnStartHeading, npc.speed);
  }

  private updateTurning(npc: Npc, dt: number): void {
    npc.turnProgress = Math.min(1, npc.turnProgress + dt / npc.turnDuration);
    npc.speed = Math.max(4, npc.speed - 4.5 * dt);
    const edge = this.city.edges[npc.nextEdgeId];
    const a = this.city.intersections[npc.toNode];
    const b = this.city.intersections[npc.nextToNode];
    const len = edge.length;
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    const rx = -uz;
    const rz = ux;
    const endX = a.x + rx * npc.nextLaneOffset;
    const endZ = a.z + rz * npc.nextLaneOffset;
    const s = npc.turnProgress;
    const smooth = s * s * (3 - 2 * s);
    const ix = npc.turnStartX + (endX - npc.turnStartX) * smooth;
    const iz = npc.turnStartZ + (endZ - npc.turnStartZ) * smooth;
    const midX = (npc.turnStartX + endX) / 2 - a.x;
    const midZ = (npc.turnStartZ + endZ) / 2 - a.z;
    const bulge = 1 - Math.cos(s * Math.PI);
    const px = ix - midX * bulge * 0.4;
    const pz = iz - midZ * bulge * 0.4;
    const heading = this.lerpAngle(
      npc.turnStartHeading,
      npc.turnEndHeading,
      smooth,
    );
    npc.vehicle.setKinematic(px, pz, heading, npc.speed);
    if (npc.turnProgress >= 1) {
      npc.edgeId = npc.nextEdgeId;
      npc.fromNode = npc.toNode;
      npc.toNode = npc.nextToNode;
      npc.laneOffset = npc.nextLaneOffset;
      npc.t = 0.02;
      npc.turnProgress = -1;
    }
  }

  private lerpAngle(from: number, to: number, t: number): number {
    let delta = to - from;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return from + delta * t;
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
        turnProgress: -1,
        turnDuration: 0,
        turnStartX: 0,
        turnStartZ: 0,
        turnStartHeading: 0,
        turnEndHeading: 0,
        nextEdgeId: 0,
        nextToNode: 0,
        nextLaneOffset: 0,
      });
      return;
    }
  }
}
