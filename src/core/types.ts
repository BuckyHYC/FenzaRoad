export type GameMode = 'menu' | 'garage' | 'freeRoam' | 'endless' | 'race' | 'lobby' | 'multiplayer';
export type RacePhase = 'idle' | 'countdown' | 'racing' | 'finished';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type BodyStyle = 'sedan' | 'coupe' | 'suv' | 'pickup' | 'taxi' | 'police';
export type CameraMode = 'chase' | 'hood';
export type ControlMode = 'mobile' | 'desktop';
export type Density = 'low' | 'medium' | 'high';
export type MapMode = 'finite' | 'endless';
export type QualityPreset = 'auto' | 'high' | 'medium' | 'low';
export type RaceLayoutId = 'perimeter' | 'cityTour' | 'hillLoop';

export interface MultiplayerPlayer {
  id: string;
  username: string;
  vehicleId: string;
  color: string;
  x: number;
  z: number;
  heading: number;
  speedMs: number;
  isHost: boolean;
}

export interface RoomInfo {
  id: string;
  name: string;
  hostId: string;
  hostName: string;
  players: MultiplayerPlayer[];
  maxPlayers: number;
  status: 'lobby' | 'playing';
}

export interface MultiplayerState {
  connected: boolean;
  connecting: boolean;
  username: string;
  roomId: string | null;
  roomName: string;
  isHost: boolean;
  rooms: RoomInfo[];
  players: MultiplayerPlayer[];
}

export interface VehicleSpec {
  id: string;
  name: string;
  bodyStyle: BodyStyle;
  color: string;
  colorOptions: string[];
  topSpeedMs: number;
  gears: number;
  engineRedlineRpm: number;
  engineIdleRpm: number;
  accelMs2: number;
  brakeMs2: number;
  torqueCurveNm: number[];
  peakTorqueNm: number;
  gearRatios: number[];
  finalDrive: number;
  steerRate: number;
  grip: number;
  length: number;
  width: number;
  height: number;
}

export interface Aabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CircleCollider {
  x: number;
  z: number;
  radius: number;
}

export interface LaneInfo {
  edgeId: number;
  fromNode: number;
  toNode: number;
  laneIndex: number;
  lateralOffset: number;
}

export interface PlayerStats {
  distanceKm: number;
  endlessKm: number;
  races: number;
  raceWins: number;
  topSpeedKmh: number;
  playSeconds: number;
  coinsEarned: number;
}

export interface DailyState {
  /** 最近一次活跃的日期（YYYY-MM-DD，用于刷新每日任务） */
  date: string;
  /** 今日已完成并领取奖励的任务 id */
  done: string[];
  /** 最近一次签到的日期 */
  checkInDate: string;
  /** 连续签到天数 */
  checkInStreak: number;
}

export interface SavedProgress {
  selectedVehicleId: string;
  selectedColor: string;
  bestLaps: Record<string, number>;
  pedestrianKills: number;
  muted: boolean;
  bgmVolume: number;
  sfxVolume: number;
  controlMode: ControlMode;
  density: Density;
  quality: QualityPreset;
  coins: number;
  ownedVehicleIds: string[];
  stats: PlayerStats;
  daily: DailyState;
  unlockedAchievements: string[];
}

export interface PlayerState {
  vehicleId: string;
  color: string;
  x: number;
  z: number;
  heading: number;
  speedKmh: number;
  rpm: number;
  rpmRatio: number;
  gear: number;
  lap: number;
  position: number;
  raceTimeMs: number;
}

export interface RaceState {
  phase: RacePhase;
  countdown: number;
  totalLaps: number;
  totalRacers: number;
  difficulty: Difficulty;
  layoutId: RaceLayoutId;
  resultPosition: number;
  bestLapMs: number;
}

export interface RaceResultData {
  position: number;
  totalRacers: number;
  bestLapMs: number;
  totalMs: number;
  difficulty: Difficulty;
  /** 本次竞速获得的金币 */
  reward: number;
  isWin: boolean;
  /** 是否刷新了该赛道/难度的最佳圈速纪录 */
  newRecord: boolean;
}

export interface RaceLayout {
  id: RaceLayoutId;
  name: string;
  checkpoints: { x: number; z: number }[];
  routePoints?: { x: number; z: number }[];
  startSlots: { x: number; z: number }[];
  startHeading: number;
  raceBarriers: Aabb[];
  raceBarrierCircles: CircleCollider[];
  checkpointRadius: number;
  corridorWidth: number;
}

export interface RaceLayoutDefinition {
  id: RaceLayoutId;
  name: string;
  path: [number, number][];
  checkpointRadius?: number;
  corridorWidth?: number;
  barrierWidth?: number;
  barrierOffset?: number;
  barrierExtra?: number;
  flagOffset?: number;
  startGridOffset?: number;
  startGridSpacing?: number;
  startGridRowOffset?: number;
}
