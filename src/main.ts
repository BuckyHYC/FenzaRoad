import './style.css';
import * as THREE from 'three';
import GameEngine from './core/GameEngine';
import InputManager from './core/InputManager';
import SimpleCar from './vehicles/SimpleCar';
import HUD from './ui/HUD';
import {
  CAMERA_FOLLOW_DISTANCE,
  CAMERA_FOLLOW_HEIGHT,
  CAMERA_LOOK_AHEAD,
  CAMERA_LOOK_HEIGHT,
  CAMERA_SMOOTH_FACTOR,
} from './config/constants';

const app = document.getElementById('app');
if (!app) {
  throw new Error('App container not found');
}

const engine = new GameEngine(app);
InputManager.getInstance();

const car = new SimpleCar(engine.scene);
const hud = new HUD();

const cameraTarget = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const smoothLookTarget = new THREE.Vector3();

function updateCamera(deltaTime: number, snap = false): void {
  const position = car.getPosition();
  const forward = car.getForward();
  const smoothT = snap ? 1 : 1 - Math.exp(-CAMERA_SMOOTH_FACTOR * deltaTime);

  // Behind the car along -forward, then lift in world space
  cameraTarget
    .copy(position)
    .addScaledVector(forward, -CAMERA_FOLLOW_DISTANCE);
  cameraTarget.y = position.y + CAMERA_FOLLOW_HEIGHT;
  engine.camera.position.lerp(cameraTarget, smoothT);

  // Look at a point ahead on the road so the car stays in the lower frame
  lookTarget
    .copy(position)
    .addScaledVector(forward, CAMERA_LOOK_AHEAD);
  lookTarget.y = position.y + CAMERA_LOOK_HEIGHT;
  smoothLookTarget.lerp(lookTarget, smoothT);
  engine.camera.lookAt(smoothLookTarget);
}

// Snap once so the first frame is already in chase view
updateCamera(0, true);

engine.registerUpdate((deltaTime: number) => {
  car.update(deltaTime);
  hud.updateSpeed(car.getSpeed());
  updateCamera(deltaTime);
});

engine.start();
