import type { Density, QualityPreset, RaceLayoutId, VehicleSpec } from './types';

export const WORLD = {
  GRID_SIZE: 8,
  BLOCK_LENGTH: 150,
  ROAD_WIDTH: 16,
  SIDEWALK_WIDTH: 3,
  BUILDING_INSET: 17,
  CITY_SEED: 20260809,
  RENDER_DISTANCE: 380,
  LIGHT_CYCLE: 16,
  LIGHT_GREEN: 8,
  LIGHT_YELLOW_START: 10,
  CITY_MAX_X: 600,
  VILLAGE_MAX_X: 900,
  SPAWN_X: 300,
  SPAWN_Z: 450,
  RIVER_Z: 600,
  RIVER_WIDTH: 22,
  RIVER_LENGTH_PADDING: 120,
  BOUNDARY_OFFSET: 14,
  ENDLESS_CHUNK_SIZE: 300,
  ENDLESS_WINDOW: 5,
} as const;

export const QUALITY_PRESETS: Record<
  QualityPreset,
  {
    pixelRatio: number;
    antialias: boolean;
    shadowMapSize: number;
    pcfSoft: boolean;
    bloom: boolean;
    ssao: boolean;
    reflector: boolean;
  }
> = {
  low: {
    pixelRatio: 1,
    antialias: false,
    shadowMapSize: 0,
    pcfSoft: false,
    bloom: false,
    ssao: false,
    reflector: false,
  },
  medium: {
    pixelRatio: 1.25,
    antialias: true,
    shadowMapSize: 2048,
    pcfSoft: true,
    bloom: true,
    ssao: false,
    reflector: false,
  },
  high: {
    pixelRatio: 1.5,
    antialias: true,
    shadowMapSize: 4096,
    pcfSoft: true,
    bloom: true,
    ssao: true,
    reflector: true,
  },
  auto: {
    pixelRatio: 1.25,
    antialias: true,
    shadowMapSize: 2048,
    pcfSoft: true,
    bloom: true,
    ssao: false,
    reflector: false,
  },
} as const;

export const MULTIPLAYER_CONFIG = {
  SERVER_PATH: '/multiplayer',
  MAX_PLAYERS: 8,
  TICK_HZ: 15,
  ROOM_REFRESH_MS: 1000,
  USERNAME_PREFIX: '城市司机',
} as const;

export const PHYSICS = {
  FIXED_STEP: 1 / 60,
  WHEELBASE: 2.7,
  MAX_STEER_ANGLE: 0.34,
  STEER_RESPONSE: 1.8,
  STEER_SPEED_FACTOR: 0.72,
  HAND_BRAKE_GRIP: 0.55,
  NORMAL_GRIP: 7,
  COAST_DECELERATION: 2.2,
  REVERSE_MAX_SPEED: 9,
  COLLISION_BOUNCE: 0.38,
  COLLISION_RESTITUTION: 0.34,
  VEHICLE_MASS_DENSITY: 125,
  CAR_RADIUS_PADDING: 0.12,
} as const;

export const DRIVETRAIN = {
  FIRST_GEAR_REDLINE_RATIO: 0.14,
  UPSHIFT_RPM_RATIO: 0.985,
  UPSHIFT_THROTTLE: 0.15,
  DOWNSHIFT_RPM_RATIO: 0.42,
  DOWNSHIFT_THROTTLE: 0.2,
  DOWNSHIFT_BRAKE: 0.3,
  DOWNSHIFT_SPEED_RATIO: 0.95,
  SHIFT_TIME: 0.18,
  RPM_RESPONSE: 8,
  REVERSE_RPM_RATIO: 0.6,
  REVERSE_GEAR_RATIO: 3.4,
} as const;

export const DENSITY_CONFIG: Record<
  Density,
  {
    trafficMax: number;
    trafficSpawnInterval: number;
    pedestrianMax: number;
    pedestrianNearby: number;
    pedestrianSpawnInterval: number;
  }
> = {
  low: {
    trafficMax: 60,
    trafficSpawnInterval: 0.66,
    pedestrianMax: 44,
    pedestrianNearby: 18,
    pedestrianSpawnInterval: 0.32,
  },
  medium: {
    trafficMax: 84,
    trafficSpawnInterval: 0.44,
    pedestrianMax: 66,
    pedestrianNearby: 26,
    pedestrianSpawnInterval: 0.24,
  },
  high: {
    trafficMax: 110,
    trafficSpawnInterval: 0.28,
    pedestrianMax: 92,
    pedestrianNearby: 34,
    pedestrianSpawnInterval: 0.16,
  },
};

export const CAMERA_CONFIG = {
  FOV: 74,
  HOOD_FOV: 90,
  NEAR: 0.1,
  FAR: 1800,
  CHASE_DISTANCE: 8.5,
  CHASE_HEIGHT: 3.4,
  LOOK_AHEAD: 7,
  LOOK_HEIGHT: 1.25,
  SMOOTH_FACTOR: 9,
  INTERIOR_EYE_HEIGHT_RATIO: 0.9,
  INTERIOR_FORWARD: 0.18,
  INTERIOR_LATERAL: -0.18,
  ORBIT_DISTANCE: 16,
  ORBIT_HEIGHT: 5.2,
} as const;

export const TRAFFIC_CONFIG = {
  MAX_COUNT: 42,
  SPAWN_INTERVAL: 0.9,
  BASE_SPEED: 11.5,
  SPEED_VARIATION: 3.5,
  STOP_MARGIN: 15,
  FOLLOW_GAP: 9,
  SPAWN_MIN_PLAYER_DISTANCE: 240,
  DESPAWN_DISTANCE: 680,
} as const;

export const PEDESTRIAN_CONFIG = {
  MAX_COUNT: 76,
  NEARBY_TARGET: 30,
  SPAWN_INTERVAL: 0.2,
  SPAWN_MIN_PLAYER_DISTANCE: 80,
  SPAWN_MAX_PLAYER_DISTANCE: 460,
  DESPAWN_DISTANCE: 600,
  NEARBY_RADIUS: 320,
  WALK_SPEED_MIN: 0.9,
  WALK_SPEED_MAX: 1.55,
  DOWN_DURATION: 4,
  FALL_DURATION: 0.35,
  SIDEWALK_OFFSET: 9.5,
  RADIUS: 0.46,
  MODEL_SCALE: 1.28,
} as const;

export const RACE_CONFIG = {
  TOTAL_LAPS: 3,
  TOTAL_RACERS: 4,
  MIN_OPPONENTS: 1,
  MAX_OPPONENTS: 7,
  MIN_LAPS: 1,
  MAX_LAPS: 5,
  MAX_TOTAL_RACERS: 8,
  COUNTDOWN_SECONDS: 3,
  CHECKPOINT_RADIUS: 22,
  CORRIDOR_WIDTH: 26,
  BARRIER_WIDTH: 1.1,
  BARRIER_HEIGHT: 0.95,
  BARRIER_OFFSET: 16.5,
  BARRIER_EXTRA: 2.5,
  FLAG_OFFSET: 13.5,
  START_GRID_OFFSET: 3.5,
  START_GRID_SPACING: 11,
  START_GRID_ROW_OFFSET: 7,
  AI_RUBBERBAND_BEHIND: 1.1,
  AI_RUBBERBAND_AHEAD: 0.92,
  DIFFICULTIES: {
    easy: { speedScale: 0.82, cornerScale: 0.72, rubberband: 1.06 },
    normal: { speedScale: 0.92, cornerScale: 0.84, rubberband: 1.08 },
    hard: { speedScale: 1.0, cornerScale: 1.0, rubberband: 1.1 },
  } as Record<string, { speedScale: number; cornerScale: number; rubberband: number }>,
} as const;

/** 行驶奖励：每行驶 1 km 获得 2 金币 */
export const DISTANCE_COIN_EVERY_KM = 2;
/** 生涯统计周期性存档间隔（秒） */
export const PROGRESS_SAVE_INTERVAL = 10;

/** 自由漫游城市中的竞速任务触发点（数据驱动，对应 race/layouts 中的地图） */
export interface TaskPointDef {
  id: string;
  layoutId: RaceLayoutId;
  name: string;
  /** 世界坐标（位于道路交叉口） */
  x: number;
  z: number;
  /** 高亮圆环与触发区半径 */
  radius: number;
  defaultLaps: number;
  defaultOpponents: number;
}

export const TASK_POINTS: TaskPointDef[] = [
  {
    id: 'task-perimeter',
    layoutId: 'perimeter',
    name: '城市环路',
    x: 300,
    z: 300,
    radius: 9,
    defaultLaps: 2,
    defaultOpponents: 3,
  },
  {
    id: 'task-citytour',
    layoutId: 'cityTour',
    name: '城市巡回',
    x: 750,
    z: 450,
    radius: 9,
    defaultLaps: 2,
    defaultOpponents: 3,
  },
  {
    id: 'task-hillloop',
    layoutId: 'hillLoop',
    name: '山地纵贯',
    x: 1050,
    z: 750,
    radius: 9,
    defaultLaps: 2,
    defaultOpponents: 3,
  },
];

export const TASK_POINT_CONFIG = {
  MIN_LAPS: 1,
  MAX_LAPS: 5,
  MIN_OPPONENTS: 1,
  MAX_OPPONENTS: 7,
  TRIGGER_RADIUS_MARGIN: 1.5,
} as const;

export const TREE_COLLIDER_RADIUS = 0.85;

export const DENSITY_VALUES = {
  low: { trafficMax: 60, trafficSpawnInterval: 0.66, pedestrianMax: 44, pedestrianNearby: 18, pedestrianSpawnInterval: 0.32 },
  medium: { trafficMax: 84, trafficSpawnInterval: 0.44, pedestrianMax: 66, pedestrianNearby: 26, pedestrianSpawnInterval: 0.24 },
  high: { trafficMax: 110, trafficSpawnInterval: 0.28, pedestrianMax: 92, pedestrianNearby: 34, pedestrianSpawnInterval: 0.16 },
} as const;

export const AUDIO_CONFIG = {
  ENGINE_BASE_FREQ: 58,
  ENGINE_MAX_ADD: 232,
  ENGINE_BASE_GAIN: 0.012,
  ENGINE_THROTTLE_GAIN: 0.03,
} as const;

/** 背景音乐：普通模式与竞速模式的总线增益（竞速更燃更响） */
export const MUSIC_CONFIG = {
  NORMAL_GAIN: 0.16,
  RACE_GAIN: 0.2,
} as const;

export const COLORS = {
  SKY: 0x9fc7e8,
  FOG: 0xbfd4e4,
  GROUND: 0x6d9660,
  ROAD: 0x3d4148,
  SIDEWALK: 0x9a9ea6,
  MARKING: 0xe8e8e8,
  BUILDINGS: [0x9aa7b0, 0xc9c2b4, 0xb7a88c, 0x8e9aa6, 0xa8543f, 0x3f5f6e, 0x7d6f57, 0x5c7f8c],
} as const;

export const VEHICLES: VehicleSpec[] = [
  {
    id: 'sedan',
    name: '城市轿车',
    bodyStyle: 'sedan',
    color: '#cc3333',
    colorOptions: ['#cc3333', '#3568c9', '#e8e8e8', '#333333'],
    topSpeedMs: 46,
    gears: 6,
    engineRedlineRpm: 7000,
    engineIdleRpm: 850,
    accelMs2: 13.0,
    brakeMs2: 20,
    torqueCurveNm: [205, 235, 258, 272, 278, 274, 260, 240, 208],
    peakTorqueNm: 278,
    gearRatios: [3.6, 2.19, 1.42, 1.0, 0.78, 0.62],
    finalDrive: 4.06,
    steerRate: 3.4,
    grip: 1.0,
    length: 4.4,
    width: 1.8,
    height: 1.42,
  },
  {
    id: 'coupe',
    name: '运动轿跑',
    bodyStyle: 'coupe',
    color: '#e0562c',
    colorOptions: ['#e0562c', '#f2c94c', '#7a2fd0', '#222222'],
    topSpeedMs: 62,
    gears: 7,
    engineRedlineRpm: 8500,
    engineIdleRpm: 950,
    accelMs2: 17.5,
    brakeMs2: 24,
    torqueCurveNm: [350, 440, 515, 555, 560, 545, 515, 455, 390],
    peakTorqueNm: 560,
    gearRatios: [3.9, 2.6, 1.95, 1.52, 1.25, 1.05, 0.89],
    finalDrive: 3.7,
    steerRate: 3.9,
    grip: 1.15,
    length: 4.45,
    width: 1.85,
    height: 1.24,
  },
  {
    id: 'suv',
    name: '越野 SUV',
    bodyStyle: 'suv',
    color: '#2f6b3f',
    colorOptions: ['#2f6b3f', '#c98a3d', '#e8e8e8', '#1f3a4d'],
    topSpeedMs: 42,
    gears: 6,
    engineRedlineRpm: 6200,
    engineIdleRpm: 800,
    accelMs2: 11.0,
    brakeMs2: 18,
    torqueCurveNm: [410, 465, 490, 485, 455, 420, 380, 340, 295],
    peakTorqueNm: 490,
    gearRatios: [3.5, 2.24, 1.55, 1.18, 0.95, 0.78],
    finalDrive: 3.9,
    steerRate: 3.1,
    grip: 1.3,
    length: 4.8,
    width: 1.95,
    height: 1.82,
  },
  {
    id: 'pickup',
    name: '经典皮卡',
    bodyStyle: 'pickup',
    color: '#8a6f3f',
    colorOptions: ['#8a6f3f', '#4f6d8c', '#b7b7b7', '#5a3826'],
    topSpeedMs: 38,
    gears: 6,
    engineRedlineRpm: 5800,
    engineIdleRpm: 750,
    accelMs2: 9.5,
    brakeMs2: 16,
    torqueCurveNm: [475, 540, 570, 580, 555, 510, 470, 425, 380],
    peakTorqueNm: 580,
    gearRatios: [3.9, 2.47, 1.67, 1.24, 1.0, 0.82],
    finalDrive: 3.5,
    steerRate: 2.9,
    grip: 1.05,
    length: 5.2,
    width: 1.9,
    height: 1.78,
  },
  {
    id: 'taxi',
    name: '城市出租车',
    bodyStyle: 'taxi',
    color: '#e6b800',
    colorOptions: ['#e6b800', '#f5f0dc', '#2f6f4f'],
    topSpeedMs: 41,
    gears: 5,
    engineRedlineRpm: 6800,
    engineIdleRpm: 850,
    accelMs2: 10.8,
    brakeMs2: 19,
    torqueCurveNm: [210, 255, 285, 305, 310, 300, 275, 250, 215],
    peakTorqueNm: 310,
    gearRatios: [3.3, 2.05, 1.38, 1.0, 0.79],
    finalDrive: 4.1,
    steerRate: 3.2,
    grip: 1.0,
    length: 4.5,
    width: 1.8,
    height: 1.46,
  },
  {
    id: 'police',
    name: '警用拦截车',
    bodyStyle: 'police',
    color: '#f2f2f2',
    colorOptions: ['#f2f2f2', '#2b2b3a', '#31506b'],
    topSpeedMs: 56,
    gears: 7,
    engineRedlineRpm: 8000,
    engineIdleRpm: 900,
    accelMs2: 15.5,
    brakeMs2: 22,
    torqueCurveNm: [395, 485, 545, 580, 575, 545, 500, 440, 380],
    peakTorqueNm: 580,
    gearRatios: [3.7, 2.45, 1.85, 1.45, 1.19, 1.0, 0.85],
    finalDrive: 3.7,
    steerRate: 3.7,
    grip: 1.1,
    length: 4.6,
    width: 1.85,
    height: 1.46,
  },
];

export const DEFAULT_VEHICLE_ID = 'sedan';
export const STORAGE_KEY = 'fenza-road-save-v1';
