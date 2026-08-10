import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { COLORS, RACE_CONFIG, TREE_COLLIDER_RADIUS, WORLD } from '../core/Constants';
import type {
  Aabb,
  CircleCollider,
  LaneInfo,
  QualityPreset,
  RaceLayout,
  RaceLayoutDefinition,
  RaceLayoutId,
} from '../core/types';
import { RACE_LAYOUT_DEFINITIONS } from '../race/layouts';

export interface CityIntersection {
  index: number;
  x: number;
  z: number;
}

export interface CityEdge {
  id: number;
  from: number;
  to: number;
  axis: 'x' | 'z';
  length: number;
}

export interface City {
  group: THREE.Group;
  chunks: THREE.Group[];
  intersections: CityIntersection[];
  edges: CityEdge[];
  lanes: LaneInfo[];
  buildingColliders: Aabb[];
  boundaryColliders: Aabb[];
  treeColliders: CircleCollider[];
  bounds: Aabb;
  raceBarriers: Aabb[];
  raceProps: THREE.Group;
  raceLayouts: RaceLayout[];
  activeRaceLayoutId: RaceLayoutId;
  revision: number;
  setRacePropsVisible(visible: boolean): void;
  setRaceLayout(layoutId: RaceLayoutId): RaceLayout;
  lightGreen(axis: 'x' | 'z', timeSec: number, nodeIndex: number): boolean;
  updateSignals(timeSec: number): void;
  updateWater(timeSec: number): void;
  updateChunks(px: number, pz: number): void;
  getTerrainHeight(x: number, z: number): number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function transformedBox(
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
  return geometry;
}

function overlapsAabb(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  other: Aabb,
  margin = 0,
): boolean {
  return (
    minX < other.maxX + margin &&
    maxX > other.minX - margin &&
    minZ < other.maxZ + margin &&
    maxZ > other.minZ - margin
  );
}

function hillHeightAt(
  hill: { x: number; z: number; radius: number; height: number },
  x: number,
  z: number,
): number {
  const dx = Math.abs(x - hill.x);
  const dz = Math.abs(z - hill.z);
  if (dx >= hill.radius || dz >= hill.radius) return 0;
  const t = 1 - Math.max(dx, dz) / hill.radius;
  return hill.height * t;
}

function raceCheckpointPositions(points: THREE.Vector3[]): THREE.Vector3[] {
  const n = points.length;
  if (n < 2) return points.map((p) => p.clone());
  const isCorner = (index: number): boolean => {
    const prev = points[(index - 1 + n) % n];
    const curr = points[index];
    const next = points[(index + 1) % n];
    const ax = curr.x - prev.x;
    const az = curr.z - prev.z;
    const bx = next.x - curr.x;
    const bz = next.z - curr.z;
    const cross = ax * bz - az * bx;
    const dot = ax * bx + az * bz;
    return Math.abs(cross) > 1e-3 || dot < -1e-3;
  };
  const cornerIndices: number[] = [];
  for (let i = 0; i < n; i += 1) {
    if (isCorner(i)) cornerIndices.push(i);
  }
  if (cornerIndices.length === 0) return points.map((p) => p.clone());
  const runs: { a: THREE.Vector3; b: THREE.Vector3; checkpoint: THREE.Vector3 }[] = [];
  for (let k = 0; k < cornerIndices.length; k += 1) {
    const start = cornerIndices[k];
    const end = cornerIndices[(k + 1) % cornerIndices.length];
    const a = points[start];
    const b = points[end];
    runs.push({
      a,
      b,
      checkpoint: new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2),
    });
  }
  const startPoint = points[0];
  const nextPoint = points[1 % n];
  const startDx = nextPoint.x - startPoint.x;
  const startDz = nextPoint.z - startPoint.z;
  const startLen = Math.hypot(startDx, startDz) || 1;
  const sux = startDx / startLen;
  const suz = startDz / startLen;
  const startMidX = (startPoint.x + nextPoint.x) / 2;
  const startMidZ = (startPoint.z + nextPoint.z) / 2;
  for (const run of runs) {
    const abx = run.b.x - run.a.x;
    const abz = run.b.z - run.a.z;
    const lenSq = abx * abx + abz * abz;
    const t0 =
      lenSq > 0
        ? ((startPoint.x - run.a.x) * abx + (startPoint.z - run.a.z) * abz) / lenSq
        : 0;
    if (t0 < -0.01 || t0 > 1.01) continue;
    const distToStart = Math.hypot(
      run.checkpoint.x - startMidX,
      run.checkpoint.z - startMidZ,
    );
    if (distToStart < 45) {
      run.checkpoint.x += sux * 45;
      run.checkpoint.z += suz * 45;
    }
  }
  return runs.map((run) => run.checkpoint);
}

function makeInstanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  count: number,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  return mesh;
}

export function buildCity(scene: THREE.Scene, options?: { quality?: QualityPreset }): City {
  const useReflector = options?.quality === 'high';
  const group = new THREE.Group();
  const N = WORLD.GRID_SIZE;
  const B = WORLD.BLOCK_LENGTH;
  const rand = mulberry32(WORLD.CITY_SEED);
  const MAP_SIZE = N * B;
  const CITY_MAX_X = WORLD.CITY_MAX_X;
  const VILLAGE_MAX_X = WORLD.VILLAGE_MAX_X;

  const intersections: CityIntersection[] = [];
  for (let j = 0; j <= N; j += 1) {
    for (let i = 0; i <= N; i += 1) {
      intersections.push({ index: j * (N + 1) + i, x: i * B, z: j * B });
    }
  }

  const edges: CityEdge[] = [];
  let edgeId = 0;
  for (let j = 0; j <= N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      edges.push({
        id: edgeId++,
        from: j * (N + 1) + i,
        to: j * (N + 1) + i + 1,
        axis: 'x',
        length: B,
      });
    }
  }
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i <= N; i += 1) {
      edges.push({
        id: edgeId++,
        from: j * (N + 1) + i,
        to: (j + 1) * (N + 1) + i,
        axis: 'z',
        length: B,
      });
    }
  }

  const laneOffsets = [2.75, 5.75];
  const lanes: LaneInfo[] = [];
  for (const edge of edges) {
    for (let laneIndex = 0; laneIndex < 2; laneIndex += 1) {
      lanes.push({
        edgeId: edge.id,
        fromNode: edge.from,
        toNode: edge.to,
        laneIndex,
        lateralOffset: laneOffsets[laneIndex],
      });
    }
    for (let laneIndex = 0; laneIndex < 2; laneIndex += 1) {
      lanes.push({
        edgeId: edge.id,
        fromNode: edge.to,
        toNode: edge.from,
        laneIndex: 2 + laneIndex,
        lateralOffset: -laneOffsets[laneIndex],
      });
    }
  }

  const roadParts: THREE.BufferGeometry[] = [];
  const sidewalkParts: THREE.BufferGeometry[] = [];
  const markingParts: THREE.BufferGeometry[] = [];
  for (const edge of edges) {
    const a = intersections[edge.from];
    const b = intersections[edge.to];
    const midX = (a.x + b.x) / 2;
    const midZ = (a.z + b.z) / 2;
    if (edge.axis === 'x') {
      roadParts.push(transformedBox(B, 0.14, WORLD.ROAD_WIDTH, midX, 0.06, midZ));
      if (midX <= CITY_MAX_X) {
        sidewalkParts.push(
          transformedBox(
            B + WORLD.SIDEWALK_WIDTH * 2,
            0.12,
            WORLD.ROAD_WIDTH + WORLD.SIDEWALK_WIDTH * 2,
            midX,
            0.03,
            midZ,
          ),
        );
      }
    } else {
      roadParts.push(transformedBox(WORLD.ROAD_WIDTH, 0.14, B, midX, 0.06, midZ));
      if (midX <= CITY_MAX_X) {
        sidewalkParts.push(
          transformedBox(
            WORLD.ROAD_WIDTH + WORLD.SIDEWALK_WIDTH * 2,
            0.12,
            B + WORLD.SIDEWALK_WIDTH * 2,
            midX,
            0.03,
            midZ,
          ),
        );
      }
    }
    const dashCount = Math.floor(B / 14);
    for (let d = 1; d < dashCount; d += 1) {
      const t = (d / dashCount) * B;
      const px = a.x + (b.x - a.x) * (t / B);
      const pz = a.z + (b.z - a.z) * (t / B);
      if (edge.axis === 'x') {
        markingParts.push(transformedBox(5, 0.05, 0.16, px, 0.15, pz));
      } else {
        markingParts.push(transformedBox(0.16, 0.05, 5, px, 0.15, pz));
      }
    }
  }

  const asphaltMaterial = new THREE.MeshStandardMaterial({
    color: COLORS.ROAD,
    roughness: 0.9,
  });
  const roadGeometry = mergeGeometries(roadParts);
  const sidewalkGeometry = mergeGeometries(sidewalkParts);
  const markingGeometry = mergeGeometries(markingParts);
  if (roadGeometry) {
    const road = new THREE.Mesh(
      roadGeometry,
      asphaltMaterial,
    );
    road.receiveShadow = true;
    group.add(road);
  }
  if (sidewalkGeometry) {
    const sidewalk = new THREE.Mesh(
      sidewalkGeometry,
      new THREE.MeshStandardMaterial({ color: COLORS.SIDEWALK, roughness: 0.85 }),
    );
    sidewalk.receiveShadow = true;
    group.add(sidewalk);
  }
  if (markingGeometry) {
    const marking = new THREE.Mesh(
      markingGeometry,
      new THREE.MeshBasicMaterial({ color: COLORS.MARKING }),
    );
    group.add(marking);
  }

  const groundCity = new THREE.Mesh(
    new THREE.PlaneGeometry(CITY_MAX_X + WORLD.BOUNDARY_OFFSET * 2, MAP_SIZE + WORLD.BOUNDARY_OFFSET * 2),
    new THREE.MeshStandardMaterial({ color: COLORS.GROUND, roughness: 1 }),
  );
  groundCity.rotation.x = -Math.PI / 2;
  groundCity.position.set((CITY_MAX_X - WORLD.BOUNDARY_OFFSET) / 2, -0.02, MAP_SIZE / 2);
  groundCity.receiveShadow = true;
  group.add(groundCity);
  const groundVillage = new THREE.Mesh(
    new THREE.PlaneGeometry(VILLAGE_MAX_X - CITY_MAX_X + WORLD.BOUNDARY_OFFSET * 2, MAP_SIZE + WORLD.BOUNDARY_OFFSET * 2),
    new THREE.MeshStandardMaterial({ color: 0x8b9558, roughness: 1 }),
  );
  groundVillage.rotation.x = -Math.PI / 2;
  groundVillage.position.set((CITY_MAX_X + VILLAGE_MAX_X) / 2, -0.02, MAP_SIZE / 2);
  groundVillage.receiveShadow = true;
  group.add(groundVillage);
  const groundHills = new THREE.Mesh(
    new THREE.PlaneGeometry(MAP_SIZE - VILLAGE_MAX_X + WORLD.BOUNDARY_OFFSET * 2, MAP_SIZE + WORLD.BOUNDARY_OFFSET * 2),
    new THREE.MeshStandardMaterial({ color: 0x77864f, roughness: 1 }),
  );
  groundHills.rotation.x = -Math.PI / 2;
  groundHills.position.set((VILLAGE_MAX_X + MAP_SIZE + WORLD.BOUNDARY_OFFSET) / 2, -0.02, MAP_SIZE / 2);
  groundHills.receiveShadow = true;
  group.add(groundHills);

  const dirtMaterial = new THREE.MeshStandardMaterial({
    color: 0x8a6b45,
    roughness: 1,
  });
  const waterMaterial = new THREE.MeshStandardMaterial({
    color: 0x2f7fa8,
    roughness: 0.25,
    metalness: 0.05,
    transparent: true,
    opacity: 0.92,
    emissive: 0x0b2c44,
    emissiveIntensity: 0.4,
  });
  const bankMaterial = new THREE.MeshStandardMaterial({
    color: 0x9a7a4f,
    roughness: 1,
  });
  const hillMaterial = new THREE.MeshStandardMaterial({
    color: 0x4f7d3d,
    roughness: 0.95,
  });
  const highwayMaterial = new THREE.MeshStandardMaterial({
    color: 0x565b62,
    roughness: 0.9,
  });
  const yellowMarkingMaterial = new THREE.MeshBasicMaterial({ color: 0xf2c94c });
  const villageWallMaterial = new THREE.MeshStandardMaterial({
    color: 0xd8c9a8,
    roughness: 0.92,
  });
  const villageRoofMaterial = new THREE.MeshStandardMaterial({
    color: 0x8a4a38,
    roughness: 0.85,
  });
  const villageWoodMaterial = new THREE.MeshStandardMaterial({
    color: 0x6b4a2f,
    roughness: 0.9,
  });

  const riverWidth = WORLD.RIVER_WIDTH;
  const riverLength = MAP_SIZE + WORLD.RIVER_LENGTH_PADDING;
  const riverCenterX = MAP_SIZE / 2;
  const riverBedWidth = riverWidth - 6;
  const waterBaseY = -0.14;
  const river = useReflector
    ? new Reflector(new THREE.PlaneGeometry(riverLength, riverBedWidth), {
        color: 0x2f7fa8,
        textureWidth: 512,
        textureHeight: 256,
        clipBias: 0.003,
      })
    : new THREE.Mesh(
        new THREE.PlaneGeometry(riverLength, riverBedWidth),
        waterMaterial,
      );
  river.rotation.x = -Math.PI / 2;
  river.position.set(riverCenterX, waterBaseY, WORLD.RIVER_Z);
  river.name = 'river';
  river.receiveShadow = true;
  group.add(river);

  const riverbed = new THREE.Mesh(
    new THREE.BoxGeometry(riverLength, 0.5, riverBedWidth),
    new THREE.MeshStandardMaterial({
      color: 0x6d5f47,
      roughness: 1,
    }),
  );
  riverbed.position.set(riverCenterX, -0.62, WORLD.RIVER_Z);
  riverbed.name = 'riverbed';
  riverbed.receiveShadow = true;
  group.add(riverbed);
  for (const side of [-1, 1]) {
    const slope = new THREE.Mesh(
      new THREE.BoxGeometry(riverLength, 0.09, 3.4),
      bankMaterial,
    );
    slope.position.set(
      riverCenterX,
      -0.19,
      WORLD.RIVER_Z + side * (riverBedWidth / 2 + 1.7),
    );
    slope.rotation.x = side * -0.11;
    slope.name = 'river-bank';
    slope.receiveShadow = true;
    group.add(slope);
    const bank = new THREE.Mesh(
      new THREE.BoxGeometry(riverLength, 0.08, 3.2),
      bankMaterial,
    );
    bank.position.set(riverCenterX, 0.045, WORLD.RIVER_Z + side * (riverWidth / 2 + 2));
    group.add(bank);
  }

  for (let i = 0; i <= N; i += 1) {
    const bridgeX = i * B;
    const bridge = new THREE.Mesh(
      new THREE.BoxGeometry(WORLD.ROAD_WIDTH, 0.22, 72),
      asphaltMaterial,
    );
    bridge.position.set(bridgeX, 0.16, WORLD.RIVER_Z);
    bridge.name = 'bridge';
    bridge.receiveShadow = true;
    group.add(bridge);
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 1.1, 72),
        highwayMaterial,
      );
      rail.position.set(
        bridgeX + side * (WORLD.ROAD_WIDTH / 2 + 1.1),
        0.75,
        WORLD.RIVER_Z,
      );
      group.add(rail);
    }
  }

  const villageGroup = new THREE.Group();
  villageGroup.name = 'village';
  const fieldMaterial = new THREE.MeshStandardMaterial({
    color: 0x7c8a45,
    roughness: 1,
  });
  const villageRoad = new THREE.Mesh(
    new THREE.BoxGeometry(8, 0.08, MAP_SIZE - 60),
    dirtMaterial,
  );
  villageRoad.position.set(560, 0.085, MAP_SIZE / 2);
  villageGroup.add(villageRoad);
  for (const laneZ of [225, 375, 525, 675]) {
    const lane = new THREE.Mesh(
      new THREE.BoxGeometry(150, 0.07, 6),
      dirtMaterial,
    );
    lane.position.set(555, 0.075, laneZ);
    villageGroup.add(lane);
  }
  const houseZones: [number, number][] = [
    [45, 135],
    [175, 285],
    [325, 435],
    [465, 555],
    [615, 735],
    [765, 885],
    [915, 1035],
    [1065, 1145],
  ];
  const villageHouseColliders: Aabb[] = [];
  const villageRoadColliders: Aabb[] = [
    { minX: 556, maxX: 564, minZ: 30, maxZ: MAP_SIZE - 30 },
  ];
  for (const laneZ of [225, 375, 525, 675]) {
    villageRoadColliders.push({
      minX: 480,
      maxX: 630,
      minZ: laneZ - 3,
      maxZ: laneZ + 3,
    });
  }
  const gridRoadLines: number[] = [];
  for (let i = 0; i <= N; i += 1) gridRoadLines.push(i * B);
  const villageRoadBlocks: Aabb[] = [
    ...villageRoadColliders,
    ...gridRoadLines.map((lineX) => ({
      minX: lineX - WORLD.ROAD_WIDTH / 2 - 5,
      maxX: lineX + WORLD.ROAD_WIDTH / 2 + 5,
      minZ: 0,
      maxZ: MAP_SIZE,
    })),
    ...gridRoadLines.map((lineZ) => ({
      minX: 0,
      maxX: MAP_SIZE,
      minZ: lineZ - WORLD.ROAD_WIDTH / 2 - 5,
      maxZ: lineZ + WORLD.ROAD_WIDTH / 2 + 5,
    })),
    {
      minX: 0,
      maxX: MAP_SIZE,
      minZ: WORLD.RIVER_Z - WORLD.RIVER_WIDTH / 2 - 6,
      maxZ: WORLD.RIVER_Z + WORLD.RIVER_WIDTH / 2 + 6,
    },
  ];
  const villageXGaps: [number, number][] = [
    [CITY_MAX_X + 13, 750 - 13],
    [750 + 13, VILLAGE_MAX_X - 13],
  ];
  for (const [zMin, zMax] of houseZones) {
    for (let k = 0; k < 3; k += 1) {
      const gap = villageXGaps[Math.floor(rand() * villageXGaps.length)];
      let x = gap[0] + rand() * (gap[1] - gap[0]);
      let z = zMin + rand() * (zMax - zMin);
      let bw = 9 + rand() * 4.5;
      let bd = 7 + rand() * 3;
      let bh = 3.6 + rand() * 1.5;
      let angle = rand() * Math.PI * 2;
      let attempts = 0;
      const rotatedBounds = (): { minX: number; maxX: number; minZ: number; maxZ: number } => {
        const cos = Math.abs(Math.cos(angle));
        const sin = Math.abs(Math.sin(angle));
        const halfW = (bw * cos + bd * sin) / 2;
        const halfD = (bw * sin + bd * cos) / 2;
        return { minX: x - halfW, maxX: x + halfW, minZ: z - halfD, maxZ: z + halfD };
      };
      const collides = (): boolean => {
        const bounds = rotatedBounds();
        if (
          villageRoadBlocks.some((road) =>
            overlapsAabb(
              bounds.minX,
              bounds.minZ,
              bounds.maxX,
              bounds.maxZ,
              road,
              2.5,
            ),
          )
        ) {
          return true;
        }
        return villageHouseColliders.some((house) =>
          overlapsAabb(
            bounds.minX,
            bounds.minZ,
            bounds.maxX,
            bounds.maxZ,
            house,
            3,
          ),
        );
      };
      while (attempts < 14 && collides()) {
        x = gap[0] + rand() * (gap[1] - gap[0]);
        z = zMin + rand() * (zMax - zMin);
        bw = 9 + rand() * 4.5;
        bd = 7 + rand() * 3;
        bh = 3.6 + rand() * 1.5;
        angle = rand() * Math.PI * 2;
        attempts += 1;
      }
      if (attempts >= 14) continue;
      const bounds = rotatedBounds();
      villageHouseColliders.push({
        minX: bounds.minX,
        maxX: bounds.maxX,
        minZ: bounds.minZ,
        maxZ: bounds.maxZ,
      });
      const house = new THREE.Group();
      house.name = 'village-house';
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(bw, bh, bd),
        villageWallMaterial,
      );
      body.position.y = bh / 2;
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(Math.max(bw, bd) * 0.75, 2.8 + rand(), 4),
        villageRoofMaterial,
      );
      roof.position.y = bh + 1.2;
      roof.rotation.y = Math.PI / 4;
      const chimney = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 1.5, 0.7),
        villageWoodMaterial,
      );
      chimney.position.set(bw * 0.25, bh + 1.9, -bd * 0.22);
      house.add(body, roof, chimney);
      house.position.set(x, 0, z);
      house.rotation.y = angle;
      house.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      villageGroup.add(house);
    }
  }
  for (let f = 0; f < 8; f += 1) {
    const field = new THREE.Mesh(
      new THREE.BoxGeometry(14 + rand() * 12, 0.05, 10 + rand() * 8),
      fieldMaterial,
    );
    field.position.set(615 + rand() * 275, 0.035, 45 + rand() * 1110);
    const fieldBounds = {
      minX: field.position.x - 14,
      maxX: field.position.x + 14,
      minZ: field.position.z - 10,
      maxZ: field.position.z + 10,
    };
    if (
      villageRoadBlocks.some((road) =>
        overlapsAabb(
          fieldBounds.minX,
          fieldBounds.minZ,
          fieldBounds.maxX,
          fieldBounds.maxZ,
          road,
          1,
        ),
      )
    ) {
      f -= 1;
      continue;
    }
    field.name = 'village-field';
    field.receiveShadow = true;
    villageGroup.add(field);
  }
  const villageTreeColliders: CircleCollider[] = [];
  for (let t = 0; t < 14; t += 1) {
    let tx = 620 + rand() * 270;
    let tz = 45 + rand() * 1110;
    if (
      villageRoadBlocks.some(
        (road) =>
          tx > road.minX - 3 &&
          tx < road.maxX + 3 &&
          tz > road.minZ - 3 &&
          tz < road.maxZ + 3,
      )
    ) {
      t -= 1;
      continue;
    }
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.3, 2.4, 7),
      villageWoodMaterial,
    );
    trunk.position.y = 1.2;
    const foliage = new THREE.Mesh(
      new THREE.ConeGeometry(1.5, 3, 8),
      hillMaterial,
    );
    foliage.position.y = 3.4;
    const tree = new THREE.Group();
    tree.add(trunk, foliage);
    tree.position.set(tx, 0, tz);
    villageGroup.add(tree);
    villageTreeColliders.push({ x: tx, z: tz, radius: TREE_COLLIDER_RADIUS });
  }
  group.add(villageGroup);

  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      if ((i + j) % 2 !== 0) continue;
      const x0 = i * B;
      const z0 = j * B;
      if (x0 + B / 2 >= CITY_MAX_X) continue;
      const crossesRiver = (zMin: number, zMax: number): boolean =>
        zMin < 482 && zMax > 438;
      if (crossesRiver(z0 + 30, z0 + B - 30)) continue;
      const alleyA = new THREE.Mesh(
        new THREE.BoxGeometry(4, 0.07, B - 60),
        dirtMaterial,
      );
      alleyA.position.set(x0 + 12, 0.075, z0 + B / 2);
      alleyA.name = 'alley';
      alleyA.receiveShadow = true;
      group.add(alleyA);
      if (crossesRiver(z0 + 12, z0 + B - 48)) continue;
      const alleyB = new THREE.Mesh(
        new THREE.BoxGeometry(B - 60, 0.07, 4),
        dirtMaterial,
      );
      alleyB.position.set(x0 + B / 2, 0.075, z0 + 12);
      alleyB.name = 'alley';
      alleyB.receiveShadow = true;
      group.add(alleyB);
    }
  }

  const hills: { x: number; z: number; radius: number; height: number }[] = [];
  const hillSpots: { x: number; z: number; minR: number; maxR: number }[] = [];
  for (const z of [55, 205, 355, 505, 655, 805, 955, 1105]) {
    hillSpots.push({ x: 945 + (rand() - 0.5) * 45, z, minR: 15, maxR: 26 });
    hillSpots.push({ x: 1095 + (rand() - 0.5) * 32, z, minR: 13, maxR: 22 });
  }
  const hillRoadClear = (x: number, z: number, radius: number): boolean => {
    for (const lineX of gridRoadLines) {
      if (Math.abs(x - lineX) < radius + 7) return false;
    }
    for (const lineZ of gridRoadLines) {
      if (Math.abs(z - lineZ) < radius + 7) return false;
    }
    if (Math.abs(z - WORLD.RIVER_Z) < radius + 20) return false;
    return true;
  }
  for (const spot of hillSpots) {
    const radius = spot.minR + rand() * (spot.maxR - spot.minR);
    if (!hillRoadClear(spot.x, spot.z, radius)) continue;
    if (
      hills.some(
        (hill) => Math.hypot(hill.x - spot.x, hill.z - spot.z) < hill.radius + radius + 12,
      )
    ) {
      continue;
    }
    const height = 3 + rand() * 7;
    hills.push({ x: spot.x, z: spot.z, radius, height });
  }
  for (const hill of hills) {
    const pyramidGeometry = new THREE.PlaneGeometry(
      hill.radius * 2,
      hill.radius * 2,
      28,
      28,
    );
    pyramidGeometry.rotateX(-Math.PI / 2);
    const pyramidPositions = pyramidGeometry.attributes.position;
    for (let i = 0; i < pyramidPositions.count; i += 1) {
      pyramidPositions.setY(
        i,
        hillHeightAt(
          hill,
          pyramidPositions.getX(i) + hill.x,
          pyramidPositions.getZ(i) + hill.z,
        ),
      );
    }
    pyramidGeometry.computeVertexNormals();
    const mound = new THREE.Mesh(
      pyramidGeometry,
      hillMaterial,
    );
    mound.position.set(hill.x, 0, hill.z);
    mound.name = 'hill';
    mound.castShadow = true;
    mound.receiveShadow = true;
    group.add(mound);
  }
  for (const trailX of [740, 885]) {
    const trail = new THREE.Mesh(
      new THREE.BoxGeometry(5, 0.05, MAP_SIZE - 60),
      dirtMaterial,
    );
    trail.position.set(trailX, 0.045, MAP_SIZE / 2);
    trail.name = 'hill-trail';
    trail.receiveShadow = true;
    group.add(trail);
  }

  const shoulderParts: THREE.BufferGeometry[] = [];
  const highwayDashParts: THREE.BufferGeometry[] = [];
  const span = MAP_SIZE + 12;
  for (const line of [0, N * B]) {
    const offset = WORLD.ROAD_WIDTH / 2 + 1.6;
    shoulderParts.push(
      transformedBox(2.6, 0.05, span, line - offset, 0.08, 450),
      transformedBox(2.6, 0.05, span, line + offset, 0.08, 450),
      transformedBox(span, 0.05, 2.6, 450, 0.08, line - offset),
      transformedBox(span, 0.05, 2.6, 450, 0.08, line + offset),
    );
    for (let t = 8; t < N * B; t += 12) {
      highwayDashParts.push(
        transformedBox(0.2, 0.03, 3, line, 0.16, t),
        transformedBox(3, 0.03, 0.2, t, 0.16, line),
      );
    }
  }
  const shoulderGeometry = mergeGeometries(shoulderParts);
  if (shoulderGeometry) {
    const shoulder = new THREE.Mesh(shoulderGeometry, highwayMaterial);
    shoulder.name = 'highway-shoulder';
    shoulder.receiveShadow = true;
    group.add(shoulder);
  }
  const dashGeometry = mergeGeometries(highwayDashParts);
  if (dashGeometry) {
    group.add(new THREE.Mesh(dashGeometry, yellowMarkingMaterial));
  }

  const wallParts: THREE.BufferGeometry[] = [
    transformedBox(MAP_SIZE + WORLD.BOUNDARY_OFFSET * 2 + 4, 2.4, 1.4, MAP_SIZE / 2, 1.2, -WORLD.BOUNDARY_OFFSET - 2),
    transformedBox(MAP_SIZE + WORLD.BOUNDARY_OFFSET * 2 + 4, 2.4, 1.4, MAP_SIZE / 2, 1.2, MAP_SIZE + WORLD.BOUNDARY_OFFSET + 2),
    transformedBox(1.4, 2.4, MAP_SIZE + WORLD.BOUNDARY_OFFSET * 2 + 4, -WORLD.BOUNDARY_OFFSET - 2, 1.2, MAP_SIZE / 2),
    transformedBox(1.4, 2.4, MAP_SIZE + WORLD.BOUNDARY_OFFSET * 2 + 4, MAP_SIZE + WORLD.BOUNDARY_OFFSET + 2, 1.2, MAP_SIZE / 2),
  ];
  const wallGeometry = mergeGeometries(wallParts);
  if (wallGeometry) {
    const boundaryWall = new THREE.Mesh(
      wallGeometry,
      new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.85 }),
    );
    boundaryWall.name = 'boundary-wall';
    boundaryWall.receiveShadow = true;
    boundaryWall.castShadow = true;
    group.add(boundaryWall);
  }

  const wallHalf = 0.7;
  const wallInset = WORLD.BOUNDARY_OFFSET + 2;
  const boundaryColliders: Aabb[] = [
    {
      minX: -1,
      maxX: MAP_SIZE + 1,
      minZ: -wallInset - wallHalf,
      maxZ: -wallInset + wallHalf,
    },
    {
      minX: -1,
      maxX: MAP_SIZE + 1,
      minZ: MAP_SIZE + wallInset - wallHalf,
      maxZ: MAP_SIZE + wallInset + wallHalf,
    },
    {
      minX: -wallInset - wallHalf,
      maxX: -wallInset + wallHalf,
      minZ: -1,
      maxZ: MAP_SIZE + 1,
    },
    {
      minX: MAP_SIZE + wallInset - wallHalf,
      maxX: MAP_SIZE + wallInset + wallHalf,
      minZ: -1,
      maxZ: MAP_SIZE + 1,
    },
  ];

  const CHUNK_SIZE = WORLD.BLOCK_LENGTH * 2;
  const CHUNKS = Math.ceil(WORLD.GRID_SIZE / 2);
  const CHUNK_COUNT = CHUNKS * CHUNKS;
  const chunkIndexAt = (x: number, z: number): number => {
    const cx = Math.min(CHUNKS - 1, Math.max(0, Math.floor(x / CHUNK_SIZE)));
    const cz = Math.min(CHUNKS - 1, Math.max(0, Math.floor(z / CHUNK_SIZE)));
    return cz * CHUNKS + cx;
  };

  const buildingMatrices: THREE.Matrix4[][] = Array.from(
    { length: CHUNK_COUNT },
    () => [],
  );
  const buildingColors: THREE.Color[][] = Array.from(
    { length: CHUNK_COUNT },
    () => [],
  );
  const roofMatrices: THREE.Matrix4[][] = Array.from(
    { length: CHUNK_COUNT },
    () => [],
  );
  const roofColors: THREE.Color[][] = Array.from(
    { length: CHUNK_COUNT },
    () => [],
  );
  const windowMatrices: THREE.Matrix4[][] = Array.from(
    { length: CHUNK_COUNT },
    () => [],
  );
  const windowColors: THREE.Color[][] = Array.from(
    { length: CHUNK_COUNT },
    () => [],
  );
  const buildingColliders: Aabb[] = [];
  buildingColliders.push(...villageHouseColliders);
  const treeColliders: CircleCollider[] = [];
  treeColliders.push(...villageTreeColliders);
  const inset = WORLD.BUILDING_INSET;
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const x0 = i * B + inset;
      const x1 = (i + 1) * B - inset;
      const z0 = j * B + inset;
      const z1 = (j + 1) * B - inset;
      if (i * B + B / 2 >= CITY_MAX_X) continue;
      const areaW = x1 - x0;
      const areaD = z1 - z0;
      if (areaW < 24 || areaD < 24) continue;
      const gap = 9;
      const plotW = (areaW - gap) / 2;
      const plotD = (areaD - gap) / 2;
      for (let py = 0; py < 2; py += 1) {
        for (let px = 0; px < 2; px += 1) {
          if (rand() < 0.28) continue;
          const bw = 18 + rand() * Math.min(plotW - 8, 26);
          const bd = 18 + rand() * Math.min(plotD - 8, 26);
          const bx = x0 + px * (plotW + gap) + (plotW - bw) * 0.5 + (rand() - 0.5) * 3;
          const bz = z0 + py * (plotD + gap) + (plotD - bd) * 0.5 + (rand() - 0.5) * 3;
          const bh = 9 + rand() * 38;
          const chunk = chunkIndexAt(bx + bw / 2, bz + bd / 2);
          const matrix = new THREE.Matrix4().compose(
            new THREE.Vector3(bx + bw / 2, bh / 2, bz + bd / 2),
            new THREE.Quaternion(),
            new THREE.Vector3(bw, bh, bd),
          );
          buildingMatrices[chunk].push(matrix);
          const buildingColor = new THREE.Color(
            COLORS.BUILDINGS[Math.floor(rand() * COLORS.BUILDINGS.length)],
          );
          buildingColors[chunk].push(buildingColor);
          roofMatrices[chunk].push(
            new THREE.Matrix4().compose(
              new THREE.Vector3(bx + bw / 2, bh + 0.16, bz + bd / 2),
              new THREE.Quaternion(),
              new THREE.Vector3(bw + 0.5, 0.32, bd + 0.5),
            ),
          );
          roofColors[chunk].push(buildingColor.clone().multiplyScalar(0.66));
          const windowCols = Math.min(5, Math.max(2, Math.floor(bw / 5.6)));
          const windowRows = Math.min(4, Math.max(2, Math.floor(bh / 6.2)));
          for (let wy = 0; wy < windowRows; wy += 1) {
            for (let wx = 0; wx < windowCols; wx += 1) {
              const wxPos = bx + (bw * (wx + 1)) / (windowCols + 1);
              const wyPos = (bh * (wy + 1)) / (windowRows + 2);
              const wzPos = bz + (bd * (wx + 1)) / (windowCols + 1);
              const lit = rand() < 0.18;
              const windowColor = lit
                ? new THREE.Color(0xffe6a0)
                : new THREE.Color(0x2b4a66);
              if (bd >= bw) {
                windowMatrices[chunk].push(
                  new THREE.Matrix4().compose(
                    new THREE.Vector3(wxPos, wyPos, bz + bd + 0.07),
                    new THREE.Quaternion(),
                    new THREE.Vector3(0.9, 1.1, 0.08),
                  ),
                  new THREE.Matrix4().compose(
                    new THREE.Vector3(wxPos, wyPos, bz - 0.07),
                    new THREE.Quaternion(),
                    new THREE.Vector3(0.9, 1.1, 0.08),
                  ),
                );
                windowColors[chunk].push(windowColor, windowColor.clone());
              } else {
                windowMatrices[chunk].push(
                  new THREE.Matrix4().compose(
                    new THREE.Vector3(bx - 0.07, wyPos, wzPos),
                    new THREE.Quaternion().setFromAxisAngle(
                      new THREE.Vector3(0, 1, 0),
                      Math.PI / 2,
                    ),
                    new THREE.Vector3(0.9, 1.1, 0.08),
                  ),
                  new THREE.Matrix4().compose(
                    new THREE.Vector3(bx + bw + 0.07, wyPos, wzPos),
                    new THREE.Quaternion().setFromAxisAngle(
                      new THREE.Vector3(0, 1, 0),
                      -Math.PI / 2,
                    ),
                    new THREE.Vector3(0.9, 1.1, 0.08),
                  ),
                );
                windowColors[chunk].push(windowColor, windowColor.clone());
              }
            }
          }
          buildingColliders.push({ minX: bx, maxX: bx + bw, minZ: bz, maxZ: bz + bd });
        }
      }
    }
  }

  const treeTrunkData: { x: number; z: number; scale: number }[][] = Array.from(
    { length: CHUNK_COUNT },
    () => [],
  );
  const treeStep = 22;
  for (const edge of edges) {
    const a = intersections[edge.from];
    const b = intersections[edge.to];
    const ux = (b.x - a.x) / B;
    const uz = (b.z - a.z) / B;
    const rx = -uz;
    const rz = ux;
    for (let t = 10; t < B - 4; t += treeStep) {
      const side = (Math.floor(t / treeStep) + edge.id) % 2 === 0 ? 1 : -1;
      const offset = WORLD.ROAD_WIDTH / 2 + WORLD.SIDEWALK_WIDTH * 0.65;
      const px = a.x + ux * t + rx * side * offset + (rand() - 0.5) * 2.4;
      const pz = a.z + uz * t + rz * side * offset + (rand() - 0.5) * 2.4;
      if (px > VILLAGE_MAX_X) continue;
      treeTrunkData[chunkIndexAt(px, pz)].push({
        x: px,
        z: pz,
        scale: 0.8 + rand() * 0.7,
      });
      treeColliders.push({ x: px, z: pz, radius: TREE_COLLIDER_RADIUS });
    }
  }

  const streetLampPositions: { x: number; z: number }[][] = Array.from(
    { length: CHUNK_COUNT },
    () => [],
  );
  for (const node of intersections) {
    if (node.x >= CITY_MAX_X - 10) continue;
    streetLampPositions[chunkIndexAt(node.x + 9.5, node.z + 9.5)].push({
      x: node.x + 9.5,
      z: node.z + 9.5,
    });
    streetLampPositions[chunkIndexAt(node.x - 9.5, node.z - 9.5)].push({
      x: node.x - 9.5,
      z: node.z - 9.5,
    });
  }

  const signalInstances: {
    x: number;
    z: number;
    axis: 'x' | 'z';
    nodeIndex: number;
  }[][] = Array.from({ length: CHUNK_COUNT }, () => []);
  for (const node of intersections) {
    if (node.x >= CITY_MAX_X - 10) continue;
    signalInstances[chunkIndexAt(node.x - 6.5, node.z + 6.5)].push({
      x: node.x - 6.5,
      z: node.z + 6.5,
      axis: 'x',
      nodeIndex: node.index,
    });
    signalInstances[chunkIndexAt(node.x + 6.5, node.z - 6.5)].push({
      x: node.x + 6.5,
      z: node.z - 6.5,
      axis: 'z',
      nodeIndex: node.index,
    });
  }

  const buildingMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.78,
  });
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    metalness: 0.15,
  });
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.45,
    metalness: 0.35,
  });
  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
  });
  const foliageMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
  });
  const poleMaterial = new THREE.MeshStandardMaterial({
    color: 0x2c2f33,
    roughness: 0.7,
  });
  const lampHeadMaterial = new THREE.MeshBasicMaterial({ color: 0xffe6a0 });
  const signalHousingMaterial = new THREE.MeshStandardMaterial({
    color: 0x1b1d21,
    roughness: 0.55,
    metalness: 0.25,
  });
  const redSignalMaterial = new THREE.MeshBasicMaterial({ color: 0xd33a2c });
  const yellowSignalMaterial = new THREE.MeshBasicMaterial({ color: 0xffc53d });
  const greenSignalMaterial = new THREE.MeshBasicMaterial({ color: 0x2fbf4f });
  const SIGNAL_LAMP_Y = [4.98, 5.55, 6.12] as const;
  const signalChunks: {
    red: THREE.InstancedMesh;
    yellow: THREE.InstancedMesh;
    green: THREE.InstancedMesh;
    instances: { x: number; z: number; axis: 'x' | 'z'; nodeIndex: number }[];
  }[] = [];

  const chunks: THREE.Group[] = [];
  for (let c = 0; c < CHUNK_COUNT; c += 1) {
    const chunkGroup = new THREE.Group();
    chunkGroup.name = `city-chunk-${c}`;
    const chunkBuildings = buildingMatrices[c];
    if (chunkBuildings.length > 0) {
      const buildingMesh = makeInstanced(
        new THREE.BoxGeometry(1, 1, 1),
        buildingMaterial,
        chunkBuildings.length,
      );
      buildingMesh.name = 'buildings';
      buildingMesh.receiveShadow = true;
      buildingMesh.castShadow = true;
      for (let i = 0; i < chunkBuildings.length; i += 1) {
        buildingMesh.setMatrixAt(i, chunkBuildings[i]);
        buildingMesh.setColorAt(i, buildingColors[c][i]);
      }
      buildingMesh.instanceMatrix.needsUpdate = true;
      if (buildingMesh.instanceColor) buildingMesh.instanceColor.needsUpdate = true;
      chunkGroup.add(buildingMesh);
    }

    const chunkRoofs = roofMatrices[c];
    if (chunkRoofs.length > 0) {
      const roofMesh = makeInstanced(
        new THREE.BoxGeometry(1, 1, 1),
        roofMaterial,
        chunkRoofs.length,
      );
      roofMesh.name = 'building-roofs';
      roofMesh.receiveShadow = true;
      roofMesh.castShadow = true;
      for (let i = 0; i < chunkRoofs.length; i += 1) {
        roofMesh.setMatrixAt(i, chunkRoofs[i]);
        roofMesh.setColorAt(i, roofColors[c][i]);
      }
      roofMesh.instanceMatrix.needsUpdate = true;
      if (roofMesh.instanceColor) roofMesh.instanceColor.needsUpdate = true;
      chunkGroup.add(roofMesh);
    }

    const chunkWindows = windowMatrices[c];
    if (chunkWindows.length > 0) {
      const windowMesh = makeInstanced(
        new THREE.BoxGeometry(1, 1, 1),
        windowMaterial,
        chunkWindows.length,
      );
      windowMesh.name = 'building-windows';
      windowMesh.receiveShadow = true;
      windowMesh.castShadow = false;
      for (let i = 0; i < chunkWindows.length; i += 1) {
        windowMesh.setMatrixAt(i, chunkWindows[i]);
        windowMesh.setColorAt(i, windowColors[c][i]);
      }
      windowMesh.instanceMatrix.needsUpdate = true;
      if (windowMesh.instanceColor) windowMesh.instanceColor.needsUpdate = true;
      chunkGroup.add(windowMesh);
    }

    const chunkTrees = treeTrunkData[c];
    if (chunkTrees.length > 0) {
      const trunkMesh = makeInstanced(
        new THREE.CylinderGeometry(0.2, 0.34, 2.7, 7),
        trunkMaterial,
        chunkTrees.length,
      );
      const foliageLower = makeInstanced(
        new THREE.ConeGeometry(1.55, 2.4, 8),
        foliageMaterial,
        chunkTrees.length,
      );
      const foliageUpper = makeInstanced(
        new THREE.ConeGeometry(1.05, 2.1, 8),
        foliageMaterial,
        chunkTrees.length,
      );
      const foliageTop = makeInstanced(
        new THREE.ConeGeometry(0.6, 1.8, 8),
        foliageMaterial,
        chunkTrees.length,
      );
      trunkMesh.castShadow = false;
      foliageLower.castShadow = false;
      foliageUpper.castShadow = false;
      foliageTop.castShadow = false;
      for (let i = 0; i < chunkTrees.length; i += 1) {
        const data = chunkTrees[i];
        const s = data.scale;
        const trunkMatrix = new THREE.Matrix4().compose(
          new THREE.Vector3(data.x, 1.35 * s, data.z),
          new THREE.Quaternion(),
          new THREE.Vector3(1, s, 1),
        );
        trunkMesh.setMatrixAt(i, trunkMatrix);
        trunkMesh.setColorAt(
          i,
          new THREE.Color(0x6a4a2f).multiplyScalar(0.88 + rand() * 0.25),
        );
        const lowerMatrix = new THREE.Matrix4().compose(
          new THREE.Vector3(data.x, 3.9 * s, data.z),
          new THREE.Quaternion(),
          new THREE.Vector3(1.55 * s, s, 1.55 * s),
        );
        foliageLower.setMatrixAt(i, lowerMatrix);
        foliageLower.setColorAt(
          i,
          new THREE.Color(0x37642f).multiplyScalar(0.85 + rand() * 0.35),
        );
        const upperMatrix = new THREE.Matrix4().compose(
          new THREE.Vector3(data.x, 6.15 * s, data.z),
          new THREE.Quaternion(),
          new THREE.Vector3(1.05 * s, s, 1.05 * s),
        );
        foliageUpper.setMatrixAt(i, upperMatrix);
        foliageUpper.setColorAt(
          i,
          new THREE.Color(0x3f7d3a).multiplyScalar(0.9 + rand() * 0.3),
        );
        const topMatrix = new THREE.Matrix4().compose(
          new THREE.Vector3(data.x, 8.1 * s, data.z),
          new THREE.Quaternion(),
          new THREE.Vector3(0.6 * s, s, 0.6 * s),
        );
        foliageTop.setMatrixAt(i, topMatrix);
        foliageTop.setColorAt(
          i,
          new THREE.Color(0x4a8a44).multiplyScalar(0.9 + rand() * 0.3),
        );
      }
      trunkMesh.instanceMatrix.needsUpdate = true;
      if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
      foliageLower.instanceMatrix.needsUpdate = true;
      if (foliageLower.instanceColor) foliageLower.instanceColor.needsUpdate = true;
      foliageUpper.instanceMatrix.needsUpdate = true;
      if (foliageUpper.instanceColor) foliageUpper.instanceColor.needsUpdate = true;
      foliageTop.instanceMatrix.needsUpdate = true;
      if (foliageTop.instanceColor) foliageTop.instanceColor.needsUpdate = true;
      chunkGroup.add(trunkMesh);
      chunkGroup.add(foliageLower);
      chunkGroup.add(foliageUpper);
      chunkGroup.add(foliageTop);
    }

    const chunkLamps = streetLampPositions[c];
    if (chunkLamps.length > 0) {
      const poleMesh = makeInstanced(
        new THREE.CylinderGeometry(0.07, 0.1, 4.6, 5),
        poleMaterial,
        chunkLamps.length,
      );
      const headMesh = makeInstanced(
        new THREE.BoxGeometry(0.9, 0.22, 0.3),
        lampHeadMaterial,
        chunkLamps.length,
      );
      for (let i = 0; i < chunkLamps.length; i += 1) {
        const lamp = chunkLamps[i];
        const poleMatrix = new THREE.Matrix4().compose(
          new THREE.Vector3(lamp.x, 2.3, lamp.z),
          new THREE.Quaternion(),
          new THREE.Vector3(1, 1, 1),
        );
        poleMesh.setMatrixAt(i, poleMatrix);
        const headMatrix = new THREE.Matrix4().compose(
          new THREE.Vector3(lamp.x, 4.62, lamp.z),
          new THREE.Quaternion(),
          new THREE.Vector3(1, 1, 1),
        );
        headMesh.setMatrixAt(i, headMatrix);
      }
      poleMesh.instanceMatrix.needsUpdate = true;
      headMesh.instanceMatrix.needsUpdate = true;
      chunkGroup.add(poleMesh);
      chunkGroup.add(headMesh);
    }

    const chunkSignals = signalInstances[c];
    if (chunkSignals.length > 0) {
      const signalPoleMesh = makeInstanced(
        new THREE.CylinderGeometry(0.08, 0.12, 4.7, 6),
        poleMaterial,
        chunkSignals.length,
      );
      signalPoleMesh.name = 'signal-poles';
      for (let i = 0; i < chunkSignals.length; i += 1) {
        const signal = chunkSignals[i];
        signalPoleMesh.setMatrixAt(
          i,
          new THREE.Matrix4().compose(
            new THREE.Vector3(signal.x, 2.35, signal.z),
            new THREE.Quaternion(),
            new THREE.Vector3(1, 1, 1),
          ),
        );
      }
      signalPoleMesh.instanceMatrix.needsUpdate = true;
      chunkGroup.add(signalPoleMesh);

      const signalHeads = makeInstanced(
        new THREE.BoxGeometry(0.82, 2.05, 0.52),
        signalHousingMaterial,
        chunkSignals.length,
      );
      signalHeads.name = 'signal-heads';
      for (let i = 0; i < chunkSignals.length; i += 1) {
        const signal = chunkSignals[i];
        signalHeads.setMatrixAt(
          i,
          new THREE.Matrix4().compose(
            new THREE.Vector3(signal.x, 5.55, signal.z),
            new THREE.Quaternion(),
            new THREE.Vector3(1, 1, 1),
          ),
        );
      }
      signalHeads.instanceMatrix.needsUpdate = true;
      chunkGroup.add(signalHeads);

      const lampGeometry = new THREE.CylinderGeometry(0.24, 0.24, 0.06, 20);
      const lampQuaternion = (axis: 'x' | 'z'): THREE.Quaternion =>
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            Math.PI / 2,
            axis === 'x' ? Math.PI / 2 : 0,
            0,
          ),
        );
      const redSignals = makeInstanced(
        lampGeometry,
        redSignalMaterial,
        chunkSignals.length,
      );
      redSignals.name = 'signal-red-lamps';
      const yellowSignals = makeInstanced(
        lampGeometry,
        yellowSignalMaterial,
        chunkSignals.length,
      );
      yellowSignals.name = 'signal-yellow-lamps';
      const greenSignals = makeInstanced(
        lampGeometry,
        greenSignalMaterial,
        chunkSignals.length,
      );
      greenSignals.name = 'signal-green-lamps';
      for (let i = 0; i < chunkSignals.length; i += 1) {
        const signal = chunkSignals[i];
        const quaternion = lampQuaternion(signal.axis);
        for (const [lampIndex, lamps] of [
          [0, redSignals],
          [1, yellowSignals],
          [2, greenSignals],
        ] as const) {
          lamps.setMatrixAt(
            i,
            new THREE.Matrix4().compose(
              new THREE.Vector3(signal.x, SIGNAL_LAMP_Y[lampIndex], signal.z),
              quaternion,
              new THREE.Vector3(1, 1, 1),
            ),
          );
        }
      }
      redSignals.instanceMatrix.needsUpdate = true;
      yellowSignals.instanceMatrix.needsUpdate = true;
      greenSignals.instanceMatrix.needsUpdate = true;
      chunkGroup.add(redSignals);
      chunkGroup.add(yellowSignals);
      chunkGroup.add(greenSignals);
      signalChunks.push({
        red: redSignals,
        yellow: yellowSignals,
        green: greenSignals,
        instances: chunkSignals,
      });
    }
    chunks.push(chunkGroup);
  }
  group.add(...chunks);

  const signalMatrix = new THREE.Matrix4();
  const updateSignals = (timeSec: number): void => {
    for (const signalChunk of signalChunks) {
      for (let i = 0; i < signalChunk.instances.length; i += 1) {
        const signal = signalChunk.instances[i];
        const offset = (signal.nodeIndex % 7) * 1.6;
        const t = (timeSec + offset) % WORLD.LIGHT_CYCLE;
        const green =
          signal.axis === 'x'
            ? t < WORLD.LIGHT_GREEN
            : t >= WORLD.LIGHT_YELLOW_START;
        const yellow =
          t >= WORLD.LIGHT_GREEN && t < WORLD.LIGHT_YELLOW_START;
        const red = !green && !yellow;
        signalMatrix.compose(
          new THREE.Vector3(signal.x, SIGNAL_LAMP_Y[0], signal.z),
          new THREE.Quaternion(),
          new THREE.Vector3(1, red ? 1 : 0, 1),
        );
        signalChunk.red.setMatrixAt(i, signalMatrix);
        signalMatrix.compose(
          new THREE.Vector3(signal.x, SIGNAL_LAMP_Y[1], signal.z),
          new THREE.Quaternion(),
          new THREE.Vector3(1, yellow ? 1 : 0, 1),
        );
        signalChunk.yellow.setMatrixAt(i, signalMatrix);
        signalMatrix.compose(
          new THREE.Vector3(signal.x, SIGNAL_LAMP_Y[2], signal.z),
          new THREE.Quaternion(),
          new THREE.Vector3(1, green ? 1 : 0, 1),
        );
        signalChunk.green.setMatrixAt(i, signalMatrix);
      }
      signalChunk.red.instanceMatrix.needsUpdate = true;
      signalChunk.yellow.instanceMatrix.needsUpdate = true;
      signalChunk.green.instanceMatrix.needsUpdate = true;
    }
  };

  const updateChunks = (px: number, pz: number): void => {
    const radiusSq = WORLD.RENDER_DISTANCE * WORLD.RENDER_DISTANCE;
    for (let c = 0; c < chunks.length; c += 1) {
      const cx = (c % CHUNKS) * CHUNK_SIZE + CHUNK_SIZE / 2;
      const cz = Math.floor(c / CHUNKS) * CHUNK_SIZE + CHUNK_SIZE / 2;
      const dx = px - cx;
      const dz = pz - cz;
      chunks[c].visible = dx * dx + dz * dz <= radiusSq;
    }
  };

  const updateWater = (timeSec: number): void => {
    river.position.y = waterBaseY + Math.sin(timeSec * 0.9) * 0.025;
    if (!useReflector) {
      waterMaterial.opacity = 0.84 + Math.sin(timeSec * 1.4) * 0.06;
    }
  };

  const raceProps = new THREE.Group();
  raceProps.name = 'race-props';

  const at = (x: number, z: number): THREE.Vector3 => new THREE.Vector3(x, 0, z);
  const blockLength = 4.2;
  const flagPalette = [0xd9342f, 0x2f6fd0, 0x2f9e4f, 0xe0a63a];
  const buildRaceLayout = (definition: RaceLayoutDefinition): RaceLayout => {
    const id = definition.id;
    const name = definition.name;
    const path = definition.path;
    const checkpointRadius =
      definition.checkpointRadius ?? RACE_CONFIG.CHECKPOINT_RADIUS;
    const corridorWidth =
      definition.corridorWidth ?? RACE_CONFIG.CORRIDOR_WIDTH;
    const barrierWidth =
      definition.barrierWidth ?? RACE_CONFIG.BARRIER_WIDTH;
    const barrierOffset =
      definition.barrierOffset ?? RACE_CONFIG.BARRIER_OFFSET;
    const barrierExtra =
      definition.barrierExtra ?? RACE_CONFIG.BARRIER_EXTRA;
    const flagOffset = definition.flagOffset ?? RACE_CONFIG.FLAG_OFFSET;
    const startGridOffset =
      definition.startGridOffset ?? RACE_CONFIG.START_GRID_OFFSET;
    const startGridSpacing =
      definition.startGridSpacing ?? RACE_CONFIG.START_GRID_SPACING;
    const startGridRowOffset =
      definition.startGridRowOffset ?? RACE_CONFIG.START_GRID_ROW_OFFSET;
    const rawPoints = path.map(([px, pz]) => at(px * B, pz * B));
    const points: THREE.Vector3[] = [];
    for (const point of rawPoints) {
      const last = points[points.length - 1];
      if (!last || Math.hypot(point.x - last.x, point.z - last.z) > 1e-6) {
        points.push(point);
      }
    }
    if (points.length > 1) {
      const first = points[0];
      const last = points[points.length - 1];
      if (Math.hypot(last.x - first.x, last.z - first.z) < 1e-6) {
        points.pop();
      }
    }
    const routePoints = points.map((p) => ({ x: p.x, z: p.z }));
    const checkpoints = raceCheckpointPositions(points).map((p) => ({
      x: p.x,
      z: p.z,
    }));
    const layoutGroup = new THREE.Group();
    layoutGroup.name = `race-layout-${id}`;
    const raceBarriers: Aabb[] = [];
    const raceBarrierCircles: CircleCollider[] = [];
    const barrierMatrices: THREE.Matrix4[] = [];
    const barrierColors: THREE.Color[] = [];
    const collisionHalfWidth =
      barrierWidth / 2 + Math.min(1.15, barrierExtra * 0.5);

    const startDx = points[1].x - points[0].x;
    const startDz = points[1].z - points[0].z;
    const startLen = Math.hypot(startDx, startDz);
    const sux = startDx / startLen;
    const suz = startDz / startLen;
    let snx = -suz;
    let snz = sux;
    const midX = (points[0].x + points[1].x) / 2;
    const midZ = (points[0].z + points[1].z) / 2;
    const centroidX =
      points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const centroidZ =
      points.reduce((sum, point) => sum + point.z, 0) / points.length;
    if ((centroidX - midX) * snx + (centroidZ - midZ) * snz < 0) {
      snx = -snx;
      snz = -snz;
    }
    const startGridX = midX + snx * startGridOffset;
    const startGridZ = midZ + snz * startGridOffset;
    const startSlots: { x: number; z: number }[] = [];
    for (let k = 0; k < RACE_CONFIG.MAX_TOTAL_RACERS; k += 1) {
      startSlots.push({
        x: startGridX - sux * k * startGridSpacing,
        z: startGridZ - suz * k * startGridSpacing,
      });
    }
    for (let k = 0; k < startSlots.length; k += 1) {
      if (k % 2 === 1) {
        startSlots[k].x += snx * startGridRowOffset;
        startSlots[k].z += snz * startGridRowOffset;
      }
    }
    const startHeading = Math.atan2(sux, suz);

    for (let ci = 0; ci < points.length; ci += 1) {
      const a = points[ci];
      const b = points[(ci + 1) % points.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      const ux = dx / len;
      const uz = dz / len;
      const nx = -uz;
      const nz = ux;
      const cross = dx * nz - dz * nx;
      for (const side of cross > 0 ? [1, -1] : [-1, 1]) {
        const bx = a.x + nx * (side * barrierOffset);
        const bz = a.z + nz * (side * barrierOffset);
        const cornerGap =
          WORLD.ROAD_WIDTH / 2 +
          WORLD.SIDEWALK_WIDTH +
          barrierWidth / 2 +
          barrierExtra +
          2;
        let start = Math.min(cornerGap, len / 2 - 1);
        let end = Math.max(len - cornerGap, len / 2 + 1);
        if (ci === 0 && side === 1) {
          const startT = (startGridX - a.x) * ux + (startGridZ - a.z) * uz;
          const gapA = startT - 31;
          const gapB = startT + 31;
          if (gapA > start && gapA < end) end = Math.min(end, gapA);
          if (gapB > start && gapB < end) start = Math.max(start, gapB);
        }
        if (end - start < 2) continue;
        const lowX = bx + ux * start;
        const lowZ = bz + uz * start;
        const highX = bx + ux * end;
        const highZ = bz + uz * end;
        raceBarriers.push({
          minX: Math.min(lowX, highX) - collisionHalfWidth,
          maxX: Math.max(lowX, highX) + collisionHalfWidth,
          minZ: Math.min(lowZ, highZ) - collisionHalfWidth,
          maxZ: Math.max(lowZ, highZ) + collisionHalfWidth,
        });
        raceBarrierCircles.push(
          { x: lowX, z: lowZ, radius: collisionHalfWidth },
          { x: highX, z: highZ, radius: collisionHalfWidth },
        );
        for (let t = start; t < end; t += blockLength) {
          const bxPos = bx + ux * (t + blockLength / 2);
          const bzPos = bz + uz * (t + blockLength / 2);
          barrierMatrices.push(
            new THREE.Matrix4().compose(
              new THREE.Vector3(bxPos, RACE_CONFIG.BARRIER_HEIGHT / 2, bzPos),
              new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 1, 0),
                Math.atan2(ux, uz),
              ),
              new THREE.Vector3(Math.min(blockLength, end - t), RACE_CONFIG.BARRIER_HEIGHT, barrierWidth),
            ),
          );
          barrierColors.push(new THREE.Color(ci % 2 === 0 ? 0xd9342f : 0xe8e8e8));
        }
      }

      const mouthBarrier = (
        x: number,
        z: number,
        rotationY: number,
        length: number,
      ): void => {
        barrierMatrices.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(x, RACE_CONFIG.BARRIER_HEIGHT / 2, z),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY),
            new THREE.Vector3(length, RACE_CONFIG.BARRIER_HEIGHT, barrierWidth),
          ),
        );
        barrierColors.push(new THREE.Color(ci % 2 === 0 ? 0xd9342f : 0xe8e8e8));
        const half = collisionHalfWidth;
        const capX = rotationY === 0 ? length / 2 : 0;
        const capZ = rotationY === 0 ? 0 : length / 2;
        raceBarrierCircles.push(
          { x: x - capX, z: z - capZ, radius: half },
          { x: x + capX, z: z + capZ, radius: half },
        );
        if (rotationY === 0) {
          raceBarriers.push({
            minX: x - length / 2 - half,
            maxX: x + length / 2 + half,
            minZ: z - half,
            maxZ: z + half,
          });
        } else {
          raceBarriers.push({
            minX: x - half,
            maxX: x + half,
            minZ: z - length / 2 - half,
            maxZ: z + length / 2 + half,
          });
        }
      };
      const mouthLen = WORLD.ROAD_WIDTH + WORLD.SIDEWALK_WIDTH * 2 + 2;
      const mouthOffset =
        WORLD.ROAD_WIDTH / 2 + WORLD.SIDEWALK_WIDTH + barrierExtra + 1.5;
      const p = a;
      if (Math.abs(p.z - N * B) < 0.1 && p.x > B - 0.1 && p.x < N * B - 0.1) {
        mouthBarrier(p.x, N * B - mouthOffset, 0, mouthLen);
      } else if (Math.abs(p.x - N * B) < 0.1 && p.z > B - 0.1 && p.z < N * B - 0.1) {
        mouthBarrier(N * B - mouthOffset, p.z, Math.PI / 2, mouthLen);
      } else if (Math.abs(p.z) < 0.1 && p.x > B - 0.1 && p.x < N * B - 0.1) {
        mouthBarrier(p.x, mouthOffset, 0, mouthLen);
      } else if (Math.abs(p.x) < 0.1 && p.z > B - 0.1 && p.z < N * B - 0.1) {
        mouthBarrier(mouthOffset, p.z, Math.PI / 2, mouthLen);
      }
    }

    if (barrierMatrices.length > 0) {
      const barrierMesh = makeInstanced(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
        barrierMatrices.length,
      );
      barrierMesh.castShadow = true;
      barrierMesh.receiveShadow = true;
      for (let i = 0; i < barrierMatrices.length; i += 1) {
        barrierMesh.setMatrixAt(i, barrierMatrices[i]);
        barrierMesh.setColorAt(i, barrierColors[i]);
      }
      barrierMesh.instanceMatrix.needsUpdate = true;
      if (barrierMesh.instanceColor) barrierMesh.instanceColor.needsUpdate = true;
      layoutGroup.add(barrierMesh);
    }

    const poleMatrices: THREE.Matrix4[] = [];
    const flagMatrices: THREE.Matrix4[] = [];
    const flagColors: THREE.Color[] = [];
    for (let ci = 0; ci < points.length; ci += 1) {
      const p = points[ci];
      const q = points[(ci + 1) % points.length];
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const len = Math.hypot(dx, dz);
      const ux = dx / len;
      const uz = dz / len;
      const nx = -uz;
      const nz = ux;
      const heading = Math.atan2(ux, uz);
      for (const side of [-1, 1]) {
        const fx = p.x + nx * (side * flagOffset);
        const fz = p.z + nz * (side * flagOffset);
        poleMatrices.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(fx, 1.35, fz),
            new THREE.Quaternion(),
            new THREE.Vector3(1, 1, 1),
          ),
        );
        flagMatrices.push(
          new THREE.Matrix4().compose(
            new THREE.Vector3(fx, 1.85, fz),
            new THREE.Quaternion().setFromAxisAngle(
              new THREE.Vector3(0, 1, 0),
              heading + (side > 0 ? Math.PI : 0),
            ),
            new THREE.Vector3(1, 1, 1),
          ),
        );
        flagColors.push(new THREE.Color(flagPalette[(ci + (side > 0 ? 0 : 1)) % flagPalette.length]));
      }
    }
    if (poleMatrices.length > 0) {
      const flagPoles = makeInstanced(
        new THREE.CylinderGeometry(0.055, 0.07, 2.7, 6),
        new THREE.MeshStandardMaterial({ color: 0xcfcfcf, roughness: 0.45, metalness: 0.6 }),
        poleMatrices.length,
      );
      flagPoles.castShadow = true;
      for (let i = 0; i < poleMatrices.length; i += 1) {
        flagPoles.setMatrixAt(i, poleMatrices[i]);
      }
      flagPoles.instanceMatrix.needsUpdate = true;
      layoutGroup.add(flagPoles);

      const flagMesh = makeInstanced(
        new THREE.BufferGeometry(),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.7,
          side: THREE.DoubleSide,
        }),
        flagMatrices.length,
      );
      const triangle = new THREE.BufferGeometry();
      triangle.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0, 0, 0, 0.8, 0, 0, 0, 0.52, 0.55], 3),
      );
      triangle.computeVertexNormals();
      flagMesh.geometry = triangle;
      for (let i = 0; i < flagMatrices.length; i += 1) {
        flagMesh.setMatrixAt(i, flagMatrices[i]);
        flagMesh.setColorAt(i, flagColors[i]);
      }
      flagMesh.instanceMatrix.needsUpdate = true;
      if (flagMesh.instanceColor) flagMesh.instanceColor.needsUpdate = true;
      layoutGroup.add(flagMesh);
    }
    raceProps.add(layoutGroup);
    return {
      id,
      name,
      checkpoints,
      routePoints,
      startSlots,
      startHeading,
      raceBarriers,
      raceBarrierCircles,
      checkpointRadius,
      corridorWidth,
    };
  };

  const raceLayouts: RaceLayout[] =
    RACE_LAYOUT_DEFINITIONS.map(buildRaceLayout);
  let activeRaceLayoutId: RaceLayoutId = 'perimeter';
  raceProps.visible = false;
  group.add(raceProps);
  const setRacePropsVisible = (visible: boolean): void => {
    raceProps.visible = visible;
  };
  const setRaceLayout = (layoutId: RaceLayoutId): RaceLayout => {
    activeRaceLayoutId = layoutId;
    for (const layout of raceLayouts) {
      const layoutGroup = raceProps.getObjectByName(`race-layout-${layout.id}`);
      if (layoutGroup) layoutGroup.visible = layout.id === layoutId;
    }
    return raceLayouts.find((layout) => layout.id === layoutId) ?? raceLayouts[0];
  };
  setRaceLayout('perimeter');

  const lightGreenFor = (
    axis: 'x' | 'z',
    timeSec: number,
    nodeIndex: number,
  ): boolean => {
    const offset = (nodeIndex % 7) * 1.6;
    const t = (timeSec + offset) % WORLD.LIGHT_CYCLE;
    if (axis === 'x') return t < WORLD.LIGHT_GREEN;
    return t >= WORLD.LIGHT_YELLOW_START;
  };

  const getTerrainHeight = (x: number, z: number): number => {
    let height = 0;
    for (const hill of hills) {
      height = Math.max(height, hillHeightAt(hill, x, z));
    }
    return height;
  };

  const city: City = {
    group,
    chunks,
    intersections,
    edges,
    lanes,
    buildingColliders,
    boundaryColliders,
    treeColliders,
    bounds: { minX: 0, maxX: MAP_SIZE, minZ: 0, maxZ: MAP_SIZE },
    get raceBarriers() {
      return raceLayouts.find((layout) => layout.id === activeRaceLayoutId)?.raceBarriers ?? [];
    },
    raceProps,
    raceLayouts,
    get activeRaceLayoutId(): RaceLayoutId {
      return activeRaceLayoutId;
    },
    revision: 0,
    setRacePropsVisible,
    setRaceLayout,
    lightGreen: lightGreenFor,
    updateSignals,
    updateWater,
    updateChunks,
    getTerrainHeight,
  };

  scene.add(group);
  return city;
}
