import * as THREE from 'three';
import {
  CAMERA_CONFIG,
  COLORS,
  DISTANCE_COIN_EVERY_KM,
  PHYSICS,
  PROGRESS_SAVE_INTERVAL,
  QUALITY_PRESETS,
  RACE_CONFIG,
  VEHICLES,
  WORLD,
} from './Constants';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { eventBus, Events } from './EventBus';
import { gameState } from './GameState';
import type {
  CameraMode,
  Difficulty,
  MapMode,
  QualityPreset,
  RaceLayout,
  RaceResultData,
  RoomInfo,
} from './types';
import { InputSystem } from '../systems/InputSystem';
import { AudioSystem } from '../systems/AudioSystem';
import { buildCity, type City } from '../level/CityBuilder';
import { buildEndlessWorld } from '../level/EndlessWorld';
import { createSkybox, createSkyTexture, getSunDirection } from '../level/Skybox';
import { PlayerVehicle } from '../gameplay/PlayerVehicle';
import { setVehicleEnvMap } from '../gameplay/VehicleFactory';
import {
  buildAabbGrid,
  buildCircleGrid,
  queryAabbGrid,
  queryCircleGrid,
  type AabbGrid,
  type CircleGrid,
} from '../gameplay/SpatialGrid';
import { TrafficSystem } from '../gameplay/TrafficSystem';
import { PedestrianSystem, type PedestrianCollider } from '../gameplay/PedestrianSystem';
import { RaceManager } from '../gameplay/RaceManager';
import { TaskPoints, type TaskPointInstance } from '../gameplay/TaskPoints';
import { MultiplayerClient } from '../multiplayer/MultiplayerClient';
import { UIManager } from '../ui/UIManager';

interface MinimapDot {
  x: number;
  z: number;
  isPlayer: boolean;
  kind?: 'task';
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
  private readonly finiteCity: City;
  private endlessCity: City | null = null;
  private city: City;
  private readonly ui: UIManager;
  private readonly input: InputSystem;
  private readonly audio: AudioSystem;
  private readonly traffic: TrafficSystem;
  private readonly pedestrians: PedestrianSystem;
  private readonly taskPoints: TaskPoints;
  private activeTaskPoint: TaskPointInstance | null = null;
  private taskPanelOpen = false;
  private taskReturn: { x: number; z: number; heading: number } | null = null;
  private race: RaceManager;
  private readonly aiVehicles: PlayerVehicle[] = [];
  private readonly remoteVehicles = new Map<string, PlayerVehicle>();
  private readonly remoteTargets = new Map<string, { x: number; z: number; heading: number; speedMs: number }>();
  private readonly multiplayerClient = new MultiplayerClient();
  private buildingGrid: AabbGrid | null = null;
  private treeGrid: CircleGrid | null = null;
  private collisionGridCity: City | null = null;
  private colliderGridRevision = -1;
  private renderScale = 1;
  private adaptiveScaleTimer = 0;
  private adaptiveScaleSamples = 0;
  private adaptiveScaleFrameMs = 0;
  private player: PlayerVehicle;
  private showcase: PlayerVehicle;
  private cameraMode: CameraMode = 'chase';
  private quality: QualityPreset;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private ssaoPass: SSAOPass | null = null;
  private multiplayerStateTimer = 0;
  private accumulator = 0;
  private orbitTime = 0;
  private timeSec = 0;
  private frameCount = 0;
  private frameTime = 0;
  private saveTimer = 0;
  private distanceCoinAccum = 0;
  private readonly cameraPosition = new THREE.Vector3();
  private readonly cameraLook = new THREE.Vector3();
  private orbitYaw = 0;
  private activeFov: number = CAMERA_CONFIG.FOV;
  private garageSwitchT = 1;
  private thumbRenderer: THREE.WebGLRenderer | null = null;
  private thumbScene: THREE.Scene | null = null;
  private thumbCamera: THREE.PerspectiveCamera | null = null;
  private readonly thumbnailCache = new Map<string, string>();

  constructor(container: HTMLElement) {
    const lowPowerRender =
      typeof navigator !== 'undefined' && navigator.webdriver === true;
    const qualitySetting = gameState.settings.quality;
    this.quality =
      qualitySetting === 'auto'
        ? lowPowerRender
          ? 'low'
          : 'medium'
        : qualitySetting;
    const qualityConfig = QUALITY_PRESETS[this.quality];
    this.renderer = new THREE.WebGLRenderer({
      antialias: qualityConfig.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, qualityConfig.pixelRatio),
    );
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = qualityConfig.shadowMapSize > 0;
    this.renderer.shadowMap.type = qualityConfig.pcfSoft
      ? THREE.PCFSoftShadowMap
      : THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.SKY);
    this.scene.fog = new THREE.FogExp2(COLORS.FOG, 0.0025);
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
    const sunDir = getSunDirection();
    this.sun.position.set(sunDir.x * 300, sunDir.y * 300, sunDir.z * 300);
    this.sun.castShadow = qualityConfig.shadowMapSize > 0;
    this.sun.shadow.mapSize.set(
      qualityConfig.shadowMapSize,
      qualityConfig.shadowMapSize,
    );
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 500;
    this.sun.shadow.camera.left = -120;
    this.sun.shadow.camera.right = 120;
    this.sun.shadow.camera.top = 120;
    this.sun.shadow.camera.bottom = -120;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.012;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.applyQuality();
    this.finiteCity = buildCity(this.scene, { quality: this.quality });
    this.city = this.finiteCity;
    this.input = new InputSystem();
    this.audio = new AudioSystem();
    this.audio.init();
    this.audio.setMuted(gameState.settings.muted);
    this.audio.setVolumes(
      gameState.settings.bgmVolume,
      gameState.settings.sfxVolume,
    );
    this.player = this.createPlayer(gameState.player.vehicleId, gameState.player.color);
    this.player.visuals.group.visible = false;
    this.showcase = this.createPlayer(gameState.player.vehicleId, gameState.player.color);
    this.traffic = new TrafficSystem(this.finiteCity, this.scene);
    this.pedestrians = new PedestrianSystem(this.finiteCity, this.scene);
    this.taskPoints = new TaskPoints(this.scene);
    const defaultLayout = this.finiteCity.raceLayouts[0];
    this.race = new RaceManager(
      defaultLayout.checkpoints.map((p) => new THREE.Vector3(p.x, 0, p.z)),
      defaultLayout,
    );
    this.ui = new UIManager(this, this.input, container);

    this.subscribeMultiplayerEvents();

    window.addEventListener('resize', this.onResize);

    this.debug = {
      finishRace: () => this.debugFinishRace(),
      nextLap: () => this.debugNextLap(),
      teleport: (x: number, z: number) => this.debugTeleport(x, z),
    };

    const unlockAudio = (): void => {
      this.audio.resume();
      this.audio.startBgm();
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

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
    if (this.taskPoints.isActive()) {
      for (const point of this.taskPoints.points) {
        dots.push({ x: point.x, z: point.z, isPlayer: false, kind: 'task' });
      }
    }
    if (gameState.mode === 'race') {
      for (const racer of this.race.racers) {
        if (racer.vehicle === this.player) continue;
        dots.push({ x: racer.vehicle.x, z: racer.vehicle.z, isPlayer: false });
      }
    }
    if (gameState.mode === 'multiplayer') {
      for (const vehicle of this.remoteVehicles.values()) {
        dots.push({ x: vehicle.x, z: vehicle.z, isPlayer: false });
      }
    }
    return dots;
  }

  getRaceRoute(): { x: number; z: number }[] {
    if (gameState.mode !== 'race') return [];
    const route =
      this.race.routePoints.length > 0
        ? this.race.routePoints
        : this.race.checkpoints;
    return route.map((point) => ({ x: point.x, z: point.z }));
  }

  private setWorld(mapMode: MapMode): void {
    const target =
      mapMode === 'endless' ? this.ensureEndlessCity() : this.finiteCity;
    const changed = this.city !== target;
    this.city = target;
    this.finiteCity.group.visible = mapMode === 'finite';
    if (this.endlessCity) {
      this.endlessCity.group.visible = mapMode === 'endless';
    }
    if (changed) {
      this.traffic.setCity(target);
      this.pedestrians.setCity(target);
      this.traffic.setActive(false);
      this.pedestrians.setActive(false);
      this.clearAiVehicles();
      this.clearRemoteVehicles();
    }
  }

  private ensureEndlessCity(): City {
    if (!this.endlessCity) {
      this.endlessCity = buildEndlessWorld(this.scene);
      this.endlessCity.group.visible = false;
    }
    return this.endlessCity;
  }

  private leaveMultiplayerIfNeeded(): void {
    if (
      gameState.mode === 'lobby' ||
      gameState.mode === 'multiplayer' ||
      gameState.multiplayer.roomId
    ) {
      this.multiplayerClient.leaveRoom();
      this.multiplayerClient.disconnect();
      this.clearRemoteVehicles();
      gameState.multiplayer.roomId = null;
      gameState.multiplayer.roomName = '';
      gameState.multiplayer.isHost = false;
      gameState.multiplayer.players = [];
      gameState.multiplayer.connected = false;
    }
  }

  showMenu(): void {
    this.leaveMultiplayerIfNeeded();
    this.setWorld('finite');
    gameState.setMode('menu');
    this.city.setRacePropsVisible(false);
    this.ui.showMainMenu();
    this.setShowcaseVisible(true);
    this.setPlayerVisible(false);
    this.finishGarageSwitch();
    this.traffic.setActive(false);
    this.pedestrians.setActive(false);
    this.clearAiVehicles();
    this.placeShowcase();
    this.audio.setRaceMusic(false);
    this.taskPoints.setActive(false);
    this.taskReturn = null;
    this.ui.setTaskRaceReturn(false);
  }

  showSettings(): void {
    this.leaveMultiplayerIfNeeded();
    this.setWorld('finite');
    gameState.setMode('menu');
    this.city.setRacePropsVisible(false);
    this.ui.showSettings();
    this.setShowcaseVisible(true);
    this.setPlayerVisible(false);
    this.finishGarageSwitch();
    this.traffic.setActive(false);
    this.pedestrians.setActive(false);
    this.clearAiVehicles();
    this.placeShowcase();
    this.taskPoints.setActive(false);
  }

  showProgress(): void {
    this.leaveMultiplayerIfNeeded();
    this.setWorld('finite');
    gameState.setMode('menu');
    this.city.setRacePropsVisible(false);
    this.ui.showProgress();
    this.setShowcaseVisible(true);
    this.setPlayerVisible(false);
    this.finishGarageSwitch();
    this.traffic.setActive(false);
    this.pedestrians.setActive(false);
    this.clearAiVehicles();
    this.placeShowcase();
    this.taskPoints.setActive(false);
  }

  showGarage(): void {
    this.leaveMultiplayerIfNeeded();
    this.setWorld('finite');
    gameState.setMode('garage');
    this.ui.showGarage();
    this.setShowcaseVisible(true);
    this.setPlayerVisible(false);
    this.finishGarageSwitch();
    this.traffic.setActive(false);
    this.pedestrians.setActive(false);
    this.clearAiVehicles();
    this.placeShowcase();
    this.taskPoints.setActive(false);
  }

  showGarageVehicle(vehicleId: string, color: string): void {
    this.scene.remove(this.showcase.visuals.group);
    this.showcase = this.createPlayer(vehicleId, color);
    this.placeShowcase();
    this.garageSwitchT = 0;
    this.showcase.visuals.group.scale.setScalar(0.25);
  }

  captureGarageThumbnail(): string | null {
    const cacheKey = `${this.showcase.spec.id}:${this.showcase.spec.color}`;
    const cached = this.thumbnailCache.get(cacheKey);
    if (cached) return cached;
    if (!this.thumbRenderer) {
      this.thumbRenderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: false,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      });
      this.thumbRenderer.setPixelRatio(1);
      this.thumbRenderer.setSize(440, 280);
      this.thumbRenderer.shadowMap.enabled = true;
      this.thumbRenderer.shadowMap.type = THREE.PCFShadowMap;
    }
    if (!this.thumbScene || !this.thumbCamera) {
      const scene = new THREE.Scene();
      const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x6d8f6a, 1.1);
      scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xfff2d8, 2.4);
      sun.position.set(5, 8, 6);
      sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 30;
      sun.shadow.camera.left = -6;
      sun.shadow.camera.right = 6;
      sun.shadow.camera.top = 6;
      sun.shadow.camera.bottom = -6;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.02;
      scene.add(sun);
      scene.add(sun.target);
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(14, 14),
        new THREE.MeshStandardMaterial({
          color: 0x121820,
          roughness: 0.9,
          metalness: 0.1,
        }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.02;
      ground.receiveShadow = true;
      scene.add(ground);
      const camera = new THREE.PerspectiveCamera(32, 440 / 280, 0.1, 60);
      camera.position.set(4.8, 2.5, 5.6);
      camera.lookAt(0, 0.45, 0);
      this.thumbScene = scene;
      this.thumbCamera = camera;
    }

    const group = this.showcase.visuals.group;
    const prevScale = group.scale.x;
    this.scene.remove(group);
    this.thumbScene.add(group);
    group.position.set(0, 0, 0);
    group.rotation.set(0, 0.55, 0);
    group.scale.setScalar(1);
    group.updateMatrixWorld(true);
    try {
      this.thumbRenderer.render(this.thumbScene, this.thumbCamera);
      const url = this.thumbRenderer.domElement.toDataURL('image/png');
      this.thumbnailCache.set(cacheKey, url);
      return url;
    } finally {
      group.scale.setScalar(prevScale);
      this.thumbScene.remove(group);
      this.scene.add(group);
      this.placeShowcase();
    }
  }

  selectGarageVehicle(vehicleId: string, color: string): void {
    gameState.player.vehicleId = vehicleId;
    gameState.player.color = color;
    gameState.save();
    eventBus.emit(Events.GARAGE_SELECTED, { vehicleId, color });
    this.scene.remove(this.player.visuals.group);
    this.player = this.createPlayer(vehicleId, color);
    if (this.player.visuals.glassMesh) {
      this.player.visuals.glassMesh.visible = this.cameraMode === 'chase';
    }
    this.applyInteriorVisibility();
    this.showMenu();
  }

  showRaceMenu(): void {
    this.leaveMultiplayerIfNeeded();
    this.setWorld('finite');
    gameState.setMode('menu');
    this.city.setRacePropsVisible(false);
    this.ui.showRaceMenu();
    this.setShowcaseVisible(true);
    this.setPlayerVisible(false);
    this.finishGarageSwitch();
    this.traffic.setActive(false);
    this.placeShowcase();
    this.taskPoints.setActive(false);
  }

  showMultiplayer(): void {
    this.setWorld('finite');
    gameState.setMode('lobby');
    gameState.multiplayer.connecting = true;
    gameState.multiplayer.connected = false;
    this.ui.showMultiplayer();
    this.setShowcaseVisible(true);
    this.setPlayerVisible(false);
    this.traffic.setActive(false);
    this.pedestrians.setActive(false);
    this.clearAiVehicles();
    this.placeShowcase();
    this.taskPoints.setActive(false);
    this.multiplayerClient.connect();
  }

  createMultiplayerRoom(name: string): void {
    this.multiplayerClient.createRoom(name);
  }

  joinMultiplayerRoom(roomId: string): void {
    this.multiplayerClient.joinRoom(roomId);
  }

  leaveMultiplayerRoom(): void {
    this.multiplayerClient.leaveRoom();
    this.showMultiplayer();
  }

  startMultiplayerGame(): void {
    this.multiplayerClient.startGame();
  }

  private getActiveRaceLayout(): RaceLayout {
    return (
      this.finiteCity.raceLayouts.find(
        (layout) => layout.id === gameState.race.layoutId,
      ) ?? this.finiteCity.raceLayouts[0]
    );
  }

  startMultiplayer(): void {
    this.setWorld('finite');
    gameState.resetRun();
    gameState.setMode('multiplayer');
    this.city.setRacePropsVisible(false);
    this.ui.showMultiplayerHud();
    this.setShowcaseVisible(false);
    this.setPlayerVisible(true);
    this.traffic.setActive(false);
    this.pedestrians.setActive(false);
    this.clearAiVehicles();
    this.taskPoints.setActive(false);
    this.activeTaskPoint = null;
    const playerIndex = Math.max(
      0,
      gameState.multiplayer.players.findIndex(
        (p) => p.username === gameState.multiplayer.username,
      ),
    );
    const defaultLayout = this.finiteCity.raceLayouts[0];
    const slot =
      defaultLayout.startSlots[playerIndex % defaultLayout.startSlots.length];
    this.player.reset(slot.x, slot.z, Math.PI / 2);
    this.audio.init();
    this.audio.resume();
    this.audio.startBgm();
    this.audio.setRaceMusic(false);
  }

  startFreeRoam(mapMode: MapMode = 'finite'): void {
    this.leaveMultiplayerIfNeeded();
    gameState.setMapMode(mapMode);
    this.setWorld(mapMode);
    gameState.resetRun();
    gameState.setMode(mapMode === 'endless' ? 'endless' : 'freeRoam');
    this.city.setRacePropsVisible(false);
    this.ui.showFreeRoamHud();
    this.setShowcaseVisible(false);
    this.setPlayerVisible(true);
    this.traffic.setActive(true);
    this.pedestrians.setActive(true);
    this.clearAiVehicles();
    this.taskPoints.setActive(mapMode === 'finite');
    this.activeTaskPoint = null;
    this.player.reset(WORLD.SPAWN_X, WORLD.SPAWN_Z, Math.PI);
    this.audio.init();
    this.audio.resume();
    this.audio.startBgm();
    this.audio.setRaceMusic(false);
  }

  startRace(): void {
    this.leaveMultiplayerIfNeeded();
    this.setWorld('finite');
    const difficulty = gameState.race.difficulty;
    const layout = this.finiteCity.setRaceLayout(gameState.race.layoutId);
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
    this.taskPoints.setActive(false);

    const available = VEHICLES.filter((v) => v.id !== this.player.spec.id);
    const totalRacers = Math.max(
      2,
      Math.min(RACE_CONFIG.MAX_TOTAL_RACERS, gameState.race.totalRacers),
    );
    for (let i = 0; i < totalRacers - 1; i += 1) {
      const spec = available[i % available.length];
      this.aiVehicles.push(this.createPlayer(spec.id, spec.color, false, false));
    }
    this.race = new RaceManager(
      layout.checkpoints.map((p) => new THREE.Vector3(p.x, 0, p.z)),
      {
        checkpointRadius: layout.checkpointRadius,
        corridorWidth: layout.corridorWidth,
        routePoints: layout.routePoints ?? layout.checkpoints,
        avoidBoxes: [
          ...this.city.buildingColliders,
          ...this.city.boundaryColliders,
          ...layout.raceBarriers,
        ],
        avoidCircles: [
          ...this.city.treeColliders,
          ...layout.raceBarrierCircles,
        ],
      },
    );
    this.race.init(
      this.player,
      this.aiVehicles,
      difficulty,
      gameState.race.totalLaps,
      layout.startSlots.map((p) => new THREE.Vector3(p.x, 0, p.z)),
      layout.startHeading,
    );
    this.race.startCountdown();
    this.audio.init();
    this.audio.resume();
    this.audio.startBgm();
    this.audio.setRaceMusic(true);
  }

  restartRace(): void {
    this.startRace();
  }

  restartCurrent(): void {
    if (gameState.mode === 'race') this.startRace();
    else if (gameState.mode === 'endless') this.startFreeRoam('endless');
    else if (gameState.mode === 'multiplayer') this.startMultiplayer();
    else this.startFreeRoam('finite');
  }

  /** 竞速结算：统计与奖励并入存档，返回带奖励信息的结算数据 */
  awardRaceResult(data: {
    position: number;
    totalRacers: number;
    bestLapMs: number;
    totalMs: number;
    difficulty: Difficulty;
  }): RaceResultData {
    const result = gameState.recordRace({
      position: data.position,
      totalRacers: data.totalRacers,
      difficulty: gameState.race.difficulty,
      layoutId: gameState.race.layoutId,
      bestLapMs: data.bestLapMs,
    });
    return {
      position: data.position,
      totalRacers: data.totalRacers,
      bestLapMs: data.bestLapMs,
      totalMs: data.totalMs,
      difficulty: data.difficulty,
      reward: result.reward,
      isWin: result.isWin,
      newRecord: result.newRecord,
    };
  }

  /** 行驶中的生涯统计：里程 / 极速 / 在线时长 / 里程金币 */
  private trackProgress(dt: number): void {
    const speedMs = this.player.getSpeedMs();
    const km = (speedMs * dt) / 1000;
    gameState.addDistanceKm(km, gameState.mode === 'endless');
    gameState.updateTopSpeed(speedMs * 3.6);
    gameState.addPlaySeconds(dt);
    this.distanceCoinAccum += km;
    const coinStep = 1 / DISTANCE_COIN_EVERY_KM;
    if (this.distanceCoinAccum >= coinStep) {
      const gained = Math.floor(this.distanceCoinAccum / coinStep);
      this.distanceCoinAccum -= gained * coinStep;
      gameState.addCoins(gained);
    }
  }

  // ---------------- 竞速任务触发点 ----------------

  /** 是否处于任务点发起的竞速（结算界面显示「返回自由漫游」） */
  isTaskRace(): boolean {
    return this.taskReturn !== null;
  }

  openTaskPanel(point: TaskPointInstance): void {
    if (this.taskPanelOpen) return;
    this.taskPanelOpen = true;
    this.activeTaskPoint = point;
    gameState.setPaused(true);
    this.audio.suspend();
    this.ui.showTaskPanel(point);
  }

  closeTaskPanel(): void {
    if (!this.taskPanelOpen) return;
    this.taskPanelOpen = false;
    gameState.setPaused(false);
    this.audio.resume();
    this.ui.hideTaskPanel();
  }

  /** 从任务点开始竞速：沿用玩家车辆，套用面板参数 */
  startTaskRace(laps: number, opponents: number): void {
    const point = this.activeTaskPoint;
    if (!point) return;
    this.taskReturn = {
      x: this.player.x,
      z: this.player.z,
      heading: this.player.heading,
    };
    this.closeTaskPanel();
    gameState.race.layoutId = point.layoutId;
    gameState.race.totalLaps = laps;
    gameState.race.totalRacers = opponents + 1;
    this.startRace();
    this.ui.setTaskRaceReturn(true);
  }

  /** 竞速结束返回自由漫游，回到进入前的任务点位置 */
  returnToFreeRoam(): void {
    const target = this.taskReturn;
    this.taskReturn = null;
    this.ui.setTaskRaceReturn(false);
    this.startFreeRoam('finite');
    if (target) {
      this.player.reset(target.x, target.z, target.heading);
    }
  }

  togglePause(): void {
    if (
      gameState.mode !== 'freeRoam' &&
      gameState.mode !== 'endless' &&
      gameState.mode !== 'race' &&
      gameState.mode !== 'multiplayer'
    ) {
      return;
    }
    if (gameState.mode === 'race' && this.race.phase === 'finished') return;
    gameState.setPaused(!gameState.paused);
    if (gameState.paused) {
      this.audio.suspend();
      gameState.checkAchievements();
      gameState.save();
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

  setBgmVolume(value: number): void {
    gameState.settings.bgmVolume = Math.max(0, Math.min(1, value));
    gameState.save();
    this.audio.setVolumes(
      gameState.settings.bgmVolume,
      gameState.settings.sfxVolume,
    );
  }

  setSfxVolume(value: number): void {
    gameState.settings.sfxVolume = Math.max(0, Math.min(1, value));
    gameState.save();
    this.audio.setVolumes(
      gameState.settings.bgmVolume,
      gameState.settings.sfxVolume,
    );
  }

  resetVehicle(): void {
    if (gameState.mode === 'freeRoam' || gameState.mode === 'endless') {
      this.player.reset(WORLD.SPAWN_X, WORLD.SPAWN_Z, Math.PI);
      return;
    }
    if (gameState.mode === 'multiplayer') {
      const playerIndex = gameState.multiplayer.players.findIndex(
        (p) => p.username === gameState.multiplayer.username,
      );
      const defaultLayout = this.finiteCity.raceLayouts[0];
      const slot =
        defaultLayout.startSlots[
          Math.max(0, playerIndex) % defaultLayout.startSlots.length
        ];
      this.player.reset(slot.x, slot.z, Math.PI / 2);
      return;
    }
    if (gameState.mode === 'race' && this.race.phase !== 'finished') {
      const layout = this.getActiveRaceLayout();
      const slot =
        layout.startSlots[
          Math.min(this.race.playerIndex, layout.startSlots.length - 1)
        ];
      this.player.reset(slot.x, slot.z, layout.startHeading);
    }
  }

  private readonly animate = (): void => {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.frameCount += 1;
    this.frameTime += dt;
    this.updateAdaptiveResolution(dt);
    this.accumulator += dt;
    while (this.accumulator >= PHYSICS.FIXED_STEP) {
      this.tick(PHYSICS.FIXED_STEP);
      this.accumulator -= PHYSICS.FIXED_STEP;
    }
    this.sky.position.copy(this.camera.position);
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  };

  private updateAdaptiveResolution(dt: number): void {
    this.adaptiveScaleTimer += dt;
    this.adaptiveScaleSamples += 1;
    this.adaptiveScaleFrameMs += dt * 1000;
    if (this.adaptiveScaleTimer < 0.7) return;
    const avgMs = this.adaptiveScaleFrameMs / Math.max(1, this.adaptiveScaleSamples);
    const fps = 1000 / Math.max(1, avgMs);
    const config = QUALITY_PRESETS[this.quality];
    const minScale = config.pixelRatio > 1.25 ? 0.55 : 0.7;
    let target = this.renderScale;
    if (fps < 44) {
      target = Math.max(minScale, this.renderScale - 0.14);
    } else if (fps >= 56 && this.renderScale < 1) {
      target = Math.min(1, this.renderScale + 0.06);
    }
    this.adaptiveScaleTimer = 0;
    this.adaptiveScaleSamples = 0;
    this.adaptiveScaleFrameMs = 0;
    if (Math.abs(target - this.renderScale) < 0.001) return;
    this.renderScale = target;
    this.applyRenderScale();
  }

  private applyRenderScale(): void {
    const config = QUALITY_PRESETS[this.quality];
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, config.pixelRatio) * this.renderScale,
    );
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer?.setSize(window.innerWidth, window.innerHeight);
  }

  private tick(dt: number): void {
    this.timeSec += dt;
    this.input.update();
    this.handleDiscreteInput();
    this.city.updateSignals(this.timeSec);
    this.city.updateWater(this.timeSec);
    const revision = this.city.revision;
    if (gameState.mode === 'menu' || gameState.mode === 'garage' || gameState.mode === 'lobby') {
      this.city.updateChunks(this.showcase.x, this.showcase.z);
    } else {
      this.city.updateChunks(this.player.x, this.player.z);
    }
    if (this.city.revision !== revision) {
      this.traffic.rebindCity();
      this.pedestrians.rebindCity();
    }

    if (gameState.paused) {
      this.ui.updateHud();
      return;
    }

    if (gameState.mode === 'menu' || gameState.mode === 'garage' || gameState.mode === 'lobby') {
      if (this.garageSwitchT < 1) {
        this.garageSwitchT = Math.min(1, this.garageSwitchT + dt * 3.4);
        const t = this.garageSwitchT;
        const c1 = 1.70158;
        const c3 = c1 + 1;
        const scale =
          1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
        this.showcase.visuals.group.scale.setScalar(Math.max(0.01, scale));
      }
      this.orbitTime += dt;
      this.updateOrbitCamera();
    } else if (gameState.mode === 'freeRoam' || gameState.mode === 'endless') {
      this.updateFreeRoam(dt);
    } else if (gameState.mode === 'multiplayer') {
      this.updateMultiplayer(dt);
    } else if (gameState.mode === 'race') {
      this.updateRace(dt);
    }
    this.taskPoints.update(dt);
    this.tickProgressSave(dt);
  }

  /** 游玩期间周期性结算成就并落盘，避免每个物理帧写 localStorage */
  private tickProgressSave(dt: number): void {
    if (
      gameState.mode !== 'freeRoam' &&
      gameState.mode !== 'endless' &&
      gameState.mode !== 'race' &&
      gameState.mode !== 'multiplayer'
    ) {
      return;
    }
    this.saveTimer += dt;
    if (this.saveTimer < PROGRESS_SAVE_INTERVAL) return;
    this.saveTimer = 0;
    gameState.checkAchievements();
    gameState.save();
  }

  private updateFreeRoam(dt: number): void {
    const input = this.input;
    this.player.update(dt, {
      throttle: Math.max(0, input.moveZ),
      brake: Math.max(0, -input.moveZ),
      steer: input.moveX,
      handbrake: input.handbrake,
    });
    this.player.groundY = this.city.getTerrainHeight(this.player.x, this.player.z);
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
        gameState.addPedestrianKill();
        this.player.speed *= 0.42;
        this.player.lateral *= 0.4;
      }
      eventBus.emit(Events.VEHICLE_COLLISION, { intensity });
      this.audio.playCollision(intensity);
    });
    this.resolveWorldCollisions(this.player);
    this.resolveVehicleCollisions();
    if (gameState.mode !== 'endless') this.clampToBounds(this.player);
    this.updateChaseCamera(dt);
    this.updateSun();
    this.trackProgress(dt);
    this.activeTaskPoint = this.taskPoints.nearestActive(this.player.x, this.player.z);
    this.ui.setTaskHintVisible(!!this.activeTaskPoint);
    this.syncGameState();
    this.audio.updateEngine(
      this.player.getRpmRatio(),
      this.player.rpm,
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
      this.player.groundY = this.city.getTerrainHeight(this.player.x, this.player.z);
      this.resolveWorldCollisions(this.player);
      for (const racer of this.race.racers) {
        this.resolveWorldCollisions(racer.vehicle);
      }
      this.resolveVehicleCollisions();
      this.clampToBounds(this.player);
      this.audio.updateEngine(
        this.player.getRpmRatio(),
        this.player.rpm,
        Math.max(0, input.moveZ),
      );
    }
    if (phase === 'racing' || phase === 'countdown' || phase === 'finished') {
      this.updateChaseCamera(dt);
      this.updateSun();
    }
    this.trackProgress(dt);
    this.syncGameState();
    this.ui.updateHud();
  }

  private updateMultiplayer(dt: number): void {
    const input = this.input;
    this.player.update(dt, {
      throttle: Math.max(0, input.moveZ),
      brake: Math.max(0, -input.moveZ),
      steer: input.moveX,
      handbrake: input.handbrake,
    });
    this.player.groundY = this.city.getTerrainHeight(this.player.x, this.player.z);
    this.resolveWorldCollisions(this.player);
    this.resolveVehicleCollisions();
    this.clampToBounds(this.player);
    this.updateRemoteVehicles(dt);

    this.multiplayerStateTimer -= dt;
    if (this.multiplayerStateTimer <= 0) {
      this.multiplayerStateTimer = 1 / 15;
      this.multiplayerClient.sendState({
        x: this.player.x,
        z: this.player.z,
        heading: this.player.heading,
        speedMs: this.player.getSpeedMs(),
        vehicleId: this.player.spec.id,
        color: this.player.spec.color,
      });
    }
    this.updateChaseCamera(dt);
    this.updateSun();
    this.trackProgress(dt);
    this.syncGameState();
    this.audio.updateEngine(
      this.player.getRpmRatio(),
      this.player.rpm,
      Math.max(0, input.moveZ),
    );
    this.ui.updateHud();
  }

  private updateRemoteVehicles(dt: number): void {
    for (const [id, vehicle] of this.remoteVehicles) {
      const target = this.remoteTargets.get(id);
      if (!target) continue;
      const smooth = 1 - Math.exp(-12 * dt);
      vehicle.x += (target.x - vehicle.x) * smooth;
      vehicle.z += (target.z - vehicle.z) * smooth;
      vehicle.heading += this.lerpAngleDelta(vehicle.heading, target.heading) * smooth;
      vehicle.speed = target.speedMs;
      vehicle.setKinematic(vehicle.x, vehicle.z, vehicle.heading, vehicle.speed);
      vehicle.rollWheels(dt);
    }
  }

  private lerpAngleDelta(from: number, to: number): number {
    let delta = to - from;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return delta;
  }

  private syncGameState(): void {
    gameState.player.x = this.player.x;
    gameState.player.z = this.player.z;
    gameState.player.heading = this.player.heading;
    gameState.player.speedKmh = this.player.getSpeedMs() * 3.6;
    gameState.player.rpm = Math.round(this.player.rpm);
    gameState.player.rpmRatio = this.player.getRpmRatio();
    gameState.player.gear = this.player.gear;
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
    if (this.taskPanelOpen) {
      // 任务设置面板打开时：E / Esc 关闭面板，忽略其它操作
      if (this.input.consume('interact') || this.input.consume('pause')) {
        this.closeTaskPanel();
      }
      return;
    }
    if (this.input.consume('pause')) this.togglePause();
    if (this.input.consume('reset')) this.resetVehicle();
    if (this.input.consume('camera')) {
      this.cameraMode = this.cameraMode === 'chase' ? 'hood' : 'chase';
      if (this.player.visuals.glassMesh) {
        this.player.visuals.glassMesh.visible = this.cameraMode === 'chase';
      }
      this.applyInteriorVisibility();
    }
    if (this.input.consume('mute')) this.toggleMute();
    if (this.input.consume('interact')) this.interactWithTask();
  }

  /** 与任务点交互：与按 E 相同（供任务提示按钮点击调用） */
  interactWithTask(): void {
    if (this.taskPanelOpen) {
      this.closeTaskPanel();
      return;
    }
    if (
      gameState.mode === 'freeRoam' &&
      this.activeTaskPoint &&
      !gameState.paused
    ) {
      this.openTaskPanel(this.activeTaskPoint);
    }
  }

  private updateChaseCamera(dt: number): void {
    // 第三人称下按住鼠标右键左右拖动：以车为中心环绕视角，松开后平滑复位
    if (this.cameraMode === 'chase') {
      this.orbitYaw += this.input.consumeOrbitDelta() * 0.0045;
      if (!this.input.isOrbitDragging()) {
        this.orbitYaw *= Math.exp(-4.5 * dt);
        if (Math.abs(this.orbitYaw) < 0.004) this.orbitYaw = 0;
      }
    } else {
      // 引擎盖视角不使用环绕，丢弃遗留增量
      this.input.consumeOrbitDelta();
      this.orbitYaw = 0;
    }
    const fx = Math.sin(this.player.heading);
    const fz = Math.cos(this.player.heading);
    const groundY = this.player.groundY;
    let desiredX: number;
    let desiredY: number;
    let desiredZ: number;
    if (this.cameraMode === 'chase') {
      this.setCameraFov(CAMERA_CONFIG.FOV);
      desiredX = this.player.x - fx * CAMERA_CONFIG.CHASE_DISTANCE;
      desiredY = CAMERA_CONFIG.CHASE_HEIGHT + groundY;
      desiredZ = this.player.z - fz * CAMERA_CONFIG.CHASE_DISTANCE;
      if (this.orbitYaw !== 0) {
        const relX = desiredX - this.player.x;
        const relZ = desiredZ - this.player.z;
        const cos = Math.cos(this.orbitYaw);
        const sin = Math.sin(this.orbitYaw);
        desiredX = this.player.x + relX * cos - relZ * sin;
        desiredZ = this.player.z + relX * sin + relZ * cos;
      }
      // 视线目标：正常追尾看车前方预瞄点；环绕幅度越大越偏向盯住车身中心，
      // 保证「以车为中心」旋转时车始终在画面中央
      const lookAheadX = this.player.x + fx * CAMERA_CONFIG.LOOK_AHEAD;
      const lookAheadZ = this.player.z + fz * CAMERA_CONFIG.LOOK_AHEAD;
      const orbitAmount = Math.min(1, Math.abs(this.orbitYaw) / 0.6);
      this.cameraLook.set(
        lookAheadX + (this.player.x - lookAheadX) * orbitAmount,
        CAMERA_CONFIG.LOOK_HEIGHT + groundY,
        lookAheadZ + (this.player.z - lookAheadZ) * orbitAmount,
      );
    } else {
      this.setCameraFov(CAMERA_CONFIG.HOOD_FOV);
      const rx = fz;
      const rz = -fx;
      desiredX =
        this.player.x +
        fx * CAMERA_CONFIG.INTERIOR_FORWARD +
        rx * CAMERA_CONFIG.INTERIOR_LATERAL;
      desiredY =
        this.player.spec.height * CAMERA_CONFIG.INTERIOR_EYE_HEIGHT_RATIO +
        groundY;
      desiredZ =
        this.player.z +
        fz * CAMERA_CONFIG.INTERIOR_FORWARD +
        rz * CAMERA_CONFIG.INTERIOR_LATERAL;
      this.cameraPosition.set(desiredX, desiredY, desiredZ);
      this.cameraLook.set(
        this.player.x + fx * 20,
        1.12 + groundY,
        this.player.z + fz * 20,
      );
      this.camera.position.copy(this.cameraPosition);
      this.camera.lookAt(this.cameraLook);
      return;
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
    this.setCameraFov(CAMERA_CONFIG.FOV);
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
    const d = getSunDirection();
    this.sun.position.set(this.player.x + d.x * 300, d.y * 300, this.player.z + d.z * 300);
    this.sun.target.position.set(this.player.x, 0, this.player.z);
    this.sun.target.updateMatrixWorld();
  }

  private resolveWorldCollisions(vehicle: PlayerVehicle): void {
    if (!Number.isFinite(vehicle.x) || !Number.isFinite(vehicle.z)) return;
    const radius = vehicle.spec.width / 2 + PHYSICS.CAR_RADIUS_PADDING;
    const velocity = vehicle.getVelocity();
    const emitCollision = (intensity: number): void => {
      if (vehicle !== this.player) return;
      eventBus.emit(Events.VEHICLE_COLLISION, { intensity });
      this.audio.playCollision(intensity);
    };
    this.ensureCollisionGrids();
    const queryRadius = radius + 2;
    for (const box of queryAabbGrid(
      this.buildingGrid as AabbGrid,
      vehicle.x,
      vehicle.z,
      queryRadius,
    )) {
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
    for (const tree of queryCircleGrid(
      this.treeGrid as CircleGrid,
      vehicle.x,
      vehicle.z,
      queryRadius,
    )) {
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
      for (const box of this.getActiveRaceLayout().raceBarriers) {
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
      for (const circle of this.getActiveRaceLayout().raceBarrierCircles) {
        const dx = vehicle.x - circle.x;
        const dz = vehicle.z - circle.z;
        const minDist = radius + circle.radius;
        const distSq = dx * dx + dz * dz;
        if (distSq >= minDist * minDist || distSq < 1e-6) continue;
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const nz = dz / dist;
        vehicle.x += nx * (minDist - dist);
        vehicle.z += nz * (minDist - dist);
        const vn = velocity.vx * nx + velocity.vz * nz;
        if (vn < -1.5) {
          vehicle.speed *= 0.55;
          vehicle.lateral *= 0.5;
          emitCollision(Math.min(1, -vn / 10));
        }
      }
    }
  }

  private ensureCollisionGrids(): void {
    if (
      this.collisionGridCity === this.city &&
      this.colliderGridRevision === this.city.revision &&
      this.buildingGrid &&
      this.treeGrid
    ) {
      return;
    }
    this.buildingGrid = buildAabbGrid(
      [...this.city.buildingColliders, ...this.city.boundaryColliders],
      40,
    );
    this.treeGrid = buildCircleGrid(this.city.treeColliders, 32);
    this.collisionGridCity = this.city;
    this.colliderGridRevision = this.city.revision;
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
      ...[...this.remoteVehicles.values()].map((vehicle) => ({
        x: vehicle.x,
        z: vehicle.z,
        radius: vehicle.spec.width / 2 + PHYSICS.CAR_RADIUS_PADDING,
        vehicle,
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
    if (!Number.isFinite(distSq) || !Number.isFinite(minDist)) return;
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
    if (relN >= 0 || !Number.isFinite(relN)) return;

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
    if (vehicle !== this.player) this.traffic.onVehicleHit(vehicle);
    if (otherVehicle !== this.player) this.traffic.onVehicleHit(otherVehicle);
    // 只有涉及玩家的碰撞才反馈音效/闪屏，避免远处 NPC 互撞产生虚假撞击提示
    if (vehicle === this.player || otherVehicle === this.player) {
      const intensity = Math.min(1, -relN / 14);
      if (intensity >= 0.22) {
        eventBus.emit(Events.VEHICLE_COLLISION, { intensity });
        this.audio.playCollision(intensity);
      }
    }
  }

  private clampToBounds(vehicle: PlayerVehicle): void {
    const colliders = this.city.boundaryColliders;
    if (colliders.length === 0) return;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const box of colliders) {
      minX = Math.min(minX, box.minX);
      maxX = Math.max(maxX, box.maxX);
      minZ = Math.min(minZ, box.minZ);
      maxZ = Math.max(maxZ, box.maxZ);
    }
    const margin = vehicle.spec.width / 2 + 0.6;
    vehicle.x = Math.max(minX + margin, Math.min(maxX - margin, vehicle.x));
    vehicle.z = Math.max(minZ + margin, Math.min(maxZ - margin, vehicle.z));
  }

  private createPlayer(
    vehicleId: string,
    color: string,
    castShadows = true,
    highQuality = true,
  ): PlayerVehicle {
    const spec = VEHICLES.find((v) => v.id === vehicleId) ?? VEHICLES[0];
    const vehicle = new PlayerVehicle(spec, color, this.scene, castShadows, highQuality);
    return vehicle;
  }

  private setShowcaseVisible(visible: boolean): void {
    this.showcase.visuals.group.visible = visible;
  }

  private setPlayerVisible(visible: boolean): void {
    this.player.visuals.group.visible = visible;
  }

  private placeShowcase(): void {
    this.showcase.reset(WORLD.SPAWN_X, WORLD.SPAWN_Z, 0);
    this.showcase.visuals.group.visible = true;
  }

  private finishGarageSwitch(): void {
    this.garageSwitchT = 1;
    this.showcase.visuals.group.scale.setScalar(1);
  }

  private setCameraFov(fov: number): void {
    if (this.activeFov === fov) return;
    this.activeFov = fov;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  private applyInteriorVisibility(): void {
    const visible = this.cameraMode === 'chase';
    this.player.visuals.group.traverse((child) => {
      if (
        child instanceof THREE.Mesh &&
        (child.name === 'interior-dashboard' ||
          child.name === 'interior-pillar' ||
          child.name === 'interior-headliner')
      ) {
        child.visible = visible;
      }
    });
  }

  setQuality(preset: QualityPreset): void {
    gameState.setQuality(preset);
    if (preset === 'auto') {
      const lowPowerRender =
        typeof navigator !== 'undefined' && navigator.webdriver === true;
      this.quality = lowPowerRender ? 'low' : 'medium';
    } else {
      this.quality = preset;
    }
    this.applyQuality();
    eventBus.emit(Events.QUALITY_CHANGED, { quality: this.quality });
  }

  private applyQuality(): void {
    const config = QUALITY_PRESETS[this.quality];
    this.renderScale = 1;
    this.adaptiveScaleTimer = 0;
    this.adaptiveScaleSamples = 0;
    this.adaptiveScaleFrameMs = 0;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, config.pixelRatio),
    );
    this.renderer.shadowMap.enabled = config.shadowMapSize > 0;
    this.renderer.shadowMap.type = config.pcfSoft
      ? THREE.PCFSoftShadowMap
      : THREE.PCFShadowMap;
    this.sun.castShadow = config.shadowMapSize > 0;
    this.sun.shadow.mapSize.set(
      config.shadowMapSize,
      config.shadowMapSize,
    );
    if (config.bloom) {
      if (!this.composer) {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloomPass = new UnrealBloomPass(
          new THREE.Vector2(window.innerWidth, window.innerHeight),
          0.32,
          0.7,
          0.85,
        );
        this.composer.addPass(this.bloomPass);
        this.composer.addPass(new OutputPass());
      }
      if (config.ssao) {
        if (!this.ssaoPass) {
          this.ssaoPass = new SSAOPass(
            this.scene,
            this.camera,
            window.innerWidth,
            window.innerHeight,
          );
          const outputIndex = this.composer.passes.length - 1;
          this.composer.passes.splice(outputIndex, 0, this.ssaoPass);
        }
        this.ssaoPass.enabled = true;
      } else if (this.ssaoPass) {
        this.ssaoPass.enabled = false;
      }
      this.composer.setSize(window.innerWidth, window.innerHeight);
    } else if (this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.bloomPass = null;
      this.ssaoPass = null;
    }
  }

  private subscribeMultiplayerEvents(): void {
    eventBus.on(Events.MULTIPLAYER_CONNECTED, (data) => {
      const payload = data as { username: string; rooms: unknown[] } | undefined;
      if (!payload) return;
      gameState.multiplayer.connected = true;
      gameState.multiplayer.connecting = false;
      gameState.multiplayer.username = payload.username;
      gameState.multiplayer.rooms = payload.rooms as RoomInfo[];
      this.ui.refreshMultiplayer();
    });
    eventBus.on(Events.MULTIPLAYER_ROOMS, (data) => {
      const payload = data as { rooms: unknown[] } | undefined;
      if (!payload) return;
      gameState.multiplayer.rooms = payload.rooms as RoomInfo[];
      this.ui.refreshMultiplayer();
    });
    eventBus.on(Events.MULTIPLAYER_JOINED, (data) => {
      const payload = data as { room: RoomInfo } | undefined;
      if (!payload) return;
      const room = payload.room;
      gameState.multiplayer.roomId = room.id;
      gameState.multiplayer.roomName = room.name;
      gameState.multiplayer.isHost = room.hostName === gameState.multiplayer.username;
      gameState.multiplayer.players = room.players;
      this.ui.refreshMultiplayer();
    });
    eventBus.on(Events.MULTIPLAYER_GAME_STARTED, (data) => {
      const payload = data as { room: RoomInfo } | undefined;
      if (!payload) return;
      gameState.multiplayer.roomId = payload.room.id;
      gameState.multiplayer.roomName = payload.room.name;
      gameState.multiplayer.isHost = payload.room.hostName === gameState.multiplayer.username;
      gameState.multiplayer.players = payload.room.players;
      this.startMultiplayer();
    });
    eventBus.on(Events.MULTIPLAYER_STATE, (data) => {
      const payload = data as { players: RoomInfo['players'] } | undefined;
      if (!payload) return;
      gameState.multiplayer.players = payload.players;
      this.syncRemoteVehicles(payload.players);
      this.ui.refreshMultiplayer();
    });
  }

  private syncRemoteVehicles(players: RoomInfo['players']): void {
    const seen = new Set<string>();
    for (const player of players) {
      if (player.username === gameState.multiplayer.username) continue;
      seen.add(player.id);
      this.remoteTargets.set(player.id, {
        x: player.x,
        z: player.z,
        heading: player.heading,
        speedMs: player.speedMs,
      });
      let vehicle = this.remoteVehicles.get(player.id);
      if (!vehicle) {
        const spec = VEHICLES.find((v) => v.id === player.vehicleId) ?? VEHICLES[0];
        vehicle = this.createPlayer(spec.id, player.color, true, false);
        vehicle.visuals.group.visible = true;
        this.remoteVehicles.set(player.id, vehicle);
      }
    }
    for (const id of [...this.remoteVehicles.keys()]) {
      if (seen.has(id)) continue;
      const vehicle = this.remoteVehicles.get(id);
      if (vehicle) this.scene.remove(vehicle.visuals.group);
      this.remoteVehicles.delete(id);
      this.remoteTargets.delete(id);
    }
  }

  private clearRemoteVehicles(): void {
    for (const vehicle of this.remoteVehicles.values()) {
      this.scene.remove(vehicle.visuals.group);
    }
    this.remoteVehicles.clear();
    this.remoteTargets.clear();
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
    racer.checkpoint = this.race.checkpoints.length - 2;
    racer.lap = Math.min(racer.lap + 1, this.race.totalLaps - 1);
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
    this.composer?.setSize(window.innerWidth, window.innerHeight);
  };
}
