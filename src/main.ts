import './style.css';
import { Game } from './core/Game';
import { gameState } from './core/GameState';
import { eventBus, Events } from './core/EventBus';

const app = document.getElementById('app');
if (!app) {
  throw new Error('App container not found');
}

const game = new Game(app);

const g = window as unknown as {
  __GAME__?: unknown;
  __GAME_STATE__?: unknown;
  __EVENT_BUS__?: unknown;
  __EVENTS__?: unknown;
  render_game_to_text?: () => string;
  advanceTime?: (ms: number) => Promise<void>;
};

g.__GAME__ = game;
g.__GAME_STATE__ = gameState;
g.__EVENT_BUS__ = eventBus;
g.__EVENTS__ = Events;

g.render_game_to_text = (): string => {
  const player = gameState.player;
  return JSON.stringify({
    coords: 'origin:top-left x:right z:down',
    mode: gameState.mode,
    paused: gameState.paused,
    racePhase: gameState.race.phase,
    player: {
      x: Math.round(player.x),
      z: Math.round(player.z),
      heading: Number(player.heading.toFixed(3)),
      speedKmh: Math.round(player.speedKmh),
      lap: player.lap,
      position: player.position,
      vehicleId: player.vehicleId,
    },
    race: {
      lap: player.lap,
      totalLaps: gameState.race.totalLaps,
      position: player.position,
      totalRacers: gameState.race.totalRacers,
      phase: gameState.race.phase,
    },
    fps: Number(game.getFps().toFixed(1)),
  });
};

g.advanceTime = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const start = performance.now();
    const step = (): void => {
      if (performance.now() - start >= ms) {
        resolve();
      } else {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  });
