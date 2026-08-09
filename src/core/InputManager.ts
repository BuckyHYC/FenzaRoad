export default class InputManager {
  private static instance: InputManager | null = null;
  private readonly pressedKeys = new Set<string>();

  private constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clearKeys);
  }

  static getInstance(): InputManager {
    if (!InputManager.instance) {
      InputManager.instance = new InputManager();
    }
    return InputManager.instance;
  }

  isKeyPressed(key: string): boolean {
    return this.pressedKeys.has(key);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.pressedKeys.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressedKeys.delete(event.code);
  };

  private readonly clearKeys = (): void => {
    this.pressedKeys.clear();
  };
}
