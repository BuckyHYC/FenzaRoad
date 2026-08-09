import * as THREE from 'three';
import { DENSITY_CONFIG, PEDESTRIAN_CONFIG } from '../core/Constants';
import { gameState } from '../core/GameState';
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
  const model = new THREE.Group();
  model.scale.setScalar(PEDESTRIAN_CONFIG.MODEL_SCALE);

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

  const upperArmGeo = geometry(
    'ped-arm',
    () => new THREE.BoxGeometry(0.11, 0.46, 0.13),
  );
  const armMat = material(
    `ped-shirt:${shirtColor}`,
    () => new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.85 }),
  );
  const shoulderPivot = new THREE.Group();
  shoulderPivot.position.y = 1.18;
  const leftArm = new THREE.Mesh(upperArmGeo, armMat);
  leftArm.position.set(-0.26, -0.22, 0);
  leftArm.castShadow = true;
  const rightArm = new THREE.Mesh(upperArmGeo, armMat);
  rightArm.position.set(0.26, -0.22, 0);
  rightArm.castShadow = true;
  shoulderPivot.add(leftArm, rightArm);

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
  head.position.y = 0.28;
  head.castShadow = true;
  const headGroup = new THREE.Group();
  headGroup.position.y = 1.2;
  headGroup.add(head);

  model.add(body, leftLeg, rightLeg, shoulderPivot, headGroup);
  group.add(model);
  group.userData.leftLeg = leftLeg;
  group.userData.rightLeg = rightLeg;
  group.userData.shoulderPivot = shoulderPivot;
  group.userData.headGroup = headGroup;
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
    const density = DENSITY_CONFIG[gameState.settings.density];
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = density.pedestrianSpawnInterval;
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
      group.userData.leftLeg.rotation.x = 0;
      group.userData.rightLeg.rotation.x = 0;
      group.userData.shoulderPivot.rotation.x = 0;
      group.userData.headGroup.rotation.z = 0;
    } else {
      const swing = ped.moving ? Math.sin(ped.phase) : 0;
      group.userData.leftLeg.rotation.x = swing * 0.55;
      group.userData.rightLeg.rotation.x = -swing * 0.55;
      group.userData.shoulderPivot.rotation.x = -swing * 0.28;
      group.userData.headGroup.rotation.z = Math.sin(ped.phase * 0.5) * 0.06;
      group.position.set(ped.x, 0, ped.z);
      group.rotation.set(
        ped.moving ? Math.abs(Math.cos(ped.phase)) * 0.018 : 0,
        ped.heading,
        ped.moving ? Math.sin(ped.phase) * 0.03 : 0,
      );
      group.scale.setScalar(1);
    }
  }

  private trySpawn(playerX: number, playerZ: number): void {
    const density = DENSITY_CONFIG[gameState.settings.density];
    if (this.pedestrians.length >= density.pedestrianMax) return;
    let nearby = 0;
    for (const ped of this.pedestrians) {
      const dx = ped.x - playerX;
      const dz = ped.z - playerZ;
      if (
        dx * dx + dz * dz <
        PEDESTRIAN_CONFIG.NEARBY_RADIUS ** 2
      ) {
        nearby += 1;
      }
    }
    if (nearby >= density.pedestrianNearby) return;

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
