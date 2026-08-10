import { DEFAULT_VEHICLE_ID, STORAGE_KEY, VEHICLES } from './Constants';
import { eventBus, Events } from './EventBus';
import type {
  Difficulty,
  GameMode,
  ControlMode,
  Density,
  MapMode,
  MultiplayerState,
  PlayerState,
  QualityPreset,
  RaceLayoutId,
  RaceState,
  SavedProgress,
} from './types';

function emptySaved(): SavedProgress {
  const touchDevice =
    typeof navigator !== 'undefined' &&
    (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
  return {
    selectedVehicleId: DEFAULT_VEHICLE_ID,
    selectedColor: VEHICLES[0].color,
    bestLaps: {},
    muted: false,
    bgmVolume: 0.7,
    sfxVolume: 0.8,
    controlMode: touchDevice ? 'mobile' : 'desktop',
    density: 'low',
    quality: 'auto',
  };
}

function clampVolume(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

function loadSaved(): SavedProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySaved();
    const parsed = JSON.parse(raw) as Partial<SavedProgress>;
    const base = emptySaved();
    const vehicleId =
      typeof parsed.selectedVehicleId === 'string' &&
      VEHICLES.some((v) => v.id === parsed.selectedVehicleId)
        ? parsed.selectedVehicleId
        : base.selectedVehicleId;
    const spec = VEHICLES.find((v) => v.id === vehicleId);
    const color =
      spec && typeof parsed.selectedColor === 'string' &&
      spec.colorOptions.includes(parsed.selectedColor)
        ? parsed.selectedColor
        : spec?.color ?? base.selectedColor;
    const controlMode: ControlMode =
      parsed.controlMode === 'mobile' || parsed.controlMode === 'desktop'
        ? parsed.controlMode
        : base.controlMode;
    const density: Density =
      parsed.density === 'low' || parsed.density === 'medium' || parsed.density === 'high'
        ? parsed.density
        : base.density;
    const quality: QualityPreset =
      parsed.quality === 'high' ||
      parsed.quality === 'medium' ||
      parsed.quality === 'low' ||
      parsed.quality === 'auto'
        ? parsed.quality
        : base.quality;
    const bgmVolume = clampVolume(parsed.bgmVolume, base.bgmVolume);
    const sfxVolume = clampVolume(parsed.sfxVolume, base.sfxVolume);
    return {
      selectedVehicleId: vehicleId,
      selectedColor: color,
      bestLaps:
        parsed.bestLaps && typeof parsed.bestLaps === 'object'
          ? parsed.bestLaps
          : {},
      muted: parsed.muted === true,
      bgmVolume,
      sfxVolume,
      controlMode,
      density,
      quality,
    };
  } catch {
    return emptySaved();
  }
}

class GameState {
  mode: GameMode = 'menu';
  paused = false;
  mapMode: MapMode = 'finite';
  multiplayer: MultiplayerState = {
    connected: false,
    connecting: false,
    username: '',
    roomId: null,
    roomName: '',
    isHost: false,
    rooms: [],
    players: [],
  };
  player: PlayerState = {
    vehicleId: DEFAULT_VEHICLE_ID,
    color: VEHICLES[0].color,
    x: 0,
    z: 0,
    heading: 0,
    speedKmh: 0,
    rpm: 0,
    rpmRatio: 0,
    gear: 1,
    lap: 0,
    position: 1,
    raceTimeMs: 0,
  };
  race: RaceState = {
    phase: 'idle',
    countdown: 0,
    totalLaps: 3,
    totalRacers: 4,
    difficulty: 'normal',
    layoutId: 'perimeter',
    resultPosition: 0,
    bestLapMs: 0,
  };
  settings = {
    muted: false,
    bgmVolume: 0.7,
    sfxVolume: 0.8,
    controlMode: 'desktop' as ControlMode,
    density: 'low' as Density,
    quality: 'auto' as QualityPreset,
  };
  saved: SavedProgress;

  constructor() {
    this.saved = loadSaved();
    this.settings.muted = this.saved.muted;
    this.settings.bgmVolume = this.saved.bgmVolume;
    this.settings.sfxVolume = this.saved.sfxVolume;
    this.settings.controlMode = this.saved.controlMode;
    this.settings.density = this.saved.density;
    this.settings.quality = this.saved.quality;
    this.player.vehicleId = this.saved.selectedVehicleId;
    this.player.color = this.saved.selectedColor;
  }

  setMode(mode: GameMode): void {
    this.mode = mode;
    this.paused = false;
    eventBus.emit(Events.MODE_CHANGED, { mode });
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setDifficulty(difficulty: Difficulty): void {
    this.race.difficulty = difficulty;
  }

  setRaceLayout(layoutId: RaceLayoutId): void {
    this.race.layoutId = layoutId;
  }

  setMapMode(mode: MapMode): void {
    this.mapMode = mode;
  }

  setQuality(quality: QualityPreset): void {
    this.settings.quality = quality;
    this.save();
  }

  resetRun(): void {
    this.player.lap = 0;
    this.player.position = 1;
    this.player.raceTimeMs = 0;
    this.race.phase = 'idle';
    this.race.countdown = 0;
    this.race.resultPosition = 0;
    this.race.bestLapMs = 0;
  }

  save(): void {
    this.saved.selectedVehicleId = this.player.vehicleId;
    this.saved.selectedColor = this.player.color;
    this.saved.muted = this.settings.muted;
    this.saved.bgmVolume = this.settings.bgmVolume;
    this.saved.sfxVolume = this.settings.sfxVolume;
    this.saved.controlMode = this.settings.controlMode;
    this.saved.density = this.settings.density;
    this.saved.quality = this.settings.quality;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.saved));
    } catch {
      // Storage may be unavailable (private mode); game still works in memory.
    }
  }
}

export const gameState = new GameState();
