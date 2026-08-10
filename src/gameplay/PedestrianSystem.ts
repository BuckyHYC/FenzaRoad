import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { DENSITY_CONFIG, PEDESTRIAN_CONFIG } from '../core/Constants';
import { gameState } from '../core/GameState';
import type { City } from '../level/CityBuilder';
import {
  buildCircleGrid,
  queryCircleGrid,
  type CircleGrid,
} from './SpatialGrid';

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
// 只收录拟真行人模型，每个行人生成时从列表中随机挑选一个。
const PEDESTRIAN_MODEL_URLS = [
  '/models/pedestrians/michelle.glb',
];
const EXTERNAL_MODEL_HEIGHT = 1.7;

interface PedestrianBones {
  leftLeg: THREE.Bone[];
  rightLeg: THREE.Bone[];
  leftArm: THREE.Bone[];
  rightArm: THREE.Bone[];
  leftForearm: THREE.Bone[];
  rightForearm: THREE.Bone[];
  armPose?: PedestrianArmPose;
}

interface PedestrianArmPose {
  leftShoulder: THREE.Bone;
  rightShoulder: THREE.Bone;
  leftBind: THREE.Quaternion;
  rightBind: THREE.Quaternion;
  leftParentLocal: THREE.Quaternion;
  rightParentLocal: THREE.Quaternion;
  leftParentLocalInv: THREE.Quaternion;
  rightParentLocalInv: THREE.Quaternion;
  leftBaseLocal: THREE.Quaternion;
  rightBaseLocal: THREE.Quaternion;
}

const materialCache = new Map<string, THREE.Material>();
const partGeometryCache = new Map<string, THREE.BufferGeometry>();
const pedestrianGltfCache = new Map<string, Promise<THREE.Group>>();
const pedestrianFitCache = new Map<
  string,
  { scale: number; centerX: number; centerZ: number; minY: number }
>();

function loadPedestrianScene(url: string): Promise<THREE.Group> {
  let pending = pedestrianGltfCache.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => resolve(gltf.scene),
        undefined,
        (error) => reject(error),
      );
    });
    pedestrianGltfCache.set(url, pending);
  }
  return pending;
}

function pickPedestrianModelUrl(): string {
  return PEDESTRIAN_MODEL_URLS[Math.floor(Math.random() * PEDESTRIAN_MODEL_URLS.length)];
}

const armSwingAxis = new THREE.Vector3(1, 0, 0);
const armSwayAxis = new THREE.Vector3(0, 0, 1);
const armPoseScratchA = new THREE.Quaternion();
const armPoseScratchB = new THREE.Quaternion();
const armPoseScratchC = new THREE.Quaternion();

function buildArmPoseForShoulder(
  root: THREE.Object3D,
  rootInv: THREE.Matrix4,
  shoulder: THREE.Bone,
): { parentLocal: THREE.Quaternion; parentLocalInv: THREE.Quaternion; baseLocal: THREE.Quaternion } {
  const upper =
    shoulder.children.find((child): child is THREE.Bone => child instanceof THREE.Bone) ??
    shoulder;
  const shoulderPos = new THREE.Vector3()
    .setFromMatrixPosition(shoulder.matrixWorld)
    .applyMatrix4(rootInv);
  const upperPos = new THREE.Vector3()
    .setFromMatrixPosition(upper.matrixWorld)
    .applyMatrix4(rootInv);
  const restDir = upperPos.sub(shoulderPos).normalize();
  const down = new THREE.Vector3(0, -1, 0);
  const baseWorld = new THREE.Quaternion().setFromUnitVectors(restDir, down);
  const parentWorld = new THREE.Quaternion()
    .setFromRotationMatrix(shoulder.parent!.matrixWorld)
    .normalize();
  const rootWorld = new THREE.Quaternion()
    .setFromRotationMatrix(root.matrixWorld)
    .normalize();
  const parentLocal = rootWorld.clone().invert().multiply(parentWorld);
  const parentLocalInv = parentLocal.clone().invert();
  const baseLocal = parentLocalInv.clone().multiply(baseWorld).multiply(parentLocal);
  return { parentLocal, parentLocalInv, baseLocal };
}

function buildArmPose(root: THREE.Object3D, bones: PedestrianBones): void {
  const leftShoulder = bones.leftArm[0];
  const rightShoulder = bones.rightArm[0];
  if (!leftShoulder || !rightShoulder) return;
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const left = buildArmPoseForShoulder(root, rootInv, leftShoulder);
  const right = buildArmPoseForShoulder(root, rootInv, rightShoulder);
  bones.armPose = {
    leftShoulder,
    rightShoulder,
    leftBind: leftShoulder.quaternion.clone(),
    rightBind: rightShoulder.quaternion.clone(),
    leftParentLocal: left.parentLocal,
    rightParentLocal: right.parentLocal,
    leftParentLocalInv: left.parentLocalInv,
    rightParentLocalInv: right.parentLocalInv,
    leftBaseLocal: left.baseLocal,
    rightBaseLocal: right.baseLocal,
  };
}

function collectPedestrianBones(root: THREE.Object3D): PedestrianBones {
  const bones: PedestrianBones = {
    leftLeg: [],
    rightLeg: [],
    leftArm: [],
    rightArm: [],
    leftForearm: [],
    rightForearm: [],
  };
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!(node instanceof THREE.Bone)) return;
    const name = node.name.toLowerCase();
    const isLeft = name.includes('left');
    const isRight = name.includes('right');
    if (
      /(forearm|lowerarm|lower_arm)/.test(name) ||
      (name.includes('arm') && name.includes('fore'))
    ) {
      if (isLeft) bones.leftForearm.push(node);
      else if (isRight) bones.rightForearm.push(node);
      return;
    }
    if (
      /(upleg|thigh|upperleg|upper_leg)/.test(name) ||
      (name.includes('leg') && name.includes('upper'))
    ) {
      if (isLeft) bones.leftLeg.push(node);
      else if (isRight) bones.rightLeg.push(node);
      return;
    }
    if (
      /(shoulder|upperarm|upper_arm)/.test(name) ||
      (/arm$/.test(name) && !name.includes('fore'))
    ) {
      if (isLeft) bones.leftArm.push(node);
      else if (isRight) bones.rightArm.push(node);
    }
  });
  buildArmPose(root, bones);
  return bones;
}

function resetPedestrianBones(bones: PedestrianBones | undefined): void {
  if (!bones) return;
  if (bones.armPose) {
    bones.armPose.leftShoulder.quaternion.copy(bones.armPose.leftBind);
    bones.armPose.rightShoulder.quaternion.copy(bones.armPose.rightBind);
  }
  for (const list of [
    bones.leftLeg,
    bones.rightLeg,
    bones.leftArm,
    bones.rightArm,
    bones.leftForearm,
    bones.rightForearm,
  ]) {
    for (const bone of list) {
      bone.rotation.x = 0;
      bone.rotation.z = 0;
    }
  }
}

function animatePedestrianArms(
  bones: PedestrianBones,
  stride: number,
  armAmp: number,
): void {
  const pose = bones.armPose;
  const leftSwing = -stride * armAmp;
  const rightSwing = stride * armAmp;
  const sway = Math.sin(stride) * 0.05;
  if (pose) {
    const applyShoulder = (
      shoulder: THREE.Bone,
      bind: THREE.Quaternion,
      parentLocal: THREE.Quaternion,
      parentLocalInv: THREE.Quaternion,
      baseLocal: THREE.Quaternion,
      swing: number,
      sideSway: number,
    ): void => {
      armPoseScratchA.setFromAxisAngle(armSwingAxis, swing);
      armPoseScratchB.copy(parentLocalInv).multiply(armPoseScratchA).multiply(parentLocal);
      armPoseScratchC.copy(armPoseScratchB);
      armPoseScratchA.setFromAxisAngle(armSwayAxis, sideSway);
      armPoseScratchB.copy(parentLocalInv).multiply(armPoseScratchA).multiply(parentLocal);
      armPoseScratchC
        .multiply(armPoseScratchB)
        .multiply(baseLocal)
        .multiply(bind);
      shoulder.quaternion.copy(armPoseScratchC);
    };
    applyShoulder(
      pose.leftShoulder,
      pose.leftBind,
      pose.leftParentLocal,
      pose.leftParentLocalInv,
      pose.leftBaseLocal,
      leftSwing,
      sway,
    );
    applyShoulder(
      pose.rightShoulder,
      pose.rightBind,
      pose.rightParentLocal,
      pose.rightParentLocalInv,
      pose.rightBaseLocal,
      rightSwing,
      -sway,
    );
  } else {
    if (bones.leftArm[0]) bones.leftArm[0].rotation.x = leftSwing;
    if (bones.rightArm[0]) bones.rightArm[0].rotation.x = rightSwing;
  }
}

function animatePedestrianBones(
  bones: PedestrianBones | undefined,
  stride: number,
  amplitude: number,
): void {
  if (!bones) return;
  const legAmp = amplitude * 0.85;
  const armAmp = amplitude * 0.62;
  if (bones.leftLeg[0]) bones.leftLeg[0].rotation.x = stride * legAmp;
  if (bones.rightLeg[0]) bones.rightLeg[0].rotation.x = -stride * legAmp;
  animatePedestrianArms(bones, stride, armAmp);
  // 手臂前摆时肘部自然弯曲，后摆时伸直。
  const leftElbow = Math.max(0, -stride) * armAmp * 0.55;
  const rightElbow = Math.max(0, stride) * armAmp * 0.55;
  if (bones.leftForearm[0]) bones.leftForearm[0].rotation.x = leftElbow;
  if (bones.rightForearm[0]) bones.rightForearm[0].rotation.x = rightElbow;
}

function measureExternalBounds(root: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const out = new THREE.Vector3();
  const temp = new THREE.Vector3();
  const skinMatrix = new THREE.Matrix4();
  let measured = false;
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!(node instanceof THREE.SkinnedMesh)) return;
    const geometry = node.geometry;
    const position = geometry.attributes.position;
    const skinIndex = geometry.attributes.skinIndex;
    const skinWeight = geometry.attributes.skinWeight;
    const skeleton = node.skeleton;
    if (!position || !skinIndex || !skinWeight || !skeleton) return;
    measured = true;
    for (let i = 0; i < position.count; i += 1) {
      v.set(position.getX(i), position.getY(i), position.getZ(i));
      out.set(0, 0, 0);
      for (let j = 0; j < 4; j += 1) {
        const weight = skinWeight.getComponent(i, j);
        if (weight <= 0) continue;
        const boneIndex = skinIndex.getComponent(i, j);
        const bone = skeleton.bones[boneIndex];
        const inverse = skeleton.boneInverses[boneIndex];
        if (!bone || !inverse) continue;
        skinMatrix.multiplyMatrices(bone.matrixWorld, inverse);
        out.addScaledVector(temp.copy(v).applyMatrix4(skinMatrix), weight);
      }
      box.expandByPoint(out);
    }
  });
  if (!measured) {
    box.setFromObject(root);
  }
  return box;
}

function fitExternalRoot(root: THREE.Object3D): {
  scale: number;
  centerX: number;
  centerZ: number;
  minY: number;
} {
  const natural = measureExternalBounds(root);
  const size = natural.getSize(new THREE.Vector3());
  if (size.y < 1e-4) {
    return { scale: 1, centerX: 0, centerZ: 0, minY: 0 };
  }
  const scale = EXTERNAL_MODEL_HEIGHT / size.y;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  const fitted = measureExternalBounds(root);
  const center = fitted.getCenter(new THREE.Vector3());
  return {
    scale,
    centerX: center.x,
    centerZ: center.z,
    minY: fitted.min.y,
  };
}

async function attachPedestrianModel(group: THREE.Group): Promise<void> {
  const url = pickPedestrianModelUrl();
  try {
    const source = await loadPedestrianScene(url);
    const root = cloneSkeleton(source);
    let fit = pedestrianFitCache.get(url);
    if (!fit) {
      fit = fitExternalRoot(root);
      pedestrianFitCache.set(url, fit);
    }
    root.scale.setScalar(fit.scale);
    root.position.x -= fit.centerX;
    root.position.z -= fit.centerZ;
    root.position.y -= fit.minY;
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = false;
      }
    });
    group.userData.externalRoot = root;
    group.userData.modelUrl = url;
    group.userData.fitScale = fit.scale;
    group.userData.bones = collectPedestrianBones(root);
    group.userData.proceduralModel.visible = false;
    group.add(root);
  } catch {
    // Keep the procedural pedestrian when the model is unavailable.
  }
}

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
  const skinColor = ['#e8b88e', '#c98d5f', '#a96f45', '#f0c9a0'][
    Math.floor(Math.random() * 4)
  ];
  const hairColor = ['#241a12', '#3a2b1d', '#5a4632', '#241f26', '#8a4b2a'][
    Math.floor(Math.random() * 5)
  ];
  const group = new THREE.Group();
  const model = new THREE.Group();
  model.scale.setScalar(PEDESTRIAN_CONFIG.MODEL_SCALE);

  const skinMat = material(
    `ped-skin:${skinColor}`,
    () => new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.72 }),
  );
  const hairMat = material(
    `ped-hair:${hairColor}`,
    () => new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.9 }),
  );

  const torsoGeo = geometry(
    'ped-torso',
    () => new THREE.CapsuleGeometry(0.2, 0.3, 4, 8),
  );
  const body = new THREE.Mesh(
    torsoGeo,
    material(
      `ped-shirt:${shirtColor}`,
      () => new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.85 }),
    ),
  );
  body.rotation.z = 0.06;
  body.position.y = 0.95;
  body.castShadow = true;

  const legGeo = geometry('ped-leg', () => new THREE.CapsuleGeometry(0.07, 0.34, 4, 6));
  const legMat = material(
    `ped-pants:${pantsColor}`,
    () => new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.9 }),
  );
  const shoeGeo = geometry(
    'ped-shoe',
    () => new THREE.BoxGeometry(0.1, 0.08, 0.2),
  );
  const shoeMat = material(
    'ped-shoe',
    () => new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.85 }),
  );
  const leftLegPivot = new THREE.Group();
  leftLegPivot.position.set(-0.11, 0.66, 0.02);
  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(0, -0.26, 0);
  leftLeg.castShadow = true;
  const leftShoe = new THREE.Mesh(shoeGeo, shoeMat);
  leftShoe.position.set(0, -0.48, 0.05);
  leftShoe.castShadow = true;
  leftLegPivot.add(leftLeg, leftShoe);

  const rightLegPivot = new THREE.Group();
  rightLegPivot.position.set(0.11, 0.66, 0.02);
  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0, -0.26, 0);
  rightLeg.castShadow = true;
  const rightShoe = new THREE.Mesh(shoeGeo, shoeMat);
  rightShoe.position.set(0, -0.48, 0.05);
  rightShoe.castShadow = true;
  rightLegPivot.add(rightLeg, rightShoe);

  const armGeo = geometry('ped-arm', () => new THREE.CapsuleGeometry(0.055, 0.24, 4, 6));
  const armMat = material(
    `ped-shirt:${shirtColor}`,
    () => new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.85 }),
  );
  const armPivot = new THREE.Group();
  armPivot.position.set(0, 1.16, -0.02);
  const leftArmPivot = new THREE.Group();
  leftArmPivot.position.set(-0.27, 0, 0);
  const rightArmPivot = new THREE.Group();
  rightArmPivot.position.set(0.27, 0, 0);
  const leftArm = new THREE.Mesh(armGeo, armMat);
  leftArm.position.set(0, -0.17, 0);
  leftArm.castShadow = true;
  const rightArm = new THREE.Mesh(armGeo, armMat);
  rightArm.position.set(0, -0.17, 0);
  rightArm.castShadow = true;
  leftArmPivot.add(leftArm);
  rightArmPivot.add(rightArm);
  armPivot.add(leftArmPivot, rightArmPivot);

  const headGeo = geometry(
    'ped-head',
    () => new THREE.SphereGeometry(0.15, 12, 10),
  );
  const head = new THREE.Mesh(headGeo, skinMat);
  head.position.y = 0.02;
  head.castShadow = true;
  const hairGeo = geometry(
    'ped-hair',
    () => new THREE.SphereGeometry(0.155, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62),
  );
  const hair = new THREE.Mesh(hairGeo, hairMat);
  hair.position.y = 0.09;
  hair.scale.y = 0.82;
  const headGroup = new THREE.Group();
  headGroup.position.y = 1.32;
  headGroup.add(head, hair);

  model.add(body, leftLegPivot, rightLegPivot, armPivot, headGroup);
  group.add(model);
  group.userData.proceduralModel = model;
  group.userData.leftLegPivot = leftLegPivot;
  group.userData.rightLegPivot = rightLegPivot;
  group.userData.armPivot = armPivot;
  group.userData.leftArmPivot = leftArmPivot;
  group.userData.rightArmPivot = rightArmPivot;
  group.userData.headGroup = headGroup;
  void attachPedestrianModel(group);
  return group;
}

export class PedestrianSystem {
  private readonly pedestrians: Pedestrian[] = [];
  private city: City;
  private readonly scene: THREE.Scene;
  private treeGrid: CircleGrid | null = null;
  private treeGridCity: City | null = null;
  private treeGridRevision = -1;
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
    this.treeGrid = null;
    this.treeGridCity = null;
    this.treeGridRevision = -1;
    this.clear();
  }

  rebindCity(): void {
    for (let i = this.pedestrians.length - 1; i >= 0; i -= 1) {
      if (!this.rebindPedestrian(this.pedestrians[i])) {
        this.scene.remove(this.pedestrians[i].group);
        this.pedestrians.splice(i, 1);
      }
    }
  }

  private rebindPedestrian(ped: Pedestrian): boolean {
    const x = ped.x;
    const z = ped.z;
    let bestDist = Infinity;
    let best:
      | {
          edgeId: number;
          fromNode: number;
          toNode: number;
          t: number;
          lateral: number;
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
      if (dist < bestDist && Math.abs(lateral) <= 13) {
        bestDist = dist;
        best = {
          edgeId: edge.id,
          fromNode: edge.from,
          toNode: edge.to,
          t,
          lateral,
        };
      }
    }
    if (!best || bestDist > 15) return false;
    ped.edgeId = best.edgeId;
    ped.fromNode = best.fromNode;
    ped.toNode = best.toNode;
    ped.t = best.t;
    ped.side = best.lateral >= 0 ? 1 : -1;
    ped.jitter = Math.max(
      -2.5,
      Math.min(2.5, Math.abs(best.lateral) - PEDESTRIAN_CONFIG.SIDEWALK_OFFSET),
    );
    ped.moving = true;
    ped.pauseTimer = 0;
    return true;
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
    ped.phase += dt * 5.2 * (0.75 + ped.speed * 0.3);
    this.ensureTreeGrid();
    for (const tree of queryCircleGrid(
      this.treeGrid as CircleGrid,
      ped.x,
      ped.z,
      3,
    )) {
      const tdx = ped.x - tree.x;
      const tdz = ped.z - tree.z;
      const minDist = ped.radius + tree.radius;
      const distSq = tdx * tdx + tdz * tdz;
      if (distSq >= minDist * minDist || distSq < 1e-6) continue;
      const dist = Math.sqrt(distSq);
      ped.x += (tdx / dist) * (minDist - dist);
      ped.z += (tdz / dist) * (minDist - dist);
    }
  }

  private ensureTreeGrid(): void {
    if (
      this.treeGridCity === this.city &&
      this.treeGridRevision === this.city.revision &&
      this.treeGrid
    ) {
      return;
    }
    this.treeGrid = buildCircleGrid(this.city.treeColliders, 28);
    this.treeGridCity = this.city;
    this.treeGridRevision = this.city.revision;
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
      group.userData.leftLegPivot.rotation.x = 0;
      group.userData.rightLegPivot.rotation.x = 0;
      group.userData.armPivot.rotation.x = 0;
      group.userData.leftArmPivot.rotation.x = 0;
      group.userData.rightArmPivot.rotation.x = 0;
      group.userData.headGroup.rotation.z = 0;
      resetPedestrianBones(group.userData.bones as PedestrianBones | undefined);
    } else {
      const stride = ped.moving ? Math.sin(ped.phase) : 0;
      const amplitude = ped.moving ? 0.62 : 0;
      animatePedestrianBones(
        group.userData.bones as PedestrianBones | undefined,
        stride,
        amplitude,
      );
      group.userData.leftLegPivot.rotation.x = stride * amplitude;
      group.userData.rightLegPivot.rotation.x = -stride * amplitude;
      group.userData.armPivot.rotation.x = 0;
      group.userData.leftArmPivot.rotation.x = -stride * amplitude * 0.55;
      group.userData.rightArmPivot.rotation.x = stride * amplitude * 0.55;
      group.userData.leftLegPivot.rotation.z = ped.moving ? 0.06 : 0;
      group.userData.rightLegPivot.rotation.z = ped.moving ? -0.06 : 0;
      group.userData.headGroup.rotation.z = Math.sin(ped.phase * 0.5) * 0.08;
      group.userData.headGroup.rotation.x = ped.moving
        ? Math.max(0, Math.sin(ped.phase)) * 0.08
        : 0;
      group.position.set(ped.x, 0, ped.z);
      group.rotation.set(
        ped.moving ? Math.abs(Math.cos(ped.phase)) * 0.035 : 0,
        ped.heading,
        ped.moving ? Math.sin(ped.phase) * 0.025 : 0,
      );
      group.scale.setScalar(1);
    }
    const externalRoot = group.userData.externalRoot as THREE.Group | undefined;
    if (externalRoot) {
      externalRoot.position.y = Math.abs(Math.sin(ped.phase)) * 0.05;
      externalRoot.rotation.x = ped.moving ? Math.sin(ped.phase) * 0.05 : 0;
      externalRoot.rotation.z = ped.moving ? Math.cos(ped.phase) * 0.04 : 0;
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
