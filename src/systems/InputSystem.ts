export type InputAction = 'pause' | 'reset' | 'camera' | 'mute' | 'confirm';

const KEY_ACTIONS: Record<string, InputAction> = {
  Escape: 'pause',
  KeyR: 'reset',
  KeyC: 'camera',
  KeyM: 'mute',
  Enter: 'confirm',
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class InputSystem {
  moveX = 0;
  moveZ = 0;
  handbrake = false;

  private readonly keys = new Set<string>();
  private readonly pressedQueue: InputAction[] = [];
  private touchMoveX = 0;
  private touchMoveZ = 0;
  private touchHandbrake = false;
  private touchActive = false;

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  setTouch(moveX: number, moveZ: number, handbrake: boolean): void {
    this.touchMoveX = clamp(moveX, -1, 1);
    this.touchMoveZ = clamp(moveZ, -1, 1);
    this.touchHandbrake = handbrake;
    this.touchActive = true;
  }

  update(): void {
    let mx = 0;
    let mz = 0;
    if (this.keys.has('KeyA')) mx += 1;
    if (this.keys.has('KeyD')) mx -= 1;
    if (this.keys.has('ArrowLeft')) mx -= 1;
    if (this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz -= 1;

    if (mx === 0 && mz === 0 && this.touchActive) {
      mx = this.touchMoveX;
      mz = this.touchMoveZ;
    }
    this.moveX = clamp(mx, -1, 1);
    this.moveZ = clamp(mz, -1, 1);
    this.handbrake = this.keys.has('Space') || this.touchHandbrake;
  }

  consume(action: InputAction): boolean {
    const index = this.pressedQueue.indexOf(action);
    if (index === -1) return false;
    this.pressedQueue.splice(index, 1);
    return true;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat) return;
    const action = KEY_ACTIONS[event.code];
    if (action) {
      this.pressedQueue.push(action);
    }
    this.keys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
  };

  private readonly onBlur = (): void => {
    this.keys.clear();
    this.touchActive = false;
  };
}
