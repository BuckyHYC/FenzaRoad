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
  private readonly city: City;
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
      npc.t = 0.9;
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
    npc.t -= 1;
    npc.edgeId = next.edgeId;
    npc.fromNode = npc.toNode;
    npc.toNode = next.toNode;
    npc.laneOffset = Math.random() < 0.5 ? 2.75 : 5.75;
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
      const vehicle = new PlayerVehicle(spec, color, this.scene);
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
      });
      return;
    }
  }
}
