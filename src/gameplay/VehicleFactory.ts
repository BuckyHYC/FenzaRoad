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
      geo.applyMatrix4(new THREE.Matrix4().makeTranslation(part.x, part.y, part.z));
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
  const cabinH = H * profile.cabin.heightRatio;
  const bodyBevel = 0.045;
  const glassBevel = 0.035;
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
  const cabinGeo = extrudeShape(
    taperedRoundedRect(
      W * profile.cabin.widthRatio,
      L * profile.cabin.lengthRatio,
      0.94,
      1,
      0.5,
    ),
    cabinH,
    glassBevel,
  );

  const bodyY = wheelR - 0.04 + bodyH / 2 + bodyBevel;
  const bodyTop = bodyY + bodyH / 2 + bodyBevel;
  const cabinZ = L * profile.cabin.zOffset;
  const cabinY = bodyTop + cabinH / 2 + glassBevel - 0.01;
  const cabinTop = cabinY + cabinH / 2 + glassBevel;
  const roofY = cabinTop + 0.035;
  const roofGeo = new THREE.BoxGeometry(
    W * profile.roofWidthRatio,
    0.07,
    L * profile.roofLengthRatio,
  );

  const parts: StaticPart[] = [
    { geo: bodyGeo, x: 0, y: bodyY, z: 0, key: 'body' },
    { geo: cabinGeo, x: 0, y: cabinY, z: cabinZ, key: 'glass' },
    { geo: roofGeo, x: 0, y: roofY, z: cabinZ, key: 'body' },
  ];

  parts.push(
    {
      geo: new THREE.BoxGeometry(W * 0.98, 0.18, 0.16),
      x: 0,
      y: wheelR + 0.13,
      z: L / 2 + 0.06,
      key: 'dark',
    },
    {
      geo: new THREE.BoxGeometry(W * 0.98, 0.18, 0.16),
      x: 0,
      y: wheelR + 0.13,
      z: -L / 2 - 0.06,
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

export function buildVehicle(spec: VehicleSpec, color: string): VehicleVisuals {
  const group = new THREE.Group();
  const L = spec.length;
  const W = spec.width;
  const H = spec.height;

  const bodyMat = material(
    `body:${color}`,
    () => new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.55 }),
  );
  const glassMat = material(
    'glass',
    () => new THREE.MeshStandardMaterial({ color: 0x0d1820, roughness: 0.08, metalness: 0.55 }),
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
    castShadow = true,
  ): void => {
    if (!geo) return;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  attachStatic(statics.body, bodyMat);
  attachStatic(statics.glass, glassMat);
  attachStatic(statics.dark, darkMat);
  attachStatic(statics.headlight, headlightMat, false);
  attachStatic(statics.taillight, taillightMat, false);
  attachStatic(statics.roof, roofMat, false);
  attachStatic(statics.lightbarRed, lightbarRedMat, false);
  attachStatic(statics.lightbarBlue, lightbarBlueMat, false);
  attachStatic(statics.stripe, stripeMat);

  const wheelR = 0.32;
  const wheelGeo = geometry(
    'wheel-tire',
    () => new THREE.CylinderGeometry(wheelR, wheelR, 0.24, 16),
  );
  const rimGeo = geometry(
    'wheel-rim',
    () => new THREE.CylinderGeometry(0.2, 0.2, 0.26, 12),
  );
  const hubGeo = geometry(
    'wheel-hub',
    () => new THREE.CylinderGeometry(0.06, 0.06, 0.28, 8),
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
    const tire = new THREE.Mesh(wheelGeo, tireMat);
    tire.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.castShadow = true;
    const hub = new THREE.Mesh(hubGeo, darkMat);
    wheel.add(tire, rim, hub);
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
