import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';

type GameWindow = Window & {
  __GAME__: {
    debug: {
      finishRace: () => void;
      nextLap: () => void;
      teleport: (x: number, z: number) => void;
    };
  };
  __GAME_STATE__: {
    mode: string;
    paused: boolean;
    player: {
      vehicleId: string;
      x: number;
      z: number;
      speedKmh: number;
      lap: number;
    };
    race: { phase: string };
  };
  render_game_to_text: () => string;
};

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => (window as unknown as { __GAME__?: unknown }).__GAME__ !== undefined);
  await expect(page.getByText('城市驾驶模拟')).toBeVisible();
}

test('boots into main menu without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await boot(page);
  const state = await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    return { mode: g.__GAME_STATE__.mode, text: g.render_game_to_text() };
  });
  expect(state.mode).toBe('menu');
  expect(state.text).toContain('"mode":"menu"');
  expect(errors).toEqual([]);
});

test('free roam drives, camera toggle and pause work', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '自由漫游' }).click();
  await expect(page.locator('#hud')).toBeVisible();

  const before = await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    return JSON.parse(g.render_game_to_text()) as { player: { x: number; z: number } };
  });
  await page.keyboard.down('w');
  await page.waitForTimeout(900);
  await page.keyboard.up('w');
  const after = await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    return JSON.parse(g.render_game_to_text()) as { player: { x: number; z: number } };
  });
  const moved = Math.abs(after.player.x - before.player.x) + Math.abs(after.player.z - before.player.z);
  expect(moved).toBeGreaterThan(2);

  await page.keyboard.press('c');
  await page.waitForTimeout(200);
  const camera = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      cameraMode: string;
      camera: { fov: number };
    };
    return { mode: game.cameraMode, fov: game.camera.fov };
  });
  expect(camera.mode).toBe('hood');
  expect(camera.fov).toBeGreaterThan(80);

  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-overlay')).toBeVisible();
  await page.locator('.pause-overlay .menu-btn-primary').click();
  await expect(page.locator('.pause-overlay')).toBeHidden();
});

test('traffic signals have poles and three lamp heads', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      city: {
        group: {
          traverse: (fn: (obj: {
            name?: string;
            isInstancedMesh?: boolean;
            count?: number;
            geometry?: {
              computeBoundingBox?: () => void;
              boundingBox?: { min: { y: number }; max: { y: number } };
            };
            instanceMatrix?: { array?: Float32Array };
          }) => void) => void;
        };
      };
    };
    let poleCount = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    const lampCounts: Record<string, number> = {};
    game.city.group.traverse((obj) => {
      if (!obj.isInstancedMesh || !obj.count) return;
      if (obj.name === 'signal-poles') {
        poleCount += obj.count;
        obj.geometry?.computeBoundingBox?.();
        const bb = obj.geometry?.boundingBox;
        const y = obj.instanceMatrix?.array?.[13] ?? 0;
        if (bb) {
          minY = Math.min(minY, bb.min.y + y);
          maxY = Math.max(maxY, bb.max.y + y);
        }
      }
      if (obj.name && /^signal-(red|yellow|green)-lamps$/.test(obj.name)) {
        lampCounts[obj.name] = (lampCounts[obj.name] ?? 0) + obj.count;
      }
    });
    return { poleCount, minY, maxY, lampCounts };
  });
  expect(result.poleCount).toBeGreaterThan(0);
  expect(result.minY).toBeGreaterThanOrEqual(-0.05);
  expect(result.maxY).toBeGreaterThan(4.5);
  expect(result.lampCounts['signal-red-lamps']).toBeGreaterThan(0);
  expect(result.lampCounts['signal-yellow-lamps']).toBeGreaterThan(0);
  expect(result.lampCounts['signal-green-lamps']).toBeGreaterThan(0);
});

test('automatic transmission shifts and HUD shows tachometer', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '自由漫游' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#hud-gear')).toHaveText('D1');

  await page.keyboard.down('w');
  await page.waitForTimeout(1500);
  await page.keyboard.up('w');
  const state = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      player: { gear: number; rpm: number };
    };
    return { gear: game.player.gear, rpm: game.player.rpm };
  });
  expect(state.gear).toBeGreaterThan(1);
  expect(state.rpm).toBeGreaterThan(0);
  await expect(page.locator('#hud-gear')).toHaveText(`D${state.gear}`);
  expect(Number(await page.locator('#hud-rpm').textContent())).toBeGreaterThan(0);
});

test('garage shows torque curve and gear ratio bars', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '车库' }).click();
  const result = await page.evaluate(() => {
    const canvas = document.querySelector('#torque-curve') as HTMLCanvasElement | null;
    const labels = [...document.querySelectorAll('.gear-label')].map(
      (node) => node.textContent ?? '',
    );
    return { hasCanvas: !!canvas && canvas.width > 0, labels };
  });
  expect(result.hasCanvas).toBe(true);
  expect(result.labels.length).toBeGreaterThan(3);
  expect(result.labels[0]).toBe('D1');
});

test('torque curve and gear ratios shape acceleration', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '自由漫游' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  const accel = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      player: {
        gear: number;
        rpm: number;
        speed: number;
        lateral: number;
        getEngineAccel: () => number;
        spec: {
          engineIdleRpm: number;
          engineRedlineRpm: number;
          gearRatios: number[];
        };
      };
    };
    const player = game.player;
    player.speed = 4;
    player.lateral = 0;
    player.gear = 1;
    const range = player.spec.engineRedlineRpm - player.spec.engineIdleRpm;
    player.rpm = player.spec.engineIdleRpm + range * 0.5;
    const peak = player.getEngineAccel();
    player.rpm = player.spec.engineRedlineRpm;
    const redline = player.getEngineAccel();
    player.gear = player.spec.gearRatios.length;
    const topGear = player.getEngineAccel();
    return { peak, redline, topGear };
  });
  expect(accel.peak).toBeGreaterThan(accel.topGear);
  expect(accel.peak).toBeGreaterThan(accel.redline);
});

test('garage thumbnail, arrows and selection persist', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '车库' }).click();
  const thumb = page.locator('#garage-thumb');
  await expect(thumb).toBeVisible();
  const firstSrc = await thumb.getAttribute('src');
  expect(firstSrc).toMatch(/^data:image\/png/);

  await page.getByRole('button', { name: '下一辆' }).click();
  await expect(page.locator('#garage-name')).toHaveText('运动轿跑');
  const secondSrc = await thumb.getAttribute('src');
  expect(secondSrc).not.toBe(firstSrc);

  await page.getByRole('button', { name: '使用此车辆' }).click();
  await expect(page.getByText('城市驾驶模拟')).toBeVisible();
  const saved = await page.evaluate(() => localStorage.getItem('fenza-road-save-v1'));
  expect(saved).toContain('"selectedVehicleId":"coupe"');

  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __GAME_STATE__?: unknown }).__GAME_STATE__ !== undefined);
  const vehicleId = await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    return g.__GAME_STATE__.player.vehicleId;
  });
  expect(vehicleId).toBe('coupe');
});

test('settings screen and mobile camera button work', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.locator('.settings-overlay')).toContainText('声音');
  await expect(page.locator('.settings-overlay')).toContainText('操控方式');
  await page.locator('.settings-overlay').getByRole('button', { name: '手机操控' }).click();
  await expect(page.locator('.settings-overlay [data-control-mode="mobile"]')).toHaveClass(/active/);
  await page.locator('.settings-overlay').getByRole('button', { name: '返回主菜单' }).click();

  await page.getByRole('button', { name: '自由漫游' }).click();
  await expect(page.locator('.touch-controls')).toBeVisible();
  await expect(page.locator('.cam-btn')).toBeVisible();
  await page.locator('.cam-btn').click();
  await page.waitForTimeout(200);
  const mode = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      cameraMode: string;
    };
    return game.cameraMode;
  });
  expect(mode).toBe('hood');
});

test('race countdown, debug finish and restart', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '竞速模式' }).click();
  await page.getByRole('button', { name: '开始比赛' }).click();
  await expect(page.locator('.countdown-overlay')).toContainText('3');
  await page.waitForFunction(() => {
    const g = window as unknown as GameWindow;
    return g.__GAME_STATE__.race.phase === 'racing';
  }, { timeout: 15000 });

  await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    g.__GAME__.debug.finishRace();
  });
  await expect(page.locator('#result-title')).toBeVisible();

  await page.getByRole('button', { name: '再来一局' }).click();
  await expect(page.locator('.countdown-overlay')).toBeVisible();
  await page.waitForFunction(() => {
    const g = window as unknown as GameWindow;
    return g.__GAME_STATE__.race.phase === 'racing';
  }, { timeout: 15000 });
  await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    g.__GAME__.debug.finishRace();
  });
  await expect(page.locator('#result-title')).toBeVisible();
});

test('desktop visual and FPS smoke', async ({ page }) => {
  await boot(page);
  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/menu.png' });
  expect(fs.statSync('test-results/menu.png').size).toBeGreaterThan(5000);

  await page.getByRole('button', { name: '自由漫游' }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/free-roam.png' });
  expect(fs.statSync('test-results/free-roam.png').size).toBeGreaterThan(5000);
  const fps = await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    return Number(JSON.parse(g.render_game_to_text()).fps);
  });
  expect(fps).toBeGreaterThan(15);
});
