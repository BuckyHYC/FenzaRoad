import { RACE_CONFIG, VEHICLES } from '../core/Constants';
import { eventBus, Events } from '../core/EventBus';
import { gameState } from '../core/GameState';
import type { ControlMode, Difficulty, RacePhase } from '../core/types';
import type { InputSystem } from '../systems/InputSystem';
import type { Game } from '../core/Game';
import { Minimap } from './Minimap';
import { TouchControls } from './TouchControls';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', className, text);
  node.addEventListener('click', onClick);
  return node;
}

function formatTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--:--.---';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = Math.floor(ms % 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

interface RaceFinishedData {
  position: number;
  totalRacers: number;
  bestLapMs: number;
  totalMs: number;
}

export class UIManager {
  private readonly game: Game;
  private readonly root: HTMLDivElement;
  private readonly menuOverlay: HTMLDivElement;
  private readonly raceMenuOverlay: HTMLDivElement;
  private readonly garageOverlay: HTMLDivElement;
  private readonly hudOverlay: HTMLDivElement;
  private readonly countdownOverlay: HTMLDivElement;
  private readonly pauseOverlay: HTMLDivElement;
  private readonly resultOverlay: HTMLDivElement;
  private readonly raceInfo: HTMLDivElement;
  private readonly speedValue: HTMLSpanElement;
  private readonly lapValue: HTMLSpanElement;
  private readonly positionValue: HTMLSpanElement;
  private readonly timeValue: HTMLSpanElement;
  private readonly bestLapValue: HTMLSpanElement;
  private readonly muteButton: HTMLButtonElement;
  private readonly resultTitle: HTMLHeadingElement;
  private readonly resultDetail: HTMLParagraphElement;
  private readonly garageCards = new Map<string, HTMLButtonElement>();
  private readonly garageSwatches: HTMLDivElement;
  private readonly garageName: HTMLHeadingElement;
  private readonly controlModeRow: HTMLDivElement;
  private readonly statBars = new Map<string, HTMLDivElement>();
  private readonly minimap: Minimap;
  private readonly touchControls: TouchControls;
  private selectedGarageVehicleId = gameState.saved.selectedVehicleId;
  private selectedGarageColor = gameState.saved.selectedColor;
  private countdownTimer: number | null = null;
  private collisionFlashTimer: number | null = null;

  constructor(game: Game, input: InputSystem, container: HTMLElement) {
    this.game = game;
    this.root = el('div', 'ui-root') as HTMLDivElement;
    container.appendChild(this.root);

    this.menuOverlay = this.buildMainMenu();
    this.raceMenuOverlay = this.buildRaceMenu();
    this.garageOverlay = this.buildGarage();
    this.hudOverlay = this.buildHud();
    this.countdownOverlay = el('div', 'overlay countdown-overlay hidden') as HTMLDivElement;
    this.pauseOverlay = this.buildPause();
    this.resultOverlay = this.buildResult();

    this.root.append(
      this.menuOverlay,
      this.raceMenuOverlay,
      this.garageOverlay,
      this.hudOverlay,
      this.countdownOverlay,
      this.pauseOverlay,
      this.resultOverlay,
    );

    const speedElement = this.hudOverlay.querySelector('#hud-speed');
    const lapElement = this.hudOverlay.querySelector('#hud-lap');
    const positionElement = this.hudOverlay.querySelector('#hud-position');
    const timeElement = this.hudOverlay.querySelector('#hud-time');
    const bestLapElement = this.hudOverlay.querySelector('#hud-bestlap');
    const raceInfoElement = this.hudOverlay.querySelector('#hud-race');
    const minimapElement = this.hudOverlay.querySelector('#minimap');
    if (
      !(speedElement instanceof HTMLSpanElement) ||
      !(lapElement instanceof HTMLSpanElement) ||
      !(positionElement instanceof HTMLSpanElement) ||
      !(timeElement instanceof HTMLSpanElement) ||
      !(bestLapElement instanceof HTMLSpanElement) ||
      !(raceInfoElement instanceof HTMLDivElement) ||
      !(minimapElement instanceof HTMLCanvasElement)
    ) {
      throw new Error('HUD elements missing');
    }
    this.speedValue = speedElement;
    this.lapValue = lapElement;
    this.positionValue = positionElement;
    this.timeValue = timeElement;
    this.bestLapValue = bestLapElement;
    this.raceInfo = raceInfoElement;
    this.minimap = new Minimap(minimapElement);

    const garageName = this.garageOverlay.querySelector('#garage-name');
    const garageSwatches = this.garageOverlay.querySelector('#garage-swatches');
    const muteButton = this.menuOverlay.querySelector('#menu-mute');
    if (
      !(garageName instanceof HTMLHeadingElement) ||
      !(garageSwatches instanceof HTMLDivElement) ||
      !(muteButton instanceof HTMLButtonElement)
    ) {
      throw new Error('Garage/menu elements missing');
    }
    this.garageName = garageName;
    this.garageSwatches = garageSwatches;
    this.muteButton = muteButton;
    this.muteButton.textContent = gameState.settings.muted ? '声音：关' : '声音：开';

    const controlModeRow = this.menuOverlay.querySelector('#control-mode-row');
    if (!(controlModeRow instanceof HTMLDivElement)) {
      throw new Error('Control mode row missing');
    }
    this.controlModeRow = controlModeRow;
    this.setDifficulty(gameState.race.difficulty);
    this.refreshControlModeButtons();

    const resultTitle = this.resultOverlay.querySelector('#result-title');
    const resultDetail = this.resultOverlay.querySelector('#result-detail');
    if (
      !(resultTitle instanceof HTMLHeadingElement) ||
      !(resultDetail instanceof HTMLParagraphElement)
    ) {
      throw new Error('Result elements missing');
    }
    this.resultTitle = resultTitle;
    this.resultDetail = resultDetail;

    this.touchControls = new TouchControls(input, this.root);
    this.buildGarageCards();
    this.subscribeEvents();
  }

  showMainMenu(): void {
    this.hideAll();
    this.menuOverlay.classList.remove('hidden');
    this.touchControls.hide();
  }

  showRaceMenu(): void {
    this.hideAll();
    this.raceMenuOverlay.classList.remove('hidden');
    this.touchControls.hide();
  }

  showGarage(): void {
    this.hideAll();
    this.garageOverlay.classList.remove('hidden');
    this.refreshGaragePreview();
    this.touchControls.hide();
  }

  showFreeRoamHud(): void {
    this.hideAll();
    this.raceInfo.classList.add('hidden');
    this.hudOverlay.classList.remove('hidden');
    if (gameState.settings.controlMode === 'mobile') this.touchControls.show();
  }

  showRaceHud(): void {
    this.hideAll();
    this.raceInfo.classList.remove('hidden');
    this.hudOverlay.classList.remove('hidden');
    if (gameState.settings.controlMode === 'mobile') this.touchControls.show();
  }

  showPause(): void {
    this.pauseOverlay.classList.remove('hidden');
    this.touchControls.hide();
  }

  hidePause(): void {
    this.pauseOverlay.classList.add('hidden');
    if (gameState.settings.controlMode === 'mobile') this.touchControls.show();
  }

  setControlMode(mode: ControlMode): void {
    gameState.settings.controlMode = mode;
    gameState.save();
    this.refreshControlModeButtons();
  }

  showCountdown(value: number): void {
    this.countdownOverlay.classList.remove('hidden');
    this.countdownOverlay.textContent = value > 0 ? String(value) : 'GO';
    if (this.countdownTimer !== null) window.clearTimeout(this.countdownTimer);
    this.countdownTimer = window.setTimeout(() => {
      this.countdownOverlay.classList.add('hidden');
    }, value > 0 ? 950 : 850);
  }

  showResult(data: RaceFinishedData): void {
    this.hideAll();
    this.resultOverlay.classList.remove('hidden');
    const place = data.position <= 0 ? '未完赛' : `第 ${data.position} 名`;
    this.resultTitle.textContent = place;
    this.resultDetail.textContent = `总用时 ${formatTime(data.totalMs)} · 最佳圈速 ${formatTime(data.bestLapMs)}`;
    this.touchControls.hide();
  }

  updateHud(): void {
    const speedKmh = Math.round(Math.abs(gameState.player.speedKmh));
    this.speedValue.textContent = String(speedKmh);
    if (gameState.mode === 'race') {
      this.lapValue.textContent = `${Math.min(gameState.player.lap, gameState.race.totalLaps)}/${gameState.race.totalLaps}`;
      this.positionValue.textContent = `${gameState.player.position}/${gameState.race.totalRacers}`;
      this.timeValue.textContent = formatTime(gameState.player.raceTimeMs);
      this.bestLapValue.textContent = formatTime(gameState.race.bestLapMs);
    }

    const dots = this.game.getMinimapDots();
    this.minimap.render(gameState.player.x, gameState.player.z, gameState.player.heading, dots);
  }

  setGaragePreview(vehicleId: string, color: string): void {
    this.selectedGarageVehicleId = vehicleId;
    this.selectedGarageColor = color;
    this.game.showGarageVehicle(vehicleId, color);
    this.refreshGaragePreview();
  }

  confirmGarageSelection(): void {
    this.game.selectGarageVehicle(this.selectedGarageVehicleId, this.selectedGarageColor);
  }

  setDifficulty(difficulty: Difficulty): void {
    gameState.setDifficulty(difficulty);
    const buttons = this.raceMenuOverlay.querySelectorAll('[data-difficulty]');
    for (const node of buttons) {
      const isActive = node instanceof HTMLElement && node.dataset.difficulty === difficulty;
      node.classList.toggle('active', isActive);
    }
  }

  getRacePhase(): RacePhase {
    return gameState.race.phase;
  }

  private buildMainMenu(): HTMLDivElement {
    const overlay = el('div', 'overlay menu-overlay') as HTMLDivElement;
    const panel = el('div', 'menu-panel') as HTMLDivElement;
    panel.appendChild(el('h1', 'game-title', '城市驾驶模拟'));
    panel.appendChild(el('p', 'game-subtitle', '单机开放城市 · 自由漫游与 AI 竞速'));
    panel.appendChild(button('menu-btn menu-btn-primary', '自由漫游', () => this.game.startFreeRoam()));
    panel.appendChild(button('menu-btn', '竞速模式', () => this.game.showRaceMenu()));
    panel.appendChild(button('menu-btn', '车库', () => this.game.showGarage()));
    const mute = button('menu-btn menu-btn-small', '', () => this.game.toggleMute());
    mute.id = 'menu-mute';
    panel.appendChild(mute);
    const controlRow = el('div', 'difficulty-row control-mode-row') as HTMLDivElement;
    controlRow.id = 'control-mode-row';
    const desktopBtn = button('seg-btn', '电脑操控', () => this.setControlMode('desktop'));
    desktopBtn.dataset.controlMode = 'desktop';
    const mobileBtn = button('seg-btn', '手机操控', () => this.setControlMode('mobile'));
    mobileBtn.dataset.controlMode = 'mobile';
    controlRow.appendChild(desktopBtn);
    controlRow.appendChild(mobileBtn);
    panel.appendChild(controlRow);
    overlay.appendChild(panel);
    return overlay;
  }

  refreshMuteButton(): void {
    this.muteButton.textContent = gameState.settings.muted ? '声音：关' : '声音：开';
  }

  private refreshControlModeButtons(): void {
    for (const node of this.controlModeRow.querySelectorAll('[data-control-mode]')) {
      const active =
        node instanceof HTMLElement &&
        node.dataset.controlMode === gameState.settings.controlMode;
      node.classList.toggle('active', active);
    }
  }

  private buildRaceMenu(): HTMLDivElement {
    const overlay = el('div', 'overlay menu-overlay') as HTMLDivElement;
    const panel = el('div', 'menu-panel') as HTMLDivElement;
    panel.appendChild(el('h1', 'menu-heading', '竞速模式'));
    panel.appendChild(el('p', 'menu-description', `城市环路 · ${RACE_CONFIG.TOTAL_LAPS} 圈 · ${RACE_CONFIG.TOTAL_RACERS} 台车`));

    const diffRow = el('div', 'difficulty-row') as HTMLDivElement;
    const difficulties: { id: Difficulty; label: string }[] = [
      { id: 'easy', label: '简单' },
      { id: 'normal', label: '普通' },
      { id: 'hard', label: '困难' },
    ];
    for (const item of difficulties) {
      const node = button('seg-btn', item.label, () => this.setDifficulty(item.id));
      node.dataset.difficulty = item.id;
      diffRow.appendChild(node);
    }
    panel.appendChild(diffRow);
    panel.appendChild(button('menu-btn menu-btn-primary', '开始比赛', () => this.game.startRace()));
    panel.appendChild(button('menu-btn menu-btn-secondary', '返回', () => this.game.showMenu()));
    overlay.appendChild(panel);
    return overlay;
  }

  private buildGarage(): HTMLDivElement {
    const overlay = el('div', 'overlay garage-overlay') as HTMLDivElement;
    const panel = el('div', 'garage-panel') as HTMLDivElement;
    panel.appendChild(el('h1', 'menu-heading', '车库'));
    const list = el('div', 'garage-list') as HTMLDivElement;
    panel.appendChild(list);
    const detail = el('div', 'garage-detail') as HTMLDivElement;
    const name = el('h2', 'garage-name') as HTMLHeadingElement;
    name.id = 'garage-name';
    const statRows = el('div', 'garage-stats') as HTMLDivElement;
    const statDefs: { key: string; label: string; max: number }[] = [
      { key: 'speed', label: '极速', max: 62 },
      { key: 'accel', label: '加速', max: 13.5 },
      { key: 'steer', label: '操控', max: 3.9 },
      { key: 'brake', label: '制动', max: 24 },
    ];
    for (const def of statDefs) {
      const row = el('div', 'stat-row') as HTMLDivElement;
      row.appendChild(el('span', 'stat-label', def.label));
      const track = el('div', 'stat-track') as HTMLDivElement;
      const fill = el('div', 'stat-fill') as HTMLDivElement;
      fill.dataset.statKey = def.key;
      track.appendChild(fill);
      row.appendChild(track);
      statRows.appendChild(row);
      this.statBars.set(def.key, fill);
    }
    detail.appendChild(name);
    detail.appendChild(statRows);
    const swatches = el('div', 'garage-swatches') as HTMLDivElement;
    swatches.id = 'garage-swatches';
    detail.appendChild(swatches);
    detail.appendChild(button('menu-btn menu-btn-primary', '使用此车辆', () => this.confirmGarageSelection()));
    detail.appendChild(button('menu-btn menu-btn-secondary', '返回', () => this.game.showMenu()));
    panel.appendChild(detail);
    overlay.appendChild(panel);
    return overlay;
  }

  private buildGarageCards(): void {
    const list = this.garageOverlay.querySelector('.garage-list');
    if (!(list instanceof HTMLDivElement)) return;
    for (const spec of VEHICLES) {
      const card = button('garage-card', '', () => {
        this.setGaragePreview(spec.id, spec.color);
      });
      card.appendChild(el('span', 'garage-card-name', spec.name));
      card.appendChild(el('span', 'garage-card-speed', `${Math.round(spec.topSpeedMs * 3.6)} km/h`));
      card.dataset.vehicleId = spec.id;
      list.appendChild(card);
      this.garageCards.set(spec.id, card);
    }
  }

  private buildHud(): HTMLDivElement {
    const hud = el('div', 'hud hidden') as HTMLDivElement;
    hud.id = 'hud';
    const speedBlock = el('div', 'speed-block') as HTMLDivElement;
    const speedValue = el('span', 'speed-value') as HTMLSpanElement;
    speedValue.id = 'hud-speed';
    speedValue.textContent = '0';
    speedBlock.appendChild(speedValue);
    speedBlock.appendChild(el('span', 'speed-unit', 'km/h'));
    hud.appendChild(speedBlock);

    const raceInfo = el('div', 'race-info hidden') as HTMLDivElement;
    raceInfo.id = 'hud-race';
    const lapRow = el('div', 'race-row') as HTMLDivElement;
    lapRow.appendChild(el('span', 'race-label', '圈数'));
    const lapValue = el('span', 'race-value') as HTMLSpanElement;
    lapValue.id = 'hud-lap';
    lapRow.appendChild(lapValue);
    const posRow = el('div', 'race-row') as HTMLDivElement;
    posRow.appendChild(el('span', 'race-label', '名次'));
    const positionValue = el('span', 'race-value') as HTMLSpanElement;
    positionValue.id = 'hud-position';
    posRow.appendChild(positionValue);
    const timeRow = el('div', 'race-row') as HTMLDivElement;
    timeRow.appendChild(el('span', 'race-label', '时间'));
    const timeValue = el('span', 'race-value') as HTMLSpanElement;
    timeValue.id = 'hud-time';
    timeRow.appendChild(timeValue);
    const bestRow = el('div', 'race-row') as HTMLDivElement;
    bestRow.appendChild(el('span', 'race-label', '最佳'));
    const bestLapValue = el('span', 'race-value') as HTMLSpanElement;
    bestLapValue.id = 'hud-bestlap';
    bestRow.appendChild(bestLapValue);
    raceInfo.append(lapRow, posRow, timeRow, bestRow);
    hud.appendChild(raceInfo);

    const minimap = el('canvas', 'minimap') as HTMLCanvasElement;
    minimap.id = 'minimap';
    hud.appendChild(minimap);

    hud.appendChild(button('hud-btn', '暂停', () => this.game.togglePause()));
    return hud;
  }

  private buildPause(): HTMLDivElement {
    const overlay = el('div', 'overlay pause-overlay hidden') as HTMLDivElement;
    const panel = el('div', 'menu-panel') as HTMLDivElement;
    panel.appendChild(el('h1', 'menu-heading', '暂停'));
    panel.appendChild(button('menu-btn menu-btn-primary', '继续', () => this.game.togglePause()));
    panel.appendChild(button('menu-btn', '重新开始', () => this.game.restartCurrent()));
    panel.appendChild(button('menu-btn menu-btn-secondary', '返回主菜单', () => this.game.showMenu()));
    overlay.appendChild(panel);
    return overlay;
  }

  private buildResult(): HTMLDivElement {
    const overlay = el('div', 'overlay result-overlay hidden') as HTMLDivElement;
    const panel = el('div', 'menu-panel') as HTMLDivElement;
    const title = el('h1', 'menu-heading') as HTMLHeadingElement;
    title.id = 'result-title';
    const detail = el('p', 'result-detail') as HTMLParagraphElement;
    detail.id = 'result-detail';
    panel.appendChild(title);
    panel.appendChild(detail);
    panel.appendChild(button('menu-btn menu-btn-primary', '再来一局', () => this.game.restartRace()));
    panel.appendChild(button('menu-btn menu-btn-secondary', '返回主菜单', () => this.game.showMenu()));
    overlay.appendChild(panel);
    return overlay;
  }

  private refreshGaragePreview(): void {
    const spec = VEHICLES.find((v) => v.id === this.selectedGarageVehicleId) ?? VEHICLES[0];
    this.garageName.textContent = spec.name;
    const stats: Record<string, number> = {
      speed: spec.topSpeedMs,
      accel: spec.accelMs2,
      steer: spec.steerRate,
      brake: spec.brakeMs2,
    };
    const maxes: Record<string, number> = { speed: 62, accel: 13.5, steer: 3.9, brake: 24 };
    for (const [key, fill] of this.statBars) {
      fill.style.width = `${Math.round((stats[key] / maxes[key]) * 100)}%`;
    }
    this.garageSwatches.replaceChildren();
    for (const color of spec.colorOptions) {
      const swatch = button('color-swatch', '', () => {
        this.setGaragePreview(spec.id, color);
      });
      swatch.style.background = color;
      swatch.classList.toggle('active', color === this.selectedGarageColor);
      this.garageSwatches.appendChild(swatch);
    }
    for (const [id, card] of this.garageCards) {
      card.classList.toggle('active', id === this.selectedGarageVehicleId);
    }
  }

  private subscribeEvents(): void {
    eventBus.on(Events.RACE_COUNTDOWN, (data) => {
      const value = (data as { value: number } | undefined)?.value ?? 0;
      this.showCountdown(value);
    });
    eventBus.on(Events.RACE_LAP, (data) => {
      const payload = data as { lap: number; bestLapMs: number } | undefined;
      if (payload) gameState.race.bestLapMs = payload.bestLapMs;
    });
    eventBus.on(Events.RACE_POSITION, (data) => {
      const payload = data as { position: number; totalRacers: number } | undefined;
      if (payload) {
        gameState.player.position = payload.position;
        gameState.race.totalRacers = payload.totalRacers;
      }
    });
    eventBus.on(Events.RACE_FINISHED, (data) => {
      this.showResult(data as RaceFinishedData);
    });
    eventBus.on(Events.VEHICLE_COLLISION, () => {
      this.speedValue.classList.add('collision-flash');
      if (this.collisionFlashTimer !== null) window.clearTimeout(this.collisionFlashTimer);
      this.collisionFlashTimer = window.setTimeout(() => {
        this.speedValue.classList.remove('collision-flash');
      }, 220);
    });
  }

  private hideAll(): void {
    for (const overlay of [
      this.menuOverlay,
      this.raceMenuOverlay,
      this.garageOverlay,
      this.hudOverlay,
      this.countdownOverlay,
      this.pauseOverlay,
      this.resultOverlay,
    ]) {
      overlay.classList.add('hidden');
    }
  }
}
