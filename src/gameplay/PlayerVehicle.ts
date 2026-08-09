import * as THREE from 'three';
import { PHYSICS } from '../core/Constants';
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

  private steerAngle = 0;
  private wheelRoll = 0;

  constructor(spec: VehicleSpec, color: string, scene: THREE.Scene) {
    this.spec = spec;
    this.visuals = buildVehicle(spec, color);
    scene.add(this.visuals.group);
  }

  reset(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = 0;
    this.lateral = 0;
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

  getVelocity(): { vx: number; vz: number } {
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const rx = fz;
    const rz = -fx;
    return { vx: fx * this.speed + rx * this.lateral, vz: fz * this.speed + rz * this.lateral };
  }

  update(dt: number, input: DriveInput): void {
    const spec = this.spec;

    if (input.throttle > 0) {
      if (this.speed >= 0) {
        this.speed = Math.min(
          this.speed + spec.accelMs2 * input.throttle * dt,
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

  private syncVisuals(): void {
    const group = this.visuals.group;
    group.position.set(this.x, 0, this.z);
    group.rotation.y = this.heading;
    this.visuals.frontLeftPivot.rotation.y = this.steerAngle;
    this.visuals.frontRightPivot.rotation.y = this.steerAngle;
    for (const wheel of this.visuals.wheels) {
      wheel.rotation.set(this.wheelRoll, 0, Math.PI / 2);
    }
  }
}
