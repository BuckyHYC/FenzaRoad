/** Vehicle kinematics */
export const CAR_MAX_SPEED = 25; // m/s (~90 km/h)
export const CAR_ACCELERATION = 12; // m/s²
export const CAR_BRAKE_DECELERATION = 18; // m/s²
export const CAR_COAST_DECELERATION = 4; // m/s² (natural slowdown)
export const CAR_REVERSE_MAX_SPEED = 8; // m/s
export const CAR_STEER_SPEED = 2.2; // rad/s — how fast wheels turn
export const CAR_MAX_STEER_ANGLE = 0.45; // rad (~26°)
export const CAR_STEER_SPEED_FACTOR = 0.35; // higher speed → less steer sensitivity

/** Car dimensions (meters) */
export const CAR_BODY_LENGTH = 4.2;
export const CAR_BODY_WIDTH = 1.8;
export const CAR_BODY_HEIGHT = 1.2;
export const CAR_WHEEL_RADIUS = 0.35;
export const CAR_WHEEL_WIDTH = 0.25;

/** Camera follow — classic racing third-person (behind car, looking forward) */
export const CAMERA_FOLLOW_DISTANCE = 7;
export const CAMERA_FOLLOW_HEIGHT = 3;
export const CAMERA_SMOOTH_FACTOR = 10;
export const CAMERA_LOOK_AHEAD = 8;
export const CAMERA_LOOK_HEIGHT = 1.2;

/** Scene */
export const GROUND_SIZE = 500;
export const GROUND_COLOR = 0x3a5f3a;

/** Lighting */
export const AMBIENT_LIGHT_INTENSITY = 0.45;
export const DIRECTIONAL_LIGHT_INTENSITY = 1.2;
export const SHADOW_MAP_SIZE = 2048;

/** Fixed timestep */
export const FIXED_TIMESTEP = 1 / 60;
