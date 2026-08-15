import { RACE_CONFIG, VEHICLES, type TaskPointDef } from '../core/Constants';
import { eventBus, Events } from '../core/EventBus';
import { gameState } from '../core/GameState';
import {
  ACHIEVEMENTS,
  type AchievementDef,
  achievementProgress,
  challengeProgress,
  checkInReward,
  dailyChallengesFor,
  vehiclePrice,
} from '../core/Progress';
import { TITLES, type TitleDefinition } from '../core/Titles';
import type {
  ControlMode,
  Density,
  Difficulty,
  QualityPreset,
  RaceLayoutId,
  RacePhase,
  RaceResultData,
  VehicleSpec,
} from '../core/types';
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

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 分钟';
  const totalMinutes = Math.floor(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} 小时 ${minutes} 分`;
}

interface RaceFinishedData {
  position: number;
  totalRacers: number;
  bestLapMs: number;
  totalMs: number;
  difficulty: Difficulty;
}

export class UIManager {
  private readonly game: Game;
  private readonly root: HTMLDivElement;
  private readonly menuOverlay: HTMLDivElement;
  private readonly raceMenuOverlay: HTMLDivElement;
  private readonly settingsOverlay: HTMLDivElement;
  private readonly progressOverlay: HTMLDivElement;
  private readonly garageOverlay: HTMLDivElement;
  private readonly multiplayerOverlay: HTMLDivElement;
  private readonly lobbyOverlay: HTMLDivElement;
  private readonly hudOverlay: HTMLDivElement;
  private readonly taskHint: HTMLDivElement;
  private readonly taskRaceOverlay: HTMLDivElement;
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
  private readonly multiplayerStatus: HTMLSpanElement;
  private readonly multiplayerUsername: HTMLSpanElement;
  private readonly multiplayerRooms: HTMLDivElement;
  private readonly lobbyTitle: HTMLHeadingElement;
  private readonly lobbyPlayers: HTMLDivElement;
  private readonly lobbyStart: HTMLButtonElement;
  private readonly garageCards = new Map<string, HTMLButtonElement>();
  private readonly garageSwatches: HTMLDivElement;
  private readonly garageName: HTMLHeadingElement;
  private readonly garageThumb: HTMLImageElement;
  private readonly statBars = new Map<string, HTMLDivElement>();
  private readonly minimap: Minimap;
  private readonly touchControls: TouchControls;
  private raceMetaChip: HTMLSpanElement | null = null;
  private selectedGarageVehicleId = gameState.saved.selectedVehicleId;
  private selectedGarageColor = gameState.saved.selectedColor;
  private garageSlideDir: 1 | -1 = 1;
  private countdownTimer: number | null = null;
  private collisionFlashTimer: number | null = null;
  private readonly killValue: HTMLSpanElement;
  private readonly killNext: HTMLSpanElement;
  private readonly titleToast: HTMLDivElement;
  private readonly progressToast: HTMLDivElement;
  private readonly hudCoins: HTMLSpanElement;
  private lastShownKills = gameState.pedestrianKills;
  private titleToastTimer: number | null = null;
  private progressToastTimer: number | null = null;
  private minimapFrame = 0;
  private taskLaps = 2;
  private taskOpponents = 3;

  constructor(game: Game, input: InputSystem, container: HTMLElement) {
    this.game = game;
    this.root = el('div', 'ui-root') as HTMLDivElement;
    container.appendChild(this.root);

    this.menuOverlay = this.buildMainMenu();
    this.raceMenuOverlay = this.buildRaceMenu();
    this.settingsOverlay = this.buildSettings();
    this.progressOverlay = this.buildProgress();
    this.garageOverlay = this.buildGarage();
    this.multiplayerOverlay = this.buildMultiplayer();
    this.lobbyOverlay = this.buildLobby();
    this.hudOverlay = this.buildHud();
    this.taskHint = el('div', 'task-hint hidden') as HTMLDivElement;
    this.taskHint.id = 'task-hint';
    this.taskHint.textContent = '按 E 开始竞速';
    this.taskRaceOverlay = this.buildTaskRacePanel();
    this.countdownOverlay = el('div', 'overlay countdown-overlay hidden') as HTMLDivElement;
    this.pauseOverlay = this.buildPause();
    this.resultOverlay = this.buildResult();
    this.progressToast = el('div', 'progress-toast hidden') as HTMLDivElement;
    this.progressToast.id = 'progress-toast';

    this.root.append(
      this.menuOverlay,
      this.raceMenuOverlay,
      this.settingsOverlay,
      this.progressOverlay,
      this.garageOverlay,
      this.multiplayerOverlay,
      this.lobbyOverlay,
      this.hudOverlay,
      this.taskHint,
      this.taskRaceOverlay,
      this.countdownOverlay,
      this.pauseOverlay,
      this.resultOverlay,
      this.progressToast,
    );

    const speedElement = this.hudOverlay.querySelector('#hud-speed');
    const tachElement = this.hudOverlay.querySelector('#hud-rpm');
    const tachBarElement = this.hudOverlay.querySelector('#hud-rpm-bar');
    const killElement = this.hudOverlay.querySelector('#hud-kills');
    const killNextElement = this.hudOverlay.querySelector('#hud-next-title');
    const titleToastElement = this.hudOverlay.querySelector('#hud-title-toast');
    const gearElement = this.hudOverlay.querySelector('#hud-gear');
    const lapElement = this.hudOverlay.querySelector('#hud-lap');
    const positionElement = this.hudOverlay.querySelector('#hud-position');
    const timeElement = this.hudOverlay.querySelector('#hud-time');
    const bestLapElement = this.hudOverlay.querySelector('#hud-bestlap');
    const raceInfoElement = this.hudOverlay.querySelector('#hud-race');
    const minimapElement = this.hudOverlay.querySelector('#minimap');
    const hudCoinsElement = this.hudOverlay.querySelector('#hud-coins');
    if (
      !(speedElement instanceof HTMLSpanElement) ||
      !(tachElement instanceof HTMLSpanElement) ||
      !(tachBarElement instanceof HTMLDivElement) ||
      !(killElement instanceof HTMLSpanElement) ||
      !(killNextElement instanceof HTMLSpanElement) ||
      !(titleToastElement instanceof HTMLDivElement) ||
      !(gearElement instanceof HTMLSpanElement) ||
      !(lapElement instanceof HTMLSpanElement) ||
      !(positionElement instanceof HTMLSpanElement) ||
      !(timeElement instanceof HTMLSpanElement) ||
      !(bestLapElement instanceof HTMLSpanElement) ||
      !(raceInfoElement instanceof HTMLDivElement) ||
      !(minimapElement instanceof HTMLCanvasElement) ||
      !(hudCoinsElement instanceof HTMLSpanElement)
    ) {
      throw new Error('HUD elements missing');
    }
    this.speedValue = speedElement;
    this.tachValue = tachElement;
    this.tachBar = tachBarElement;
    this.killValue = killElement;
    this.killNext = killNextElement;
    this.titleToast = titleToastElement;
    this.gearValue = gearElement;
    this.lapValue = lapElement;
    this.positionValue = positionElement;
    this.timeValue = timeElement;
    this.bestLapValue = bestLapElement;
    this.raceInfo = raceInfoElement;
    this.minimap = new Minimap(minimapElement);
    this.hudCoins = hudCoinsElement;
    this.hudCoins.textContent = String(Math.floor(gameState.coins));

    const garageName = this.garageOverlay.querySelector('#garage-name');
    const garageSwatches = this.garageOverlay.querySelector('#garage-swatches');
    const garageThumb = this.garageOverlay.querySelector('#garage-thumb');
    const muteButton = this.menuOverlay.querySelector('#menu-mute');
    const settingsMuteButton = this.settingsOverlay.querySelector('#settings-mute');
    const multiplayerStatus = this.multiplayerOverlay.querySelector('#multiplayer-status');
    const multiplayerUsername = this.multiplayerOverlay.querySelector('#multiplayer-username');
    const multiplayerRooms = this.multiplayerOverlay.querySelector('#multiplayer-rooms');
    const multiplayerRoomName = this.multiplayerOverlay.querySelector('#multiplayer-room-name');
    const lobbyTitle = this.lobbyOverlay.querySelector('#lobby-title');
    const lobbyPlayers = this.lobbyOverlay.querySelector('#lobby-players');
    const lobbyStart = this.lobbyOverlay.querySelector('#lobby-start');
    if (
      !(garageName instanceof HTMLHeadingElement) ||
      !(garageSwatches instanceof HTMLDivElement) ||
      !(garageThumb instanceof HTMLImageElement) ||
      !(muteButton instanceof HTMLButtonElement) ||
      !(settingsMuteButton instanceof HTMLButtonElement) ||
      !(multiplayerStatus instanceof HTMLSpanElement) ||
      !(multiplayerUsername instanceof HTMLSpanElement) ||
      !(multiplayerRooms instanceof HTMLDivElement) ||
      !(multiplayerRoomName instanceof HTMLInputElement) ||
      !(lobbyTitle instanceof HTMLHeadingElement) ||
      !(lobbyPlayers instanceof HTMLDivElement) ||
      !(lobbyStart instanceof HTMLButtonElement)
    ) {
      throw new Error('Garage/menu/multiplayer elements missing');
    }
    this.garageName = garageName;
    this.garageSwatches = garageSwatches;
    this.garageThumb = garageThumb;
    this.multiplayerStatus = multiplayerStatus;
    this.multiplayerUsername = multiplayerUsername;
    this.multiplayerRooms = multiplayerRooms;
    this.lobbyTitle = lobbyTitle;
    this.lobbyPlayers = lobbyPlayers;
    this.lobbyStart = lobbyStart;
    this.muteButton = muteButton;
    this.muteButton.textContent = gameState.settings.muted ? '声音：关' : '声音：开';
    settingsMuteButton.textContent = gameState.settings.muted ? '声音：关' : '声音：开';

    this.setDifficulty(gameState.race.difficulty);
    this.setRaceLayout(gameState.race.layoutId);
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
    this.refreshRaceMenuOptions();
    this.refreshMenuWallet();
    this.touchControls.hide();
  }

  showProgress(): void {
    this.hideAll();
    this.progressOverlay.classList.remove('hidden');
    this.refreshProgressScreen();
    this.touchControls.hide();
  }

  showSettings(): void {
    this.hideAll();
    this.settingsOverlay.classList.remove('hidden');
    this.refreshControlModeButtons();
    this.refreshDensityButtons();
    this.refreshQualityButtons();
    this.touchControls.hide();
  }

  showRaceMenu(): void {
    this.hideAll();
    this.raceMenuOverlay.classList.remove('hidden');
    this.refreshRaceMenuOptions();
    this.touchControls.hide();
  }

  showGarage(): void {
    this.hideAll();
    this.garageOverlay.classList.remove('hidden');
    this.refreshGaragePreview();
    this.touchControls.hide();
  }

  showMultiplayer(): void {
    this.hideAll();
    this.multiplayerOverlay.classList.remove('hidden');
    this.refreshMultiplayer();
    this.touchControls.hide();
  }

  showMultiplayerHud(): void {
    this.showFreeRoamHud();
  }

  refreshMultiplayer(): void {
    const state = gameState.multiplayer;
    const connected = state.connected;
    this.multiplayerStatus.textContent = connected
      ? '已连接'
      : state.connecting
        ? '连接中...'
        : '未连接';
    this.multiplayerUsername.textContent = state.username
      ? `用户名：${state.username}`
      : '连接后自动分配用户名';

    if (state.roomId && gameState.mode === 'lobby') {
      this.hideAll();
      this.lobbyOverlay.classList.remove('hidden');
      this.lobbyTitle.textContent = state.roomName || '房间';
      this.lobbyPlayers.replaceChildren();
      for (const player of state.players) {
        const row = el('div', 'lobby-player') as HTMLDivElement;
        row.appendChild(el('span', 'lobby-player-name', player.username));
        if (player.isHost) row.appendChild(el('span', 'lobby-host', '房主'));
        this.lobbyPlayers.appendChild(row);
      }
      this.lobbyStart.classList.toggle('hidden', !(state.isHost && state.roomId));
      this.touchControls.hide();
      return;
    }

    if (state.roomId && gameState.mode === 'multiplayer') {
      this.lobbyPlayers.replaceChildren();
      for (const player of state.players) {
        const row = el('div', 'lobby-player') as HTMLDivElement;
        row.appendChild(el('span', 'lobby-player-name', player.username));
        if (player.isHost) row.appendChild(el('span', 'lobby-host', '房主'));
        this.lobbyPlayers.appendChild(row);
      }
      return;
    }

    this.multiplayerRooms.replaceChildren();
    if (state.rooms.length === 0) {
      this.multiplayerRooms.appendChild(el('p', 'menu-description', '暂无房间，创建一个吧'));
    }
    for (const room of state.rooms) {
      const card = el('div', 'room-card') as HTMLDivElement;
      const info = el('div', 'room-card-info') as HTMLDivElement;
      info.appendChild(el('strong', 'room-name', room.name));
      info.appendChild(
        el(
          'span',
          'room-meta',
          `${room.hostName} · ${room.players.length}/${room.maxPlayers} · ${room.status === 'playing' ? '游戏中' : '等待中'}`,
        ),
      );
      const join = button('menu-btn menu-btn-small', '加入', () => {
        this.game.joinMultiplayerRoom(room.id);
      });
      join.disabled = room.status === 'playing' || room.players.length >= room.maxPlayers;
      card.append(info, join);
      this.multiplayerRooms.appendChild(card);
    }
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
    this.refreshQualityButtons();
    this.refreshTitlePanel();
    this.syncPauseSliders();
    this.touchControls.hide();
  }

  private syncPauseSliders(): void {
    const bgm = this.pauseOverlay.querySelector('#pause-bgm-volume');
    const sfx = this.pauseOverlay.querySelector('#pause-sfx-volume');
    if (bgm instanceof HTMLInputElement) {
      bgm.value = String(gameState.settings.bgmVolume);
    }
    if (sfx instanceof HTMLInputElement) {
      sfx.value = String(gameState.settings.sfxVolume);
    }
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

  showResult(data: RaceResultData): void {
    this.hideAll();
    this.resultOverlay.classList.remove('hidden');
    const place = data.position <= 0 ? '未完赛' : `第 ${data.position} 名`;
    this.resultTitle.textContent = place;
    this.resultDetail.textContent = `总用时 ${formatTime(data.totalMs)} · 最佳圈速 ${formatTime(data.bestLapMs)}`;
    const reward = this.resultOverlay.querySelector('#result-reward');
    if (reward instanceof HTMLElement) {
      reward.textContent = `奖励 🪙 ${data.reward}`;
      reward.classList.toggle('hidden', data.reward <= 0);
    }
    const record = this.resultOverlay.querySelector('#result-record');
    if (record instanceof HTMLElement) {
      record.classList.toggle('hidden', !data.newRecord);
    }
    this.touchControls.hide();
  }

  updateHud(): void {
    const speedKmh = Math.round(Math.abs(gameState.player.speedKmh));
    this.speedValue.textContent = String(speedKmh);
    this.tachValue.textContent = String(Math.round(gameState.player.rpm));
    this.tachBar.style.width = `${Math.round(gameState.player.rpmRatio * 100)}%`;
    this.gearValue.textContent = gameState.player.gear === 0 ? 'R' : `D${gameState.player.gear}`;
    this.killValue.textContent = String(gameState.pedestrianKills);
    this.hudCoins.textContent = String(Math.floor(gameState.coins));
    const nextTitle = TITLES.find((title) => title.kills > gameState.pedestrianKills);
    this.killNext.textContent = nextTitle
      ? `下一称号：${nextTitle.name}（${nextTitle.kills - gameState.pedestrianKills}）`
      : '全部称号已解锁';
    if (gameState.pedestrianKills !== this.lastShownKills) {
      const gained = TITLES.filter(
        (title) => title.kills > this.lastShownKills && title.kills <= gameState.pedestrianKills,
      );
      if (gained.length > 0) this.showTitleToast(gained[gained.length - 1]);
      this.lastShownKills = gameState.pedestrianKills;
    }
    if (gameState.mode === 'race') {
      this.lapValue.textContent = `${Math.min(gameState.player.lap, gameState.race.totalLaps)}/${gameState.race.totalLaps}`;
      this.positionValue.textContent = `${gameState.player.position}/${gameState.race.totalRacers}`;
      this.timeValue.textContent = formatTime(gameState.player.raceTimeMs);
      this.bestLapValue.textContent = formatTime(gameState.race.bestLapMs);
    }

    const dots = this.game.getMinimapDots();
    this.minimapFrame += 1;
    if (this.minimapFrame % 3 === 1) {
      this.minimap.render(
        gameState.player.x,
        gameState.player.z,
        gameState.player.heading,
        dots,
        this.game.getRaceRoute(),
      );
    }
  }

  private showToast(text: string, color: string): void {
    this.progressToast.textContent = text;
    this.progressToast.style.color = color;
    this.progressToast.style.borderColor = color;
    this.progressToast.classList.remove('hidden');
    if (this.progressToastTimer !== null) window.clearTimeout(this.progressToastTimer);
    this.progressToastTimer = window.setTimeout(() => {
      this.progressToast.classList.add('hidden');
    }, 3000);
  }

  setGaragePreview(vehicleId: string, color: string, direction?: 1 | -1): void {
    const prevIndex = VEHICLES.findIndex((v) => v.id === this.selectedGarageVehicleId);
    const nextIndex = VEHICLES.findIndex((v) => v.id === vehicleId);
    const dir =
      direction ??
      (nextIndex === prevIndex
        ? this.garageSlideDir
        : nextIndex > prevIndex
          ? 1
          : -1);
    this.garageSlideDir = dir;
    this.selectedGarageVehicleId = vehicleId;
    this.selectedGarageColor = color;
    this.game.showGarageVehicle(vehicleId, color);
    this.refreshGaragePreview();
    const wrap = this.garageThumb.parentElement;
    if (wrap instanceof HTMLElement) {
      wrap.classList.remove('garage-switching-left', 'garage-switching-right');
      void wrap.offsetWidth;
      wrap.classList.add(dir > 0 ? 'garage-switching-right' : 'garage-switching-left');
      window.setTimeout(() => {
        wrap.classList.remove('garage-switching-left', 'garage-switching-right');
      }, 320);
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
    this.setGaragePreview(next.id, color, direction > 0 ? 1 : -1);
  }

  setDifficulty(difficulty: Difficulty): void {
    gameState.setDifficulty(difficulty);
    const buttons = this.raceMenuOverlay.querySelectorAll('[data-difficulty]');
    for (const node of buttons) {
      const isActive = node instanceof HTMLElement && node.dataset.difficulty === difficulty;
      node.classList.toggle('active', isActive);
    }
  }

  setRaceOpponents(count: number): void {
    gameState.race.totalRacers =
      Math.max(
        RACE_CONFIG.MIN_OPPONENTS,
        Math.min(RACE_CONFIG.MAX_OPPONENTS, Math.round(count)),
      ) + 1;
    this.refreshRaceMenuOptions();
  }

  setRaceLaps(laps: number): void {
    gameState.race.totalLaps = Math.max(
      RACE_CONFIG.MIN_LAPS,
      Math.min(RACE_CONFIG.MAX_LAPS, Math.round(laps)),
    );
    this.refreshRaceMenuOptions();
  }

  setRaceLayout(layoutId: RaceLayoutId): void {
    gameState.setRaceLayout(layoutId);
    const buttons = this.raceMenuOverlay.querySelectorAll('[data-race-layout]');
    for (const node of buttons) {
      const isActive =
        node instanceof HTMLElement && node.dataset.raceLayout === layoutId;
      node.classList.toggle('active', isActive);
    }
    this.refreshRaceMenuOptions();
  }

  private refreshRaceMenuOptions(): void {
    const meta = this.raceMenuOverlay.querySelector('#race-menu-meta');
    if (meta instanceof HTMLElement) {
      const layoutNames: Record<RaceLayoutId, string> = {
        perimeter: '城市环路',
        cityTour: '城市巡回',
        hillLoop: '山地纵贯',
      };
      meta.textContent = `${layoutNames[gameState.race.layoutId]} · ${gameState.race.totalLaps} 圈 · ${gameState.race.totalRacers} 台车`;
    }
    const opponentsValue = this.raceMenuOverlay.querySelector('#race-opponents');
    if (opponentsValue instanceof HTMLElement) {
      opponentsValue.textContent = `${gameState.race.totalRacers - 1} 名`;
    }
    const lapsValue = this.raceMenuOverlay.querySelector('#race-laps');
    if (lapsValue instanceof HTMLElement) {
      lapsValue.textContent = `${gameState.race.totalLaps} 圈`;
    }
    if (this.raceMetaChip) {
      this.raceMetaChip.textContent = `${gameState.race.totalLaps} 圈竞速`;
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
    panel.appendChild(button('menu-btn menu-btn-lg', '无尽模式', () => this.game.startFreeRoam('endless')));
    panel.appendChild(button('menu-btn menu-btn-lg', '多人游戏', () => this.game.showMultiplayer()));
    panel.appendChild(button('menu-btn menu-btn-lg', '竞速模式', () => this.game.showRaceMenu()));
    panel.appendChild(button('menu-btn menu-btn-lg', '车库', () => this.game.showGarage()));
    panel.appendChild(button('menu-btn menu-btn-lg', '生涯成就', () => this.game.showProgress()));
    panel.appendChild(button('menu-btn menu-btn-lg', '设置', () => this.game.showSettings()));
    const footer = el('div', 'menu-footer') as HTMLDivElement;
    const mute = button('menu-btn menu-btn-small', '', () => this.game.toggleMute());
    mute.id = 'menu-mute';
    footer.appendChild(mute);
    const coins = el('span', 'menu-chip wallet-chip') as HTMLSpanElement;
    coins.id = 'menu-coins';
    coins.textContent = `🪙 ${Math.floor(gameState.coins)}`;
    coins.title = '金币：赢取竞速、完成每日任务与签到获得';
    footer.appendChild(coins);
    const checkIn = button('menu-btn menu-btn-small checkin-btn', '签到', () => {
      this.game.showProgress();
    });
    checkIn.id = 'menu-checkin';
    checkIn.title = '每日签到领取金币';
    footer.appendChild(checkIn);
    footer.appendChild(el('span', 'menu-chip', `${VEHICLES.length} 台座驾`));
    const raceChip = el('span', 'menu-chip', '');
    raceChip.id = 'menu-race-chip';
    footer.appendChild(raceChip);
    this.raceMetaChip = raceChip;
    panel.appendChild(footer);
    overlay.appendChild(panel);
    return overlay;
  }

  /** 主菜单钱包与签到入口状态 */
  refreshMenuWallet(): void {
    const coins = this.menuOverlay.querySelector('#menu-coins');
    if (coins instanceof HTMLElement) {
      coins.textContent = `🪙 ${Math.floor(gameState.coins)}`;
    }
    const checkIn = this.menuOverlay.querySelector('#menu-checkin');
    if (checkIn instanceof HTMLElement) {
      const canClaim = gameState.canCheckIn();
      checkIn.textContent = canClaim ? '签到' : '已签到';
      checkIn.classList.toggle('checkin-ready', canClaim);
    }
  }

  refreshMuteButton(): void {
    const text = gameState.settings.muted ? '声音：关' : '声音：开';
    this.muteButton.textContent = text;
    const settingsMute = this.settingsOverlay.querySelector('#settings-mute');
    if (settingsMute) settingsMute.textContent = text;
  }

  private buildMultiplayer(): HTMLDivElement {
    const overlay = el('div', 'overlay multiplayer-overlay hidden') as HTMLDivElement;
    const panel = el('div', 'menu-panel multiplayer-panel') as HTMLDivElement;
    panel.appendChild(el('h1', 'menu-heading', '多人游戏'));
    panel.appendChild(el('p', 'menu-description', '创建房间或加入同一局域网好友的房间'));
    const status = el('span', 'multiplayer-status') as HTMLSpanElement;
    status.id = 'multiplayer-status';
    status.textContent = '未连接';
    panel.appendChild(status);
    const username = el('span', 'multiplayer-username') as HTMLSpanElement;
    username.id = 'multiplayer-username';
    panel.appendChild(username);

    const createRow = el('div', 'multiplayer-create') as HTMLDivElement;
    const nameInput = el('input', 'multiplayer-name-input') as HTMLInputElement;
    nameInput.id = 'multiplayer-room-name';
    nameInput.placeholder = '房间名称';
    nameInput.maxLength = 24;
    createRow.appendChild(nameInput);
    createRow.appendChild(
      button('menu-btn menu-btn-primary menu-btn-small', '创建房间', () => {
        this.game.createMultiplayerRoom(nameInput.value || '默认房间');
        nameInput.value = '';
      }),
    );
    panel.appendChild(createRow);

    const rooms = el('div', 'multiplayer-rooms') as HTMLDivElement;
    rooms.id = 'multiplayer-rooms';
    panel.appendChild(rooms);
    panel.appendChild(
      button('menu-btn menu-btn-secondary', '返回主菜单', () => this.game.showMenu()),
    );
    overlay.appendChild(panel);
    return overlay;
  }

  private buildLobby(): HTMLDivElement {
    const overlay = el('div', 'overlay lobby-overlay hidden') as HTMLDivElement;
    const panel = el('div', 'menu-panel lobby-panel') as HTMLDivElement;
    const title = el('h1', 'menu-heading') as HTMLHeadingElement;
    title.id = 'lobby-title';
    title.textContent = '房间';
    panel.appendChild(title);
    panel.appendChild(el('p', 'menu-description', '等待房主开始游戏'));
    const players = el('div', 'lobby-players') as HTMLDivElement;
    players.id = 'lobby-players';
    panel.appendChild(players);
    const start = button('menu-btn menu-btn-primary', '开始游戏', () => {
      this.game.startMultiplayerGame();
    });
    start.id = 'lobby-start';
    start.classList.add('hidden');
    panel.appendChild(start);
    panel.appendChild(
      button('menu-btn', '离开房间', () => this.game.leaveMultiplayerRoom()),
    );
    panel.appendChild(
      button('menu-btn menu-btn-secondary', '返回主菜单', () => this.game.showMenu()),
    );
    overlay.appendChild(panel);
    return overlay;
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

    const bgmRow = el('div', 'settings-row settings-row-column') as HTMLDivElement;
    bgmRow.appendChild(el('span', 'settings-label', '背景音乐'));
    const bgmSlider = el('input', 'settings-slider') as HTMLInputElement;
    bgmSlider.type = 'range';
    bgmSlider.min = '0';
    bgmSlider.max = '1';
    bgmSlider.step = '0.05';
    bgmSlider.value = String(gameState.settings.bgmVolume);
    bgmSlider.id = 'settings-bgm-volume';
    bgmSlider.addEventListener('input', () => {
      this.game.setBgmVolume(Number(bgmSlider.value));
    });
    bgmRow.appendChild(bgmSlider);
    panel.appendChild(bgmRow);

    const sfxRow = el('div', 'settings-row settings-row-column') as HTMLDivElement;
    sfxRow.appendChild(el('span', 'settings-label', '游戏音量'));
    const sfxSlider = el('input', 'settings-slider') as HTMLInputElement;
    sfxSlider.type = 'range';
    sfxSlider.min = '0';
    sfxSlider.max = '1';
    sfxSlider.step = '0.05';
    sfxSlider.value = String(gameState.settings.sfxVolume);
    sfxSlider.id = 'settings-sfx-volume';
    sfxSlider.addEventListener('input', () => {
      this.game.setSfxVolume(Number(sfxSlider.value));
    });
    sfxRow.appendChild(sfxSlider);
    panel.appendChild(sfxRow);

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

    const qualityRow = el('div', 'settings-row settings-row-column') as HTMLDivElement;
    qualityRow.appendChild(el('span', 'settings-label', '画质'));
    const qualitySeg = el('div', 'difficulty-row') as HTMLDivElement;
    const qualities: { id: QualityPreset; label: string }[] = [
      { id: 'auto', label: '自动' },
      { id: 'low', label: '低' },
      { id: 'medium', label: '中' },
      { id: 'high', label: '高' },
    ];
    for (const item of qualities) {
      const node = button('seg-btn', item.label, () => {
        this.game.setQuality(item.id);
        this.refreshQualityButtons();
      });
      node.dataset.quality = item.id;
      qualitySeg.appendChild(node);
    }
    qualityRow.appendChild(qualitySeg);
    panel.appendChild(qualityRow);

    panel.appendChild(button('menu-btn menu-btn-secondary', '返回主菜单', () => this.game.showMenu()));
    overlay.appendChild(panel);
    return overlay;
  }

  private buildProgress(): HTMLDivElement {
    const overlay = el('div', 'overlay progress-overlay hidden') as HTMLDivElement;
    const panel = el('div', 'menu-panel progress-panel') as HTMLDivElement;
    panel.appendChild(el('h1', 'menu-heading', '生涯成就'));
    panel.appendChild(el('p', 'menu-description', '每日签到、今日任务、成就与生涯统计'));

    const wallet = el('div', 'progress-wallet') as HTMLDivElement;
    const walletValue = el('span', 'progress-wallet-value') as HTMLSpanElement;
    walletValue.id = 'progress-coins';
    wallet.appendChild(walletValue);
    panel.appendChild(wallet);

    const checkInSection = el('div', 'progress-section') as HTMLDivElement;
    checkInSection.appendChild(el('h2', 'progress-section-title', '每日签到'));
    const checkInRow = el('div', 'progress-row') as HTMLDivElement;
    const streakText = el('span', 'progress-text') as HTMLSpanElement;
    streakText.id = 'progress-streak';
    const checkInBtn = button('menu-btn menu-btn-primary', '签到', () => this.doCheckIn());
    checkInBtn.id = 'progress-checkin';
    checkInRow.append(streakText, checkInBtn);
    checkInSection.appendChild(checkInRow);
    panel.appendChild(checkInSection);

    const dailyTitle = el('h2', 'progress-section-title', '今日任务');
    dailyTitle.id = 'daily-title';
    panel.appendChild(dailyTitle);
    const dailyList = el('div', 'daily-list') as HTMLDivElement;
    dailyList.id = 'daily-list';
    panel.appendChild(dailyList);

    panel.appendChild(el('h2', 'progress-section-title', '成就'));
    const achievementGrid = el('div', 'achievement-grid') as HTMLDivElement;
    achievementGrid.id = 'achievement-grid';
    panel.appendChild(achievementGrid);

    panel.appendChild(el('h2', 'progress-section-title', '生涯统计'));
    const statsGrid = el('div', 'stats-grid') as HTMLDivElement;
    statsGrid.id = 'progress-stats';
    panel.appendChild(statsGrid);

    panel.appendChild(button('menu-btn menu-btn-secondary', '返回主菜单', () => this.game.showMenu()));
    overlay.appendChild(panel);
    return overlay;
  }

  private doCheckIn(): void {
    const result = gameState.checkIn();
    if (!result.ok) return;
    this.showToast(`签到成功！连续 ${result.streak} 天，+🪙${result.reward}`, '#ffb545');
    this.refreshProgressScreen();
    this.refreshMenuWallet();
  }

  private claimDaily(defId: string): void {
    if (gameState.claimDailyChallenge(defId)) {
      this.showToast('每日任务完成，+🪙 奖励已到账', '#8ce99a');
      this.refreshProgressScreen();
      this.refreshMenuWallet();
    }
  }

  private refreshProgressScreen(): void {
    gameState.ensureDailyFresh();
    const context = gameState.getProgressContext();
    const wallet = this.progressOverlay.querySelector('#progress-coins');
    if (wallet instanceof HTMLElement) {
      wallet.textContent = `🪙 ${Math.floor(gameState.coins)}`;
    }
    const streak = this.progressOverlay.querySelector('#progress-streak');
    if (streak instanceof HTMLElement) {
      streak.textContent = `当前连续签到 ${gameState.daily.checkInStreak} 天`;
    }
    const checkInBtn = this.progressOverlay.querySelector('#progress-checkin');
    if (checkInBtn instanceof HTMLButtonElement) {
      const can = gameState.canCheckIn();
      checkInBtn.disabled = !can;
      checkInBtn.textContent = can
        ? `签到领 🪙${checkInReward(gameState.daily.checkInStreak + 1)}`
        : '今日已签到';
    }
    const dailyTitle = this.progressOverlay.querySelector('#daily-title');
    if (dailyTitle instanceof HTMLElement) {
      const doneCount = gameState.daily.done.length;
      dailyTitle.textContent = `今日任务（${doneCount}/3）`;
    }

    // 今日任务
    const dailyList = this.progressOverlay.querySelector('#daily-list');
    if (dailyList instanceof HTMLDivElement) {
      dailyList.replaceChildren();
      const defs = dailyChallengesFor();
      for (const def of defs) {
        const progress = Math.min(challengeProgress(def, context), def.target);
        const done = gameState.daily.done.includes(def.id);
        const claimable = !done && progress >= def.target;
        const row = el('div', 'daily-item') as HTMLDivElement;
        row.classList.toggle('done', done);
        const main = el('div', 'daily-item-main') as HTMLDivElement;
        const head = el('div', 'daily-item-head') as HTMLDivElement;
        head.appendChild(el('span', 'daily-item-name', def.name));
        head.appendChild(
          el('span', 'daily-item-reward', `🪙 ${def.reward}`),
        );
        main.appendChild(head);
        main.appendChild(el('span', 'daily-item-desc', def.description));
        const barWrap = el('div', 'daily-bar') as HTMLDivElement;
        const bar = el('div', 'daily-bar-fill') as HTMLDivElement;
        bar.style.width = `${Math.min(100, Math.round((progress / def.target) * 100))}%`;
        barWrap.appendChild(bar);
        main.appendChild(barWrap);
        const counter = el('span', 'daily-item-progress', `${progress}/${def.target} ${def.unit}`);
        row.append(main, counter);
        if (done) {
          const tag = el('span', 'daily-item-tag', '已领取');
          row.appendChild(tag);
        } else if (claimable) {
          const claimBtn = button('menu-btn menu-btn-small menu-btn-primary', '领取', () =>
            this.claimDaily(def.id),
          );
          row.appendChild(claimBtn);
        }
        dailyList.appendChild(row);
      }
    }

    // 成就
    const grid = this.progressOverlay.querySelector('#achievement-grid');
    if (grid instanceof HTMLDivElement) {
      grid.replaceChildren();
      for (const achievement of ACHIEVEMENTS) {
        const unlocked = gameState.unlockedAchievements.includes(achievement.id);
        const progress = Math.min(achievementProgress(achievement, context), achievement.target);
        const card = el('div', 'achievement-card') as HTMLDivElement;
        card.classList.toggle('unlocked', unlocked);
        card.title = achievement.description;
        const icon = el('span', 'achievement-icon', achievement.icon) as HTMLSpanElement;
        const body = el('div', 'achievement-body') as HTMLDivElement;
        const head = el('div', 'achievement-head') as HTMLDivElement;
        head.appendChild(el('span', 'achievement-name', achievement.name));
        head.appendChild(el('span', 'achievement-reward', `🪙 ${achievement.reward}`));
        body.appendChild(head);
        body.appendChild(el('span', 'achievement-desc', achievement.description));
        const barWrap = el('div', 'achievement-bar') as HTMLDivElement;
        const bar = el('div', 'achievement-bar-fill') as HTMLDivElement;
        bar.style.width = `${Math.min(100, Math.round((progress / achievement.target) * 100))}%`;
        barWrap.appendChild(bar);
        body.appendChild(barWrap);
        card.append(icon, body);
        const status = el('span', 'achievement-status', unlocked ? '已解锁' : `${progress}/${achievement.target}`);
        card.appendChild(status);
        grid.appendChild(card);
      }
    }

    // 生涯统计
    const stats = this.progressOverlay.querySelector('#progress-stats');
    if (stats instanceof HTMLDivElement) {
      stats.replaceChildren();
      const rows: [string, string][] = [
        ['累计里程', `${context.stats.distanceKm.toFixed(1)} km`],
        ['无尽里程', `${context.stats.endlessKm.toFixed(1)} km`],
        ['竞速场次', `${context.stats.races} 场`],
        ['夺冠次数', `${context.stats.raceWins} 次`],
        ['极速纪录', `${Math.round(context.stats.topSpeedKmh)} km/h`],
        ['驾驶时长', formatDuration(context.stats.playSeconds)],
        ['累计赚取', `🪙 ${Math.floor(context.stats.coinsEarned)}`],
        ['行人击杀', `${context.pedestrianKills} 人`],
      ];
      for (const [label, value] of rows) {
        const item = el('div', 'stat-cell') as HTMLDivElement;
        item.appendChild(el('span', 'stat-cell-label', label));
        item.appendChild(el('span', 'stat-cell-value', value));
        stats.appendChild(item);
      }
    }
  }

  // ---------------- 竞速任务触发点 ----------------

  setTaskHintVisible(visible: boolean): void {
    this.taskHint.classList.toggle('hidden', !visible);
  }

  showTaskPanel(def: TaskPointDef): void {
    this.taskLaps = def.defaultLaps;
    this.taskOpponents = def.defaultOpponents;
    const title = this.taskRaceOverlay.querySelector('#task-race-title');
    if (title instanceof HTMLElement) title.textContent = def.name;
    this.hideAll();
    this.taskRaceOverlay.classList.remove('hidden');
    this.refreshTaskSelectors();
    this.touchControls.hide();
  }

  hideTaskPanel(): void {
    this.taskRaceOverlay.classList.add('hidden');
    this.showFreeRoamHud();
  }

  setTaskRaceReturn(visible: boolean): void {
    const button = this.resultOverlay.querySelector('#result-return-free');
    if (button instanceof HTMLElement) {
      button.classList.toggle('hidden', !visible);
    }
  }

  private setTaskLaps(laps: number): void {
    this.taskLaps = Math.max(1, Math.min(5, Math.round(laps)));
    this.refreshTaskSelectors();
  }

  private setTaskOpponents(count: number): void {
    this.taskOpponents = Math.max(1, Math.min(7, Math.round(count)));
    this.refreshTaskSelectors();
  }

  private refreshTaskSelectors(): void {
    for (const node of this.taskRaceOverlay.querySelectorAll('[data-task-laps]')) {
      node.classList.toggle(
        'active',
        node instanceof HTMLElement && Number(node.dataset.taskLaps) === this.taskLaps,
      );
    }
    for (const node of this.taskRaceOverlay.querySelectorAll('[data-task-opponents]')) {
      node.classList.toggle(
        'active',
        node instanceof HTMLElement &&
          Number(node.dataset.taskOpponents) === this.taskOpponents,
      );
    }
  }

  private buildTaskRacePanel(): HTMLDivElement {
    const overlay = el('div', 'overlay task-race-overlay hidden') as HTMLDivElement;
    const panel = el('div', 'menu-panel task-race-panel') as HTMLDivElement;
    const title = el('h1', 'menu-heading') as HTMLHeadingElement;
    title.id = 'task-race-title';
    title.textContent = '竞速';
    panel.appendChild(title);
    panel.appendChild(el('p', 'menu-description', '选择圈数与对手数量后开始比赛'));

    const lapsRow = el('div', 'settings-row settings-row-column') as HTMLDivElement;
    lapsRow.appendChild(el('span', 'settings-label', '比赛圈数'));
    const lapsSeg = el('div', 'difficulty-row') as HTMLDivElement;
    for (let laps = 1; laps <= 5; laps += 1) {
      const node = button('seg-btn', `${laps} 圈`, () => this.setTaskLaps(laps));
      node.dataset.taskLaps = String(laps);
      lapsSeg.appendChild(node);
    }
    lapsRow.appendChild(lapsSeg);
    panel.appendChild(lapsRow);

    const oppRow = el('div', 'settings-row settings-row-column') as HTMLDivElement;
    oppRow.appendChild(el('span', 'settings-label', '对手数量'));
    const oppSeg = el('div', 'difficulty-row') as HTMLDivElement;
    for (let count = 1; count <= 7; count += 1) {
      const node = button('seg-btn', `${count} 人`, () => this.setTaskOpponents(count));
      node.dataset.taskOpponents = String(count);
      oppSeg.appendChild(node);
    }
    oppRow.appendChild(oppSeg);
    panel.appendChild(oppRow);

    panel.appendChild(
      button('menu-btn menu-btn-primary', '开始比赛', () =>
        this.game.startTaskRace(this.taskLaps, this.taskOpponents),
      ),
    );
    panel.appendChild(
      button('menu-btn menu-btn-secondary', '取消', () => this.game.closeTaskPanel()),
    );
    overlay.appendChild(panel);
    return overlay;
  }

  private buildRaceMenu(): HTMLDivElement {
    const overlay = el('div', 'overlay menu-overlay') as HTMLDivElement;
    const panel = el('div', 'menu-panel') as HTMLDivElement;
    panel.appendChild(el('h1', 'menu-heading', '竞速模式'));
    const meta = el('p', 'menu-description') as HTMLParagraphElement;
    meta.id = 'race-menu-meta';
    panel.appendChild(meta);

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

    const layoutRow = el('div', 'difficulty-row race-layout-row') as HTMLDivElement;
    const layouts: { id: RaceLayoutId; label: string }[] = [
      { id: 'perimeter', label: '城市环路' },
      { id: 'cityTour', label: '城市巡回' },
      { id: 'hillLoop', label: '山地纵贯' },
    ];
    for (const item of layouts) {
      const node = button('seg-btn', item.label, () => this.setRaceLayout(item.id));
      node.dataset.raceLayout = item.id;
      layoutRow.appendChild(node);
    }
    panel.appendChild(layoutRow);

    const opponentsRow = el('div', 'race-option-row') as HTMLDivElement;
    opponentsRow.appendChild(el('span', 'settings-label', '对手数量'));
    const opponentsStepper = el('div', 'stepper') as HTMLDivElement;
    const opponentsDec = button('seg-btn stepper-btn', '−', () =>
      this.setRaceOpponents(gameState.race.totalRacers - 2),
    );
    opponentsDec.dataset.raceOpponents = 'dec';
    const opponentsValue = el('span', 'stepper-value') as HTMLSpanElement;
    opponentsValue.id = 'race-opponents';
    const opponentsInc = button('seg-btn stepper-btn', '+', () =>
      this.setRaceOpponents(gameState.race.totalRacers),
    );
    opponentsInc.dataset.raceOpponents = 'inc';
    opponentsStepper.append(opponentsDec, opponentsValue, opponentsInc);
    opponentsRow.appendChild(opponentsStepper);
    panel.appendChild(opponentsRow);

    const lapsRow = el('div', 'race-option-row') as HTMLDivElement;
    lapsRow.appendChild(el('span', 'settings-label', '圈数'));
    const lapsStepper = el('div', 'stepper') as HTMLDivElement;
    const lapsDec = button('seg-btn stepper-btn', '−', () =>
      this.setRaceLaps(gameState.race.totalLaps - 1),
    );
    lapsDec.dataset.raceLaps = 'dec';
    const lapsValue = el('span', 'stepper-value') as HTMLSpanElement;
    lapsValue.id = 'race-laps';
    const lapsInc = button('seg-btn stepper-btn', '+', () =>
      this.setRaceLaps(gameState.race.totalLaps + 1),
    );
    lapsInc.dataset.raceLaps = 'inc';
    lapsStepper.append(lapsDec, lapsValue, lapsInc);
    lapsRow.appendChild(lapsStepper);
    panel.appendChild(lapsRow);

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
    const useBtn = button('menu-btn menu-btn-primary', '使用此车辆', () => this.confirmGarageSelection());
    useBtn.id = 'garage-use-btn';
    detail.appendChild(useBtn);
    const buyBtn = button('menu-btn menu-btn-primary', '购买并装备', () => this.buyGarageVehicle());
    buyBtn.id = 'garage-buy-btn';
    buyBtn.classList.add('hidden');
    detail.appendChild(buyBtn);
    detail.appendChild(button('menu-btn menu-btn-secondary', '返回', () => this.game.showMenu()));
    panel.appendChild(detail);
    overlay.appendChild(panel);
    return overlay;
  }

  private buyGarageVehicle(): void {
    const spec = VEHICLES.find((v) => v.id === this.selectedGarageVehicleId);
    if (!spec || gameState.isVehicleOwned(spec.id)) return;
    const price = vehiclePrice(spec.id);
    if (gameState.coins < price) {
      this.showToast('金币不足，完成竞速或每日任务赚取金币', '#ff6b6b');
      return;
    }
    if (gameState.buyVehicle(spec.id)) {
      this.showToast(`已购买并装备 ${spec.name}`, '#8ce99a');
      this.game.selectGarageVehicle(this.selectedGarageVehicleId, this.selectedGarageColor);
    }
  }

  private buildGarageCards(): void {
    const list = this.garageOverlay.querySelector('.garage-list');
    if (!(list instanceof HTMLDivElement)) return;
    for (const spec of VEHICLES) {
      const card = button('garage-card', '', () => {
        this.setGaragePreview(spec.id, spec.color);
      });
      card.appendChild(el('span', 'garage-card-name', spec.name));
      const price = vehiclePrice(spec.id);
      card.appendChild(
        el('span', 'garage-card-speed', price > 0 ? `🔒 🪙${price}` : `${Math.round(spec.topSpeedMs * 3.6)} km/h`),
      );
      if (price > 0) card.classList.add('garage-card-locked');
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

    const killCounter = el('div', 'kill-counter') as HTMLDivElement;
    killCounter.appendChild(el('span', 'kill-label', '行人击杀'));
    const killValue = el('span', 'kill-value') as HTMLSpanElement;
    killValue.id = 'hud-kills';
    killValue.textContent = String(gameState.pedestrianKills);
    killCounter.appendChild(killValue);
    const killNext = el('span', 'kill-next') as HTMLSpanElement;
    killNext.id = 'hud-next-title';
    killCounter.appendChild(killNext);
    hud.appendChild(killCounter);

    const coinHud = el('div', 'hud-coins') as HTMLDivElement;
    coinHud.title = '金币';
    coinHud.appendChild(el('span', 'kill-label', '金币'));
    const hudCoinsValue = el('span', 'hud-coins-value') as HTMLSpanElement;
    hudCoinsValue.id = 'hud-coins';
    hudCoinsValue.textContent = '0';
    coinHud.appendChild(hudCoinsValue);
    hud.appendChild(coinHud);

    const titleToast = el('div', 'title-toast hidden') as HTMLDivElement;
    titleToast.id = 'hud-title-toast';
    hud.appendChild(titleToast);

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

    const qualityRow = el('div', 'settings-row settings-row-column') as HTMLDivElement;
    qualityRow.appendChild(el('span', 'settings-label', '画质'));
    const qualitySeg = el('div', 'difficulty-row quality-row') as HTMLDivElement;
    const qualities: { id: QualityPreset; label: string }[] = [
      { id: 'auto', label: '自动' },
      { id: 'low', label: '低' },
      { id: 'medium', label: '中' },
      { id: 'high', label: '高' },
    ];
    for (const item of qualities) {
      const node = button('seg-btn', item.label, () => {
        this.game.setQuality(item.id);
        this.refreshQualityButtons();
      });
      node.dataset.quality = item.id;
      qualitySeg.appendChild(node);
    }
    qualityRow.appendChild(qualitySeg);
    panel.appendChild(qualityRow);

    const bgmRow = el('div', 'settings-row settings-row-column') as HTMLDivElement;
    bgmRow.appendChild(el('span', 'settings-label', '背景音乐'));
    const bgmSlider = el('input', 'settings-slider') as HTMLInputElement;
    bgmSlider.type = 'range';
    bgmSlider.min = '0';
    bgmSlider.max = '1';
    bgmSlider.step = '0.05';
    bgmSlider.value = String(gameState.settings.bgmVolume);
    bgmSlider.id = 'pause-bgm-volume';
    bgmSlider.addEventListener('input', () => {
      this.game.setBgmVolume(Number(bgmSlider.value));
    });
    bgmRow.appendChild(bgmSlider);
    panel.appendChild(bgmRow);

    const sfxRow = el('div', 'settings-row settings-row-column') as HTMLDivElement;
    sfxRow.appendChild(el('span', 'settings-label', '游戏音量'));
    const sfxSlider = el('input', 'settings-slider') as HTMLInputElement;
    sfxSlider.type = 'range';
    sfxSlider.min = '0';
    sfxSlider.max = '1';
    sfxSlider.step = '0.05';
    sfxSlider.value = String(gameState.settings.sfxVolume);
    sfxSlider.id = 'pause-sfx-volume';
    sfxSlider.addEventListener('input', () => {
      this.game.setSfxVolume(Number(sfxSlider.value));
    });
    sfxRow.appendChild(sfxSlider);
    panel.appendChild(sfxRow);

    panel.appendChild(el('h2', 'settings-label title-section-label', '称号'));
    const titleList = el('div', 'title-list') as HTMLDivElement;
    for (const title of TITLES) {
      const item = el('div', 'title-item locked') as HTMLDivElement;
      item.dataset.title = title.id;
      item.title = title.description;
      const main = el('div', 'title-main') as HTMLDivElement;
      const name = el('span', 'title-name', title.name) as HTMLSpanElement;
      const cond = el('span', 'title-cond', '0/10') as HTMLSpanElement;
      main.append(name, cond);
      item.appendChild(main);
      titleList.appendChild(item);
    }
    panel.appendChild(titleList);

    const actions = el('div', 'pause-actions') as HTMLDivElement;
    actions.appendChild(button('menu-btn menu-btn-primary', '继续', () => this.game.togglePause()));
    actions.appendChild(button('menu-btn', '重新开始', () => this.game.restartCurrent()));
    actions.appendChild(button('menu-btn menu-btn-secondary', '返回主菜单', () => this.game.showMenu()));
    panel.appendChild(actions);
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

  private refreshQualityButtons(): void {
    for (const node of this.root.querySelectorAll('[data-quality]')) {
      const active =
        node instanceof HTMLElement && node.dataset.quality === gameState.settings.quality;
      node.classList.toggle('active', active);
    }
  }

  private refreshTitlePanel(): void {
    const kills = gameState.pedestrianKills;
    for (const title of TITLES) {
      const item = this.pauseOverlay.querySelector(`[data-title="${title.id}"]`);
      if (!(item instanceof HTMLElement)) continue;
      const unlocked = kills >= title.kills;
      item.classList.toggle('locked', !unlocked);
      item.classList.toggle('unlocked', unlocked);
      const name = item.querySelector('.title-name');
      if (name instanceof HTMLElement) name.style.color = title.color;
      const cond = item.querySelector('.title-cond');
      if (cond instanceof HTMLElement) {
        cond.textContent = unlocked ? '已解锁' : `${kills}/${title.kills}`;
      }
    }
  }

  private showTitleToast(title: TitleDefinition): void {
    this.titleToast.textContent = `获得称号：${title.name}`;
    this.titleToast.style.color = title.color;
    this.titleToast.style.borderColor = title.color;
    this.titleToast.classList.remove('hidden');
    if (this.titleToastTimer !== null) window.clearTimeout(this.titleToastTimer);
    this.titleToastTimer = window.setTimeout(() => {
      this.titleToast.classList.add('hidden');
    }, 3000);
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
    const reward = el('p', 'result-reward') as HTMLParagraphElement;
    reward.id = 'result-reward';
    panel.appendChild(reward);
    const record = el('p', 'result-record') as HTMLParagraphElement;
    record.id = 'result-record';
    record.textContent = '🏅 刷新赛道纪录！';
    record.classList.add('hidden');
    panel.appendChild(record);
    const actions = el('div', 'result-actions') as HTMLDivElement;
    actions.appendChild(button('menu-btn menu-btn-primary', '再来一局', () => this.game.restartRace()));
    const returnFree = button('menu-btn', '返回自由漫游', () => this.game.returnToFreeRoam());
    returnFree.id = 'result-return-free';
    returnFree.classList.add('hidden');
    actions.appendChild(returnFree);
    actions.appendChild(
      button('menu-btn menu-btn-small', '分享成绩', () => this.shareResult()),
    );
    actions.appendChild(button('menu-btn menu-btn-secondary', '返回主菜单', () => this.game.showMenu()));
    panel.appendChild(actions);
    overlay.appendChild(panel);
    return overlay;
  }

  private shareResult(): void {
    const positionText = gameState.player.position > 0
      ? `第 ${gameState.player.position} 名`
      : '未完赛';
    const text =
      `我在 MoronTown 竞速中拿下${positionText}！` +
      `总用时 ${formatTime(gameState.player.raceTimeMs)}` +
      (gameState.race.bestLapMs > 0 ? `，最佳圈速 ${formatTime(gameState.race.bestLapMs)}` : '') +
      '。快来挑战我的纪录！';
    const share = navigator as Navigator & { share?: (data: { title: string; text: string }) => Promise<void> };
    if (typeof share.share === 'function') {
      share.share({ title: 'MoronTown', text }).catch(() => undefined);
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        this.showToast('成绩已复制到剪贴板', '#3fb0ff');
      }).catch(() => undefined);
    } else {
      this.showToast('分享成绩：' + text, '#3fb0ff');
    }
  }

  private refreshGaragePreview(): void {
    const spec = VEHICLES.find((v) => v.id === this.selectedGarageVehicleId) ?? VEHICLES[0];
    const owned = gameState.isVehicleOwned(spec.id);
    const price = vehiclePrice(spec.id);
    this.garageName.textContent = owned ? spec.name : `${spec.name}（未解锁）`;
    const stats: Record<string, number> = {
      speed: spec.topSpeedMs,
      accel: spec.accelMs2,
      steer: spec.steerRate,
      brake: spec.brakeMs2,
    };
    const maxes: Record<string, number> = { speed: 62, accel: 18, steer: 3.9, brake: 24 };
    for (const [key, fill] of this.statBars) {
      fill.style.width = `${Math.round((stats[key] / maxes[key]) * 100)}%`;
    }
    this.drawTorqueCurve(spec);
    this.buildGearRatioBars(spec);

    const useBtn = this.garageOverlay.querySelector('#garage-use-btn');
    const buyBtn = this.garageOverlay.querySelector('#garage-buy-btn');
    if (useBtn instanceof HTMLButtonElement) {
      useBtn.classList.toggle('hidden', !owned);
    }
    if (buyBtn instanceof HTMLButtonElement) {
      buyBtn.classList.toggle('hidden', owned);
      if (!owned) {
        buyBtn.textContent = `购买并装备 · 🪙${price}`;
        buyBtn.disabled = gameState.coins < price;
      }
    }

    this.garageSwatches.replaceChildren();
    if (owned) {
      for (const color of spec.colorOptions) {
        const swatch = button('color-swatch', '', () => {
          this.setGaragePreview(spec.id, color);
        });
        swatch.style.background = color;
        swatch.classList.toggle('active', color === this.selectedGarageColor);
        this.garageSwatches.appendChild(swatch);
      }
    } else {
      this.garageSwatches.appendChild(
        el('span', 'garage-locked-hint', `🔒 需 🪙${price} 解锁，解锁后可自定义颜色`),
      );
    }
    for (const [id, card] of this.garageCards) {
      card.classList.toggle('active', id === this.selectedGarageVehicleId);
      card.classList.toggle('garage-card-owned', gameState.isVehicleOwned(id));
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
      const raw = data as RaceFinishedData;
      const enriched = this.game.awardRaceResult({
        position: raw.position,
        totalRacers: raw.totalRacers,
        bestLapMs: raw.bestLapMs,
        totalMs: raw.totalMs,
        difficulty: raw.difficulty,
      });
      this.showResult(enriched);
      this.refreshMenuWallet();
    });
    eventBus.on(Events.VEHICLE_COLLISION, () => {
      this.speedValue.classList.add('collision-flash');
      if (this.collisionFlashTimer !== null) window.clearTimeout(this.collisionFlashTimer);
      this.collisionFlashTimer = window.setTimeout(() => {
        this.speedValue.classList.remove('collision-flash');
      }, 220);
    });
    eventBus.on(Events.COINS_CHANGED, () => {
      this.hudCoins.textContent = String(Math.floor(gameState.coins));
      this.refreshMenuWallet();
      if (gameState.mode === 'menu' && !this.progressOverlay.classList.contains('hidden')) {
        this.refreshProgressScreen();
      }
    });
    eventBus.on(Events.ACHIEVEMENT_UNLOCKED, (data) => {
      const achievement = (data as { achievement: AchievementDef } | undefined)?.achievement;
      if (achievement) {
        this.showToast(`成就解锁：${achievement.name} +🪙${achievement.reward}`, '#ffd84d');
        this.hudCoins.textContent = String(Math.floor(gameState.coins));
        this.refreshMenuWallet();
      }
    });
    eventBus.on(Events.PROGRESS_CHANGED, () => {
      if (gameState.mode === 'menu' && !this.progressOverlay.classList.contains('hidden')) {
        this.refreshProgressScreen();
      }
    });
  }

  private hideAll(): void {
    for (const overlay of [
      this.menuOverlay,
      this.raceMenuOverlay,
      this.settingsOverlay,
      this.progressOverlay,
      this.garageOverlay,
      this.multiplayerOverlay,
      this.lobbyOverlay,
      this.hudOverlay,
      this.taskHint,
      this.taskRaceOverlay,
      this.countdownOverlay,
      this.pauseOverlay,
      this.resultOverlay,
    ]) {
      overlay.classList.add('hidden');
    }
  }
}
