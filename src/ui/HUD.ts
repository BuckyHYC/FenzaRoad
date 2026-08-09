export default class HUD {
  private readonly speedElement: HTMLSpanElement;

  constructor() {
    const container = document.createElement('div');
    container.id = 'hud';
    container.innerHTML = 'Speed: <span id="hud-speed">0</span> km/h';
    document.body.appendChild(container);

    const element = document.getElementById('hud-speed');
    if (!(element instanceof HTMLSpanElement)) {
      throw new Error('HUD speed element not found');
    }
    this.speedElement = element;
  }

  updateSpeed(speedMs: number): void {
    const speedKmh = Math.abs(speedMs) * 3.6;
    this.speedElement.textContent = speedKmh.toFixed(0);
  }
}
