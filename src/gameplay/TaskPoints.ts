import * as THREE from 'three';
import { TASK_POINTS, type TaskPointDef } from '../core/Constants';

export interface TaskPointInstance extends TaskPointDef {
  group: THREE.Group;
  ringMat: THREE.MeshBasicMaterial;
  pillarMat: THREE.MeshBasicMaterial;
}

/**
 * 自由漫游城市中的竞速任务触发点：
 * 一圈半透明自发光圆环（呼吸闪烁）+ 中央柔和光柱（远距离导航）。
 * 位置与参数全部来自 Constants.TASK_POINTS 配置。
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
    const pulse = 0.65 + 0.35 * Math.sin(this.time * 2.6);
    for (const point of this.points) {
      point.ringMat.color.setHex(0x3fb0ff).multiplyScalar(pulse);
      point.ringMat.opacity = 0.6 + 0.25 * pulse;
      point.pillarMat.opacity = 0.14 + 0.09 * pulse;
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

    // 发光圆环（平放，双面，呼吸闪烁；不受雾影响，远距离可见）
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x3fb0ff,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(def.radius, 0.16, 8, 56), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.16;
    ring.renderOrder = 2;
    group.add(ring);

    // 内圈细环，增强视觉层次
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x9fd8ff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    const inner = new THREE.Mesh(new THREE.TorusGeometry(def.radius * 0.72, 0.07, 8, 40), innerMat);
    inner.rotation.x = Math.PI / 2;
    inner.position.y = 0.22;
    inner.renderOrder = 3;
    group.add(inner);

    // 中央柔和光柱（远距离可见）
    const pillarMat = new THREE.MeshBasicMaterial({
      color: 0x4db8ff,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 2.6, 46, 12, 1, true),
      pillarMat,
    );
    pillar.position.y = 23;
    pillar.renderOrder = 1;
    group.add(pillar);

    // 地面光斑
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x3fb0ff,
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(def.radius * 0.9, 32), glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.06;
    group.add(glow);

    return { ...def, group, ringMat, pillarMat };
  }
}
