import { RACE_CONFIG, VEHICLES } from '../core/Constants';
import { eventBus, Events } from '../core/EventBus';
import { gameState } from '../core/GameState';
import type { ControlMode, Density, Difficulty, RacePhase, VehicleSpec } from '../core/types';
import type { InputSystem } from '../systems/InputSystem';
import type { Game } from '../core/Game';
import { Minimap } from './Minimap';
import { TouchControls } from './TouchControls';
import { sampleTorqueNm } from '../gameplay/torque';

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
  private readonly settingsOverlay: HTMLDivElement;
  private readonly garageOverlay: HTMLDivElement;
  private readonly hudOverlay: HTMLDivElement;
  private readonly countdownOverlay: HTMLDivElement;
  private readonly pauseOverlay: HTMLDivElement;
  private readonly resultOverlay: HTMLDivElement;
  private readonly raceInfo: HTMLDivElement;
  private readonly speedValue: HTMLSpanElement;
  private readonly tachValue: HTMLSpanElement;
  private readonly tachBar: HTMLDivElement;
  private readonly gearValue: HTMLSpanElement;
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
  private readonly garageThumb: HTMLImageElement;
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
    this.settingsOverlay = this.buildSettings();
    this.garageOverlay = this.buildGarage();
    this.hudOverlay = this.buildHud();
    this.countdownOverlay = el('div', 'overlay countdown-overlay hidden') as HTMLDivElement;
    this.pauseOverlay = this.buildPause();
    this.resultOverlay = this.buildResult();

    this.root.append(
      this.menuOverlay,
      this.raceMenuOverlay,
      this.settingsOverlay,
      this.garageOverlay,
      this.hudOverlay,
      this.countdownOverlay,
      this.pauseOverlay,
      this.resultOverlay,
    );

    const speedElement = this.hudOverlay.querySelector('#hud-speed');
    const tachElement = this.hudOverlay.querySelector('#hud-rpm');
    const tachBarElement = this.hudOverlay.querySelector('#hud-rpm-bar');
    const gearElement = this.hudOverlay.querySelector('#hud-gear');
    const lapElement = this.hudOverlay.querySelector('#hud-lap');
    const positionElement = this.hudOverlay.querySelector('#hud-position');
    const timeElement = this.hudOverlay.querySelector('#hud-time');
    const bestLapElement = this.hudOverlay.querySelector('#hud-bestlap');
    const raceInfoElement = this.hudOverlay.querySelector('#hud-race');
    const minimapElement = this.hudOverlay.querySelector('#minimap');
    if (
      !(speedElement instanceof HTMLSpanElement) ||
      !(tachElement instanceof HTMLSpanElement) ||
      !(tachBarElement instanceof HTMLDivElement) ||
      !(gearElement instanceof HTMLSpanElement) ||
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
    this.tachValue = tachElement;
    this.tachBar = tachBarElement;
    this.gearValue = gearElement;
    this.lapValue = lapElement;
    this.positionValue = positionElement;
    this.timeValue = timeElement;
    this.bestLapValue = bestLapElement;
    this.raceInfo = raceInfoElement;
    this.minimap = new Minimap(minimapElement);

    const garageName = this.garageOverlay.querySelector('#garage-name');
    const garageSwatches = this.garageOverlay.querySelector('#garage-swatches');
    const garageThumb = this.garageOverlay.querySelector('#garage-thumb');
    const muteButton = this.menuOverlay.querySelector('#menu-mute');
    const settingsMuteButton = this.settingsOverlay.querySelector('#settings-mute');
    if (
      !(garageName instanceof HTMLHeadingElement) ||
      !(garageSwatches instanceof HTMLDivElement) ||
      !(garageThumb instanceof HTMLImageElement) ||
      !(muteButton instanceof HTMLButtonElement) ||
      !(settingsMuteButton instanceof HTMLButtonElement)
    ) {
      throw new Error('Garage/menu elements missing');
    }
    this.garageName = garageName;
    this.garageSwatches = garageSwatches;
    this.garageThumb = garageThumb;
    this.muteButton = muteButton;
    this.muteButton.textContent = gameState.settings.muted ? '声音：关' : '声音：开';
    settingsMuteButton.textContent = gameState.settings.muted ? '声音：关' : '声音：开';

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

  showSettings(): void {
    this.hideAll();
    this.settingsOverlay.classList.remove('hidden');
    this.refreshControlModeButtons();
    this.refreshDensityButtons();
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

  setDensity(density: Density): void {
    gameState.settings.density = density;
    gameState.save();
    this.refreshDensityButtons();
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
    this.tachValue.textContent = String(Math.round(gameState.player.rpm));
    this.tachBar.style.width = `${Math.round(gameState.player.rpmRatio * 100)}%`;
    this.gearValue.textContent = gameState.player.gear === 0 ? 'R' : `D${gameState.player.gear}`;
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
    const wrap = this.garageThumb.parentElement;
    if (wrap) {
      wrap.classList.remove('garage-switching');
      void wrap.offsetWidth;
      wrap.classList.add('garage-switching');
      window.setTimeout(() => wrap.classList.remove('garage-switching'), 260);
    }
  }

  confirmGarageSelection(): void {
    this.game.selectGarageVehicle(this.selectedGarageVehicleId, this.selectedGarageColor);
  }

  private cycleGarage(direction: number): void {
    const index = VEHICLES.findIndex((v) => v.id === this.selectedGarageVehicleId);
    const next = VEHICLES[(index + direction + VEHICLES.length) % VEHICLES.length];
    const color = next.colorOptions.includes(this.selectedGarageColor)
      ? this.selectedGarageColor
      : next.color;
    this.setGaragePreview(next.id, color);
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
    const overlay = el('div', 'overlay menu-overlay menu-hero-overlay') as HTMLDivElement;
    const panel = el('div', 'menu-panel menu-hero') as HTMLDivElement;
    panel.appendChild(el('p', 'menu-kicker', 'MORON TOWN'));
    panel.appendChild(el('h1', 'game-title', '城市驾驶模拟'));
    panel.appendChild(el('p', 'game-subtitle', '单机开放城市 · 自由漫游与 AI 竞速'));
    const accent = el('div', 'menu-accent') as HTMLDivElement;
    panel.appendChild(accent);
    panel.appendChild(button('menu-btn menu-btn-lg menu-btn-primary', '自由漫游', () => this.game.startFreeRoam()));
    panel.appendChild(button('menu-btn menu-btn-lg', '竞速模式', () => this.game.showRaceMenu()));
    panel.appendChild(button('menu-btn menu-btn-lg', '车库', () => this.game.showGarage()));
    panel.appendChild(button('menu-btn menu-btn-lg', '设置', () => this.game.showSettings()));
    const footer = el('div', 'menu-footer') as HTMLDivElement;
    const mute = button('menu-btn menu-btn-small', '', () => this.game.toggleMute());
    mute.id = 'menu-mute';
    footer.appendChild(mute);
    footer.appendChild(el('span', 'menu-chip', `${VEHICLES.length} 台座驾`));
    footer.appendChild(el('span', 'menu-chip', `${RACE_CONFIG.TOTAL_LAPS} 圈竞速`));
    panel.appendChild(footer);
    overlay.appendChild(panel);
    return overlay;
  }

  refreshMuteButton(): void {
    const text = gameState.settings.muted ? '声音：关' : '声音：开';
    this.muteButton.textContent = text;
    const settingsMute = this.settingsOverlay.querySelector('#settings-mute');
    if (settingsMute) settingsMute.textContent = text;
  }

  private refreshControlModeButtons(): void {
    for (const row of this.root.querySelectorAll('.control-mode-row')) {
      for (const node of row.querySelectorAll('[data-control-mode]')) {
        const active =
          node instanceof HTMLElement &&
          node.dataset.controlMode === gameState.settings.controlMode;
        node.classList.toggle('active', active);
      }
    }
  }

  private buildSettings(): HTMLDivElement {
    const overlay = el('div', 'overlay settings-overlay hidden') as HTMLDivElement;
    const panel = el('div', 'menu-panel settings-panel') as HTMLDivElement;
    panel.appendChild(el('h1', 'menu-heading', '设置'));
    panel.appendChild(el('p', 'menu-description', '声音、操控方式与城市流量'));

    const soundRow = el('div', 'settings-row') as HTMLDivElement;
    soundRow.appendChild(el('span', 'settings-label', '声音'));
    const soundButton = button('seg-btn seg-btn-wide', '', () => this.game.toggleMute());
    soundButton.id = 'settings-mute';
    soundRow.appendChild(soundButton);
    panel.appendChild(soundRow);

    const controlRow = el('div', 'settings-row settings-row-column') as HTMLDivElement;
    controlRow.appendChild(el('span', 'settings-label', '操控方式'));
    const controlSeg = el('div', 'difficulty-row control-mode-row') as HTMLDivElement;
    controlSeg.id = 'settings-control-mode-row';
    const desktopBtn = button('seg-btn', '电脑操控', () => this.setControlMode('desktop'));
    desktopBtn.dataset.controlMode = 'desktop';
    const mobileBtn = button('seg-btn', '手机操控', () => this.setControlMode('mobile'));
    mobileBtn.dataset.controlMode = 'mobile';
    controlSeg.appendChild(desktopBtn);
    controlSeg.appendChild(mobileBtn);
    controlRow.appendChild(controlSeg);
    panel.appendChild(controlRow);

    const densityRow = el('div', 'settings-row settings-row-column') as HTMLDivElement;
    densityRow.appendChild(el('span', 'settings-label', '交通密度'));
    const densitySeg = el('div', 'difficulty-row') as HTMLDivElement;
    const densities: { id: Density; label: string }[] = [
      { id: 'low', label: '少' },
      { id: 'medium', label: '适量' },
      { id: 'high', label: '多' },
    ];
    for (const item of densities) {
      const node = button('seg-btn', item.label, () => this.setDensity(item.id));
      node.dataset.density = item.id;
      densitySeg.appendChild(node);
    }
    densityRow.appendChild(densitySeg);
    panel.appendChild(densityRow);

    panel.appendChild(button('menu-btn menu-btn-secondary', '返回主菜单', () => this.game.showMenu()));
    overlay.appendChild(panel);
    return overlay;
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
    panel.appendChild(el('h1', 'menu-heading garage-heading', '车库'));
    const list = el('div', 'garage-list') as HTMLDivElement;
    panel.appendChild(list);
    const detail = el('div', 'garage-detail') as HTMLDivElement;
    const mainCol = el('div', 'garage-detail-col') as HTMLDivElement;
    const specCol = el('div', 'garage-detail-col') as HTMLDivElement;
    const stage = el('div', 'garage-stage') as HTMLDivElement;
    const prevArrow = button('garage-arrow garage-arrow-left', '‹', () => this.cycleGarage(-1));
    prevArrow.setAttribute('aria-label', '上一辆');
    const thumbWrap = el('div', 'garage-thumb-wrap') as HTMLDivElement;
    const thumb = el('img', 'garage-thumb') as HTMLImageElement;
    thumb.id = 'garage-thumb';
    thumb.alt = '';
    thumbWrap.appendChild(thumb);
    const nextArrow = button('garage-arrow garage-arrow-right', '›', () => this.cycleGarage(1));
    nextArrow.setAttribute('aria-label', '下一辆');
    stage.append(prevArrow, thumbWrap, nextArrow);
    const name = el('h2', 'garage-name') as HTMLHeadingElement;
    name.id = 'garage-name';
    mainCol.appendChild(name);
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
    specCol.appendChild(statRows);
    const torquePanel = el('div', 'torque-panel') as HTMLDivElement;
    torquePanel.appendChild(el('p', 'torque-title', '扭矩曲线'));
    const torqueCanvas = el('canvas', 'torque-curve') as HTMLCanvasElement;
    torqueCanvas.id = 'torque-curve';
    torquePanel.appendChild(torqueCanvas);
    const gearRow = el('div', 'gear-ratio-row') as HTMLDivElement;
    torquePanel.appendChild(gearRow);
    specCol.appendChild(torquePanel);
    const swatches = el('div', 'garage-swatches') as HTMLDivElement;
    swatches.id = 'garage-swatches';
    mainCol.appendChild(swatches);
    detail.append(stage, mainCol, specCol);
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
    const gaugeCluster = el('div', 'gauge-cluster') as HTMLDivElement;
    const speedBlock = el('div', 'speed-block') as HTMLDivElement;
    const speedValue = el('span', 'speed-value') as HTMLSpanElement;
    speedValue.id = 'hud-speed';
    speedValue.textContent = '0';
    speedBlock.appendChild(speedValue);
    speedBlock.appendChild(el('span', 'speed-unit', 'km/h'));
    gaugeCluster.appendChild(speedBlock);

    const tachBlock = el('div', 'tach-block') as HTMLDivElement;
    tachBlock.id = 'hud-tach';
    const tachTop = el('div', 'tach-top') as HTMLDivElement;
    const gearValue = el('span', 'gear-value') as HTMLSpanElement;
    gearValue.id = 'hud-gear';
    gearValue.textContent = 'D1';
    tachTop.appendChild(gearValue);
    tachTop.appendChild(el('span', 'tach-label', 'RPM'));
    const tachValue = el('span', 'tach-value') as HTMLSpanElement;
    tachValue.id = 'hud-rpm';
    tachValue.textContent = '0';
    const tachUnit = el('span', 'tach-unit', 'r/min');
    tachValue.appendChild(tachUnit);
    const tachBarWrap = el('div', 'tach-bar-wrap') as HTMLDivElement;
    const tachBar = el('div', 'tach-bar-fill') as HTMLDivElement;
    tachBar.id = 'hud-rpm-bar';
    tachBarWrap.appendChild(el('div', 'tach-redline'));
    tachBarWrap.appendChild(tachBar);
    tachBlock.append(tachTop, tachValue, tachBarWrap);
    gaugeCluster.appendChild(tachBlock);
    hud.appendChild(gaugeCluster);

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
    panel.appendChild(el('p', 'menu-description', '交通密度'));
    const densityRow = el('div', 'difficulty-row') as HTMLDivElement;
    const densities: { id: Density; label: string }[] = [
      { id: 'low', label: '少' },
      { id: 'medium', label: '适量' },
      { id: 'high', label: '多' },
    ];
    for (const item of densities) {
      const node = button('seg-btn', item.label, () => this.setDensity(item.id));
      node.dataset.density = item.id;
      if (item.id === gameState.settings.density) node.classList.add('active');
      densityRow.appendChild(node);
    }
    panel.appendChild(densityRow);
    panel.appendChild(button('menu-btn menu-btn-primary', '继续', () => this.game.togglePause()));
    panel.appendChild(button('menu-btn', '重新开始', () => this.game.restartCurrent()));
    panel.appendChild(button('menu-btn menu-btn-secondary', '返回主菜单', () => this.game.showMenu()));
    overlay.appendChild(panel);
    return overlay;
  }

  private refreshDensityButtons(): void {
    for (const node of this.root.querySelectorAll('[data-density]')) {
      const active =
        node instanceof HTMLElement && node.dataset.density === gameState.settings.density;
      node.classList.toggle('active', active);
    }
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
    this.drawTorqueCurve(spec);
    this.buildGearRatioBars(spec);
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
    const thumbnailUrl = this.game.captureGarageThumbnail();
    if (thumbnailUrl) this.garageThumb.src = thumbnailUrl;
  }

  private drawTorqueCurve(spec: VehicleSpec): void {
    const canvas = this.garageOverlay.querySelector('#torque-curve');
    if (!(canvas instanceof HTMLCanvasElement)) return;
    const dpr = window.devicePixelRatio || 1;
    const width = 340;
    const height = 150;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const padL = 34;
    const padR = 12;
    const padT = 14;
    const padB = 24;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;
    const maxTorque = Math.max(...spec.torqueCurveNm) * 1.15;
    const xFor = (ratio: number): number => padL + ratio * plotW;
    const yFor = (torque: number): number =>
      padT + plotH - (torque / maxTorque) * plotH;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = padT + (plotH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
    }

    ctx.fillStyle = '#9aa7b4';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(spec.engineIdleRpm), padL, height - 6);
    ctx.fillText(String(spec.engineRedlineRpm), width - padR, height - 6);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(maxTorque)} Nm`, padL - 4, padT + 4);

    const samples = 40;
    ctx.beginPath();
    for (let i = 0; i <= samples; i += 1) {
      const ratio = i / samples;
      const torque = sampleTorqueNm(spec, ratio);
      const x = xFor(ratio);
      const y = yFor(torque);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(width - padR, padT + plotH);
    ctx.lineTo(padL, padT + plotH);
    ctx.closePath();
    const gradient = ctx.createLinearGradient(0, padT, 0, padT + plotH);
    gradient.addColorStop(0, 'rgba(255, 181, 69, 0.28)');
    gradient.addColorStop(1, 'rgba(255, 181, 69, 0.02)');
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i <= samples; i += 1) {
      const ratio = i / samples;
      const torque = sampleTorqueNm(spec, ratio);
      const x = xFor(ratio);
      const y = yFor(torque);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#ffb545';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    let peakIndex = 0;
    for (let i = 1; i < spec.torqueCurveNm.length; i += 1) {
      if (spec.torqueCurveNm[i] > spec.torqueCurveNm[peakIndex]) peakIndex = i;
    }
    const peakRatio = peakIndex / (spec.torqueCurveNm.length - 1);
    ctx.beginPath();
    ctx.arc(xFor(peakRatio), yFor(spec.torqueCurveNm[peakIndex]), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }

  private buildGearRatioBars(spec: VehicleSpec): void {
    const row = this.garageOverlay.querySelector('.gear-ratio-row');
    if (!(row instanceof HTMLDivElement)) return;
    row.replaceChildren();
    const maxRatio = Math.max(...spec.gearRatios);
    for (let i = 0; i < spec.gearRatios.length; i += 1) {
      const cell = el('div', 'gear-cell') as HTMLDivElement;
      const bar = el('div', 'gear-bar') as HTMLDivElement;
      bar.style.height = `${Math.round((spec.gearRatios[i] / maxRatio) * 100)}%`;
      cell.append(bar, el('span', 'gear-label', `D${i + 1}`));
      row.appendChild(cell);
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
      this.settingsOverlay,
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
