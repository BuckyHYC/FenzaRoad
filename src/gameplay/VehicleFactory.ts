import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { BodyStyle, VehicleSpec } from '../core/types';

export interface VehicleVisuals {
  group: THREE.Group;
  frontLeftPivot: THREE.Group;
  frontRightPivot: THREE.Group;
  wheels: THREE.Group[];
  glassMesh: THREE.Mesh | null;
  steeringWheel: THREE.Group | null;
  modelRoot: THREE.Group | null;
  bodyParts: Map<string, THREE.Object3D>;
}

interface CabinProfile {
  widthRatio: number;
  lengthRatio: number;
  heightRatio: number;
  zOffset: number;
}

interface StyleProfile {
  bodyFrontTaper: number;
  bodyRearTaper: number;
  bodyRadius: number;
  cabin: CabinProfile;
  roofWidthRatio: number;
  roofLengthRatio: number;
  extra: 'none' | 'suvRack' | 'pickupBed' | 'taxiSign' | 'policeBar' | 'coupeWing';
}

type MaterialKey =
  | 'body'
  | 'glass'
  | 'dark'
  | 'headlight'
  | 'taillight'
  | 'roof'
  | 'lightbarRed'
  | 'lightbarBlue'
  | 'stripe';

interface StaticPart {
  geo: THREE.BufferGeometry;
  x: number;
  y: number;
  z: number;
  key: MaterialKey;
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
}

interface StaticGeometrySet {
  body: THREE.BufferGeometry | null;
  glass: THREE.BufferGeometry | null;
  dark: THREE.BufferGeometry | null;
  headlight: THREE.BufferGeometry | null;
  taillight: THREE.BufferGeometry | null;
  roof: THREE.BufferGeometry | null;
  lightbarRed: THREE.BufferGeometry | null;
  lightbarBlue: THREE.BufferGeometry | null;
  stripe: THREE.BufferGeometry | null;
}

const STYLE_PROFILES: Record<BodyStyle, StyleProfile> = {
  sedan: {
    bodyFrontTaper: 0.96,
    bodyRearTaper: 1,
    bodyRadius: 0.55,
    cabin: { widthRatio: 0.84, lengthRatio: 0.5, heightRatio: 0.36, zOffset: -0.04 },
    roofWidthRatio: 0.78,
    roofLengthRatio: 0.44,
    extra: 'none',
  },
  coupe: {
    bodyFrontTaper: 0.94,
    bodyRearTaper: 0.97,
    bodyRadius: 0.6,
    cabin: { widthRatio: 0.82, lengthRatio: 0.48, heightRatio: 0.32, zOffset: -0.1 },
    roofWidthRatio: 0.76,
    roofLengthRatio: 0.42,
    extra: 'coupeWing',
  },
  suv: {
    bodyFrontTaper: 1,
    bodyRearTaper: 1,
    bodyRadius: 0.6,
    cabin: { widthRatio: 0.86, lengthRatio: 0.52, heightRatio: 0.42, zOffset: -0.02 },
    roofWidthRatio: 0.8,
    roofLengthRatio: 0.46,
    extra: 'suvRack',
  },
  pickup: {
    bodyFrontTaper: 1,
    bodyRearTaper: 0.98,
    bodyRadius: 0.55,
    cabin: { widthRatio: 0.84, lengthRatio: 0.42, heightRatio: 0.4, zOffset: 0.18 },
    roofWidthRatio: 0.8,
    roofLengthRatio: 0.36,
    extra: 'pickupBed',
  },
  taxi: {
    bodyFrontTaper: 0.96,
    bodyRearTaper: 1,
    bodyRadius: 0.55,
    cabin: { widthRatio: 0.84, lengthRatio: 0.5, heightRatio: 0.36, zOffset: -0.04 },
    roofWidthRatio: 0.78,
    roofLengthRatio: 0.44,
    extra: 'taxiSign',
  },
  police: {
    bodyFrontTaper: 0.95,
    bodyRearTaper: 1,
    bodyRadius: 0.55,
    cabin: { widthRatio: 0.84, lengthRatio: 0.5, heightRatio: 0.36, zOffset: -0.04 },
    roofWidthRatio: 0.78,
    roofLengthRatio: 0.44,
    extra: 'policeBar',
  },
};

const materialCache = new Map<string, THREE.Material>();
const partGeometryCache = new Map<string, THREE.BufferGeometry>();
const staticGeometryCache = new Map<string, StaticGeometrySet>();
let vehicleEnvMap: THREE.Texture | null = null;
const vehicleGltfCache = new Map<string, Promise<THREE.Group>>();
const VEHICLE_MODEL_CACHE_BUST = `v=${Date.now()}`;

export const VEHICLE_PART_NAMES = [
  'BodyMain',
  'Hood',
  'FrontDoor_L',
  'FrontDoor_R',
  'RearDoor_L',
  'RearDoor_R',
  'TrunkLid',
  'FrontBumper',
  'RearBumper',
  'Mirror_L',
  'Mirror_R',
  'Grille',
  'Headlight_L',
  'Headlight_R',
  'Taillight_L',
  'Taillight_R',
  'Spoiler',
  'Windows',
  'Wheel_LF',
  'Wheel_RF',
  'Wheel_LR',
  'Wheel_RR',
] as const;

function loadVehicleScene(url: string): Promise<THREE.Group> {
  let pending = vehicleGltfCache.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(
        url,
        (gltf) => resolve(gltf.scene),
        undefined,
        (error) => {
          vehicleGltfCache.delete(url);
          reject(error);
        },
      );
    });
    vehicleGltfCache.set(url, pending);
  }
  return pending;
}

export function vehicleModelUrl(bodyStyle: string): string {
  return `/models/vehicles/${bodyStyle}.glb?${VEHICLE_MODEL_CACHE_BUST}`;
}

export async function attachExternalVehicleModel(
  visuals: VehicleVisuals,
  url: string,
  spec: VehicleSpec,
): Promise<void> {
  try {
    if (visuals.modelRoot) {
      visuals.group.remove(visuals.modelRoot);
      visuals.modelRoot = null;
    }
    const source = await loadVehicleScene(url);
    if (visuals.modelRoot) {
      visuals.group.remove(visuals.modelRoot);
      visuals.modelRoot = null;
    }
    const root = source.clone(true);
    root.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.castShadow = true;
        node.receiveShadow = false;
        if (/wheel|tire|rim/i.test(node.name)) {
          node.visible = false;
        }
      }
    });
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    if (size.x < 1e-4 || size.z < 1e-4 || size.y < 1e-4) return;
    const scale = Math.min(spec.length / size.z, spec.width / size.x);
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    const fitted = new THREE.Box3().setFromObject(root);
    const center = fitted.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= fitted.min.y - 0.02;
    for (const [name, obj] of visuals.bodyParts) {
      if (!name.startsWith('Wheel_')) obj.visible = false;
    }
    visuals.modelRoot = root;
    visuals.group.add(root);
  } catch {
    // Keep the procedural vehicle when the model is unavailable.
  }
}

export function setVehicleEnvMap(texture: THREE.Texture): void {
  vehicleEnvMap = texture;
  for (const [key, value] of materialCache) {
    if (
      key.startsWith('body:') ||
      key.startsWith('body-npc:') ||
      key === 'glass' ||
      key === 'glass-npc'
    ) {
      const material = value as THREE.MeshStandardMaterial;
      material.envMap = texture;
      material.needsUpdate = true;
    }
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

function buildWheelSpokesGeometry(): THREE.BufferGeometry {
  const source = new THREE.BoxGeometry(0.07, 0.03, 0.16);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i += 1) {
    const geo = source.clone().toNonIndexed();
    geo.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(0.02, 0, 0),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(0, 0, (i / 5) * Math.PI * 2),
        ),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    parts.push(geo);
  }
  return mergeGeometries(parts, false) ?? source.clone();
}

function buildWheelBoltsGeometry(): THREE.BufferGeometry {
  const source = new THREE.CylinderGeometry(0.02, 0.02, 0.025, 8);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i += 1) {
    const geo = source.clone().toNonIndexed();
    const angle = (i / 5) * Math.PI * 2;
    geo.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(0.09, Math.cos(angle) * 0.055, Math.sin(angle) * 0.055),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
        new THREE.Vector3(1, 1, 1),
      ),
    );
    parts.push(geo);
  }
  return mergeGeometries(parts, false) ?? source.clone();
}

function taperedRoundedRect(
  width: number,
  length: number,
  frontTaper: number,
  rearTaper: number,
  radius: number,
  waist = 0,
): THREE.Shape {
  const hwF = (width * frontTaper) / 2;
  const hwR = (width * rearTaper) / 2;
  const hl = length / 2;
  const r = Math.min(radius, hwF, hwR, hl);
  const waistIn = width * waist;
  const shape = new THREE.Shape();
  shape.moveTo(-hwR, hl - r);
  shape.quadraticCurveTo(-hwR, hl, -hwR + r, hl);
  shape.lineTo(hwR - r, hl);
  shape.quadraticCurveTo(hwR, hl, hwR, hl - r);
  if (waistIn > 0.001) {
    shape.quadraticCurveTo(hwR - waistIn, 0, hwR, -hl + r);
  } else {
    shape.lineTo(hwR, -hl + r);
  }
  shape.quadraticCurveTo(hwR, -hl, hwR - r, -hl);
  shape.lineTo(-hwF + r, -hl);
  shape.quadraticCurveTo(-hwF, -hl, -hwF, -hl + r);
  if (waistIn > 0.001) {
    shape.lineTo(-hwF, hl - r);
    shape.quadraticCurveTo(-hwR + waistIn, 0, -hwR, hl - r);
  } else {
    shape.lineTo(-hwF, hl - r);
  }
  return shape;
}

function extrudeShape(shape: THREE.Shape, depth: number, bevel: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    steps: 1,
    curveSegments: 12,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function mergeParts(parts: StaticPart[]): StaticGeometrySet {
  const keys: MaterialKey[] = [
    'body',
    'glass',
    'dark',
    'headlight',
    'taillight',
    'roof',
    'lightbarRed',
    'lightbarBlue',
    'stripe',
  ];
  const result = {} as StaticGeometrySet;
  for (const key of keys) {
    const matching = parts.filter((part) => part.key === key);
    if (matching.length === 0) {
      result[key] = null;
      continue;
    }
    const transformed = matching.map((part) => {
      const geo = part.geo.toNonIndexed();
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(part.x, part.y, part.z),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(part.rotationX ?? 0, part.rotationY ?? 0, part.rotationZ ?? 0),
        ),
        new THREE.Vector3(1, 1, 1),
      );
      geo.applyMatrix4(matrix);
      return geo;
    });
    if (matching.length === 1) {
      result[key] = transformed[0];
    } else {
      result[key] = mergeGeometries(transformed, false) ?? transformed[0];
    }
  }
  return result;
}

function buildStaticGeometry(
  style: BodyStyle,
  L: number,
  W: number,
  H: number,
): StaticGeometrySet {
  const profile = STYLE_PROFILES[style];
  const wheelR = 0.32;
  const bodyH = H * 0.3;
  const bodyBevel = 0.045;
  const bodyBottom = wheelR - 0.02;
  const bodyGeo = extrudeShape(
    taperedRoundedRect(
      W,
      L,
      profile.bodyFrontTaper,
      profile.bodyRearTaper,
      profile.bodyRadius,
      0.035,
    ),
    bodyH,
    bodyBevel,
  );
  const bodyY = bodyBottom + bodyBevel;
  const bodyTop = bodyBottom + bodyH + bodyBevel * 2;
  const cabinZ = L * profile.cabin.zOffset;
  const cabinLen = L * profile.cabin.lengthRatio;
  const cabinW = W * profile.cabin.widthRatio;
  const cabinH = H * profile.cabin.heightRatio;
  const cabinBevel = 0.04;
  const cabinGeo = extrudeShape(
    taperedRoundedRect(cabinW, cabinLen, 0.97, 0.98, 0.45),
    cabinH,
    cabinBevel,
  );
  const cabinY = bodyTop + 0.01 + cabinBevel;
  const cabinTop = cabinY + cabinH + cabinBevel;
  const roofGeo = extrudeShape(
    taperedRoundedRect(
      W * profile.roofWidthRatio,
      L * profile.roofLengthRatio,
      1,
      1,
      0.35,
    ),
    0.08,
    0.02,
  );
  const roofY = cabinTop + 0.04;
  const roofTop = roofY + 0.1;

  const parts: StaticPart[] = [
    { geo: bodyGeo, x: 0, y: bodyY, z: 0, key: 'body' },
    { geo: cabinGeo, x: 0, y: cabinY, z: cabinZ, key: 'glass' },
    { geo: roofGeo, x: 0, y: roofY, z: cabinZ, key: 'body' },
  ];

  switch (profile.extra) {
    case 'taxiSign':
      parts.push({
        geo: new THREE.BoxGeometry(W * 0.6, 0.14, 0.32),
        x: 0,
        y: roofTop + 0.09,
        z: cabinZ,
        key: 'roof',
      });
      break;
    case 'policeBar':
      parts.push({
        geo: new THREE.BoxGeometry(W * 0.66, 0.16, 0.44),
        x: 0,
        y: roofTop + 0.09,
        z: cabinZ,
        key: 'dark',
      });
      parts.push({
        geo: new THREE.BoxGeometry(0.32, 0.1, 0.12),
        x: -W * 0.19,
        y: roofTop + 0.15,
        z: cabinZ,
        key: 'lightbarRed',
      });
      parts.push({
        geo: new THREE.BoxGeometry(0.32, 0.1, 0.12),
        x: W * 0.19,
        y: roofTop + 0.15,
        z: cabinZ,
        key: 'lightbarBlue',
      });
      parts.push(
        {
          geo: new THREE.BoxGeometry(0.05, 0.3, L * 0.56),
          x: -(W / 2 - 0.025),
          y: wheelR + 0.56,
          z: 0,
          key: 'stripe',
        },
        {
          geo: new THREE.BoxGeometry(0.05, 0.3, L * 0.56),
          x: W / 2 - 0.025,
          y: wheelR + 0.56,
          z: 0,
          key: 'stripe',
        },
      );
      break;
    case 'suvRack':
      parts.push(
        {
          geo: new THREE.BoxGeometry(W * 0.82, 0.05, 0.1),
          x: 0,
          y: roofTop + 0.04,
          z: cabinZ - 0.32,
          key: 'dark',
        },
        {
          geo: new THREE.BoxGeometry(W * 0.82, 0.05, 0.1),
          x: 0,
          y: roofTop + 0.04,
          z: cabinZ + 0.32,
          key: 'dark',
        },
      );
      break;
    case 'pickupBed':
      parts.push(
        {
          geo: new THREE.BoxGeometry(W * 0.86, 0.06, L * 0.38),
          x: 0,
          y: bodyTop + 0.05,
          z: -L * 0.2,
          key: 'dark',
        },
        {
          geo: new THREE.BoxGeometry(W * 0.86, 0.22, 0.06),
          x: 0,
          y: bodyTop + 0.2,
          z: -L * 0.4 + 0.03,
          key: 'dark',
        },
        {
          geo: new THREE.BoxGeometry(0.06, 0.22, L * 0.38),
          x: -W * 0.43,
          y: bodyTop + 0.2,
          z: -L * 0.2,
          key: 'dark',
        },
        {
          geo: new THREE.BoxGeometry(0.06, 0.22, L * 0.38),
          x: W * 0.43,
          y: bodyTop + 0.2,
          z: -L * 0.2,
          key: 'dark',
        },
      );
      break;
    case 'none':
      break;
  }

  return mergeParts(parts);
}

function staticGeometries(
  style: BodyStyle,
  L: number,
  W: number,
  H: number,
): StaticGeometrySet {
  const key = `static:${style}:${L.toFixed(2)}:${W.toFixed(2)}:${H.toFixed(2)}`;
  const cached = staticGeometryCache.get(key);
  if (cached) return cached;
  const built = buildStaticGeometry(style, L, W, H);
  staticGeometryCache.set(key, built);
  return built;
}

export function buildVehicle(
  spec: VehicleSpec,
  color: string,
  castShadows = true,
  highQuality = true,
): VehicleVisuals {
  const group = new THREE.Group();
  const L = spec.length;
  const W = spec.width;
  const H = spec.height;

  const bodyMat = highQuality
    ? material(
        `body:${color}`,
        () =>
          new THREE.MeshPhysicalMaterial({
            color,
            roughness: 0.28,
            metalness: 0.6,
            clearcoat: 1,
            clearcoatRoughness: 0.18,
            envMapIntensity: 1.25,
            envMap: vehicleEnvMap ?? undefined,
          }),
      )
    : material(
        `body-npc:${color}`,
        () =>
          new THREE.MeshStandardMaterial({
            color,
            roughness: 0.34,
            metalness: 0.6,
            envMapIntensity: 1.0,
            envMap: vehicleEnvMap ?? undefined,
          }),
      );
  const glassMat = highQuality
    ? material(
        'glass',
        () =>
          new THREE.MeshPhysicalMaterial({
            color: 0x0b1f2a,
            roughness: 0.05,
            metalness: 0.9,
            envMapIntensity: 1.5,
            envMap: vehicleEnvMap ?? undefined,
          }),
      )
    : material(
        'glass-npc',
        () =>
          new THREE.MeshStandardMaterial({
            color: 0x0b1f2a,
            roughness: 0.08,
            metalness: 0.85,
            envMapIntensity: 1.2,
            envMap: vehicleEnvMap ?? undefined,
          }),
      );
  const darkMat = material(
    'dark',
    () => new THREE.MeshStandardMaterial({ color: 0x181a1f, roughness: 0.85, metalness: 0.1 }),
  );
  const tireMat = material(
    'tire',
    () => new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.95 }),
  );
  const rimMat = material(
    'rim',
    () => new THREE.MeshStandardMaterial({ color: 0xc9ced4, roughness: 0.25, metalness: 0.85 }),
  );
  const spokeMat = material(
    'spoke',
    () => new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.3, metalness: 0.9 }),
  );
  const headlightMat = material(
    'headlight',
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xfff6c8,
        emissive: 0xfff0b0,
        emissiveIntensity: 0.9,
      }),
  );
  const taillightMat = material(
    'taillight',
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x9c1515,
        emissive: 0xd02020,
        emissiveIntensity: 0.7,
      }),
  );
  const roofMat = material(
    'roof',
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xffd23f,
        emissive: 0xffd23f,
        emissiveIntensity: 0.35,
      }),
  );
  const lightbarRedMat = material(
    'lightbarRed',
    () =>
      new THREE.MeshStandardMaterial({
        color: 0xd02020,
        emissive: 0xff2020,
        emissiveIntensity: 0.9,
      }),
  );
  const lightbarBlueMat = material(
    'lightbarBlue',
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x2040d0,
        emissive: 0x3060ff,
        emissiveIntensity: 0.9,
      }),
  );
  const stripeMat = material(
    'stripe',
    () => new THREE.MeshStandardMaterial({ color: 0x2b4fd0, roughness: 0.4 }),
  );

  const statics = staticGeometries(spec.bodyStyle, L, W, H);
  const bodyParts = new Map<string, THREE.Object3D>();
  const wheelR = 0.32;
  const profile = STYLE_PROFILES[spec.bodyStyle];
  const bodyH = H * 0.3;
  const bodyBottom = wheelR - 0.02;
  const bodyTop = bodyBottom + bodyH + 0.09;
  const cabinH = H * profile.cabin.heightRatio;
  const cabinZ = L * profile.cabin.zOffset;
  const cabinLen = L * profile.cabin.lengthRatio;
  const cabinW = W * profile.cabin.widthRatio;
  const cabinTop = bodyTop + 0.09 + cabinH;
  const cabinFront = cabinZ + cabinLen / 2;

  const attachStatic = (
    key: string,
    geo: THREE.BufferGeometry | null,
    mat: THREE.Material,
    parent: THREE.Object3D = group,
  ): THREE.Mesh | null => {
    if (!geo) return null;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = key;
    mesh.castShadow = castShadows;
    mesh.receiveShadow = false;
    parent.add(mesh);
    return mesh;
  };

  const createPart = (name: string): THREE.Group => {
    const part = new THREE.Group();
    part.name = name;
    part.visible = highQuality;
    group.add(part);
    bodyParts.set(name, part);
    return part;
  };

  const bodyMain = createPart('BodyMain');
  bodyMain.visible = true;
  attachStatic('BodyMain-shell', statics.body, bodyMat, bodyMain);
  if (highQuality) {
    const archGeo = geometry('body-wheel-arch', () => {
      const geo = new THREE.TorusGeometry(0.4, 0.055, 8, 18, Math.PI * 1.3);
      geo.rotateY(Math.PI / 2);
      return geo;
    });
    const archZ = L / 2 - 0.42;
    for (const side of [-1, 1]) {
      for (const z of [archZ, -archZ]) {
        const arch = new THREE.Mesh(archGeo, bodyMat);
        arch.name = 'BodyMain-wheel-arch';
        arch.position.set(side * (W / 2 + 0.025), wheelR + 0.02, z);
        arch.castShadow = castShadows;
        bodyMain.add(arch);
      }
    }
    const skirtGeo = geometry('body-side-skirt', () => new THREE.BoxGeometry(1, 1, 1));
    for (const side of [-1, 1]) {
      const skirt = new THREE.Mesh(skirtGeo, bodyMat);
      skirt.name = 'BodyMain-side-skirt';
      skirt.scale.set(0.09, 0.13, L * 0.44);
      skirt.position.set(side * (W / 2 - 0.015), wheelR - 0.02, 0);
      skirt.castShadow = castShadows;
      bodyMain.add(skirt);
    }
  }

  const glassMesh = attachStatic('Windows', statics.glass, glassMat);
  if (glassMesh) bodyParts.set('Windows', glassMesh);
  const darkExtras = attachStatic('DarkExtras', statics.dark, darkMat);
  if (darkExtras) bodyParts.set('DarkExtras', darkExtras);
  const taxiSign = attachStatic('TaxiSign', statics.roof, roofMat);
  if (taxiSign) bodyParts.set('TaxiSign', taxiSign);
  const lightbarRed = attachStatic('LightbarRed', statics.lightbarRed, lightbarRedMat);
  if (lightbarRed) bodyParts.set('LightbarRed', lightbarRed);
  const lightbarBlue = attachStatic('LightbarBlue', statics.lightbarBlue, lightbarBlueMat);
  if (lightbarBlue) bodyParts.set('LightbarBlue', lightbarBlue);
  const stripe = attachStatic('Stripe', statics.stripe, stripeMat);
  if (stripe) bodyParts.set('Stripe', stripe);

  const hood = createPart('Hood');
  const frontDoorL = createPart('FrontDoor_L');
  const frontDoorR = createPart('FrontDoor_R');
  const rearDoorL = createPart('RearDoor_L');
  const rearDoorR = createPart('RearDoor_R');
  const trunkLid = createPart('TrunkLid');
  const frontBumper = createPart('FrontBumper');
  const rearBumper = createPart('RearBumper');
  const mirrorL = createPart('Mirror_L');
  const mirrorR = createPart('Mirror_R');
  const grille = createPart('Grille');
  const headlightL = createPart('Headlight_L');
  const headlightR = createPart('Headlight_R');
  const taillightL = createPart('Taillight_L');
  const taillightR = createPart('Taillight_R');
  const spoiler = createPart('Spoiler');

  if (highQuality) {
    const hoodLen = Math.max(0.75, L / 2 - cabinFront - 0.08);
    const hoodMesh = new THREE.Mesh(
      geometry('part-hood', () => new THREE.BoxGeometry(1, 0.035, 1)),
      bodyMat,
    );
    hoodMesh.name = 'Hood-surface';
    hoodMesh.scale.set(W * 0.9, 1, hoodLen);
    hoodMesh.position.set(0, bodyTop - 0.014, (L / 2 + cabinFront) / 2);
    hoodMesh.castShadow = castShadows;
    hood.add(hoodMesh);

    const doorGeo = geometry('part-door', () => new THREE.BoxGeometry(1, 1, 1));
    const doorH = Math.max(0.42, bodyH * 0.88);
    const doorLen = L * 0.185;
    const frontZ = cabinFront - L * 0.105;
    const rearZ = cabinZ - cabinLen / 2 + L * 0.115;
    for (const [part, side, z] of [
      [frontDoorL, -1, frontZ],
      [frontDoorR, 1, frontZ],
      [rearDoorL, -1, rearZ],
      [rearDoorR, 1, rearZ],
    ] as const) {
      const door = new THREE.Mesh(doorGeo, bodyMat);
      door.name = `${part.name}-surface`;
      door.scale.set(0.05, doorH, doorLen);
      door.position.set(side * (W / 2 - 0.02), bodyBottom + doorH / 2 + 0.015, z);
      door.castShadow = castShadows;
      part.add(door);
    }

    const trunkMesh = new THREE.Mesh(
      geometry('part-trunk', () => new THREE.BoxGeometry(1, 0.035, 1)),
      bodyMat,
    );
    trunkMesh.name = 'TrunkLid-surface';
    trunkMesh.scale.set(W * 0.88, 1, L * 0.2);
    trunkMesh.position.set(0, bodyTop - 0.014, -L / 2 + L * 0.115);
    trunkMesh.castShadow = castShadows;
    trunkLid.add(trunkMesh);

    const bumperMainGeo = geometry(
      'part-bumper-main',
      () => new THREE.BoxGeometry(1, 1, 1),
    );
    const bumperLipGeo = geometry(
      'part-bumper-lip',
      () => new THREE.BoxGeometry(1, 1, 1),
    );
    for (const [part, isFront] of [
      [frontBumper, true],
      [rearBumper, false],
    ] as const) {
      const main = new THREE.Mesh(bumperMainGeo, bodyMat);
      main.name = `${part.name}-main`;
      main.scale.set(W * 0.96, 0.16, 0.12);
      main.position.set(
        0,
        wheelR - 0.02,
        (isFront ? 1 : -1) * (L / 2 - 0.08),
      );
      main.castShadow = castShadows;
      const lip = new THREE.Mesh(bumperLipGeo, darkMat);
      lip.name = `${part.name}-lip`;
      lip.scale.set(W * 0.82, 0.12, 0.08);
      lip.position.set(
        0,
        wheelR - 0.13,
        (isFront ? 1 : -1) * (L / 2 - 0.06),
      );
      lip.castShadow = castShadows;
      part.add(main, lip);
    }

    const grilleFrame = new THREE.Mesh(
      geometry('part-grille-frame', () => new THREE.BoxGeometry(1, 1, 1)),
      darkMat,
    );
    grilleFrame.name = 'Grille-frame';
    grilleFrame.scale.set(W * 0.42, 0.12, 0.05);
    grilleFrame.position.set(0, wheelR + 0.42, L / 2 + 0.01);
    grilleFrame.castShadow = castShadows;
    grille.add(grilleFrame);
    const grilleSlatGeo = geometry(
      'part-grille-slat',
      () => new THREE.BoxGeometry(1, 1, 1),
    );
    for (let s = 0; s < 3; s += 1) {
      const slat = new THREE.Mesh(grilleSlatGeo, darkMat);
      slat.name = 'Grille-slat';
      slat.scale.set(W * 0.36, 0.018, 0.045);
      slat.position.set(0, wheelR + 0.4 + s * 0.028, L / 2 + 0.015);
      slat.castShadow = false;
      grille.add(slat);
    }

    const isCoupe = spec.bodyStyle === 'coupe';
    if (isCoupe) {
      const wing = new THREE.Mesh(
        geometry('part-spoiler-wing', () => new THREE.BoxGeometry(1, 1, 1)),
        darkMat,
      );
      wing.name = 'Spoiler-wing';
      wing.scale.set(W * 0.94, 0.05, 0.3);
      wing.position.set(0, bodyTop + 0.2, -L / 2 + 0.1);
      wing.castShadow = castShadows;
      const strutGeo = geometry(
        'part-spoiler-strut',
        () => new THREE.BoxGeometry(1, 1, 1),
      );
      for (const side of [-1, 1]) {
        const strut = new THREE.Mesh(strutGeo, darkMat);
        strut.name = 'Spoiler-strut';
        strut.scale.set(0.05, 0.18, 0.12);
        strut.position.set(side * (W * 0.36), bodyTop + 0.09, -L / 2 + 0.1);
        strut.castShadow = castShadows;
        spoiler.add(strut);
      }
      spoiler.add(wing);
    } else {
      const lip = new THREE.Mesh(
        geometry('part-spoiler-lip', () => new THREE.BoxGeometry(1, 1, 1)),
        darkMat,
      );
      lip.name = 'Spoiler-lip';
      lip.scale.set(W * 0.84, 0.035, 0.1);
      lip.position.set(0, bodyTop + 0.08, -L / 2 + 0.04);
      lip.castShadow = castShadows;
      spoiler.add(lip);
    }

    const mirrorArmGeo = geometry(
      'part-mirror-arm',
      () => new THREE.BoxGeometry(0.05, 0.045, 0.2),
    );
    const mirrorShellGeo = geometry(
      'part-mirror-shell',
      () => new THREE.BoxGeometry(0.2, 0.11, 0.08),
    );
    const mirrorGlassGeo = geometry(
      'part-mirror-glass',
      () => new THREE.BoxGeometry(0.15, 0.075, 0.015),
    );
    for (const [part, side] of [
      [mirrorL, -1],
      [mirrorR, 1],
    ] as const) {
      const arm = new THREE.Mesh(mirrorArmGeo, bodyMat);
      arm.name = 'Mirror-arm';
      arm.position.set(0, 0.02, 0.05);
      const shell = new THREE.Mesh(mirrorShellGeo, bodyMat);
      shell.name = 'Mirror-shell';
      shell.position.set(side * 0.16, 0.025, -0.03);
      const surface = new THREE.Mesh(mirrorGlassGeo, rimMat);
      surface.name = 'Mirror-glass';
      surface.position.set(side * 0.17, 0.025, -0.075);
      part.add(arm, shell, surface);
      part.position.set(side * (W / 2 + 0.12), bodyTop + 0.04, cabinFront - 0.12);
    }

    const headlightGeo = geometry('part-headlight', () => new THREE.BoxGeometry(1, 1, 1));
    const taillightGeo = geometry('part-taillight', () => new THREE.BoxGeometry(1, 1, 1));
    const headlightCoreMat = material(
      'headlight-core',
      () =>
        new THREE.MeshStandardMaterial({
          color: 0xfffdf0,
          emissive: 0xfff6d0,
          emissiveIntensity: 1.7,
        }),
    );
    for (const [part, side, isFront] of [
      [headlightL, -1, true],
      [headlightR, 1, true],
      [taillightL, -1, false],
      [taillightR, 1, false],
    ] as const) {
      const mat = isFront ? headlightMat : taillightMat;
      const lamp = new THREE.Mesh(isFront ? headlightGeo : taillightGeo, mat);
      lamp.name = `${part.name}-surface`;
      lamp.scale.set(0.26, 0.1, 0.06);
      lamp.position.set(
        side * (W / 2 - (isFront ? 0.38 : 0.4)),
        wheelR + (isFront ? 0.5 : 0.46),
        (isFront ? 1 : -1) * (L / 2 + 0.012),
      );
      lamp.castShadow = castShadows;
      part.add(lamp);
      const core = new THREE.Mesh(
        geometry('part-light-core', () => new THREE.BoxGeometry(1, 1, 1)),
        isFront ? headlightCoreMat : taillightMat,
      );
      core.name = 'Light-core';
      core.scale.set(0.12, 0.05, 0.02);
      core.position.set(0, 0, (isFront ? 1 : -1) * 0.035);
      part.add(core);
    }
  }

  const tireGeo = geometry(
    'wheel-tire',
    () => new THREE.CylinderGeometry(wheelR, wheelR, 0.24, 24),
  );
  const rimGeo = geometry(
    'wheel-rim',
    () => new THREE.CylinderGeometry(0.19, 0.13, 0.24, 16),
  );
  const hubGeo = geometry(
    'wheel-hub',
    () => new THREE.CylinderGeometry(0.055, 0.075, 0.28, 10),
  );
  const brakeGeo = geometry(
    'wheel-brake',
    () => new THREE.CylinderGeometry(0.14, 0.14, 0.05, 16),
  );
  const brakeMat = material(
    'brake',
    () => new THREE.MeshStandardMaterial({ color: 0x2c3035, roughness: 0.7, metalness: 0.5 }),
  );

  const frontLeftPivot = new THREE.Group();
  const frontRightPivot = new THREE.Group();
  const halfLength = L / 2 - 0.42;
  const halfWidth = W / 2 + 0.08;
  frontLeftPivot.position.set(-halfWidth, wheelR, halfLength);
  frontRightPivot.position.set(halfWidth, wheelR, halfLength);
  group.add(frontLeftPivot, frontRightPivot);

  const wheels: THREE.Group[] = [];
  const createWheel = (
    pivot: THREE.Group | null,
    x: number,
    z: number,
    name: string,
  ): THREE.Group => {
    const wheel = new THREE.Group();
    wheel.name = name;
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = castShadows;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.castShadow = castShadows;
    rim.position.x = 0.045;
    wheel.add(tire, rim);
    if (highQuality) {
      const hub = new THREE.Mesh(hubGeo, darkMat);
      hub.position.x = 0.075;
      const brake = new THREE.Mesh(brakeGeo, brakeMat);
      brake.position.x = -0.1;
      wheel.add(hub, brake);
      const spokes = new THREE.Mesh(
        geometry('wheel-spokes-merged', buildWheelSpokesGeometry),
        spokeMat,
      );
      spokes.castShadow = castShadows;
      wheel.add(spokes);
      wheel.add(
        new THREE.Mesh(
          geometry('wheel-bolts-merged', buildWheelBoltsGeometry),
          rimMat,
        ),
      );
    }
    if (pivot) {
      pivot.add(wheel);
    } else {
      wheel.position.set(x, wheelR, z);
      group.add(wheel);
    }
    wheels.push(wheel);
    bodyParts.set(name, wheel);
    return wheel;
  };
  createWheel(frontLeftPivot, -halfWidth, halfLength, 'Wheel_LF');
  createWheel(frontRightPivot, halfWidth, halfLength, 'Wheel_RF');
  createWheel(null, -halfWidth, -halfLength, 'Wheel_LR');
  createWheel(null, halfWidth, -halfLength, 'Wheel_RR');

  const interiorMat = material(
    'interior',
    () =>
      new THREE.MeshStandardMaterial({
        color: 0x1d2126,
        roughness: 0.7,
        metalness: 0.15,
      }),
  );
  let steeringWheel: THREE.Group | null = null;
  if (highQuality) {
    const dashboard = new THREE.Mesh(
      geometry(
        'interior-dashboard',
        () => new THREE.BoxGeometry(cabinW * 0.98, 0.16, 0.5),
      ),
      interiorMat,
    );
    dashboard.name = 'interior-dashboard';
    dashboard.position.set(0, bodyTop + 0.2, cabinFront - 0.3);
    dashboard.castShadow = false;
    group.add(dashboard);

    const pillarGeo = geometry(
      'interior-pillar',
      () => new THREE.BoxGeometry(0.09, 1, 0.09),
    );
    const pillarLen = cabinTop - bodyTop;
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(pillarGeo, interiorMat);
      pillar.name = 'interior-pillar';
      pillar.scale.y = pillarLen;
      pillar.position.set(
        side * (cabinW / 2 - 0.05),
        bodyTop + pillarLen / 2,
        cabinFront - 0.18,
      );
      pillar.rotation.x = -0.5;
      pillar.castShadow = false;
      group.add(pillar);
    }

    const headliner = new THREE.Mesh(
      geometry(
        'interior-headliner',
        () => new THREE.BoxGeometry(cabinW * 0.96, 0.05, cabinLen * 0.95),
      ),
      interiorMat,
    );
    headliner.name = 'interior-headliner';
    headliner.position.set(0, cabinTop - 0.05, cabinZ);
    headliner.castShadow = false;
    group.add(headliner);

    const steeringPivot = new THREE.Group();
    steeringPivot.name = 'interior-steering-pivot';
    steeringPivot.position.set(-0.34, bodyTop + 0.38, cabinFront - 0.42);
    steeringPivot.rotation.x = -0.55;
    steeringWheel = new THREE.Group();
    const wheelRing = new THREE.Mesh(
      geometry(
        'interior-wheel-ring',
        () => new THREE.TorusGeometry(0.17, 0.026, 8, 24),
      ),
      interiorMat,
    );
    const wheelHub = new THREE.Mesh(
      geometry(
        'interior-wheel-hub',
        () => new THREE.CylinderGeometry(0.045, 0.045, 0.05, 12),
      ),
      rimMat,
    );
    wheelRing.castShadow = false;
    wheelHub.castShadow = false;
    steeringWheel.add(wheelRing, wheelHub);
    steeringPivot.add(steeringWheel);
    group.add(steeringPivot);
  }

  return {
    group,
    frontLeftPivot,
    frontRightPivot,
    wheels,
    glassMesh,
    steeringWheel,
    modelRoot: null,
    bodyParts,
  };
}
