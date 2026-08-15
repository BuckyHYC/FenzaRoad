import * as THREE from 'three';
import { TASK_POINTS, type TaskPointDef } from '../core/Constants';

export interface TaskPointInstance extends TaskPointDef {
  group: THREE.Group;
  ringMat: THREE.MeshBasicMaterial;
  pillarMat: THREE.MeshBasicMaterial;
}

/**
 * 自由漫游城市中的竞速任务触发点。
 * 视觉：半透明发光圆柱墙（从任何角度都能看到「圈圈」边界）+ 顶部/地面圆环 +
 * 明亮光柱 + 悬浮信标。常亮材质（不依赖 additive 或色调映射亮度），
 * 呼吸动画只调透明度。触发区以地面坐标计算（半径与墙一致）。
 */
export class TaskPoints {
  readonly points: TaskPointInstance[] = [];
  private readonly group = new THREE.Group();
  private active = false;
  private time = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    for (const def of TASK_POINTS) {
      this.points.push(this.buildPoint(def));
    }
    this.group.visible = false;
  }

  setActive(active: boolean): void {
    this.active = active;
    this.group.visible = active;
  }

  isActive(): boolean {
    return this.active;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.time += dt;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.6);
    for (const point of this.points) {
      point.ringMat.opacity = 0.34 + 0.14 * pulse;
      point.pillarMat.opacity = 0.34 + 0.16 * pulse;
    }
  }

  /** 返回玩家当前所在的触发点（无则 null），触发半径 = 圆环半径 + 边距 */
  nearestActive(playerX: number, playerZ: number): TaskPointInstance | null {
    if (!this.active) return null;
    for (const point of this.points) {
      const dx = point.x - playerX;
      const dz = point.z - playerZ;
      const radius = point.radius + 1.5;
      if (dx * dx + dz * dz <= radius * radius) return point;
    }
    return null;
  }

  private buildPoint(def: TaskPointDef): TaskPointInstance {
    const group = new THREE.Group();
    group.name = `task-point-${def.id}`;
    group.position.set(def.x, 0, def.z);
    const r = def.radius;
    const wallH = 3.4;

    // —— 发光圆柱墙：任何视角都能看到圈状边界 ——
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x2e9bff,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, wallH, 48, 1, true),
      ringMat,
    );
    wall.position.y = wallH / 2;
    wall.renderOrder = 1;
    group.add(wall);

    // —— 顶部实心圆环（明确勾勒边界）——
    const rimMat = new THREE.MeshBasicMaterial({
      color: 0x55b4ff,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.32, 10, 64), rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = wallH + 0.1;
    rim.renderOrder = 3;
    group.add(rim);

    // —— 地面圆环（俯视/进入时可见）——
    const groundRimMat = new THREE.MeshBasicMaterial({
      color: 0x55b4ff,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const groundRim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.18, 8, 56), groundRimMat);
    groundRim.rotation.x = Math.PI / 2;
    groundRim.position.y = 0.18;
    groundRim.renderOrder = 2;
    group.add(groundRim);

    // —— 中央光柱 ——
    const pillarMat = new THREE.MeshBasicMaterial({
      color: 0x4db8ff,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 3.6, 44, 14, 1, true),
      pillarMat,
    );
    pillar.position.y = 22.5;
    pillar.renderOrder = 0;
    group.add(pillar);

    // —— 悬浮信标（远距离亮点）——
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0xbfe9ff,
      fog: false,
      toneMapped: false,
    });
    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), beaconMat);
    beacon.position.y = 11.5;
    beacon.renderOrder = 5;
    group.add(beacon);
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x2e9bff,
      transparent: true,
      opacity: 0.45,
      fog: false,
      toneMapped: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const halo = new THREE.Mesh(new THREE.SphereGeometry(2.6, 12, 9), haloMat);
    halo.position.y = 11.5;
    halo.renderOrder = 5;
    group.add(halo);

    // —— 地面光斑 ——
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x2e9bff,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(r * 0.95, 40), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.06;
    glow.renderOrder = 0;
    group.add(glow);

    return { ...def, group, ringMat, pillarMat };
  }
}
