import type { Density, VehicleSpec } from './types';

export const WORLD = {
  GRID_SIZE: 6,
  BLOCK_LENGTH: 150,
  ROAD_WIDTH: 16,
  SIDEWALK_WIDTH: 3,
  BUILDING_INSET: 17,
  CITY_SEED: 20260809,
  RENDER_DISTANCE: 380,
  LIGHT_CYCLE: 16,
  LIGHT_GREEN: 8,
  LIGHT_YELLOW_START: 10,
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
  TORQUE_BASE: 0.86,
  TORQUE_SWING: 0.2,
  GEAR_BASE: 1.0,
  GEAR_STEP: 0.24,
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
  FOV: 62,
  NEAR: 0.1,
  FAR: 1800,
  CHASE_DISTANCE: 8.5,
  CHASE_HEIGHT: 3.4,
  LOOK_AHEAD: 7,
  LOOK_HEIGHT: 1.25,
  SMOOTH_FACTOR: 9,
  INTERIOR_EYE_HEIGHT: 1.24,
  INTERIOR_FORWARD: 0.08,
  INTERIOR_LATERAL: -0.34,
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
  COUNTDOWN_SECONDS: 3,
  CHECKPOINT_RADIUS: 22,
  CORRIDOR_WIDTH: 26,
  BARRIER_WIDTH: 1.1,
  BARRIER_HEIGHT: 0.95,
  BARRIER_OFFSET: 16.5,
  BARRIER_EXTRA: 2.5,
  FLAG_OFFSET: 13.5,
  AI_RUBBERBAND_BEHIND: 1.1,
  AI_RUBBERBAND_AHEAD: 0.92,
  DIFFICULTIES: {
    easy: { speedScale: 0.82, cornerScale: 0.72, rubberband: 1.06 },
    normal: { speedScale: 0.92, cornerScale: 0.84, rubberband: 1.08 },
    hard: { speedScale: 1.0, cornerScale: 1.0, rubberband: 1.1 },
  } as Record<string, { speedScale: number; cornerScale: number; rubberband: number }>,
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
    accelMs2: 9.5,
    brakeMs2: 20,
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
    accelMs2: 13.5,
    brakeMs2: 24,
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
    accelMs2: 8.0,
    brakeMs2: 18,
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
    accelMs2: 6.8,
    brakeMs2: 16,
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
    accelMs2: 7.8,
    brakeMs2: 19,
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
    accelMs2: 11.5,
    brakeMs2: 22,
    steerRate: 3.7,
    grip: 1.1,
    length: 4.6,
    width: 1.85,
    height: 1.46,
  },
];

export const DEFAULT_VEHICLE_ID = 'sedan';
export const STORAGE_KEY = 'fenza-road-save-v1';
