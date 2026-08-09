import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BodyStyle, VehicleSpec } from '../core/types';

export interface VehicleVisuals {
  group: THREE.Group;
  frontLeftPivot: THREE.Group;
  frontRightPivot: THREE.Group;
  wheels: THREE.Group[];
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

function taperedRoundedRect(
  width: number,
  length: number,
  frontTaper: number,
  rearTaper: number,
  radius: number,
): THREE.Shape {
  const hwF = (width * frontTaper) / 2;
  const hwR = (width * rearTaper) / 2;
  const hl = length / 2;
  const r = Math.min(radius, hwF, hwR, hl);
  const shape = new THREE.Shape();
  shape.moveTo(-hwR, hl - r);
  shape.quadraticCurveTo(-hwR, hl, -hwR + r, hl);
  shape.lineTo(hwR - r, hl);
  shape.quadraticCurveTo(hwR, hl, hwR, hl - r);
  shape.lineTo(hwR, -hl + r);
  shape.quadraticCurveTo(hwR, -hl, hwR - r, -hl);
  shape.lineTo(-hwF + r, -hl);
  shape.quadraticCurveTo(-hwF, -hl, -hwF, -hl + r);
  shape.lineTo(-hwF, hl - r);
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
  const bodyH = H * 0.26;
  const bodyBevel = 0.045;
  const bodyGeo = extrudeShape(
    taperedRoundedRect(
      W,
      L,
      profile.bodyFrontTaper,
      profile.bodyRearTaper,
      profile.bodyRadius,
    ),
    bodyH,
    bodyBevel,
  );
  const bodyY = wheelR - 0.04 + bodyH / 2 + bodyBevel;
  const bodyTop = bodyY + bodyH / 2 + bodyBevel;
  const cabinZ = L * profile.cabin.zOffset;
  const cabinLen = L * profile.cabin.lengthRatio;
  const cabinW = W * profile.cabin.widthRatio;
  const cabinFront = cabinZ + cabinLen / 2;
  const cabinRear = cabinZ - cabinLen / 2;
  const windshieldHeight = 0.72;
  const windshieldY = bodyTop + windshieldHeight / 2 + 0.02;
  const roofY = bodyTop + windshieldHeight + 0.035;
  const roofGeo = new THREE.BoxGeometry(
    W * profile.roofWidthRatio,
    0.07,
    L * profile.roofLengthRatio,
  );

  const rotatedBox = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    rotationX: number,
    key: MaterialKey,
  ): StaticPart => ({ geo: new THREE.BoxGeometry(w, h, d), x, y, z, rotationX, key });

  const parts: StaticPart[] = [
    { geo: bodyGeo, x: 0, y: bodyY, z: 0, key: 'body' },
    rotatedBox(cabinW, windshieldHeight + 0.28, 0.3, 0, bodyTop + 0.13, cabinZ, 0, 'glass'),
    rotatedBox(cabinW, windshieldHeight, 0.08, 0, windshieldY, cabinFront - 0.04, -1.12, 'glass'),
    rotatedBox(cabinW, windshieldHeight, 0.08, 0, windshieldY, cabinRear + 0.04, 1.24, 'glass'),
    rotatedBox(cabinW * 0.94, windshieldHeight - 0.1, 0.05, -cabinW / 2 - 0.005, windshieldY - 0.03, cabinZ, 0, 'glass'),
    rotatedBox(cabinW * 0.94, windshieldHeight - 0.1, 0.05, cabinW / 2 + 0.005, windshieldY - 0.03, cabinZ, 0, 'glass'),
    { geo: roofGeo, x: 0, y: roofY, z: cabinZ, key: 'body' },
    {
      geo: new THREE.BoxGeometry(0.12, 0.12, 0.24),
      x: -W / 2 - 0.05,
      y: windshieldY - 0.12,
      z: cabinFront + 0.1,
      key: 'body',
    },
    {
      geo: new THREE.BoxGeometry(0.12, 0.12, 0.24),
      x: W / 2 + 0.05,
      y: windshieldY - 0.12,
      z: cabinFront + 0.1,
      key: 'body',
    },
    {
      geo: new THREE.BoxGeometry(0.06, 0.02, 0.5),
      x: -W / 2 + 0.14,
      y: wheelR + 0.62,
      z: 0,
      key: 'dark',
    },
    {
      geo: new THREE.BoxGeometry(0.06, 0.02, 0.5),
      x: W / 2 - 0.14,
      y: wheelR + 0.62,
      z: 0,
      key: 'dark',
    },
    {
      geo: new THREE.BoxGeometry(0.9, 0.22, 0.18),
      x: 0,
      y: wheelR + 0.32,
      z: L / 2 + 0.03,
      key: 'dark',
    },
    {
      geo: new THREE.BoxGeometry(0.4, 0.08, 0.05),
      x: 0,
      y: wheelR + 0.33,
      z: L / 2 + 0.1,
      key: 'dark',
    },
  ];

  parts.push(
    {
      geo: new THREE.BoxGeometry(W * 1.04, 0.28, 0.34),
      x: 0,
      y: wheelR + 0.13,
      z: L / 2 + 0.08,
      key: 'dark',
    },
    {
      geo: new THREE.BoxGeometry(W * 1.04, 0.28, 0.34),
      x: 0,
      y: wheelR + 0.13,
      z: -L / 2 - 0.08,
      key: 'dark',
    },
    {
      geo: new THREE.BoxGeometry(W * 0.92, 0.12, 0.1),
      x: 0,
      y: wheelR + 0.1,
      z: L / 2 - 0.28,
      key: 'dark',
    },
    {
      geo: new THREE.BoxGeometry(W * 0.92, 0.12, 0.1),
      x: 0,
      y: wheelR + 0.1,
      z: -L / 2 + 0.28,
      key: 'dark',
    },
    {
      geo: new THREE.BoxGeometry(W * 1.0, 0.5, 0.14),
      x: 0,
      y: wheelR + 0.16,
      z: L / 2 + 0.16,
      key: 'dark',
    },
    {
      geo: new THREE.BoxGeometry(W * 1.0, 0.5, 0.14),
      x: 0,
      y: wheelR + 0.16,
      z: -L / 2 - 0.16,
      key: 'dark',
    },
    {
      geo: new THREE.BoxGeometry(W * 1.02, 0.1, L * 0.46),
      x: 0,
      y: wheelR - 0.03,
      z: 0,
      key: 'dark',
    },
    {
      geo: new THREE.BoxGeometry(0.42, 0.16, 0.03),
      x: 0,
      y: wheelR + 0.24,
      z: L / 2 + 0.09,
      key: 'dark',
    },
    {
      geo: new THREE.BoxGeometry(0.42, 0.16, 0.03),
      x: 0,
      y: wheelR + 0.24,
      z: -L / 2 - 0.09,
      key: 'dark',
    },
  );

  parts.push(
    {
      geo: new THREE.BoxGeometry(0.14, 0.1, 0.26),
      x: -W / 2 - 0.03,
      y: wheelR + 0.72,
      z: -L * 0.1,
      key: 'body',
    },
    {
      geo: new THREE.BoxGeometry(0.14, 0.1, 0.26),
      x: W / 2 + 0.03,
      y: wheelR + 0.72,
      z: -L * 0.1,
      key: 'body',
    },
    {
      geo: new THREE.BoxGeometry(0.18, 0.12, 0.05),
      x: -W / 2 + 0.32,
      y: wheelR + 0.45,
      z: L / 2 + 0.05,
      key: 'headlight',
    },
    {
      geo: new THREE.BoxGeometry(0.18, 0.12, 0.05),
      x: W / 2 - 0.32,
      y: wheelR + 0.45,
      z: L / 2 + 0.05,
      key: 'headlight',
    },
    {
      geo: new THREE.BoxGeometry(0.2, 0.1, 0.05),
      x: -W / 2 + 0.34,
      y: wheelR + 0.42,
      z: -L / 2 - 0.05,
      key: 'taillight',
    },
    {
      geo: new THREE.BoxGeometry(0.2, 0.1, 0.05),
      x: W / 2 - 0.34,
      y: wheelR + 0.42,
      z: -L / 2 - 0.05,
      key: 'taillight',
    },
  );

  switch (profile.extra) {
    case 'taxiSign':
      parts.push({
        geo: new THREE.BoxGeometry(W * 0.6, 0.16, 0.34),
        x: 0,
        y: roofY + 0.09,
        z: cabinZ,
        key: 'roof',
      });
      break;
    case 'policeBar':
      parts.push({
        geo: new THREE.BoxGeometry(W * 0.66, 0.18, 0.46),
        x: 0,
        y: roofY + 0.09,
        z: cabinZ,
        key: 'dark',
      });
      parts.push({
        geo: new THREE.BoxGeometry(0.32, 0.1, 0.12),
        x: -W * 0.19,
        y: roofY + 0.15,
        z: cabinZ,
        key: 'lightbarRed',
      });
      parts.push({
        geo: new THREE.BoxGeometry(0.32, 0.1, 0.12),
        x: W * 0.19,
        y: roofY + 0.15,
        z: cabinZ,
        key: 'lightbarBlue',
      });
      parts.push(
        {
          geo: new THREE.BoxGeometry(0.05, 0.32, L * 0.56),
          x: -W / 2 + 0.02,
          y: wheelR + 0.58,
          z: 0,
          key: 'stripe',
        },
        {
          geo: new THREE.BoxGeometry(0.05, 0.32, L * 0.56),
          x: W / 2 - 0.02,
          y: wheelR + 0.58,
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
          y: roofY + 0.05,
          z: cabinZ - 0.32,
          key: 'dark',
        },
        {
          geo: new THREE.BoxGeometry(W * 0.82, 0.05, 0.1),
          x: 0,
          y: roofY + 0.05,
          z: cabinZ + 0.32,
          key: 'dark',
        },
      );
      break;
    case 'pickupBed':
      parts.push(
        {
          geo: new THREE.BoxGeometry(W * 0.86, 0.12, L * 0.4),
          x: 0,
          y: bodyTop + 0.03,
          z: -L * 0.2,
          key: 'dark',
        },
        {
          geo: new THREE.BoxGeometry(W * 0.92, 0.3, 0.08),
          x: 0,
          y: wheelR + 0.38,
          z: -L / 2 + 0.03,
          key: 'dark',
        },
      );
      break;
    case 'coupeWing':
      parts.push({
        geo: new THREE.BoxGeometry(W * 0.9, 0.05, 0.26),
        x: 0,
        y: bodyTop + 0.12,
        z: -L / 2 + 0.16,
        key: 'dark',
      });
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
  const attachStatic = (
    geo: THREE.BufferGeometry | null,
    mat: THREE.Material,
  ): void => {
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = castShadows;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  attachStatic(statics.body, bodyMat);
  attachStatic(statics.glass, glassMat);
  attachStatic(statics.dark, darkMat);
  attachStatic(statics.headlight, headlightMat);
  attachStatic(statics.taillight, taillightMat);
  attachStatic(statics.roof, roofMat);
  attachStatic(statics.lightbarRed, lightbarRedMat);
  attachStatic(statics.lightbarBlue, lightbarBlueMat);
  attachStatic(statics.stripe, stripeMat);

  const wheelR = 0.32;
  const tireGeo = geometry(
    'wheel-tire',
    () => new THREE.CylinderGeometry(wheelR, wheelR, 0.24, 20),
  );
  const rimGeo = geometry(
    'wheel-rim',
    () => new THREE.CylinderGeometry(0.19, 0.13, 0.24, 14),
  );
  const spokeGeo = geometry(
    'wheel-spoke',
    () => new THREE.BoxGeometry(0.07, 0.03, 0.16),
  );
  const hubGeo = geometry(
    'wheel-hub',
    () => new THREE.CylinderGeometry(0.055, 0.075, 0.28, 8),
  );
  const brakeGeo = geometry(
    'wheel-brake',
    () => new THREE.CylinderGeometry(0.14, 0.14, 0.05, 14),
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
  const createWheel = (pivot: THREE.Group | null, x: number, z: number): THREE.Group => {
    const wheel = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = castShadows;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.castShadow = castShadows;
    const hub = new THREE.Mesh(hubGeo, darkMat);
    const brake = new THREE.Mesh(brakeGeo, brakeMat);
    brake.position.x = -0.1;
    for (let i = 0; i < 5; i += 1) {
      const spoke = new THREE.Mesh(spokeGeo, spokeMat);
      const angle = (i / 5) * Math.PI * 2;
      spoke.rotation.z = angle;
      spoke.position.x = 0.02;
      spoke.castShadow = castShadows;
      wheel.add(spoke);
    }
    rim.position.x = 0.045;
    hub.position.x = 0.075;
    wheel.add(tire, rim, hub, brake);
    if (pivot) {
      pivot.add(wheel);
    } else {
      wheel.position.set(x, wheelR, z);
      group.add(wheel);
    }
    wheels.push(wheel);
    return wheel;
  };
  createWheel(frontLeftPivot, -halfWidth, halfLength);
  createWheel(frontRightPivot, halfWidth, halfLength);
  createWheel(null, -halfWidth, -halfLength);
  createWheel(null, halfWidth, -halfLength);

  return { group, frontLeftPivot, frontRightPivot, wheels };
}
