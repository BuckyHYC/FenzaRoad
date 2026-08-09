import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLORS, RACE_CONFIG, TREE_COLLIDER_RADIUS, WORLD } from '../core/Constants';
import type { Aabb, CircleCollider, LaneInfo } from '../core/types';

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
  treeColliders: CircleCollider[];
  raceBarriers: Aabb[];
  raceCheckpoints: THREE.Vector3[];
  raceStartSlots: THREE.Vector3[];
  raceStartHeading: number;
  bounds: Aabb;
  raceProps: THREE.Group;
  setRacePropsVisible(visible: boolean): void;
  lightGreen(axis: 'x' | 'z', timeSec: number, nodeIndex: number): boolean;
  updateSignals(timeSec: number): void;
  updateChunks(px: number, pz: number): void;
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

function makeInstanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  count: number,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  return mesh;
}

export function buildCity(scene: THREE.Scene): City {
  const group = new THREE.Group();
  const N = WORLD.GRID_SIZE;
  const B = WORLD.BLOCK_LENGTH;
  const rand = mulberry32(WORLD.CITY_SEED);

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
    } else {
      roadParts.push(transformedBox(WORLD.ROAD_WIDTH, 0.14, B, midX, 0.06, midZ));
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

  const roadGeometry = mergeGeometries(roadParts);
  const sidewalkGeometry = mergeGeometries(sidewalkParts);
  const markingGeometry = mergeGeometries(markingParts);
  if (roadGeometry) {
    const road = new THREE.Mesh(
      roadGeometry,
      new THREE.MeshStandardMaterial({ color: COLORS.ROAD, roughness: 0.9 }),
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

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2600, 2600),
    new THREE.MeshStandardMaterial({ color: COLORS.GROUND, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  group.add(ground);

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
  const treeColliders: CircleCollider[] = [];
  const inset = WORLD.BUILDING_INSET;
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const x0 = i * B + inset;
      const x1 = (i + 1) * B - inset;
      const z0 = j * B + inset;
      const z1 = (j + 1) * B - inset;
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
      treeTrunkData[chunkIndexAt(px, pz)].push({
        x: px,
        z: pz,
        scale: 0.8 + rand() * 0.7,
      });
      treeColliders.push({ x: px, z: pz, radius: TREE_COLLIDER_RADIUS });
    }
  }

  const lampPositions: { x: number; z: number }[][] = Array.from(
    { length: CHUNK_COUNT },
    () => [],
  );
  for (const node of intersections) {
    lampPositions[chunkIndexAt(node.x + 9.5, node.z + 9.5)].push({
      x: node.x + 9.5,
      z: node.z + 9.5,
    });
    lampPositions[chunkIndexAt(node.x - 9.5, node.z - 9.5)].push({
      x: node.x - 9.5,
      z: node.z - 9.5,
    });
  }

  const signalInstances: {
    x: number;
    z: number;
    axis: 'x' | 'z';
  }[][] = Array.from({ length: CHUNK_COUNT }, () => []);
  for (const node of intersections) {
    signalInstances[chunkIndexAt(node.x - 6.5, node.z + 6.5)].push({
      x: node.x - 6.5,
      z: node.z + 6.5,
      axis: 'x',
    });
    signalInstances[chunkIndexAt(node.x + 6.5, node.z - 6.5)].push({
      x: node.x + 6.5,
      z: node.z - 6.5,
      axis: 'z',
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
  const redSignalMaterial = new THREE.MeshBasicMaterial({ color: 0xd33a2c });
  const greenSignalMaterial = new THREE.MeshBasicMaterial({ color: 0x2fbf4f });
  const signalChunks: {
    red: THREE.InstancedMesh;
    green: THREE.InstancedMesh;
    instances: { x: number; z: number; axis: 'x' | 'z' }[];
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
      buildingMesh.receiveShadow = true;
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
      roofMesh.receiveShadow = true;
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

    const chunkLamps = lampPositions[c];
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

      const redSignals = makeInstanced(
        new THREE.BoxGeometry(0.55, 0.75, 0.55),
        redSignalMaterial,
        chunkSignals.length,
      );
      const greenSignals = makeInstanced(
        new THREE.BoxGeometry(0.55, 0.75, 0.55),
        greenSignalMaterial,
        chunkSignals.length,
      );
      chunkGroup.add(redSignals);
      chunkGroup.add(greenSignals);
      signalChunks.push({ red: redSignals, green: greenSignals, instances: chunkSignals });
    }
    chunks.push(chunkGroup);
  }
  group.add(...chunks);

  const signalMatrix = new THREE.Matrix4();
  const updateSignals = (timeSec: number): void => {
    for (const signalChunk of signalChunks) {
      for (let i = 0; i < signalChunk.instances.length; i += 1) {
        const signal = signalChunk.instances[i];
        const nodeIndex = intersections.findIndex(
          (n) => Math.abs(n.x - signal.x) < 7 && Math.abs(n.z - signal.z) < 7,
        );
        const green = lightGreenFor(signal.axis, timeSec, nodeIndex);
        signalMatrix.compose(
          new THREE.Vector3(signal.x, 4.7, signal.z),
          new THREE.Quaternion(),
          new THREE.Vector3(1, green ? 0 : 1, 1),
        );
        signalChunk.red.setMatrixAt(i, signalMatrix);
        signalMatrix.compose(
          new THREE.Vector3(signal.x, 4.7, signal.z),
          new THREE.Quaternion(),
          new THREE.Vector3(1, green ? 1 : 0, 1),
        );
        signalChunk.green.setMatrixAt(i, signalMatrix);
      }
      signalChunk.red.instanceMatrix.needsUpdate = true;
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

  const raceProps = new THREE.Group();
  raceProps.name = 'race-props';

  const startI = Math.floor(N / 2);
  const checkpoints: THREE.Vector3[] = [];
  const at = (x: number, z: number): THREE.Vector3 => new THREE.Vector3(x, 0, z);
  for (let i = startI; i <= N; i += 1) checkpoints.push(at(i * B, N * B));
  for (let j = N - 1; j >= 0; j -= 1) checkpoints.push(at(N * B, j * B));
  for (let i = N - 1; i >= 0; i -= 1) checkpoints.push(at(i * B, 0));
  for (let j = 1; j < N; j += 1) checkpoints.push(at(0, j * B));
  for (let i = 0; i < startI; i += 1) checkpoints.push(at(i * B, N * B));

  const raceBarriers: Aabb[] = [];
  const blockLength = 4.2;
  const barrierMatrices: THREE.Matrix4[] = [];
  const barrierColors: THREE.Color[] = [];
  const startGapMin = startI * B - 31;
  const startGapMax = startI * B + 31;
  for (let ci = 0; ci < checkpoints.length; ci += 1) {
    const a = checkpoints[ci];
    const b = checkpoints[(ci + 1) % checkpoints.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;
    const cross = dx * nz - dz * nx;
    for (const side of cross > 0 ? [1, -1] : [-1, 1]) {
      const bx = a.x + nx * (side * RACE_CONFIG.BARRIER_OFFSET);
      const bz = a.z + nz * (side * RACE_CONFIG.BARRIER_OFFSET);
      let start = 0;
      let end = len;
      if (ci === 0 && side === 1) {
        const gapA = startGapMin - (a.x * ux + a.z * uz);
        const gapB = startGapMax - (a.x * ux + a.z * uz);
        if (gapA > start && gapA < end) end = Math.min(end, gapA);
        if (gapB > start && gapB < end) start = Math.max(start, gapB);
      }
      if (end - start < 2) continue;
      const lowX = bx + ux * start;
      const lowZ = bz + uz * start;
      const highX = bx + ux * end;
      const highZ = bz + uz * end;
      raceBarriers.push({
        minX: Math.min(lowX, highX) - RACE_CONFIG.BARRIER_WIDTH / 2 - RACE_CONFIG.BARRIER_EXTRA,
        maxX: Math.max(lowX, highX) + RACE_CONFIG.BARRIER_WIDTH / 2 + RACE_CONFIG.BARRIER_EXTRA,
        minZ: Math.min(lowZ, highZ) - RACE_CONFIG.BARRIER_WIDTH / 2 - RACE_CONFIG.BARRIER_EXTRA,
        maxZ: Math.max(lowZ, highZ) + RACE_CONFIG.BARRIER_WIDTH / 2 + RACE_CONFIG.BARRIER_EXTRA,
      });
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
            new THREE.Vector3(Math.min(blockLength, end - t), RACE_CONFIG.BARRIER_HEIGHT, RACE_CONFIG.BARRIER_WIDTH),
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
          new THREE.Vector3(length, RACE_CONFIG.BARRIER_HEIGHT, RACE_CONFIG.BARRIER_WIDTH),
        ),
      );
      barrierColors.push(new THREE.Color(ci % 2 === 0 ? 0xd9342f : 0xe8e8e8));
      const half = RACE_CONFIG.BARRIER_WIDTH / 2 + RACE_CONFIG.BARRIER_EXTRA;
      if (rotationY === 0) {
        raceBarriers.push({
          minX: x - length / 2 - RACE_CONFIG.BARRIER_EXTRA,
          maxX: x + length / 2 + RACE_CONFIG.BARRIER_EXTRA,
          minZ: z - half,
          maxZ: z + half,
        });
      } else {
        raceBarriers.push({
          minX: x - half,
          maxX: x + half,
          minZ: z - length / 2 - RACE_CONFIG.BARRIER_EXTRA,
          maxZ: z + length / 2 + RACE_CONFIG.BARRIER_EXTRA,
        });
      }
    };
    const mouthLen = WORLD.ROAD_WIDTH + WORLD.SIDEWALK_WIDTH * 2 + 2;
    const p = a;
    if (Math.abs(p.z - N * B) < 0.1 && p.x > B - 0.1 && p.x < N * B - 0.1) {
      mouthBarrier(p.x, N * B - 10, 0, mouthLen);
    } else if (Math.abs(p.x - N * B) < 0.1 && p.z > B - 0.1 && p.z < N * B - 0.1) {
      mouthBarrier(N * B - 10, p.z, Math.PI / 2, mouthLen);
    } else if (Math.abs(p.z) < 0.1 && p.x > B - 0.1 && p.x < N * B - 0.1) {
      mouthBarrier(p.x, 10, 0, mouthLen);
    } else if (Math.abs(p.x) < 0.1 && p.z > B - 0.1 && p.z < N * B - 0.1) {
      mouthBarrier(10, p.z, Math.PI / 2, mouthLen);
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
    raceProps.add(barrierMesh);
  }

  const poleMatrices: THREE.Matrix4[] = [];
  const flagMatrices: THREE.Matrix4[] = [];
  const flagColors: THREE.Color[] = [];
  const flagPalette = [0xd9342f, 0x2f6fd0, 0x2f9e4f, 0xe0a63a];
  for (let ci = 0; ci < checkpoints.length; ci += 1) {
    const p = checkpoints[ci];
    const q = checkpoints[(ci + 1) % checkpoints.length];
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const len = Math.hypot(dx, dz);
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;
    const heading = Math.atan2(ux, uz);
    for (const side of [-1, 1]) {
      const fx = p.x + nx * (side * RACE_CONFIG.FLAG_OFFSET);
      const fz = p.z + nz * (side * RACE_CONFIG.FLAG_OFFSET);
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
    raceProps.add(flagPoles);

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
    raceProps.add(flagMesh);
  }
  raceProps.visible = false;
  group.add(raceProps);
  const setRacePropsVisible = (visible: boolean): void => {
    raceProps.visible = visible;
  };

  const raceStartSlots: THREE.Vector3[] = [];
  for (let k = 0; k < RACE_CONFIG.TOTAL_RACERS; k += 1) {
    const x = startI * B - 30 - k * 11;
    const z = N * B + (k % 2 === 0 ? -3.5 : 3.5);
    raceStartSlots.push(at(x, z));
  }

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

  const city: City = {
    group,
    chunks,
    intersections,
    edges,
    lanes,
    buildingColliders,
    treeColliders,
    raceBarriers,
    raceCheckpoints: checkpoints,
    raceStartSlots,
    raceStartHeading: Math.PI / 2,
    bounds: { minX: -40, maxX: N * B + 40, minZ: -40, maxZ: N * B + 40 },
    raceProps,
    setRacePropsVisible,
    lightGreen: lightGreenFor,
    updateSignals,
    updateChunks,
  };

  scene.add(group);
  return city;
}
