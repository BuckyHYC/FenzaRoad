import * as THREE from 'three';
import {
  CAMERA_CONFIG,
  COLORS,
  PHYSICS,
  RACE_CONFIG,
  VEHICLES,
  WORLD,
} from './Constants';
import { eventBus, Events } from './EventBus';
import { gameState } from './GameState';
import type { CameraMode } from './types';
import { InputSystem } from '../systems/InputSystem';
import { AudioSystem } from '../systems/AudioSystem';
import { buildCity, type City } from '../level/CityBuilder';
import { createSkybox, createSkyTexture } from '../level/Skybox';
import { PlayerVehicle } from '../gameplay/PlayerVehicle';
import { setVehicleEnvMap } from '../gameplay/VehicleFactory';
import { TrafficSystem } from '../gameplay/TrafficSystem';
import { PedestrianSystem, type PedestrianCollider } from '../gameplay/PedestrianSystem';
import { RaceManager } from '../gameplay/RaceManager';
import { UIManager } from '../ui/UIManager';

interface MinimapDot {
  x: number;
  z: number;
  isPlayer: boolean;
}

interface ColliderBody {
  x: number;
  z: number;
  radius: number;
  vehicle: PlayerVehicle;
}

function vehicleMass(vehicle: PlayerVehicle): number {
  return (
    vehicle.spec.length *
    vehicle.spec.width *
    vehicle.spec.height *
    PHYSICS.VEHICLE_MASS_DENSITY
  );
}

export class Game {
  readonly debug: {
    finishRace: () => void;
    nextLap: () => void;
    teleport: (x: number, z: number) => void;
  };

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sky: THREE.Mesh;
  private readonly clock = new THREE.Clock();
  private readonly sun: THREE.DirectionalLight;
  private readonly city: City;
  private readonly ui: UIManager;
  private readonly input: InputSystem;
  private readonly audio: AudioSystem;
  private readonly traffic: TrafficSystem;
  private readonly pedestrians: PedestrianSystem;
  private readonly race: RaceManager;
  private readonly aiVehicles: PlayerVehicle[] = [];
  private player: PlayerVehicle;
  private showcase: PlayerVehicle;
  private cameraMode: CameraMode = 'chase';
  private accumulator = 0;
  private orbitTime = 0;
  private timeSec = 0;
  private frameCount = 0;
  private frameTime = 0;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraLook = new THREE.Vector3();

  constructor(container: HTMLElement) {
    const lowPowerRender =
      typeof navigator !== 'undefined' && navigator.webdriver === true;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    });
    const renderScale = lowPowerRender ? 0.8 : 1.5;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, renderScale));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = !lowPowerRender;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.SKY);
    this.scene.fog = new THREE.FogExp2(COLORS.FOG, 0.0016);
    this.sky = createSkybox();
    this.scene.add(this.sky);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTexture = pmrem.fromEquirectangular(createSkyTexture()).texture;
    setVehicleEnvMap(envTexture);
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(
      CAMERA_CONFIG.FOV,
      window.innerWidth / window.innerHeight,
      CAMERA_CONFIG.NEAR,
      CAMERA_CONFIG.FAR,
    );

    const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x6d8f6a, 0.9);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.7);
    this.sun.position.set(120, 180, 90);
    this.sun.castShadow = !lowPowerRender;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 600;
    this.sun.shadow.camera.left = -140;
    this.sun.shadow.camera.right = 140;
    this.sun.shadow.camera.top = 140;
    this.sun.shadow.camera.bottom = -140;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.city = buildCity(this.scene);
    this.input = new InputSystem();
    this.audio = new AudioSystem();
    this.player = this.createPlayer(gameState.player.vehicleId, gameState.player.color);
    this.player.visuals.group.visible = false;
    this.showcase = this.createPlayer(gameState.player.vehicleId, gameState.player.color);
    this.traffic = new TrafficSystem(this.city, this.scene);
    this.pedestrians = new PedestrianSystem(this.city, this.scene);
    this.race = new RaceManager(this.city.raceCheckpoints);
    this.ui = new UIManager(this, this.input, container);

    window.addEventListener('resize', this.onResize);

    this.debug = {
      finishRace: () => this.debugFinishRace(),
      nextLap: () => this.debugNextLap(),
      teleport: (x: number, z: number) => this.debugTeleport(x, z),
    };

    this.renderer.setAnimationLoop(this.animate);
    this.showMenu();
  }

  getFps(): number {
    return this.frameTime > 0 ? this.frameCount / this.frameTime : 0;
  }

  getMinimapDots(): MinimapDot[] {
    const dots: MinimapDot[] = [
      { x: this.player.x, z: this.player.z, isPlayer: true },
    ];
    if (gameState.mode === 'race') {
      for (const racer of this.race.racers) {
        if (racer.vehicle === this.player) continue;
        dots.push({ x: racer.vehicle.x, z: racer.vehicle.z, isPlayer: false });
      }
    }
    return dots;
  }

  showMenu(): void {
    gameState.setMode('menu');
    this.city.setRacePropsVisible(false);
    this.ui.showMainMenu();
    this.setShowcaseVisible(true);
    this.setPlayerVisible(false);
    this.traffic.setActive(false);
    this.pedestrians.setActive(false);
    this.clearAiVehicles();
    this.placeShowcase();
  }

  showGarage(): void {
    gameState.setMode('garage');
    this.ui.showGarage();
    this.setShowcaseVisible(true);
    this.setPlayerVisible(false);
    this.traffic.setActive(false);
    this.pedestrians.setActive(false);
    this.clearAiVehicles();
    this.placeShowcase();
  }

  showGarageVehicle(vehicleId: string, color: string): void {
    this.scene.remove(this.showcase.visuals.group);
    this.showcase = this.createPlayer(vehicleId, color);
    this.placeShowcase();
  }

  selectGarageVehicle(vehicleId: string, color: string): void {
    gameState.player.vehicleId = vehicleId;
    gameState.player.color = color;
    gameState.save();
    eventBus.emit(Events.GARAGE_SELECTED, { vehicleId, color });
    this.scene.remove(this.player.visuals.group);
    this.player = this.createPlayer(vehicleId, color);
    this.showMenu();
  }

  showRaceMenu(): void {
    gameState.setMode('menu');
    this.city.setRacePropsVisible(false);
    this.ui.showRaceMenu();
    this.setShowcaseVisible(true);
    this.setPlayerVisible(false);
    this.traffic.setActive(false);
    this.placeShowcase();
  }

  startFreeRoam(): void {
    gameState.resetRun();
    gameState.setMode('freeRoam');
    this.city.setRacePropsVisible(false);
    this.ui.showFreeRoamHud();
    this.setShowcaseVisible(false);
    this.setPlayerVisible(true);
    this.traffic.setActive(true);
    this.pedestrians.setActive(true);
    this.clearAiVehicles();
    const center = (WORLD.GRID_SIZE / 2) * WORLD.BLOCK_LENGTH;
    this.player.reset(center - 12, center - 16, Math.PI);
    this.audio.init();
    this.audio.resume();
  }

  startRace(): void {
    const difficulty = gameState.race.difficulty;
    gameState.resetRun();
    gameState.race.difficulty = difficulty;
    gameState.setMode('race');
    this.city.setRacePropsVisible(true);
    this.ui.showRaceHud();
    this.setShowcaseVisible(false);
    this.setPlayerVisible(true);
    this.traffic.setActive(false);
    this.pedestrians.setActive(false);
    this.clearAiVehicles();

    const available = VEHICLES.filter((v) => v.id !== this.player.spec.id);
    for (let i = 0; i < RACE_CONFIG.TOTAL_RACERS - 1; i += 1) {
      const spec = available[i % available.length];
      this.aiVehicles.push(this.createPlayer(spec.id, spec.color, false, false));
    }
    this.race.init(
      this.player,
      this.aiVehicles,
      difficulty,
      this.city.raceStartSlots,
      this.city.raceStartHeading,
    );
    this.race.startCountdown();
    this.audio.init();
    this.audio.resume();
  }

  restartRace(): void {
    this.startRace();
  }

  restartCurrent(): void {
    if (gameState.mode === 'race') this.startRace();
    else this.startFreeRoam();
  }

  togglePause(): void {
    if (gameState.mode !== 'freeRoam' && gameState.mode !== 'race') return;
    if (gameState.mode === 'race' && this.race.phase === 'finished') return;
    gameState.setPaused(!gameState.paused);
    if (gameState.paused) {
      this.audio.suspend();
      this.ui.showPause();
    } else {
      this.audio.resume();
      this.ui.hidePause();
    }
  }

  toggleMute(): void {
    gameState.settings.muted = !gameState.settings.muted;
    this.audio.setMuted(gameState.settings.muted);
    gameState.save();
    this.ui.refreshMuteButton();
    eventBus.emit(Events.AUDIO_MUTE, { muted: gameState.settings.muted });
  }

  resetVehicle(): void {
    if (gameState.mode === 'freeRoam') {
      const center = (WORLD.GRID_SIZE / 2) * WORLD.BLOCK_LENGTH;
      this.player.reset(center - 12, center - 16, Math.PI);
      return;
    }
    if (gameState.mode === 'race' && this.race.phase !== 'finished') {
      const racer = this.race.racers[this.race.playerIndex];
      const W = this.city.raceCheckpoints.length;
      const target = this.city.raceCheckpoints[(racer.checkpoint + 1) % W];
      const prev = this.city.raceCheckpoints[racer.checkpoint];
      const dx = target.x - prev.x;
      const dz = target.z - prev.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = dx / len;
      const nz = dz / len;
      this.player.reset(target.x - nx * 26, target.z - nz * 26, Math.atan2(nx, nz));
    }
  }

  private readonly animate = (): void => {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.frameCount += 1;
    this.frameTime += dt;
    if (this.frameCount % 6 === 1) {
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.accumulator += dt;
    while (this.accumulator >= PHYSICS.FIXED_STEP) {
      this.tick(PHYSICS.FIXED_STEP);
      this.accumulator -= PHYSICS.FIXED_STEP;
    }
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  };

  private tick(dt: number): void {
    this.timeSec += dt;
    this.sky.rotation.y = this.timeSec * 0.0025;
    this.input.update();
    this.handleDiscreteInput();
    this.city.updateSignals(this.timeSec);

    if (gameState.paused) {
      this.ui.updateHud();
      return;
    }

    if (gameState.mode === 'menu' || gameState.mode === 'garage') {
      this.orbitTime += dt;
      this.updateOrbitCamera();
    } else if (gameState.mode === 'freeRoam') {
      this.updateFreeRoam(dt);
    } else if (gameState.mode === 'race') {
      this.updateRace(dt);
    }
  }

  private updateFreeRoam(dt: number): void {
    const input = this.input;
    this.player.update(dt, {
      throttle: Math.max(0, input.moveZ),
      brake: Math.max(0, -input.moveZ),
      steer: input.moveX,
      handbrake: input.handbrake,
    });
    this.traffic.update(dt, this.timeSec, this.player.x, this.player.z);
    const colliders: PedestrianCollider[] = [
      {
        x: this.player.x,
        z: this.player.z,
        radius: this.player.spec.width / 2 + PHYSICS.CAR_RADIUS_PADDING,
        isPlayer: true,
      },
      ...this.traffic.getNpcs().map((npc) => ({
        x: npc.x,
        z: npc.z,
        radius: npc.radius,
        isPlayer: false,
      })),
    ];
    this.pedestrians.update(dt, this.player.x, this.player.z, colliders, (intensity, isPlayer) => {
      if (isPlayer) {
        this.player.speed *= 0.42;
        this.player.lateral *= 0.4;
      }
      eventBus.emit(Events.VEHICLE_COLLISION, { intensity });
      this.audio.playCollision(intensity);
    });
    this.resolveWorldCollisions(this.player);
    this.resolveVehicleCollisions();
    this.clampToBounds(this.player);
    this.updateChaseCamera(dt);
    this.updateSun();
    this.syncGameState();
    this.audio.updateEngine(
      this.player.getSpeedMs() / this.player.spec.topSpeedMs,
      Math.max(0, input.moveZ),
    );
    this.ui.updateHud();
  }

  private updateRace(dt: number): void {
    const nowMs = performance.now();
    this.race.update(dt, nowMs);
    const phase = this.race.phase;
    if (phase === 'racing') {
      const input = this.input;
      this.player.update(dt, {
        throttle: Math.max(0, input.moveZ),
        brake: Math.max(0, -input.moveZ),
        steer: input.moveX,
        handbrake: input.handbrake,
      });
      this.resolveWorldCollisions(this.player);
      for (const racer of this.race.racers) {
        this.resolveWorldCollisions(racer.vehicle);
      }
      this.resolveVehicleCollisions();
      this.clampToBounds(this.player);
      this.audio.updateEngine(
        this.player.getSpeedMs() / this.player.spec.topSpeedMs,
        Math.max(0, input.moveZ),
      );
    }
    if (phase === 'racing' || phase === 'countdown' || phase === 'finished') {
      this.updateChaseCamera(dt);
      this.updateSun();
    }
    this.syncGameState();
    this.ui.updateHud();
  }

  private syncGameState(): void {
    gameState.player.x = this.player.x;
    gameState.player.z = this.player.z;
    gameState.player.heading = this.player.heading;
    gameState.player.speedKmh = this.player.getSpeedMs() * 3.6;
    if (gameState.mode === 'race') {
      const racer = this.race.racers[this.race.playerIndex];
      gameState.player.lap = racer.lap;
      gameState.player.position = this.race.getPlayerPosition();
      gameState.player.raceTimeMs = this.race.elapsedMs;
      gameState.race.phase = this.race.phase;
      gameState.race.bestLapMs = Number.isFinite(this.race.bestLapMs)
        ? this.race.bestLapMs
        : 0;
    }
  }

  private handleDiscreteInput(): void {
    if (this.input.consume('pause')) this.togglePause();
    if (this.input.consume('reset')) this.resetVehicle();
    if (this.input.consume('camera')) {
      this.cameraMode = this.cameraMode === 'chase' ? 'hood' : 'chase';
    }
    if (this.input.consume('mute')) this.toggleMute();
  }

  private updateChaseCamera(dt: number): void {
    const fx = Math.sin(this.player.heading);
    const fz = Math.cos(this.player.heading);
    let desiredX: number;
    let desiredY: number;
    let desiredZ: number;
    if (this.cameraMode === 'chase') {
      desiredX = this.player.x - fx * CAMERA_CONFIG.CHASE_DISTANCE;
      desiredY = CAMERA_CONFIG.CHASE_HEIGHT;
      desiredZ = this.player.z - fz * CAMERA_CONFIG.CHASE_DISTANCE;
      this.cameraLook.set(
        this.player.x + fx * CAMERA_CONFIG.LOOK_AHEAD,
        CAMERA_CONFIG.LOOK_HEIGHT,
        this.player.z + fz * CAMERA_CONFIG.LOOK_AHEAD,
      );
    } else {
      desiredX = this.player.x + fx * 0.6;
      desiredY = CAMERA_CONFIG.HOOD_HEIGHT;
      desiredZ = this.player.z + fz * 0.6;
      this.cameraLook.set(
        this.player.x + fx * 14,
        1.1,
        this.player.z + fz * 14,
      );
    }
    const smooth = 1 - Math.exp(-CAMERA_CONFIG.SMOOTH_FACTOR * dt);
    this.cameraPosition.lerp(
      new THREE.Vector3(desiredX, desiredY, desiredZ),
      smooth,
    );
    this.camera.position.copy(this.cameraPosition);
    this.camera.lookAt(this.cameraLook);
  }

  private updateOrbitCamera(): void {
    const radius = CAMERA_CONFIG.ORBIT_DISTANCE;
    const angle = this.orbitTime * 0.28;
    const cx = this.showcase.x;
    const cz = this.showcase.z;
    this.camera.position.set(
      cx + Math.cos(angle) * radius,
      CAMERA_CONFIG.ORBIT_HEIGHT,
      cz + Math.sin(angle) * radius,
    );
    this.camera.lookAt(cx, 1.3, cz);
    this.showcase.visuals.group.rotation.y = -angle * 0.6;
  }

  private updateSun(): void {
    this.sun.position.set(this.player.x + 120, 180, this.player.z + 90);
    this.sun.target.position.set(this.player.x, 0, this.player.z);
    this.sun.target.updateMatrixWorld();
  }

  private resolveWorldCollisions(vehicle: PlayerVehicle): void {
    const radius = vehicle.spec.width / 2 + PHYSICS.CAR_RADIUS_PADDING;
    const velocity = vehicle.getVelocity();
    const emitCollision = (intensity: number): void => {
      if (vehicle !== this.player) return;
      eventBus.emit(Events.VEHICLE_COLLISION, { intensity });
      this.audio.playCollision(intensity);
    };
    for (const box of this.city.buildingColliders) {
      const closestX = Math.max(box.minX, Math.min(vehicle.x, box.maxX));
      const closestZ = Math.max(box.minZ, Math.min(vehicle.z, box.maxZ));
      const dx = vehicle.x - closestX;
      const dz = vehicle.z - closestZ;
      const distSq = dx * dx + dz * dz;
      if (distSq >= radius * radius) continue;
      let nx: number;
      let nz: number;
      let overlap: number;
      if (distSq < 1e-6) {
        const left = vehicle.x - box.minX;
        const right = box.maxX - vehicle.x;
        const top = vehicle.z - box.minZ;
        const bottom = box.maxZ - vehicle.z;
        const minSide = Math.min(left, right, top, bottom);
        if (minSide === left) {
          nx = -1;
          nz = 0;
          overlap = radius + left;
        } else if (minSide === right) {
          nx = 1;
          nz = 0;
          overlap = radius + right;
        } else if (minSide === top) {
          nx = 0;
          nz = -1;
          overlap = radius + top;
        } else {
          nx = 0;
          nz = 1;
          overlap = radius + bottom;
        }
      } else {
        const dist = Math.sqrt(distSq);
        nx = dx / dist;
        nz = dz / dist;
        overlap = radius - dist;
      }
      vehicle.x += nx * overlap;
      vehicle.z += nz * overlap;
      const vn = velocity.vx * nx + velocity.vz * nz;
      if (vn < -1.5) {
        vehicle.speed *= 0.5;
        vehicle.lateral *= 0.45;
        emitCollision(Math.min(1, -vn / 12));
      }
    }
    for (const tree of this.city.treeColliders) {
      const dx = vehicle.x - tree.x;
      const dz = vehicle.z - tree.z;
      const minDist = radius + tree.radius;
      const distSq = dx * dx + dz * dz;
      if (distSq >= minDist * minDist || distSq < 1e-6) continue;
      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const nz = dz / dist;
      vehicle.x += nx * (minDist - dist);
      vehicle.z += nz * (minDist - dist);
      const vn = velocity.vx * nx + velocity.vz * nz;
      if (vn < -1.5) {
        vehicle.speed *= 0.5;
        vehicle.lateral *= 0.45;
        emitCollision(Math.min(1, -vn / 12));
      }
    }
    if (gameState.mode === 'race') {
      for (const box of this.city.raceBarriers) {
        const closestX = Math.max(box.minX, Math.min(vehicle.x, box.maxX));
        const closestZ = Math.max(box.minZ, Math.min(vehicle.z, box.maxZ));
        const dx = vehicle.x - closestX;
        const dz = vehicle.z - closestZ;
        const distSq = dx * dx + dz * dz;
        if (distSq >= radius * radius) continue;
        let nx: number;
        let nz: number;
        let overlap: number;
        if (distSq < 1e-6) {
          const left = vehicle.x - box.minX;
          const right = box.maxX - vehicle.x;
          const top = vehicle.z - box.minZ;
          const bottom = box.maxZ - vehicle.z;
          const minSide = Math.min(left, right, top, bottom);
          if (minSide === left) {
            nx = -1;
            nz = 0;
            overlap = radius + left;
          } else if (minSide === right) {
            nx = 1;
            nz = 0;
            overlap = radius + right;
          } else if (minSide === top) {
            nx = 0;
            nz = -1;
            overlap = radius + top;
          } else {
            nx = 0;
            nz = 1;
            overlap = radius + bottom;
          }
        } else {
          const dist = Math.sqrt(distSq);
          nx = dx / dist;
          nz = dz / dist;
          overlap = radius - dist;
        }
        vehicle.x += nx * overlap;
        vehicle.z += nz * overlap;
        const vn = velocity.vx * nx + velocity.vz * nz;
        if (vn < -1.5) {
          vehicle.speed *= 0.55;
          vehicle.lateral *= 0.5;
          emitCollision(Math.min(1, -vn / 10));
        }
      }
    }
  }

  private resolveVehicleCollisions(): void {
    const others: ColliderBody[] = [
      ...this.traffic.getNpcs(),
      ...this.race.racers.map((racer) => ({
        x: racer.vehicle.x,
        z: racer.vehicle.z,
        radius: racer.vehicle.spec.width / 2 + PHYSICS.CAR_RADIUS_PADDING,
        vehicle: racer.vehicle,
      })),
    ];
    for (const other of others) {
      if (other.vehicle === this.player) continue;
      this.resolvePair(this.player, other);
    }
    for (let i = 0; i < others.length; i += 1) {
      for (let j = i + 1; j < others.length; j += 1) {
        this.resolvePair(others[i].vehicle, others[j]);
      }
    }
  }

  private resolvePair(vehicle: PlayerVehicle, other: ColliderBody): void {
    const otherVehicle = other.vehicle;
    const radius = vehicle.spec.width / 2 + PHYSICS.CAR_RADIUS_PADDING;
    const dx = other.x - vehicle.x;
    const dz = other.z - vehicle.z;
    const minDist = radius + other.radius;
    const distSq = dx * dx + dz * dz;
    if (distSq >= minDist * minDist || distSq < 0.0001) return;
    const dist = Math.sqrt(distSq);
    const nx = dx / dist;
    const nz = dz / dist;
    const overlap = (minDist - dist) / 2;
    vehicle.x -= nx * overlap;
    vehicle.z -= nz * overlap;
    otherVehicle.x += nx * overlap;
    otherVehicle.z += nz * overlap;

    const va = vehicle.getVelocity();
    const vb = otherVehicle.getVelocity();
    const relN = (va.vx - vb.vx) * nx + (va.vz - vb.vz) * nz;
    if (relN >= 0) return;

    const ma = vehicleMass(vehicle);
    const mb = vehicleMass(otherVehicle);
    const impulse =
      (-(1 + PHYSICS.COLLISION_RESTITUTION) * relN) / (1 / ma + 1 / mb);
    const iax = (impulse / ma) * nx;
    const iaz = (impulse / ma) * nz;
    const ibx = (impulse / mb) * nx;
    const ibz = (impulse / mb) * nz;
    vehicle.setVelocity(va.vx - iax, va.vz - iaz);
    otherVehicle.setVelocity(vb.vx + ibx, vb.vz + ibz);
    if (vehicle !== this.player) this.traffic.syncVehicleSpeed(vehicle);
    if (otherVehicle !== this.player) this.traffic.syncVehicleSpeed(otherVehicle);
    const intensity = Math.min(1, -relN / 14);
    eventBus.emit(Events.VEHICLE_COLLISION, { intensity });
    this.audio.playCollision(intensity);
  }

  private clampToBounds(vehicle: PlayerVehicle): void {
    vehicle.x = Math.max(
      this.city.bounds.minX + 6,
      Math.min(this.city.bounds.maxX - 6, vehicle.x),
    );
    vehicle.z = Math.max(
      this.city.bounds.minZ + 6,
      Math.min(this.city.bounds.maxZ - 6, vehicle.z),
    );
  }

  private createPlayer(
    vehicleId: string,
    color: string,
    castShadows = true,
    highQuality = true,
  ): PlayerVehicle {
    const spec = VEHICLES.find((v) => v.id === vehicleId) ?? VEHICLES[0];
    return new PlayerVehicle(spec, color, this.scene, castShadows, highQuality);
  }

  private setShowcaseVisible(visible: boolean): void {
    this.showcase.visuals.group.visible = visible;
  }

  private setPlayerVisible(visible: boolean): void {
    this.player.visuals.group.visible = visible;
  }

  private placeShowcase(): void {
    const center = (WORLD.GRID_SIZE / 2) * WORLD.BLOCK_LENGTH;
    this.showcase.reset(center, center, 0);
    this.showcase.visuals.group.visible = true;
  }

  private clearAiVehicles(): void {
    for (const vehicle of this.aiVehicles) {
      this.scene.remove(vehicle.visuals.group);
    }
    this.aiVehicles.length = 0;
  }

  private debugFinishRace(): void {
    if (gameState.mode !== 'race') return;
    this.race.debugFinish();
  }

  private debugNextLap(): void {
    if (gameState.mode !== 'race' || this.race.phase !== 'racing') return;
    const racer = this.race.racers[this.race.playerIndex];
    racer.checkpoint = this.city.raceCheckpoints.length - 2;
    racer.lap = Math.min(racer.lap + 1, RACE_CONFIG.TOTAL_LAPS - 1);
  }

  private debugTeleport(x: number, z: number): void {
    this.player.x = x;
    this.player.z = z;
    this.player.visuals.group.position.set(x, 0, z);
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };
}
