import * as THREE from 'three';
import {
  CAR_ACCELERATION,
  CAR_BODY_HEIGHT,
  CAR_BODY_LENGTH,
  CAR_BODY_WIDTH,
  CAR_BRAKE_DECELERATION,
  CAR_COAST_DECELERATION,
  CAR_MAX_SPEED,
  CAR_MAX_STEER_ANGLE,
  CAR_REVERSE_MAX_SPEED,
  CAR_STEER_SPEED,
  CAR_STEER_SPEED_FACTOR,
  CAR_WHEEL_RADIUS,
  CAR_WHEEL_WIDTH,
} from '../config/constants';
import InputManager from '../core/InputManager';

export default class SimpleCar {
  readonly mesh: THREE.Group;

  private speed = 0;
  private steerAngle = 0;
  private wheelRollAngle = 0;

  private readonly bodyMesh: THREE.Mesh;
  private readonly frontLeftPivot: THREE.Group;
  private readonly frontRightPivot: THREE.Group;
  private readonly rearLeftWheel: THREE.Mesh;
  private readonly rearRightWheel: THREE.Mesh;
  private readonly frontLeftWheel: THREE.Mesh;
  private readonly frontRightWheel: THREE.Mesh;

  private readonly input: InputManager;
  private readonly forward = new THREE.Vector3();
  private readonly wheelbase: number;

  constructor(scene: THREE.Scene) {
    this.input = InputManager.getInstance();
    this.mesh = new THREE.Group();
    this.wheelbase = CAR_BODY_LENGTH * 0.55;

    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xcc2222 });
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });

    const bodyGeometry = new THREE.BoxGeometry(
      CAR_BODY_WIDTH,
      CAR_BODY_HEIGHT,
      CAR_BODY_LENGTH,
    );
    this.bodyMesh = new THREE.Mesh(bodyGeometry, bodyMaterial);
    this.bodyMesh.position.y = CAR_WHEEL_RADIUS + CAR_BODY_HEIGHT / 2;
    this.bodyMesh.castShadow = true;
    this.mesh.add(this.bodyMesh);

    const wheelGeometry = new THREE.CylinderGeometry(
      CAR_WHEEL_RADIUS,
      CAR_WHEEL_RADIUS,
      CAR_WHEEL_WIDTH,
      16,
    );

    const halfLength = CAR_BODY_LENGTH / 2 - 0.4;
    const halfWidth = CAR_BODY_WIDTH / 2 + CAR_WHEEL_WIDTH / 2;

    this.frontLeftPivot = new THREE.Group();
    this.frontRightPivot = new THREE.Group();

    this.frontLeftWheel = this.createWheel(wheelGeometry, wheelMaterial);
    this.frontRightWheel = this.createWheel(wheelGeometry, wheelMaterial);
    this.rearLeftWheel = this.createWheel(wheelGeometry, wheelMaterial);
    this.rearRightWheel = this.createWheel(wheelGeometry, wheelMaterial);

    this.frontLeftPivot.position.set(-halfWidth, CAR_WHEEL_RADIUS, -halfLength);
    this.frontRightPivot.position.set(halfWidth, CAR_WHEEL_RADIUS, -halfLength);
    this.rearLeftWheel.position.set(-halfWidth, CAR_WHEEL_RADIUS, halfLength);
    this.rearRightWheel.position.set(halfWidth, CAR_WHEEL_RADIUS, halfLength);

    this.frontLeftPivot.add(this.frontLeftWheel);
    this.frontRightPivot.add(this.frontRightWheel);
    this.mesh.add(this.frontLeftPivot);
    this.mesh.add(this.frontRightPivot);
    this.mesh.add(this.rearLeftWheel);
    this.mesh.add(this.rearRightWheel);

    scene.add(this.mesh);
  }

  update(deltaTime: number): void {
    this.updateSpeed(deltaTime);
    this.updateSteering(deltaTime);
    this.applyMovement(deltaTime);
    this.updateWheelVisuals(deltaTime);
  }

  getPosition(): THREE.Vector3 {
    return this.mesh.position.clone();
  }

  getForward(): THREE.Vector3 {
    this.mesh.getWorldDirection(this.forward);
    this.forward.y = 0;
    return this.forward.normalize();
  }

  getSpeed(): number {
    return this.speed;
  }

  private createWheel(
    geometry: THREE.CylinderGeometry,
    material: THREE.MeshStandardMaterial,
  ): THREE.Mesh {
    const wheel = new THREE.Mesh(geometry, material);
    wheel.rotation.z = Math.PI / 2;
    wheel.castShadow = true;
    return wheel;
  }

  private updateSpeed(deltaTime: number): void {
    const accelerating = this.input.isKeyPressed('KeyW');
    const braking = this.input.isKeyPressed('KeyS');

    if (accelerating) {
      if (this.speed >= 0) {
        this.speed = Math.min(
          this.speed + CAR_ACCELERATION * deltaTime,
          CAR_MAX_SPEED,
        );
      } else {
        this.speed = Math.min(this.speed + CAR_BRAKE_DECELERATION * deltaTime, 0);
      }
    } else if (braking) {
      if (this.speed > 0) {
        this.speed = Math.max(this.speed - CAR_BRAKE_DECELERATION * deltaTime, 0);
      } else {
        this.speed = Math.max(
          this.speed - CAR_ACCELERATION * deltaTime,
          -CAR_REVERSE_MAX_SPEED,
        );
      }
    } else {
      if (this.speed > 0) {
        this.speed = Math.max(this.speed - CAR_COAST_DECELERATION * deltaTime, 0);
      } else if (this.speed < 0) {
        this.speed = Math.min(this.speed + CAR_COAST_DECELERATION * deltaTime, 0);
      }
    }
  }

  private updateSteering(deltaTime: number): void {
    const speedRatio = Math.min(Math.abs(this.speed) / CAR_MAX_SPEED, 1);
    const steerSensitivity =
      1 - speedRatio * CAR_STEER_SPEED_FACTOR;

    let steerInput = 0;
    if (this.input.isKeyPressed('KeyA')) steerInput += 1;
    if (this.input.isKeyPressed('KeyD')) steerInput -= 1;

    const targetSteer = steerInput * CAR_MAX_STEER_ANGLE * steerSensitivity;
    const steerDelta = CAR_STEER_SPEED * deltaTime;

    if (this.steerAngle < targetSteer) {
      this.steerAngle = Math.min(this.steerAngle + steerDelta, targetSteer);
    } else if (this.steerAngle > targetSteer) {
      this.steerAngle = Math.max(this.steerAngle - steerDelta, targetSteer);
    }

    // Return to center when no input
    if (steerInput === 0) {
      if (this.steerAngle > 0) {
        this.steerAngle = Math.max(this.steerAngle - steerDelta, 0);
      } else if (this.steerAngle < 0) {
        this.steerAngle = Math.min(this.steerAngle + steerDelta, 0);
      }
    }

    this.frontLeftPivot.rotation.y = this.steerAngle;
    this.frontRightPivot.rotation.y = this.steerAngle;
  }

  private applyMovement(deltaTime: number): void {
    if (Math.abs(this.speed) < 0.001) return;

    const yawRate =
      (this.speed / this.wheelbase) * Math.tan(this.steerAngle);

    this.mesh.rotation.y += yawRate * deltaTime;

    this.mesh.getWorldDirection(this.forward);
    this.forward.y = 0;
    this.forward.normalize();

    this.mesh.position.addScaledVector(this.forward, this.speed * deltaTime);
  }

  private updateWheelVisuals(deltaTime: number): void {
    this.wheelRollAngle += (this.speed / CAR_WHEEL_RADIUS) * deltaTime;

    for (const wheel of [
      this.frontLeftWheel,
      this.frontRightWheel,
      this.rearLeftWheel,
      this.rearRightWheel,
    ]) {
      wheel.rotation.set(this.wheelRollAngle, 0, Math.PI / 2);
    }
  }
}
