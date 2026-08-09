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

test('free roam drives and pause overlay works', async ({ page }) => {
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

  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-overlay')).toBeVisible();
  await page.locator('.pause-overlay .menu-btn-primary').click();
  await expect(page.locator('.pause-overlay')).toBeHidden();
});

test('hood camera tracks the player vehicle without lag', async ({ page }) => {
  await boot(page);
  await page.locator('.menu-panel .menu-btn').first().click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.keyboard.press('c');
  await page.waitForTimeout(200);
  const hoodFov = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      camera: { fov: number };
    };
    return game.camera.fov;
  });
  expect(hoodFov).toBeGreaterThan(80);
  await page.keyboard.down('w');
  await page.waitForTimeout(600);
  const error = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      cameraMode: string;
      camera: { position: { x: number; y: number; z: number } };
      player: { x: number; z: number; heading: number };
    };
    if (game.cameraMode !== 'hood') return 999;
    const fx = Math.sin(game.player.heading);
    const fz = Math.cos(game.player.heading);
    const rx = fz;
    const rz = -fx;
    return Math.hypot(
      game.camera.position.x - (game.player.x + fx * 0.08 + rx * -0.34),
      game.camera.position.z - (game.player.z + fz * 0.08 + rz * -0.34),
    );
  });
  await page.keyboard.up('w');
  expect(error).toBeLessThan(0.05);
});

test('traffic signals have poles connected to the ground', async ({ page }) => {
  await boot(page);
  const poles = await page.evaluate(() => {
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
    let count = 0;
    let minY = Infinity;
    let maxY = -Infinity;
    game.city.group.traverse((obj) => {
      if (obj.name !== 'signal-poles' || !obj.isInstancedMesh || !obj.count) return;
      count += obj.count;
      obj.geometry?.computeBoundingBox?.();
      const bb = obj.geometry?.boundingBox;
      const y = obj.instanceMatrix?.array?.[13] ?? 0;
      if (bb) {
        minY = Math.min(minY, bb.min.y + y);
        maxY = Math.max(maxY, bb.max.y + y);
      }
    });
    return { count, minY, maxY };
  });
  expect(poles.count).toBeGreaterThan(0);
  expect(poles.minY).toBeGreaterThanOrEqual(-0.05);
  expect(poles.maxY).toBeGreaterThan(4.5);
});

test('traffic signal heads show red, yellow and green lamps', async ({ page }) => {
  await boot(page);
  const lamps = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      city: {
        group: {
          traverse: (fn: (obj: {
            name?: string;
            isInstancedMesh?: boolean;
            count?: number;
          }) => void) => void;
        };
      };
    };
    const counts: Record<string, number> = {};
    game.city.group.traverse((obj) => {
      if (!obj.isInstancedMesh || !obj.name) return;
      if (/^signal-(red|yellow|green)-lamps$/.test(obj.name)) {
        counts[obj.name] = (counts[obj.name] ?? 0) + (obj.count ?? 0);
      }
    });
    return counts;
  });
  expect(lamps['signal-red-lamps']).toBeGreaterThan(0);
  expect(lamps['signal-yellow-lamps']).toBeGreaterThan(0);
  expect(lamps['signal-green-lamps']).toBeGreaterThan(0);
});

test('automatic transmission shifts at redline and HUD shows tachometer', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '自由漫游' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#hud-rpm')).toBeVisible();
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
  const rpmText = await page.locator('#hud-rpm').textContent();
  expect(Number(rpmText)).toBeGreaterThan(0);
});

test('distant city chunks are culled by render distance', async ({ page }) => {
  await boot(page);
  await page.locator('.menu-panel .menu-btn').first().click();
  await expect(page.locator('#hud')).toBeVisible();
  const visibleAtCenter = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      city: { chunks: Array<{ visible: boolean }> };
    };
    return game.city.chunks.filter((chunk) => chunk.visible).length;
  });
  await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      debug: { teleport: (x: number, z: number) => void };
    };
    game.debug.teleport(20, 20);
  });
  await page.waitForTimeout(300);
  const visibleAtCorner = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      city: { chunks: Array<{ visible: boolean }> };
    };
    return game.city.chunks.filter((chunk) => chunk.visible).length;
  });
  expect(visibleAtCenter).toBeGreaterThan(visibleAtCorner);
});

test('vehicle model is coherent and steering softens with speed', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '车库' }).click();
  const model = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      showcase: {
        visuals: {
          group: {
            children: Array<{
              geometry?: { boundingBox?: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } };
              material?: { emissiveIntensity?: number };
              position: { x: number; y: number; z: number };
            }>;
          };
        };
      };
    };
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let headlightZ = -Infinity;
    let taillightZ = Infinity;
    for (const child of game.showcase.visuals.group.children) {
      if (!child.geometry) continue;
      child.geometry.computeBoundingBox();
      const bb = child.geometry.boundingBox;
      if (!bb) continue;
      minX = Math.min(minX, child.position.x + bb.min.x);
      minY = Math.min(minY, child.position.y + bb.min.y);
      minZ = Math.min(minZ, child.position.z + bb.min.z);
      maxX = Math.max(maxX, child.position.x + bb.max.x);
      maxY = Math.max(maxY, child.position.y + bb.max.y);
      maxZ = Math.max(maxZ, child.position.z + bb.max.z);
      const z = child.position.z + (bb.min.z + bb.max.z) / 2;
      const intensity = child.material?.emissiveIntensity ?? 0;
      if (intensity >= 0.8 && z > 0) headlightZ = Math.max(headlightZ, z);
      if (intensity >= 0.8 && z < 0) taillightZ = Math.min(taillightZ, z);
    }
    return {
      length: maxZ - minZ,
      width: maxX - minX,
      height: maxY - minY,
      headlightZ,
      taillightZ,
    };
  });
  expect(model.width).toBeGreaterThan(1.7);
  expect(model.length).toBeGreaterThan(4);
  expect(model.height).toBeGreaterThan(1.1);
  expect(model.headlightZ).toBeGreaterThan(model.taillightZ);

  await page.getByRole('button', { name: '使用此车辆' }).click();
  await page.getByRole('button', { name: '自由漫游' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.keyboard.down('d');
  await page.waitForTimeout(300);
  const lowSpeedSteer = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      player: { steerAngle: number };
    };
    return Math.abs(game.player.steerAngle);
  });
  await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      player: { speed: number; lateral: number };
    };
    game.player.speed = 30;
    game.player.lateral = 0;
  });
  await page.waitForTimeout(300);
  const highSpeedSteer = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      player: { steerAngle: number };
    };
    return Math.abs(game.player.steerAngle);
  });
  await page.keyboard.up('d');
  expect(lowSpeedSteer).toBeGreaterThan(0);
  expect(lowSpeedSteer).toBeLessThanOrEqual(0.34);
  expect(highSpeedSteer).toBeLessThan(lowSpeedSteer - 0.03);
});

test('garage selection persists to localStorage', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '车库' }).click();
  await page.locator('[data-vehicle-id="coupe"]').click();
  await expect(page.locator('#garage-name')).toHaveText('运动轿跑');
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

test('garage shows a thumbnail of the selected vehicle', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '车库' }).click();
  const thumb = page.locator('#garage-thumb');
  await expect(thumb).toBeVisible();
  const firstSrc = await thumb.getAttribute('src');
  expect(firstSrc).toMatch(/^data:image\/png/);

  await page.locator('[data-vehicle-id="coupe"]').click();
  await expect(page.locator('#garage-name')).toHaveText('运动轿跑');
  const secondSrc = await thumb.getAttribute('src');
  expect(secondSrc).toBeTruthy();
  expect(secondSrc).not.toBe(firstSrc);
});

test('garage arrows cycle vehicles with a smooth transition', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '车库' }).click();
  await expect(page.locator('#garage-name')).toHaveText('城市轿车');

  await page.getByRole('button', { name: '下一辆' }).click();
  await expect(page.locator('#garage-name')).toHaveText('运动轿跑');
  await page.getByRole('button', { name: '下一辆' }).click();
  await expect(page.locator('#garage-name')).toHaveText('越野 SUV');
  await page.getByRole('button', { name: '上一辆' }).click();
  await expect(page.locator('#garage-name')).toHaveText('运动轿跑');
  await expect(page.locator('.garage-thumb-wrap')).not.toHaveClass(/garage-switching/, {
    timeout: 2000,
  });
});

test('control mode choice controls joystick visibility', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '设置' }).click();
  await page.locator('.settings-overlay').getByRole('button', { name: '电脑操控' }).click();
  await page.locator('.settings-overlay').getByRole('button', { name: '返回主菜单' }).click();
  await page.getByRole('button', { name: '自由漫游' }).click();
  await expect(page.locator('.touch-controls')).toBeHidden();

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '返回主菜单' }).click();
  await page.getByRole('button', { name: '设置' }).click();
  await page.locator('.settings-overlay').getByRole('button', { name: '手机操控' }).click();
  await page.locator('.settings-overlay').getByRole('button', { name: '返回主菜单' }).click();
  await page.getByRole('button', { name: '自由漫游' }).click();
  await expect(page.locator('.touch-controls')).toBeVisible();
});

test('settings screen exposes sound, control mode and density controls', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.locator('.settings-overlay')).toBeVisible();
  await expect(page.locator('.settings-overlay')).toContainText('声音');
  await expect(page.locator('.settings-overlay')).toContainText('操控方式');
  await expect(page.locator('.settings-overlay')).toContainText('交通密度');
  await page.locator('.settings-overlay').getByRole('button', { name: '手机操控' }).click();
  await expect(page.locator('.settings-overlay [data-control-mode="mobile"]')).toHaveClass(/active/);
  await page.locator('.settings-overlay').getByRole('button', { name: '返回主菜单' }).click();
  await expect(page.locator('.menu-hero-overlay')).toBeVisible();
});

test.skip('mobile joystick steer direction matches screen left/right', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const state = (window as unknown as { __GAME_STATE__?: unknown }).__GAME_STATE__ as unknown as {
      settings: { controlMode: string };
    };
    state.settings.controlMode = 'mobile';
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      startFreeRoam: () => void;
    };
    game.startFreeRoam();
  });
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('.joystick-base')).toBeVisible();

  const heading = async (): Promise<number> => {
    const state = await page.evaluate(() => {
      const g = window as unknown as GameWindow;
      return JSON.parse(g.render_game_to_text()) as { player: { heading: number } };
    });
    return state.player.heading;
  };

  const box = await page.locator('.joystick-base').boundingBox();
  if (!box) throw new Error('joystick base missing');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  const cruise = async (): Promise<void> => {
    await page.evaluate(() => {
      const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
        player: { speed: number; lateral: number };
      };
      game.player.speed = 28;
      game.player.lateral = 0;
    });
  };

  await cruise();
  const before = await heading();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 36, cy, { steps: 6 });
  await page.waitForTimeout(450);
  await page.mouse.up();
  const afterRight = await heading();

  await cruise();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 36, cy, { steps: 6 });
  await page.waitForTimeout(450);
  await page.mouse.up();
  const afterLeft = await heading();

  expect(afterRight).toBeLessThan(before);
  expect(afterLeft).toBeGreaterThan(afterRight);
});

test('race countdown, debug lap/finish and restart', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '竞速模式' }).click();
  await page.getByRole('button', { name: '开始比赛' }).click();
  await expect(page.locator('.countdown-overlay')).toBeVisible();
  await expect(page.locator('.countdown-overlay')).toContainText('3');

  await page.waitForFunction(() => {
    const g = window as unknown as GameWindow;
    return g.__GAME_STATE__.race.phase === 'racing';
  }, { timeout: 15000 });

  await page.keyboard.down('w');
  await page.waitForTimeout(700);
  await page.keyboard.up('w');
  await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    g.__GAME__.debug.nextLap();
    g.__GAME__.debug.finishRace();
  });
  await expect(page.locator('#result-title')).toBeVisible();
  await expect(page.locator('#result-title')).toContainText('名');

  for (let i = 0; i < 1; i += 1) {
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
  }
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

test.skip('mobile layout has no overflow and touch controls', async ({ page }) => {
  await boot(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: '手机操控' }).click();
  await page.getByRole('button', { name: '自由漫游' }).click();
  await expect(page.locator('.touch-controls')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'test-results/mobile-free-roam.png' });
});

test('free roam spawns pedestrians that fall and vanish after being hit', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '自由漫游' }).click();
  await expect(page.locator('#hud')).toBeVisible();

  await page.waitForFunction(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      pedestrians?: { pedestrians?: unknown[] };
    };
    return (game.pedestrians?.pedestrians?.length ?? 0) > 0;
  }, { timeout: 15000 });

  await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      pedestrians: { pedestrians: Array<{ x: number; z: number; state: string }> };
      player: { x: number; z: number; speed: number; lateral: number };
    };
    const target = game.pedestrians.pedestrians[0];
    game.player.x = target.x;
    game.player.z = target.z;
    game.player.speed = 0;
    game.player.lateral = 0;
  });

  await page.waitForFunction(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      pedestrians: { pedestrians: Array<{ state: string }> };
    };
    return game.pedestrians.pedestrians.some((ped) => ped.state === 'down');
  }, { timeout: 3000 });

  await page.waitForFunction(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      pedestrians: { pedestrians: Array<{ state: string }> };
    };
    return game.pedestrians.pedestrians.every((ped) => ped.state !== 'down');
  }, { timeout: 7000 });
});
