export type GameMode = 'menu' | 'garage' | 'freeRoam' | 'race';
export type RacePhase = 'idle' | 'countdown' | 'racing' | 'finished';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type BodyStyle = 'sedan' | 'coupe' | 'suv' | 'pickup' | 'taxi' | 'police';
export type CameraMode = 'chase' | 'hood';
export type ControlMode = 'mobile' | 'desktop';
export type Density = 'low' | 'medium' | 'high';

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

export interface SavedProgress {
  selectedVehicleId: string;
  selectedColor: string;
  bestLaps: Record<string, number>;
  muted: boolean;
  controlMode: ControlMode;
  density: Density;
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
  resultPosition: number;
  bestLapMs: number;
}
