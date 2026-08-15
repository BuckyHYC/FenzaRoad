import { DEFAULT_VEHICLE_ID, STORAGE_KEY, VEHICLES } from './Constants';
import { eventBus, Events } from './EventBus';
import {
  ACHIEVEMENTS,
  achievementProgress,
  applyCheckIn,
  challengeProgress,
  dailyChallengesFor,
  dateKey,
  defaultDaily,
  defaultOwnedVehicleIds,
  defaultStats,
  isDailyFresh,
  KILL_COIN_REWARD,
  RACE_DNF_REWARD,
  RACE_REWARDS,
  vehiclePrice,
} from './Progress';
import type {
  ControlMode,
  DailyState,
  Density,
  Difficulty,
  GameMode,
  MapMode,
  MultiplayerState,
  PlayerState,
  PlayerStats,
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
    pedestrianKills: 0,
    muted: false,
    bgmVolume: 0.7,
    sfxVolume: 0.8,
    controlMode: touchDevice ? 'mobile' : 'desktop',
    density: 'low',
    quality: 'auto',
    coins: 0,
    ownedVehicleIds: defaultOwnedVehicleIds(DEFAULT_VEHICLE_ID),
    stats: defaultStats(),
    daily: defaultDaily(),
    unlockedAchievements: [],
  };
}

function clampVolume(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback;
}

function parseNonNegative(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
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
    const pedestrianKills = parseNonNegative(parsed.pedestrianKills, base.pedestrianKills);

    // —— 留存系统字段（含旧存档迁移）——
    const coins = parseNonNegative(parsed.coins, base.coins);
    let ownedVehicleIds: string[] = base.ownedVehicleIds;
    if (Array.isArray(parsed.ownedVehicleIds)) {
      const valid = parsed.ownedVehicleIds.filter(
        (id): id is string => typeof id === 'string' && VEHICLES.some((v) => v.id === id),
      );
      if (valid.length > 0) ownedVehicleIds = valid;
    }
    if (!ownedVehicleIds.includes(vehicleId)) ownedVehicleIds.push(vehicleId);
    const stats: PlayerStats = { ...defaultStats(), ...(parsed.stats ?? {}) };
    for (const key of Object.keys(stats) as (keyof PlayerStats)[]) {
      stats[key] = parseNonNegative(stats[key], 0);
    }
    const daily: DailyState = {
      ...defaultDaily(),
      ...(parsed.daily ?? {}),
    };
    daily.done = Array.isArray(daily.done)
      ? daily.done.filter((id): id is string => typeof id === 'string')
      : [];
    daily.checkInStreak = parseNonNegative(daily.checkInStreak, 0);
    const unlockedAchievements = Array.isArray(parsed.unlockedAchievements)
      ? parsed.unlockedAchievements.filter((id): id is string =>
          typeof id === 'string' && ACHIEVEMENTS.some((a) => a.id === id),
        )
      : [];
    return {
      selectedVehicleId: vehicleId,
      selectedColor: color,
      bestLaps:
        parsed.bestLaps && typeof parsed.bestLaps === 'object'
          ? parsed.bestLaps
          : {},
      pedestrianKills,
      muted: parsed.muted === true,
      bgmVolume,
      sfxVolume,
      controlMode,
      density,
      quality,
      coins,
      ownedVehicleIds,
      stats,
      daily,
      unlockedAchievements,
    };
  } catch {
    return emptySaved();
  }
}

class GameState {
  mode: GameMode = 'menu';
  paused = false;
  mapMode: MapMode = 'finite';
  pedestrianKills = 0;
  coins = 0;
  stats: PlayerStats = defaultStats();
  ownedVehicleIds: string[] = defaultOwnedVehicleIds(DEFAULT_VEHICLE_ID);
  daily: DailyState = defaultDaily();
  unlockedAchievements: string[] = [];
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
    this.pedestrianKills = this.saved.pedestrianKills;
    this.coins = this.saved.coins;
    this.stats = this.saved.stats;
    this.ownedVehicleIds = this.saved.ownedVehicleIds;
    this.daily = this.saved.daily;
    this.unlockedAchievements = this.saved.unlockedAchievements;
    this.player.vehicleId = this.saved.selectedVehicleId;
    this.player.color = this.saved.selectedColor;
    this.ensureDailyFresh();
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

  // ---------------- 金币 / 经济 ----------------

  /** 增加金币并记录累计赚取，触发成就检查与存档 */
  addCoins(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.coins += amount;
    this.stats.coinsEarned += amount;
    const unlocked = this.checkAchievements();
    this.save();
    eventBus.emit(Events.COINS_CHANGED, { coins: this.coins });
    if (unlocked) eventBus.emit(Events.PROGRESS_CHANGED, {});
  }

  spendCoins(amount: number): boolean {
    const cost = Math.max(0, Math.round(amount));
    if (this.coins < cost) return false;
    this.coins -= cost;
    this.save();
    eventBus.emit(Events.COINS_CHANGED, { coins: this.coins });
    return true;
  }

  isVehicleOwned(vehicleId: string): boolean {
    return this.ownedVehicleIds.includes(vehicleId);
  }

  buyVehicle(vehicleId: string): boolean {
    if (this.isVehicleOwned(vehicleId)) return false;
    const price = vehiclePrice(vehicleId);
    if (price <= 0) {
      this.ownedVehicleIds.push(vehicleId);
      this.save();
      return true;
    }
    if (!this.spendCoins(price)) return false;
    this.ownedVehicleIds.push(vehicleId);
    this.save();
    eventBus.emit(Events.PROGRESS_CHANGED, {});
    return true;
  }

  // ---------------- 生涯统计 ----------------

  addDistanceKm(km: number, endless: boolean): void {
    if (!Number.isFinite(km) || km <= 0) return;
    this.stats.distanceKm += km;
    if (endless) this.stats.endlessKm += km;
  }

  addPlaySeconds(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.stats.playSeconds += seconds;
  }

  updateTopSpeed(speedKmh: number): void {
    if (Number.isFinite(speedKmh) && speedKmh > this.stats.topSpeedKmh) {
      this.stats.topSpeedKmh = speedKmh;
    }
  }

  /** 竞速结算：记录统计、发放金币、更新赛道最佳圈速 */
  recordRace(race: {
    position: number;
    totalRacers: number;
    difficulty: Difficulty;
    layoutId: RaceLayoutId;
    bestLapMs: number;
  }): { reward: number; isWin: boolean; newRecord: boolean } {
    const { position, difficulty, layoutId, bestLapMs } = race;
    this.stats.races += 1;
    const isWin = position === 1;
    if (isWin) this.stats.raceWins += 1;
    const reward =
      position > 0 ? (RACE_REWARDS[position - 1] ?? 100) : RACE_DNF_REWARD;
    let newRecord = false;
    if (Number.isFinite(bestLapMs) && bestLapMs > 0) {
      const key = `${layoutId}:${difficulty}`;
      const previous = this.saved.bestLaps[key];
      if (typeof previous !== 'number' || bestLapMs < previous) {
        this.saved.bestLaps[key] = bestLapMs;
        newRecord = true;
      }
    }
    this.addCoins(reward);
    return { reward, isWin, newRecord };
  }

  addPedestrianKill(): void {
    this.pedestrianKills += 1;
    this.addCoins(KILL_COIN_REWARD);
  }

  // ---------------- 每日任务 / 签到 ----------------

  ensureDailyFresh(): void {
    const today = dateKey();
    if (this.daily.date !== today) {
      this.daily.date = today;
      this.daily.done = [];
    }
  }

  isDailyFresh(): boolean {
    return isDailyFresh(this.daily);
  }

  getProgressContext() {
    return {
      stats: this.stats,
      pedestrianKills: this.pedestrianKills,
      checkInStreak: this.daily.checkInStreak,
    };
  }

  dailyProgress(defId: string): number {
    const def = dailyChallengesFor().find((challenge) => challenge.id === defId);
    if (!def) return 0;
    return challengeProgress(def, this.getProgressContext());
  }

  claimDailyChallenge(defId: string): boolean {
    this.ensureDailyFresh();
    if (this.daily.done.includes(defId)) return false;
    const def = dailyChallengesFor().find((challenge) => challenge.id === defId);
    if (!def) return false;
    if (challengeProgress(def, this.getProgressContext()) < def.target) return false;
    this.daily.done.push(defId);
    this.addCoins(def.reward);
    this.save();
    eventBus.emit(Events.PROGRESS_CHANGED, {});
    return true;
  }

  canCheckIn(): boolean {
    return this.daily.checkInDate !== dateKey();
  }

  checkIn(): { streak: number; reward: number; ok: boolean } {
    this.ensureDailyFresh();
    const today = dateKey();
    if (this.daily.checkInDate === today) {
      return { streak: this.daily.checkInStreak, reward: 0, ok: false };
    }
    const result = applyCheckIn(this.daily);
    this.daily.checkInDate = today;
    this.daily.checkInStreak = result.streak;
    if (result.reward > 0) {
      this.addCoins(result.reward);
    } else {
      this.save();
    }
    eventBus.emit(Events.PROGRESS_CHANGED, {});
    return { streak: result.streak, reward: result.reward, ok: true };
  }

  // ---------------- 成就 ----------------

  /** 检查并自动解锁新成就，返回本次解锁数量 */
  checkAchievements(): number {
    const context = this.getProgressContext();
    let unlocked = 0;
    for (const achievement of ACHIEVEMENTS) {
      if (this.unlockedAchievements.includes(achievement.id)) continue;
      if (achievementProgress(achievement, context) >= achievement.target) {
        this.unlockedAchievements.push(achievement.id);
        this.coins += achievement.reward;
        this.stats.coinsEarned += achievement.reward;
        eventBus.emit(Events.ACHIEVEMENT_UNLOCKED, { achievement });
        unlocked += 1;
      }
    }
    return unlocked;
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
    this.saved.pedestrianKills = this.pedestrianKills;
    this.saved.coins = this.coins;
    this.saved.stats = this.stats;
    this.saved.ownedVehicleIds = this.ownedVehicleIds;
    this.saved.daily = this.daily;
    this.saved.unlockedAchievements = this.unlockedAchievements;
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
