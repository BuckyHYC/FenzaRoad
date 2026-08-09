import * as THREE from 'three';
import { PEDESTRIAN_CONFIG } from '../core/Constants';
import type { City } from '../level/CityBuilder';

export interface PedestrianCollider {
  x: number;
  z: number;
  radius: number;
  isPlayer: boolean;
}

interface Pedestrian {
  group: THREE.Group;
  edgeId: number;
  fromNode: number;
  toNode: number;
  side: number;
  jitter: number;
  t: number;
  direction: number;
  speed: number;
  state: 'walk' | 'down';
  fallProgress: number;
  downTimer: number;
  pauseTimer: number;
  moving: boolean;
  phase: number;
  x: number;
  z: number;
  heading: number;
  radius: number;
}

const SHIRT_COLORS = ['#e8503a', '#3a7bd5', '#e0a63a', '#4a9e5c', '#b3548f', '#f2f2f2'];
const PANTS_COLORS = ['#2c3e50', '#4a3b32', '#20242b'];

const materialCache = new Map<string, THREE.Material>();
const partGeometryCache = new Map<string, THREE.BufferGeometry>();

function material(key: string, create: () => THREE.Material): THREE.Material {
  let cached = materialCache.get(key);
  if (!cached) {
    cached = create();
    materialCache.set(key, cached);
  }
  return cached;
}

function geometry(key: string, create: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let cached = partGeometryCache.get(key);
  if (!cached) {
    cached = create();
    partGeometryCache.set(key, cached);
  }
  return cached;
}

function buildPedestrian(): THREE.Group {
  const shirtColor = SHIRT_COLORS[Math.floor(Math.random() * SHIRT_COLORS.length)];
  const pantsColor = PANTS_COLORS[Math.floor(Math.random() * PANTS_COLORS.length)];
  const group = new THREE.Group();

  const bodyGeo = geometry(
    'ped-body',
    () => new THREE.BoxGeometry(0.44, 0.6, 0.24),
  );
  const body = new THREE.Mesh(
    bodyGeo,
    material(
      `ped-shirt:${shirtColor}`,
      () => new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.85 }),
    ),
  );
  body.position.y = 0.85;
  body.castShadow = true;

  const legGeo = geometry(
    'ped-leg',
    () => new THREE.BoxGeometry(0.13, 0.55, 0.14),
  );
  const legMat = material(
    `ped-pants:${pantsColor}`,
    () => new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.9 }),
  );
  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.11, 0.275, 0);
  leftLeg.castShadow = true;
  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0.11, 0.275, 0);
  rightLeg.castShadow = true;

  const headGeo = geometry(
    'ped-head',
    () => new THREE.SphereGeometry(0.16, 10, 8),
  );
  const head = new THREE.Mesh(
    headGeo,
    material(
      'ped-skin',
      () => new THREE.MeshStandardMaterial({ color: 0xd9a878, roughness: 0.8 }),
    ),
  );
  head.position.y = 1.48;
  head.castShadow = true;

  group.add(body, leftLeg, rightLeg, head);
  return group;
}

export class PedestrianSystem {
  private readonly pedestrians: Pedestrian[] = [];
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
    for (const ped of this.pedestrians) {
      this.scene.remove(ped.group);
    }
    this.pedestrians.length = 0;
  }

  update(
    dt: number,
    playerX: number,
    playerZ: number,
    vehicles: PedestrianCollider[],
    onHit: (intensity: number, isPlayer: boolean) => void,
  ): void {
    if (!this.active) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = PEDESTRIAN_CONFIG.SPAWN_INTERVAL;
      this.trySpawn(playerX, playerZ);
    }

    for (let i = this.pedestrians.length - 1; i >= 0; i -= 1) {
      const ped = this.pedestrians[i];
      if (ped.state === 'down') {
        ped.fallProgress = Math.min(
          1,
          ped.fallProgress + dt / PEDESTRIAN_CONFIG.FALL_DURATION,
        );
        ped.downTimer -= dt;
        if (ped.downTimer <= 0) {
          this.scene.remove(ped.group);
          this.pedestrians.splice(i, 1);
          continue;
        }
      } else {
        this.movePedestrian(ped, dt);
        this.checkVehicleCollisions(ped, vehicles, onHit);
        const dx = ped.x - playerX;
        const dz = ped.z - playerZ;
        if (dx * dx + dz * dz > PEDESTRIAN_CONFIG.DESPAWN_DISTANCE ** 2) {
          this.scene.remove(ped.group);
          this.pedestrians.splice(i, 1);
          continue;
        }
      }
      this.syncVisual(ped);
    }
  }

  private movePedestrian(ped: Pedestrian, dt: number): void {
    ped.pauseTimer -= dt;
    if (ped.pauseTimer <= 0) {
      ped.moving = !ped.moving;
      ped.pauseTimer = 1.2 + Math.random() * 2.2;
    }
    if (!ped.moving) return;

    const edge = this.city.edges[ped.edgeId];
    const a = this.city.intersections[ped.fromNode];
    const b = this.city.intersections[ped.toNode];
    const len = edge.length;
    const ux = (b.x - a.x) / len;
    const uz = (b.z - a.z) / len;
    ped.t += (ped.direction * ped.speed * dt) / len;
    if (ped.t <= 0 || ped.t >= 1) {
      ped.t = Math.min(1, Math.max(0, ped.t));
      ped.direction *= -1;
    }

    const rx = -uz;
    const rz = ux;
    const t = Math.min(Math.max(ped.t, 0), 1);
    ped.x =
      a.x +
      ux * t * len +
      rx * (ped.side * PEDESTRIAN_CONFIG.SIDEWALK_OFFSET + ped.jitter);
    ped.z =
      a.z +
      uz * t * len +
      rz * (ped.side * PEDESTRIAN_CONFIG.SIDEWALK_OFFSET + ped.jitter);
    ped.heading = Math.atan2(ux * ped.direction, uz * ped.direction);
    ped.phase += dt * 8;
  }

  private checkVehicleCollisions(
    ped: Pedestrian,
    vehicles: PedestrianCollider[],
    onHit: (intensity: number, isPlayer: boolean) => void,
  ): void {
    for (const vehicle of vehicles) {
      const dx = ped.x - vehicle.x;
      const dz = ped.z - vehicle.z;
      const minDist = ped.radius + vehicle.radius;
      if (dx * dx + dz * dz >= minDist * minDist) continue;
      ped.state = 'down';
      ped.fallProgress = 0;
      ped.downTimer = PEDESTRIAN_CONFIG.DOWN_DURATION;
      ped.speed = 0;
      const intensity = Math.min(1, 0.35 + vehicle.radius * 0.22);
      onHit(intensity, vehicle.isPlayer);
      return;
    }
  }

  private syncVisual(ped: Pedestrian): void {
    const group = ped.group;
    if (ped.state === 'down') {
      const p = ped.fallProgress;
      const ease = p * p * (3 - 2 * p);
      group.position.set(ped.x, 0.08 - 0.04 * ease, ped.z);
      group.rotation.set(-Math.PI * 0.5 * ease, ped.heading + Math.PI, 0);
      group.scale.setScalar(Math.max(0.001, 1 - ease * 0.12));
    } else {
      group.position.set(ped.x, 0, ped.z);
      group.rotation.set(0, ped.heading, Math.sin(ped.phase) * 0.04);
      group.scale.setScalar(1);
    }
  }

  private trySpawn(playerX: number, playerZ: number): void {
    if (this.pedestrians.length >= PEDESTRIAN_CONFIG.MAX_COUNT) return;
    let nearby = 0;
    for (const ped of this.pedestrians) {
      const dx = ped.x - playerX;
      const dz = ped.z - playerZ;
      if (dx * dx + dz * dz < 180 * 180) nearby += 1;
    }
    if (nearby >= PEDESTRIAN_CONFIG.NEARBY_TARGET) return;

    for (let attempt = 0; attempt < 14; attempt += 1) {
      const edge = this.city.edges[Math.floor(Math.random() * this.city.edges.length)];
      const side = Math.random() < 0.5 ? 1 : -1;
      const t = Math.random();
      const jitter = (Math.random() - 0.5) * 1.4;
      const a = this.city.intersections[edge.from];
      const b = this.city.intersections[edge.to];
      const len = edge.length;
      const ux = (b.x - a.x) / len;
      const uz = (b.z - a.z) / len;
      const rx = -uz;
      const rz = ux;
      const px = a.x + ux * t * len + rx * (side * PEDESTRIAN_CONFIG.SIDEWALK_OFFSET + jitter);
      const pz = a.z + uz * t * len + rz * (side * PEDESTRIAN_CONFIG.SIDEWALK_OFFSET + jitter);
      const dx = px - playerX;
      const dz = pz - playerZ;
      const distSq = dx * dx + dz * dz;
      if (
        distSq < PEDESTRIAN_CONFIG.SPAWN_MIN_PLAYER_DISTANCE ** 2 ||
        distSq > PEDESTRIAN_CONFIG.SPAWN_MAX_PLAYER_DISTANCE ** 2
      ) {
        continue;
      }
      let tooClose = false;
      for (const other of this.pedestrians) {
        const ox = other.x - px;
        const oz = other.z - pz;
        if (ox * ox + oz * oz < 6 * 6) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      this.spawnPedestrian(edge.id, edge.from, edge.to, side, jitter, t, px, pz);
      return;
    }
  }

  private spawnPedestrian(
    edgeId: number,
    fromNode: number,
    toNode: number,
    side: number,
    jitter: number,
    t: number,
    x: number,
    z: number,
  ): void {
    const group = buildPedestrian();
    const direction = Math.random() < 0.5 ? 1 : -1;
    const heading = Math.atan2(
      direction * (this.city.intersections[toNode].x - this.city.intersections[fromNode].x),
      direction * (this.city.intersections[toNode].z - this.city.intersections[fromNode].z),
    );
    const ped: Pedestrian = {
      group,
      edgeId,
      fromNode,
      toNode,
      side,
      jitter,
      t,
      direction,
      speed:
        PEDESTRIAN_CONFIG.WALK_SPEED_MIN +
        Math.random() *
          (PEDESTRIAN_CONFIG.WALK_SPEED_MAX - PEDESTRIAN_CONFIG.WALK_SPEED_MIN),
      state: 'walk',
      fallProgress: 0,
      downTimer: 0,
      pauseTimer: Math.random() * 1.4,
      moving: true,
      phase: Math.random() * Math.PI * 2,
      x,
      z,
      heading,
      radius: PEDESTRIAN_CONFIG.RADIUS,
    };
    group.position.set(x, 0, z);
    group.rotation.y = heading;
    this.scene.add(group);
    this.pedestrians.push(ped);
  }
}
