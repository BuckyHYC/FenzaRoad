import * as THREE from 'three';

export const SUN_CONFIG = {
  azimuthDeg: 143,
  elevationDeg: 32,
  angularDiameterDeg: 0.53,
  colorTemperatureK: 5778,
  intensity: 1.55,
} as const;

export function getSunDirection(): { x: number; y: number; z: number } {
  const azimuth = (SUN_CONFIG.azimuthDeg * Math.PI) / 180;
  const elevation = (SUN_CONFIG.elevationDeg * Math.PI) / 180;
  const horizontal = Math.cos(elevation);
  return {
    x: Math.cos(azimuth) * horizontal,
    y: Math.sin(elevation),
    z: Math.sin(azimuth) * horizontal,
  };
}

export function getSunTexturePosition(): { x: number; y: number } {
  const d = getSunDirection();
  let u = Math.atan2(d.z, -d.x) / (Math.PI * 2);
  u = (u + 1) % 1;
  const v = Math.acos(Math.max(-1, Math.min(1, d.y))) / Math.PI;
  return { x: Math.round(u * 1024), y: Math.round(v * 512) };
}

function drawCloud(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  alpha: number,
): void {
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x, y, size * 1.5, size * 0.52, 0, 0, Math.PI * 2);
  ctx.ellipse(x + size * 0.85, y + size * 0.08, size * 0.95, size * 0.4, 0, 0, Math.PI * 2);
  ctx.ellipse(x - size * 0.75, y + size * 0.05, size * 1.05, size * 0.46, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function createSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, '#3f7fc4');
  gradient.addColorStop(0.42, '#77b0e2');
  gradient.addColorStop(0.7, '#b8d9ef');
  gradient.addColorStop(0.86, '#e3eef6');
  gradient.addColorStop(1, '#eef5f9');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 512);

  const sunPos = getSunTexturePosition();
  const sunX = sunPos.x;
  const sunY = sunPos.y;
  const sunGlow = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 110);
  sunGlow.addColorStop(0, 'rgba(255,248,224,0.98)');
  sunGlow.addColorStop(0.18, 'rgba(255,240,200,0.6)');
  sunGlow.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = sunGlow;
  ctx.fillRect(sunX - 115, sunY - 115, 230, 230);
  ctx.fillStyle = 'rgba(255,252,230,0.98)';
  ctx.beginPath();
  ctx.arc(sunX, sunY, 17, 0, Math.PI * 2);
  ctx.fill();

  for (let i = 0; i < 22; i += 1) {
    const x = ((i * 337 + 41) % 1024) + (Math.random() - 0.5) * 80;
    const y = 36 + Math.random() * 210;
    const size = 12 + Math.random() * 18;
    const alpha = 0.32 + Math.random() * 0.38;
    drawCloud(ctx, x, y, size, alpha);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createSkybox(): THREE.Mesh {
  const texture = createSkyTexture();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1600, 32, 16),
    new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    }),
  );
  sky.name = 'skybox';
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}
