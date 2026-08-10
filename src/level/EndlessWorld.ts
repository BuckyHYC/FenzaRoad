import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, WORLD } from '../core/Constants';
import type { Aabb, CircleCollider, LaneInfo } from '../core/types';
import type { City, CityEdge, CityIntersection } from './CityBuilder';

const BLOCK = WORLD.BLOCK_LENGTH;
const CHUNK = WORLD.ENDLESS_CHUNK_SIZE;
const HALF_WINDOW = Math.floor(WORLD.ENDLESS_WINDOW / 2);
const RIVER_REL_Z = WORLD.RIVER_Z - WORLD.SPAWN_Z;
const RIVER_LEN_MARGIN = WORLD.RIVER_LENGTH_PADDING;

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

function makeInstanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  count: number,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  return mesh;
}

export function buildEndlessWorld(scene: THREE.Scene): City {
  const group = new THREE.Group();
  const chunks: THREE.Group[] = [];
  const intersections: CityIntersection[] = [];
  const edges: CityEdge[] = [];
  const lanes: LaneInfo[] = [];
  const buildingColliders: Aabb[] = [];
  const treeColliders: CircleCollider[] = [];
  let centerCX = Number.POSITIVE_INFINITY;
  let centerCZ = Number.POSITIVE_INFINITY;
  let currentRevision = 0;
  let river: THREE.Mesh | null = null;

  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xe8e8e8,
    emissive: 0xffe9b0,
    emissiveIntensity: 0.55,
    roughness: 0.5,
  });
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x5a6068,
    roughness: 0.7,
    metalness: 0.4,
  });
  const asphaltMat = new THREE.MeshStandardMaterial({
    color: COLORS.ROAD,
    roughness: 0.88,
  });
  const sidewalkMat = new THREE.MeshStandardMaterial({
    color: COLORS.SIDEWALK,
    roughness: 0.85,
  });
  const groundMat = new THREE.MeshStandardMaterial({
    color: COLORS.GROUND,
    roughness: 1,
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
  });
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.8,
  });
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x21303c,
    roughness: 0.35,
    metalness: 0.25,
    emissive: 0x0e2233,
    emissiveIntensity: 0.55,
  });
  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
  });
  const foliageMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
  });
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x2f7fa8,
    roughness: 0.2,
    metalness: 0.1,
    transparent: true,
    opacity: 0.9,
    emissive: 0x0b2c44,
    emissiveIntensity: 0.45,
  });

  const rebuild = (cx: number, cz: number): void => {
    for (const chunk of chunks) {
      scene.remove(chunk);
      chunk.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          const material = child.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material?.dispose();
        }
      });
    }
    group.clear();
    chunks.length = 0;
    intersections.length = 0;
    edges.length = 0;
    lanes.length = 0;
    buildingColliders.length = 0;
    treeColliders.length = 0;
    currentRevision += 1;
    city.revision = currentRevision;

    const startRelX = cx * CHUNK - HALF_WINDOW * CHUNK;
    const startRelZ = cz * CHUNK - HALF_WINDOW * CHUNK;
    const endRelX = cx * CHUNK + (HALF_WINDOW + 1) * CHUNK;
    const endRelZ = cz * CHUNK + (HALF_WINDOW + 1) * CHUNK;
    const nodeCount = Math.round((endRelX - startRelX) / BLOCK) + 1;

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(endRelX - startRelX + 60, endRelZ - startRelZ + 60),
      groundMat,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(
      WORLD.SPAWN_X + (startRelX + endRelX) / 2,
      -0.04,
      WORLD.SPAWN_Z + (startRelZ + endRelZ) / 2,
    );
    ground.receiveShadow = true;
    group.add(ground);

    for (let j = 0; j < nodeCount; j += 1) {
      for (let i = 0; i < nodeCount; i += 1) {
        const relX = startRelX + i * BLOCK;
        const relZ = startRelZ + j * BLOCK;
        intersections.push({
          index: j * nodeCount + i,
          x: WORLD.SPAWN_X + relX,
          z: WORLD.SPAWN_Z + relZ,
        });
      }
    }

    const laneOffsets = [2.75, 5.75];
    let edgeId = 0;
    for (let j = 0; j < nodeCount; j += 1) {
      for (let i = 0; i < nodeCount - 1; i += 1) {
        const from = j * nodeCount + i;
        const to = j * nodeCount + i + 1;
        edges.push({ id: edgeId++, from, to, axis: 'x', length: BLOCK });
        lanes.push({
          edgeId: edges[edges.length - 1].id,
          fromNode: from,
          toNode: to,
          laneIndex: 0,
          lateralOffset: laneOffsets[0],
        });
        lanes.push({
          edgeId: edges[edges.length - 1].id,
          fromNode: to,
          toNode: from,
          laneIndex: 1,
          lateralOffset: -laneOffsets[0],
        });
      }
    }
    for (let j = 0; j < nodeCount - 1; j += 1) {
      for (let i = 0; i < nodeCount; i += 1) {
        const from = j * nodeCount + i;
        const to = (j + 1) * nodeCount + i;
        edges.push({ id: edgeId++, from, to, axis: 'z', length: BLOCK });
        lanes.push({
          edgeId: edges[edges.length - 1].id,
          fromNode: from,
          toNode: to,
          laneIndex: 0,
          lateralOffset: laneOffsets[0],
        });
        lanes.push({
          edgeId: edges[edges.length - 1].id,
          fromNode: to,
          toNode: from,
          laneIndex: 1,
          lateralOffset: -laneOffsets[0],
        });
      }
    }

    const roadParts: THREE.BufferGeometry[] = [];
    const sidewalkParts: THREE.BufferGeometry[] = [];
    for (const edge of edges) {
      const a = intersections[edge.from];
      const b = intersections[edge.to];
      const midX = (a.x + b.x) / 2;
      const midZ = (a.z + b.z) / 2;
      if (edge.axis === 'x') {
        roadParts.push(transformedBox(BLOCK, 0.14, WORLD.ROAD_WIDTH, midX, 0.06, midZ));
        sidewalkParts.push(
          transformedBox(
            BLOCK + WORLD.SIDEWALK_WIDTH * 2,
            0.12,
            WORLD.ROAD_WIDTH + WORLD.SIDEWALK_WIDTH * 2,
            midX,
            0.03,
            midZ,
          ),
        );
      } else {
        roadParts.push(transformedBox(WORLD.ROAD_WIDTH, 0.14, BLOCK, midX, 0.06, midZ));
        sidewalkParts.push(
          transformedBox(
            WORLD.ROAD_WIDTH + WORLD.SIDEWALK_WIDTH * 2,
            0.12,
            BLOCK + WORLD.SIDEWALK_WIDTH * 2,
            midX,
            0.03,
            midZ,
          ),
        );
      }
    }
    const roadGeometry = mergeGeometries(roadParts);
    if (roadGeometry) {
      const road = new THREE.Mesh(roadGeometry, asphaltMat);
      road.receiveShadow = true;
      group.add(road);
    }
    const sidewalkGeometry = mergeGeometries(sidewalkParts);
    if (sidewalkGeometry) {
      const sidewalk = new THREE.Mesh(sidewalkGeometry, sidewalkMat);
      sidewalk.receiveShadow = true;
      group.add(sidewalk);
    }

    const CHUNK_PER_SIDE = WORLD.ENDLESS_WINDOW;
    const chunkIndexAt = (worldX: number, worldZ: number): number => {
      const relX = worldX - (WORLD.SPAWN_X + startRelX);
      const relZ = worldZ - (WORLD.SPAWN_Z + startRelZ);
      const cx = Math.min(
        CHUNK_PER_SIDE - 1,
        Math.max(0, Math.floor(relX / CHUNK)),
      );
      const cz = Math.min(
        CHUNK_PER_SIDE - 1,
        Math.max(0, Math.floor(relZ / CHUNK)),
      );
      return cz * CHUNK_PER_SIDE + cx;
    };
    const chunkCount = CHUNK_PER_SIDE * CHUNK_PER_SIDE;
    const chunkWalls: THREE.Matrix4[][] = Array.from(
      { length: chunkCount },
      () => [],
    );
    const chunkWallColors: THREE.Color[][] = Array.from(
      { length: chunkCount },
      () => [],
    );
    const chunkRoofs: THREE.Matrix4[][] = Array.from(
      { length: chunkCount },
      () => [],
    );
    const chunkRoofColors: THREE.Color[][] = Array.from(
      { length: chunkCount },
      () => [],
    );
    const chunkWindows: THREE.Matrix4[][] = Array.from(
      { length: chunkCount },
      () => [],
    );
    const chunkTrunks: THREE.Matrix4[][] = Array.from(
      { length: chunkCount },
      () => [],
    );
    const chunkTrunkColors: THREE.Color[][] = Array.from(
      { length: chunkCount },
      () => [],
    );
    const chunkFoliage: THREE.Matrix4[][] = Array.from(
      { length: chunkCount },
      () => [],
    );
    const chunkFoliageColors: THREE.Color[][] = Array.from(
      { length: chunkCount },
      () => [],
    );

    for (let j = 0; j < nodeCount - 1; j += 1) {
      for (let i = 0; i < nodeCount - 1; i += 1) {
        const relX0 = startRelX + i * BLOCK;
        const relZ0 = startRelZ + j * BLOCK;
        const relX1 = relX0 + BLOCK;
        const relZ1 = relZ0 + BLOCK;
        const localRand = mulberry32(
          WORLD.CITY_SEED ^
            Math.floor(relX0 / BLOCK) * 73856093 ^
            Math.floor(relZ0 / BLOCK) * 19349663,
        );
        const x0 = WORLD.SPAWN_X + relX0 + WORLD.BUILDING_INSET;
        const x1 = WORLD.SPAWN_X + relX1 - WORLD.BUILDING_INSET;
        const z0 = WORLD.SPAWN_Z + relZ0 + WORLD.BUILDING_INSET;
        const z1 = WORLD.SPAWN_Z + relZ1 - WORLD.BUILDING_INSET;
        if (x1 - x0 < 20 || z1 - z0 < 20) continue;

        const buildingCount = 1 + Math.floor(localRand() * 2.6);
        for (let b = 0; b < buildingCount; b += 1) {
          const bw = 14 + localRand() * 22;
          const bd = 14 + localRand() * 22;
          const bh = 8 + localRand() * 18;
          const bx = x0 + (x1 - x0 - bw) * (0.12 + localRand() * 0.76);
          const bz = z0 + (z1 - z0 - bd) * (0.12 + localRand() * 0.76);
          const chunk = chunkIndexAt(bx + bw / 2, bz + bd / 2);
          const wallMatrix = new THREE.Matrix4().compose(
            new THREE.Vector3(bx, bh / 2, bz),
            new THREE.Quaternion(),
            new THREE.Vector3(bw, bh, bd),
          );
          chunkWalls[chunk].push(wallMatrix);
          chunkWallColors[chunk].push(
            new THREE.Color(0xc9c2b4).multiplyScalar(
              0.92 + localRand() * 0.16,
            ),
          );
          const roofMatrix = new THREE.Matrix4().compose(
            new THREE.Vector3(bx, bh + 0.25, bz),
            new THREE.Quaternion(),
            new THREE.Vector3(bw * 0.96, 0.5, bd * 0.96),
          );
          chunkRoofs[chunk].push(roofMatrix);
          chunkRoofColors[chunk].push(
            new THREE.Color(0x8a9aa6).multiplyScalar(
              0.88 + localRand() * 0.2,
            ),
          );
          const windowMatrix = new THREE.Matrix4();
          for (let w = 0; w < 6; w += 1) {
            const side = w % 2 === 0 ? -1 : 1;
            const inset = 1.2 + (w % 3) * 1.4;
            const wx = bx + side * (bw / 2 + 0.06);
            const wz = bz + (w % 2 === 0 ? 1 : -1) * inset;
            windowMatrix.compose(
              new THREE.Vector3(wx, bh * 0.55, wz),
              new THREE.Quaternion().setFromAxisAngle(
                new THREE.Vector3(0, 1, 0),
                side > 0 ? Math.PI / 2 : -Math.PI / 2,
              ),
              new THREE.Vector3(1, 1, 1),
            );
            chunkWindows[chunk].push(windowMatrix.clone());
          }
          buildingColliders.push({
            minX: bx - bw / 2,
            maxX: bx + bw / 2,
            minZ: bz - bd / 2,
            maxZ: bz + bd / 2,
          });
        }

        if (localRand() < 0.42) {
          const tx = x0 + (x1 - x0) * (0.2 + localRand() * 0.6);
          const tz = z0 + (z1 - z0) * (0.2 + localRand() * 0.6);
          const chunk = chunkIndexAt(tx, tz);
          chunkTrunks[chunk].push(
            new THREE.Matrix4().compose(
              new THREE.Vector3(tx, 1.35, tz),
              new THREE.Quaternion(),
              new THREE.Vector3(1, 1, 1),
            ),
          );
          chunkTrunkColors[chunk].push(
            new THREE.Color(0x6a4a2f).multiplyScalar(
              0.85 + localRand() * 0.3,
            ),
          );
          chunkFoliage[chunk].push(
            new THREE.Matrix4().compose(
              new THREE.Vector3(tx, 4.5, tz),
              new THREE.Quaternion(),
              new THREE.Vector3(1.8, 4.4, 1.8),
            ),
          );
          chunkFoliageColors[chunk].push(
            new THREE.Color(0x3f7d3a).multiplyScalar(
              0.85 + localRand() * 0.35,
            ),
          );
          treeColliders.push({ x: tx, z: tz, radius: 0.85 });
        }
      }
    }

    for (let cj = 0; cj < CHUNK_PER_SIDE; cj += 1) {
      for (let ci = 0; ci < CHUNK_PER_SIDE; ci += 1) {
        const chunkGroup = new THREE.Group();
        chunkGroup.name = `endless-chunk:${cx + ci - HALF_WINDOW}:${cz + cj - HALF_WINDOW}`;
        const index = cj * CHUNK_PER_SIDE + ci;
        const walls = chunkWalls[index];
        if (walls.length > 0) {
          const wallMesh = makeInstanced(
            new THREE.BoxGeometry(1, 1, 1),
            wallMat,
            walls.length,
          );
          wallMesh.name = 'endless-buildings';
          wallMesh.castShadow = true;
          wallMesh.receiveShadow = true;
          for (let i = 0; i < walls.length; i += 1) {
            wallMesh.setMatrixAt(i, walls[i]);
            wallMesh.setColorAt(i, chunkWallColors[index][i]);
          }
          wallMesh.instanceMatrix.needsUpdate = true;
          if (wallMesh.instanceColor) wallMesh.instanceColor.needsUpdate = true;
          chunkGroup.add(wallMesh);
        }
        const roofs = chunkRoofs[index];
        if (roofs.length > 0) {
          const roofMesh = makeInstanced(
            new THREE.BoxGeometry(1, 1, 1),
            roofMat,
            roofs.length,
          );
          roofMesh.name = 'endless-building-roofs';
          roofMesh.castShadow = true;
          roofMesh.receiveShadow = true;
          for (let i = 0; i < roofs.length; i += 1) {
            roofMesh.setMatrixAt(i, roofs[i]);
            roofMesh.setColorAt(i, chunkRoofColors[index][i]);
          }
          roofMesh.instanceMatrix.needsUpdate = true;
          if (roofMesh.instanceColor) roofMesh.instanceColor.needsUpdate = true;
          chunkGroup.add(roofMesh);
        }
        const windows = chunkWindows[index];
        if (windows.length > 0) {
          const windowMesh = makeInstanced(
            new THREE.BoxGeometry(0.8, 1.05, 0.12),
            windowMat,
            windows.length,
          );
          windowMesh.name = 'endless-building-windows';
          windowMesh.castShadow = false;
          windowMesh.receiveShadow = true;
          for (let i = 0; i < windows.length; i += 1) {
            windowMesh.setMatrixAt(i, windows[i]);
          }
          windowMesh.instanceMatrix.needsUpdate = true;
          chunkGroup.add(windowMesh);
        }
        const trunks = chunkTrunks[index];
        if (trunks.length > 0) {
          const trunkMesh = makeInstanced(
            new THREE.CylinderGeometry(0.2, 0.34, 2.7, 7),
            trunkMat,
            trunks.length,
          );
          trunkMesh.name = 'endless-tree-trunks';
          const foliageMesh = makeInstanced(
            new THREE.ConeGeometry(1.8, 4.4, 8),
            foliageMat,
            trunks.length,
          );
          foliageMesh.name = 'endless-tree-foliage';
          trunkMesh.castShadow = true;
          trunkMesh.receiveShadow = true;
          foliageMesh.castShadow = true;
          foliageMesh.receiveShadow = true;
          for (let i = 0; i < trunks.length; i += 1) {
            trunkMesh.setMatrixAt(i, trunks[i]);
            trunkMesh.setColorAt(i, chunkTrunkColors[index][i]);
            foliageMesh.setMatrixAt(i, chunkFoliage[index][i]);
            foliageMesh.setColorAt(i, chunkFoliageColors[index][i]);
          }
          trunkMesh.instanceMatrix.needsUpdate = true;
          if (trunkMesh.instanceColor) trunkMesh.instanceColor.needsUpdate = true;
          foliageMesh.instanceMatrix.needsUpdate = true;
          if (foliageMesh.instanceColor) {
            foliageMesh.instanceColor.needsUpdate = true;
          }
          chunkGroup.add(trunkMesh, foliageMesh);
        }
        chunks.push(chunkGroup);
        group.add(chunkGroup);
      }
    }

    const lampMatrices: THREE.Matrix4[] = [];
    for (const node of intersections) {
      lampMatrices.push(
        new THREE.Matrix4().compose(
          new THREE.Vector3(node.x + 9.5, 2.3, node.z + 9.5),
          new THREE.Quaternion(),
          new THREE.Vector3(1, 1, 1),
        ),
        new THREE.Matrix4().compose(
          new THREE.Vector3(node.x - 9.5, 2.3, node.z - 9.5),
          new THREE.Quaternion(),
          new THREE.Vector3(1, 1, 1),
        ),
      );
    }
    if (lampMatrices.length > 0) {
      const poles = makeInstanced(
        new THREE.CylinderGeometry(0.07, 0.1, 4.6, 5),
        poleMat,
        lampMatrices.length,
      );
      const heads = makeInstanced(
        new THREE.BoxGeometry(0.9, 0.22, 0.3),
        lampMat,
        lampMatrices.length,
      );
      for (let i = 0; i < lampMatrices.length; i += 1) {
        poles.setMatrixAt(i, lampMatrices[i]);
        const headMatrix = new THREE.Matrix4().copy(lampMatrices[i]);
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        headMatrix.decompose(position, quaternion, scale);
        headMatrix.compose(
          new THREE.Vector3(position.x, 4.62, position.z),
          quaternion,
          scale,
        );
        heads.setMatrixAt(i, headMatrix);
      }
      poles.instanceMatrix.needsUpdate = true;
      heads.instanceMatrix.needsUpdate = true;
      group.add(poles, heads);
    }

    if (startRelZ <= RIVER_REL_Z && endRelZ >= RIVER_REL_Z) {
      const riverSpan = endRelX - startRelX + RIVER_LEN_MARGIN * 2;
      river = new THREE.Mesh(
        new THREE.PlaneGeometry(riverSpan, WORLD.RIVER_WIDTH - 6),
        waterMat,
      );
      river.name = 'river';
      river.rotation.x = -Math.PI / 2;
      river.position.set(
        WORLD.SPAWN_X + (startRelX + endRelX) / 2,
        -0.14,
        WORLD.SPAWN_Z + RIVER_REL_Z,
      );
      river.receiveShadow = true;
      group.add(river);

      const riverbed = new THREE.Mesh(
        new THREE.BoxGeometry(riverSpan, 0.5, WORLD.RIVER_WIDTH - 6),
        new THREE.MeshStandardMaterial({ color: 0x6d5f47, roughness: 1 }),
      );
      riverbed.position.set(
        WORLD.SPAWN_X + (startRelX + endRelX) / 2,
        -0.62,
        WORLD.SPAWN_Z + RIVER_REL_Z,
      );
      group.add(riverbed);

      for (let i = 0; i < nodeCount; i += 1) {
        const relX = startRelX + i * BLOCK;
        const bridge = new THREE.Mesh(
          new THREE.BoxGeometry(WORLD.ROAD_WIDTH, 0.22, 72),
          asphaltMat,
        );
        bridge.position.set(
          WORLD.SPAWN_X + relX,
          0.16,
          WORLD.SPAWN_Z + RIVER_REL_Z,
        );
        bridge.name = 'bridge';
        bridge.receiveShadow = true;
        group.add(bridge);
        for (const side of [-1, 1]) {
          const rail = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 1.1, 72),
            poleMat,
          );
          rail.position.set(
            WORLD.SPAWN_X + relX + side * (WORLD.ROAD_WIDTH / 2 + 1.1),
            0.75,
            WORLD.SPAWN_Z + RIVER_REL_Z,
          );
          group.add(rail);
        }
      }
    }

  };

  const updateChunks = (px: number, pz: number): void => {
    const relX = px - WORLD.SPAWN_X;
    const relZ = pz - WORLD.SPAWN_Z;
    const cx = Math.round(relX / CHUNK);
    const cz = Math.round(relZ / CHUNK);
    if (cx === centerCX && cz === centerCZ) return;
    centerCX = cx;
    centerCZ = cz;
    rebuild(cx, cz);
  };

  const updateWater = (timeSec: number): void => {
    if (!river) return;
    river.position.y = -0.14 + Math.sin(timeSec * 0.9) * 0.025;
    waterMat.opacity = 0.84 + Math.sin(timeSec * 1.4) * 0.06;
  };

  const raceProps = new THREE.Group();
  raceProps.name = 'race-props';
  raceProps.visible = false;
  group.add(raceProps);

  const city: City = {
    group,
    chunks,
    intersections,
    edges,
    lanes,
    buildingColliders,
    treeColliders,
    raceBarriers: [],
    raceCheckpoints: [],
    raceStartSlots: [],
    raceStartHeading: Math.PI / 2,
    bounds: {
      minX: -1000000,
      maxX: 1000000,
      minZ: -1000000,
      maxZ: 1000000,
    },
    raceProps,
    revision: 0,
    setRacePropsVisible: (_visible: boolean): void => undefined,
    lightGreen: (axis: 'x' | 'z', timeSec: number, nodeIndex: number): boolean => {
      const offset = (nodeIndex % 7) * 1.6;
      const t = (timeSec + offset) % WORLD.LIGHT_CYCLE;
      return axis === 'x' ? t < WORLD.LIGHT_GREEN : t >= WORLD.LIGHT_YELLOW_START;
    },
    updateSignals: (_timeSec: number): void => undefined,
    updateWater,
    updateChunks,
  };

  updateChunks(WORLD.SPAWN_X, WORLD.SPAWN_Z);
  scene.add(group);
  return city;
}
