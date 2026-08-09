import * as THREE from 'three';
import { DRIVETRAIN, PHYSICS } from '../core/Constants';
import type { VehicleSpec } from '../core/types';
import { buildVehicle, type VehicleVisuals } from './VehicleFactory';

export interface DriveInput {
  throttle: number;
  brake: number;
  steer: number;
  handbrake: boolean;
}

const WHEEL_RADIUS = 0.32;

export class PlayerVehicle {
  readonly spec: VehicleSpec;
  readonly visuals: VehicleVisuals;

  x = 0;
  z = 0;
  heading = 0;
  speed = 0;
  lateral = 0;
  gear = 1;
  rpm = 0;

  private steerAngle = 0;
  private wheelRoll = 0;
  private shiftTimer = 0;
  private readonly gearMaxSpeeds: number[];

  constructor(
    spec: VehicleSpec,
    color: string,
    scene: THREE.Scene,
    castShadows = true,
    highQuality = true,
  ) {
    this.spec = spec;
    this.gearMaxSpeeds = PlayerVehicle.buildGearMaxSpeeds(spec);
    this.rpm = spec.engineIdleRpm;
    this.visuals = buildVehicle(spec, color, castShadows, highQuality);
    scene.add(this.visuals.group);
  }

  reset(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.lateral = 0;
    this.gear = 1;
    this.rpm = this.spec.engineIdleRpm;
    this.shiftTimer = 0;
    this.steerAngle = 0;
    this.wheelRoll = 0;
    this.syncVisuals();
  }

  setKinematic(x: number, z: number, heading: number, speedMs: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = speedMs;
    this.lateral = 0;
    this.syncVisuals();
  }

  getSpeedMs(): number {
    return Math.hypot(this.speed, this.lateral);
  }

  getRpmRatio(): number {
    const range = Math.max(
      1,
      this.spec.engineRedlineRpm - this.spec.engineIdleRpm,
    );
    return Math.max(
      0,
      Math.min(1, (this.rpm - this.spec.engineIdleRpm) / range),
    );
  }

  getVelocity(): { vx: number; vz: number } {
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const rx = fz;
    const rz = -fx;
    return { vx: fx * this.speed + rx * this.lateral, vz: fz * this.speed + rz * this.lateral };
  }

  setVelocity(vx: number, vz: number): void {
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    this.speed = vx * fx + vz * fz;
    this.lateral = vx * fz - vz * fx;
  }

  update(dt: number, input: DriveInput): void {
    const spec = this.spec;
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    if (this.speed < -0.5) {
      this.gear = 0;
    } else if (Math.abs(this.speed) < 0.8) {
      this.gear = 1;
    }

    const rpmRatio = this.getRpmRatio();
    const torque = this.getTorqueFactor(rpmRatio);
    const gearFactor = this.gear > 0 ? this.getGearFactor() : DRIVETRAIN.GEAR_BASE;
    const engineAccel = spec.accelMs2 * torque * gearFactor;

    if (input.throttle > 0) {
      if (this.speed >= 0) {
        this.speed = Math.min(
          this.speed + engineAccel * input.throttle * dt,
          spec.topSpeedMs,
        );
      } else {
        this.speed = Math.min(this.speed + spec.brakeMs2 * dt, 0);
      }
    } else if (input.brake > 0) {
      if (this.speed > 0) {
        this.speed = Math.max(this.speed - spec.brakeMs2 * input.brake * dt, 0);
      } else {
        this.speed = Math.max(
          this.speed - spec.accelMs2 * 0.55 * dt,
          -PHYSICS.REVERSE_MAX_SPEED,
        );
      }
    } else if (Math.abs(this.speed) > 0.001) {
      const decel = PHYSICS.COAST_DECELERATION * dt;
      if (this.speed > 0) this.speed = Math.max(this.speed - decel, 0);
      else this.speed = Math.min(this.speed + decel, 0);
    }

    const forwardSpeed = Math.abs(this.speed);
    this.updateTransmission(forwardSpeed, input);
    const targetRpm = this.computeTargetRpm(forwardSpeed);
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * DRIVETRAIN.RPM_RESPONSE);

    const speedRatio = Math.min(Math.abs(this.speed) / spec.topSpeedMs, 1);
    const targetSteer =
      input.steer *
      PHYSICS.MAX_STEER_ANGLE *
      (1 - speedRatio * speedRatio * PHYSICS.STEER_SPEED_FACTOR);
    const steerDelta = spec.steerRate * PHYSICS.STEER_RESPONSE * dt;
    if (this.steerAngle < targetSteer) {
      this.steerAngle = Math.min(this.steerAngle + steerDelta, targetSteer);
    } else if (this.steerAngle > targetSteer) {
      this.steerAngle = Math.max(this.steerAngle - steerDelta, targetSteer);
    }

    if (Math.abs(this.speed) > 0.1) {
      const yawRate = (this.speed / PHYSICS.WHEELBASE) * Math.tan(this.steerAngle);
      this.heading += yawRate * dt;
    }

    const grip = input.handbrake ? PHYSICS.HAND_BRAKE_GRIP : spec.grip * PHYSICS.NORMAL_GRIP;
    const lateralTarget = input.steer * this.speed * (input.handbrake ? 0.34 : 0.1);
    this.lateral += (lateralTarget - this.lateral) * Math.min(grip * dt, 1);

    const velocity = this.getVelocity();
    this.x += velocity.vx * dt;
    this.z += velocity.vz * dt;

    this.wheelRoll += (this.speed / WHEEL_RADIUS) * dt;
    this.syncVisuals();
  }

  setWheelSteering(steerAngle: number): void {
    this.steerAngle = steerAngle;
  }

  rollWheels(dt: number): void {
    this.wheelRoll += (this.speed / WHEEL_RADIUS) * dt;
    for (const wheel of this.visuals.wheels) {
      wheel.rotation.set(this.wheelRoll, 0, Math.PI / 2);
    }
  }

  private static buildGearMaxSpeeds(spec: VehicleSpec): number[] {
    const speeds: number[] = [];
    const first = DRIVETRAIN.FIRST_GEAR_REDLINE_RATIO;
    for (let gear = 1; gear <= spec.gears; gear += 1) {
      const t = (gear - 1) / Math.max(1, spec.gears - 1);
      speeds.push(spec.topSpeedMs * first * Math.pow(1 / first, t));
    }
    return speeds;
  }

  private getTorqueFactor(rpmRatio: number): number {
    const r = Math.max(0, Math.min(1, rpmRatio));
    return DRIVETRAIN.TORQUE_BASE + DRIVETRAIN.TORQUE_SWING * Math.sin(Math.PI * r);
  }

  private getGearFactor(): number {
    return DRIVETRAIN.GEAR_BASE + (this.spec.gears - this.gear) * DRIVETRAIN.GEAR_STEP;
  }

  private computeTargetRpm(speedMs: number): number {
    const spec = this.spec;
    const range = spec.engineRedlineRpm - spec.engineIdleRpm;
    if (this.gear === 0) {
      const reverseRatio = Math.min(speedMs / PHYSICS.REVERSE_MAX_SPEED, 1);
      return spec.engineIdleRpm + range * reverseRatio * DRIVETRAIN.REVERSE_RPM_RATIO;
    }
    const vMax = this.gearMaxSpeeds[this.gear - 1] ?? spec.topSpeedMs;
    const speedRatio = Math.min(speedMs / vMax, 1);
    return spec.engineIdleRpm + range * speedRatio;
  }

  private updateTransmission(speedMs: number, input: DriveInput): void {
    if (this.gear === 0 || this.shiftTimer > 0) return;
    const redline = this.spec.engineRedlineRpm;
    const target = this.computeTargetRpm(speedMs);
    if (
      input.throttle > DRIVETRAIN.UPSHIFT_THROTTLE &&
      target >= redline * DRIVETRAIN.UPSHIFT_RPM_RATIO &&
      this.gear < this.spec.gears
    ) {
      this.gear += 1;
      this.shiftTimer = DRIVETRAIN.SHIFT_TIME;
      return;
    }
    if (
      this.gear > 1 &&
      target < redline * DRIVETRAIN.DOWNSHIFT_RPM_RATIO &&
      (input.throttle > DRIVETRAIN.DOWNSHIFT_THROTTLE ||
        input.brake > DRIVETRAIN.DOWNSHIFT_BRAKE) &&
      speedMs <= this.gearMaxSpeeds[this.gear - 2] * DRIVETRAIN.DOWNSHIFT_SPEED_RATIO
    ) {
      this.gear -= 1;
      this.shiftTimer = DRIVETRAIN.SHIFT_TIME;
    }
  }

  private syncVisuals(): void {
    const group = this.visuals.group;
    group.position.set(this.x, 0, this.z);
    group.rotation.y = this.heading;
    this.visuals.frontLeftPivot.rotation.y = this.steerAngle;
    this.visuals.frontRightPivot.rotation.y = this.steerAngle;
    if (this.visuals.steeringWheel) {
      this.visuals.steeringWheel.rotation.z = this.steerAngle * 1.8;
    }
    for (const wheel of this.visuals.wheels) {
      wheel.rotation.set(this.wheelRoll, 0, Math.PI / 2);
    }
  }
}
