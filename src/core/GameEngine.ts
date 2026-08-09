import * as THREE from 'three';
import {
  AMBIENT_LIGHT_INTENSITY,
  DIRECTIONAL_LIGHT_INTENSITY,
  FIXED_TIMESTEP,
  GROUND_COLOR,
  GROUND_SIZE,
  SHADOW_MAP_SIZE,
} from '../config/constants';

type UpdateCallback = (deltaTime: number) => void;

export default class GameEngine {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  private readonly updateCallbacks: UpdateCallback[] = [];
  private accumulator = 0;
  private lastTime = 0;
  private animationId = 0;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);

    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.camera.position.set(0, 3, 7);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.setupLights();
    this.setupGround();
    window.addEventListener('resize', this.onResize);
  }

  registerUpdate(callback: UpdateCallback): void {
    this.updateCallbacks.push(callback);
  }

  start(): void {
    this.lastTime = performance.now();
    this.animationId = requestAnimationFrame(this.loop);
  }

  private readonly loop = (currentTime: number): void => {
    this.animationId = requestAnimationFrame(this.loop);

    const frameDelta = Math.min((currentTime - this.lastTime) / 1000, 0.1);
    this.lastTime = currentTime;
    this.accumulator += frameDelta;

    while (this.accumulator >= FIXED_TIMESTEP) {
      for (const callback of this.updateCallbacks) {
        callback(FIXED_TIMESTEP);
      }
      this.accumulator -= FIXED_TIMESTEP;
    }

    this.renderer.render(this.scene, this.camera);
  };

  private setupLights(): void {
    const ambient = new THREE.AmbientLight(0xffffff, AMBIENT_LIGHT_INTENSITY);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(
      0xffffff,
      DIRECTIONAL_LIGHT_INTENSITY,
    );
    directional.position.set(50, 80, 30);
    directional.castShadow = true;
    directional.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    directional.shadow.camera.near = 1;
    directional.shadow.camera.far = 200;
    directional.shadow.camera.left = -80;
    directional.shadow.camera.right = 80;
    directional.shadow.camera.top = 80;
    directional.shadow.camera.bottom = -80;
    this.scene.add(directional);
  }

  private setupGround(): void {
    const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
    const material = new THREE.MeshStandardMaterial({ color: GROUND_COLOR });
    const ground = new THREE.Mesh(geometry, material);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  dispose(): void {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}
