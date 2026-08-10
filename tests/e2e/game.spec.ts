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
  await page.waitForFunction(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      cameraMode: string;
    };
    return game.cameraMode === 'hood';
  }, { timeout: 5000 });
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

test('drift pose rotates the model without changing driving physics', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '自由漫游' }).click();
  const result = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      player: {
        speed: number;
        lateral: number;
        heading: number;
        visuals: { group: { rotation: { y: number } } };
        getDriftPose: () => number;
        update: (dt: number, input: {
          throttle: number;
          brake: number;
          steer: number;
          handbrake: boolean;
        }) => void;
      };
      city: {
        group: {
          traverse: (fn: (obj: { name?: string }) => void) => void;
        };
      };
    };
    const names = new Set<string>();
    game.city.group.traverse((obj) => {
      if (obj.name) names.add(obj.name);
    });
    const player = game.player;
    player.speed = 18;
    player.lateral = 0;
    player.heading = 0;
    player.update(0.06, { throttle: 0, brake: 0, steer: 1, handbrake: true });
    const pose = player.getDriftPose();
    const driftDiff = Math.abs(player.visuals.group.rotation.y - player.heading);
    const driftRotDelta = player.visuals.group.rotation.y - player.heading;
    const headingAfter = player.heading;
    player.update(0.06, { throttle: 0, brake: 0, steer: 1, handbrake: false });
    const poseAfterRelease = player.getDriftPose();
    player.update(0.06, { throttle: 0, brake: 0, steer: 0, handbrake: false });
    const poseAfterStraight = player.getDriftPose();
    return {
      names: [...names],
      pose,
      driftDiff,
      driftRotDelta,
      headingAfter,
      poseAfterRelease,
      poseAfterStraight,
    };
  });
  expect(result.pose).toBeGreaterThan(0.3);
  expect(result.driftDiff).toBeGreaterThan(0.2);
  expect(result.driftRotDelta).toBeGreaterThan(0.2);
  expect(result.headingAfter).toBeLessThan(0.3);
  expect(result.poseAfterRelease).toBeGreaterThan(0.5);
  expect(result.poseAfterStraight).toBeLessThan(result.poseAfterRelease);
  expect(result.names).toEqual(
    expect.arrayContaining([
      'river',
      'bridge',
      'village',
      'highway-shoulder',
      'alley',
      'hill',
    ]),
  );
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

test('npc vehicles turn smoothly through intersections', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '自由漫游' }).click();
  await page.waitForFunction(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      traffic: { npcs: unknown[] };
    };
    return game.traffic.npcs.length > 0;
  }, { timeout: 15000 });
  const setup = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      traffic: {
        npcs: Array<{
          t: number;
          speed: number;
          turnProgress: number;
          vehicle: { heading: number; x: number; z: number };
        }>;
        advanceThroughIntersection: (npc: unknown) => void;
      };
      player: { x: number; z: number };
    };
    const player = game.player;
    const npc = game.traffic.npcs
      .slice()
      .sort(
        (a, b) =>
          Math.hypot(a.vehicle.x - player.x, a.vehicle.z - player.z) -
          Math.hypot(b.vehicle.x - player.x, b.vehicle.z - player.z),
      )[0];
    npc.speed = 10;
    npc.t = 1;
    game.traffic.advanceThroughIntersection(npc);
    const turning = npc.turnProgress >= 0;
    const before = {
      heading: npc.vehicle.heading,
      x: npc.vehicle.x,
      z: npc.vehicle.z,
    };
    return { turning, before };
  });
  await page.waitForFunction(
    ({ x, z }: { x: number; z: number }) => {
      const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
        traffic: {
          npcs: Array<{ vehicle: { x: number; z: number } }>;
        };
      };
      const npc = game.traffic.npcs[0];
      return npc && Math.hypot(npc.vehicle.x - x, npc.vehicle.z - z) > 0.5;
    },
    { x: setup.before.x, z: setup.before.z },
    { timeout: 5000 },
  );
  const result = await page.evaluate(({ before }) => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      traffic: {
        npcs: Array<{ vehicle: { heading: number; x: number; z: number } }>;
      };
    };
    const npc = game.traffic.npcs[0];
    const after = {
      heading: npc.vehicle.heading,
      x: npc.vehicle.x,
      z: npc.vehicle.z,
    };
    return {
      headingDelta: Math.abs(after.heading - before.heading),
      moved: Math.hypot(after.x - before.x, after.z - before.z),
    };
  }, { before: setup.before });
  expect(setup.turning).toBe(true);
  expect(result.headingDelta).toBeLessThan(1.2);
  expect(result.moved).toBeGreaterThan(0.5);
  expect(result.moved).toBeLessThan(20);
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
  expect(accel.peak).toBeGreaterThan(11);
});

test('garage thumbnail, arrows and selection persist', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '车库' }).click();
  const thumb = page.locator('#garage-thumb');
  await expect(thumb).toBeVisible();
  const firstSrc = await thumb.getAttribute('src');
  expect(firstSrc).toMatch(/^data:image\/png/);
  const wrap = page.locator('.garage-thumb-wrap');
  const sizeBefore = await wrap.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });

  await page.getByRole('button', { name: '下一辆' }).click();
  await expect(page.locator('#garage-name')).toHaveText('运动轿跑');
  const secondSrc = await thumb.getAttribute('src');
  expect(secondSrc).not.toBe(firstSrc);
  await expect(wrap).toHaveClass(/garage-switching-right/);
  await page.waitForTimeout(350);
  await expect(wrap).not.toHaveClass(/garage-switching/);
  const sizeAfter = await wrap.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  expect(sizeAfter.width).toBeCloseTo(sizeBefore.width, 1);
  expect(sizeAfter.height).toBeCloseTo(sizeBefore.height, 1);

  await page.locator('.garage-arrow-left').click();
  await expect(wrap).toHaveClass(/garage-switching-left/);
  await page.locator('.garage-arrow-right').click();
  expect(await thumb.getAttribute('src')).toBe(secondSrc);

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

test('river has a sunken bed with animated water', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      city: {
        group: {
          traverse: (fn: (obj: {
            name?: string;
            position?: { y: number };
            material?: { opacity: number };
          }) => void) => void;
        };
        updateWater: (timeSec: number) => void;
      };
    };
    let riverY = 0;
    let bedY = 0;
    let opacityA = 0;
    let opacityB = 0;
    game.city.group.traverse((obj) => {
      if (obj.name === 'river') {
        riverY = obj.position?.y ?? 0;
        opacityA = obj.material?.opacity ?? 0;
      }
      if (obj.name === 'riverbed') bedY = obj.position?.y ?? 0;
    });
    game.city.updateWater(0);
    game.city.group.traverse((obj) => {
      if (obj.name === 'river') opacityB = obj.material?.opacity ?? 0;
    });
    return { riverY, bedY, opacityA, opacityB };
  });
  expect(result.bedY).toBeLessThan(-0.2);
  expect(result.riverY).toBeGreaterThan(result.bedY);
  expect(result.opacityB).not.toBe(result.opacityA);
});

test('settings screen and mobile camera button work', async ({ page }) => {
  await boot(page);
  expect(
    await page
      .locator('.menu-btn-lg')
      .first()
      .evaluate((el) => getComputedStyle(el).userSelect),
  ).toBe('none');
  await page.getByRole('button', { name: '设置' }).click();
  await expect(page.locator('.settings-overlay')).toContainText('声音');
  await expect(page.locator('.settings-overlay')).toContainText('操控方式');
  await expect(page.locator('#settings-bgm-volume')).toBeVisible();
  await page.locator('#settings-bgm-volume').fill('0.35');
  const bgmVolume = await page.evaluate(() => {
    const state = (window as unknown as { __GAME_STATE__?: unknown }).__GAME_STATE__ as unknown as {
      settings: { bgmVolume: number };
    };
    return state.settings.bgmVolume;
  });
  expect(bgmVolume).toBeCloseTo(0.35, 2);
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
  expect(fps).toBeGreaterThan(12);
  const adaptive = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      renderScale: number;
      renderer: { getPixelRatio: () => number };
    };
    return {
      scale: game.renderScale,
      pixelRatio: game.renderer.getPixelRatio(),
    };
  });
  expect(adaptive.scale).toBeGreaterThanOrEqual(0.5);
  expect(adaptive.scale).toBeLessThanOrEqual(1);
  expect(adaptive.pixelRatio).toBeGreaterThan(0);
});

test('mobile touch controls accept simultaneous pointers', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '设置' }).click();
  await page.locator('.settings-overlay [data-control-mode="mobile"]').click();
  await page.locator('.settings-overlay .menu-btn-secondary').click();
  await page.locator('.menu-hero .menu-btn-lg').first().click();
  await expect(page.locator('.touch-controls')).toBeVisible();

  const rects = await page.evaluate(() => {
    const base = document.querySelector('.joystick-base') as HTMLElement | null;
    const throttle = document.querySelector('.pedal-throttle') as HTMLElement | null;
    if (!base || !throttle) throw new Error('touch controls missing');
    const b = base.getBoundingClientRect();
    const t = throttle.getBoundingClientRect();
    return {
      bx: b.left + b.width / 2,
      by: b.top + b.height / 2,
      tx: t.left + t.width / 2,
      ty: t.top + t.height / 2,
    };
  });

  await page.evaluate(({ bx, by, tx, ty }) => {
    const base = document.querySelector('.joystick-base') as HTMLElement;
    const throttle = document.querySelector('.pedal-throttle') as HTMLElement;
    const baseOpts: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      pointerType: 'touch',
      clientX: bx + 30,
      clientY: by,
    };
    base.dispatchEvent(new PointerEvent('pointerdown', baseOpts));
    base.dispatchEvent(new PointerEvent('pointermove', baseOpts));
    throttle.dispatchEvent(
      new PointerEvent('pointerdown', {
        ...baseOpts,
        pointerId: 2,
        isPrimary: false,
        clientX: tx,
        clientY: ty,
      }),
    );
  }, rects);

  await page.waitForTimeout(300);
  const state = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      input: { moveX: number; moveZ: number };
    };
    return { moveX: game.input.moveX, moveZ: game.input.moveZ };
  });
  expect(state.moveX).toBeLessThan(-0.2);
  expect(state.moveZ).toBeGreaterThan(0.9);

  await page.evaluate(({ bx, by, tx, ty }) => {
    const base = document.querySelector('.joystick-base') as HTMLElement;
    const throttle = document.querySelector('.pedal-throttle') as HTMLElement;
    base.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 1,
        pointerType: 'touch',
        clientX: bx + 30,
        clientY: by,
      }),
    );
    throttle.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        pointerId: 2,
        pointerType: 'touch',
        clientX: tx,
        clientY: ty,
      }),
    );
  }, rects);
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      input: { moveX: number; moveZ: number };
    };
    return { moveX: game.input.moveX, moveZ: game.input.moveZ };
  });
  expect(after.moveX).toBe(0);
  expect(after.moveZ).toBe(0);
});

test('map splits into rectangular zones and sun lights from an offset', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      city: {
        bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
        group: { traverse: (fn: (obj: unknown) => void) => void };
      };
      sun: { position: { x: number; y: number; z: number } };
      sky: { material?: { map?: { image?: HTMLCanvasElement } } };
      renderer: { shadowMap: { type: number } };
    };
    let maxBuildingX = -Infinity;
    let hillCount = 0;
    let villageHouses = 0;
    let boundaryWalls = 0;
    let hillsInside = true;
    let buildingsCastShadow = false;
    let skyCanvas: HTMLCanvasElement | null = null;
    game.city.group.traverse((raw) => {
      const obj = raw as {
        name?: string;
        isInstancedMesh?: boolean;
        count?: number;
        castShadow?: boolean;
        instanceMatrix?: { array: Float32Array };
        position?: { x: number; z: number };
        material?: { map?: { image?: HTMLCanvasElement } };
      };
      if (obj.name === 'buildings' && obj.isInstancedMesh && obj.instanceMatrix) {
        if (obj.castShadow === true) buildingsCastShadow = true;
        const arr = obj.instanceMatrix.array;
        for (let i = 0; i < (obj.count ?? 0); i += 1) {
          const tx = arr[i * 16 + 12];
          const sx = Math.abs(arr[i * 16]);
          maxBuildingX = Math.max(maxBuildingX, tx + sx / 2);
        }
      }
      if (obj.name === 'hill' && obj.position) {
        hillCount += 1;
        if (obj.position.x < 660 || obj.position.x > 905) hillsInside = false;
      }
      if (obj.name === 'village-house') villageHouses += 1;
      if (obj.name === 'boundary-wall') boundaryWalls += 1;
    });
    skyCanvas = game.sky.material?.map?.image ?? null;
    const sun = game.sun.position;
    const shadowType = game.renderer.shadowMap.type;
    const shadowSize = (game.sun as unknown as { shadow: { mapSize: { width: number } } }).shadow.mapSize.width;
    const elevation = Math.atan2(sun.y, Math.hypot(sun.x, sun.z));
    const azimuth = Math.atan2(sun.z, sun.x);
    let sunBright = false;
    if (skyCanvas) {
      const ctx = skyCanvas.getContext('2d');
      const d = {
        x: Math.cos((143 * Math.PI) / 180) * Math.cos((32 * Math.PI) / 180),
        y: Math.sin((32 * Math.PI) / 180),
        z: Math.sin((143 * Math.PI) / 180) * Math.cos((32 * Math.PI) / 180),
      };
      let u = Math.atan2(d.z, -d.x) / (Math.PI * 2);
      u = (u + 1) % 1;
      const v = Math.acos(d.y) / Math.PI;
      const pixel = ctx?.getImageData(Math.floor(u * 1024), Math.floor(v * 512), 1, 1).data;
      if (pixel) sunBright = (pixel[0] + pixel[1] + pixel[2]) / 3 > 180;
    }
    return {
      bounds: game.city.bounds,
      maxBuildingX,
      hillCount,
      villageHouses,
      boundaryWalls,
      hillsInside,
      buildingsCastShadow,
      elevation,
      azimuth,
      sunBright,
      shadowType,
      shadowSize,
    };
  });

  expect(result.bounds).toEqual({ minX: 0, maxX: 1200, minZ: 0, maxZ: 1200 });
  expect(result.maxBuildingX).toBeLessThanOrEqual(601);
  expect(result.hillCount).toBeGreaterThan(6);
  expect(result.hillsInside).toBe(true);
  expect(result.buildingsCastShadow).toBe(true);
  expect(result.villageHouses).toBeGreaterThan(10);
  expect(result.boundaryWalls).toBe(1);
  expect(result.elevation).toBeGreaterThan(0.4);
  expect(result.elevation).toBeLessThan(1.1);
  expect(result.azimuth).not.toBeCloseTo(0, 1);
  expect(result.sunBright).toBe(true);
  expect(result.shadowType).toBe(1);
  expect(result.shadowSize).toBeGreaterThanOrEqual(0);
});

test('endless mode streams chunks past the old finite boundary', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '无尽模式' }).click();
  await expect(page.locator('#hud')).toBeVisible();

  await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      debug: { teleport: (x: number, z: number) => void };
    };
    game.debug.teleport(950, 450);
  });
  await page.waitForTimeout(400);

  const result = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      city: {
        chunks: unknown[];
        bounds: { minX: number; maxX: number };
        group: { traverse: (fn: (obj: { name?: string }) => void) => void };
      };
    };
    const state = (window as unknown as { __GAME_STATE__?: unknown }).__GAME_STATE__ as unknown as {
      mode: string;
    };
    let riverCount = 0;
    let bridgeCount = 0;
    let wallCount = 0;
    let buildingChunkCount = 0;
    game.city.group.traverse((obj) => {
      if (obj.name === 'river') riverCount += 1;
      if (obj.name === 'bridge') bridgeCount += 1;
      if (obj.name === 'boundary-wall') wallCount += 1;
      if (obj.name === 'endless-buildings' && obj.isInstancedMesh) {
        buildingChunkCount += 1;
      }
    });
    return {
      mode: state.mode,
      chunks: game.city.chunks.length,
      riverCount,
      bridgeCount,
      wallCount,
      buildingChunkCount,
      maxX: game.city.bounds.maxX,
    };
  });

  expect(result.mode).toBe('endless');
  expect(result.chunks).toBeGreaterThanOrEqual(25);
  expect(result.riverCount).toBeGreaterThan(0);
  expect(result.bridgeCount).toBeGreaterThan(8);
  expect(result.wallCount).toBe(0);
  expect(result.buildingChunkCount).toBeGreaterThan(0);
  expect(result.maxX).toBeGreaterThan(100000);
});

test('quality presets switch renderer, shadows and composer', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '设置' }).click();
  await page.getByRole('button', { name: '高' }).click();
  const high = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      renderer: { shadowMap: { enabled: boolean; type: number } };
      composer: unknown;
    };
    const state = (window as unknown as { __GAME_STATE__?: unknown }).__GAME_STATE__ as unknown as {
      settings: { quality: string };
    };
    return {
      quality: state.settings.quality,
      shadows: game.renderer.shadowMap.enabled,
      shadowType: game.renderer.shadowMap.type,
      composer: game.composer !== null,
    };
  });
  expect(high.quality).toBe('high');
  expect(high.shadows).toBe(true);
  expect(high.shadowType).toBe(2);
  expect(high.composer).toBe(true);

  await page.getByRole('button', { name: '低' }).click();
  const low = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      renderer: { shadowMap: { enabled: boolean } };
      composer: unknown;
    };
    const state = (window as unknown as { __GAME_STATE__?: unknown }).__GAME_STATE__ as unknown as {
      settings: { quality: string };
    };
    return {
      quality: state.settings.quality,
      shadows: game.renderer.shadowMap.enabled,
      composer: game.composer !== null,
    };
  });
  expect(low.quality).toBe('low');
  expect(low.shadows).toBe(false);
  expect(low.composer).toBe(false);
});

test('multiplayer lobby, room creation, join and start work across two clients', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await context.newPage();
  const guest = await context.newPage();

  async function bootMultiplayer(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/');
    await page.waitForFunction(() => (window as unknown as { __GAME__?: unknown }).__GAME__ !== undefined);
    await page.getByRole('button', { name: '多人游戏' }).click();
    await page.waitForFunction(() => {
      const state = (window as unknown as { __GAME_STATE__?: unknown }).__GAME_STATE__ as unknown as {
        multiplayer: { connected: boolean; username: string };
      };
      return state.multiplayer.connected && state.multiplayer.username.length > 0;
    }, { timeout: 15000 });
  }

  await bootMultiplayer(host);
  await host.locator('#multiplayer-room-name').fill('联机测试房');
  await host.getByRole('button', { name: '创建房间' }).click();
  await expect(host.locator('.lobby-overlay')).toBeVisible();
  await expect(host.locator('#lobby-start')).toBeVisible();

  await bootMultiplayer(guest);
  await expect(guest.locator('.room-card')).toContainText('联机测试房');
  await guest.locator('.room-card').getByRole('button', { name: '加入' }).click();
  await expect(guest.locator('.lobby-overlay')).toBeVisible();

  await host.locator('#lobby-start').click();
  await expect(host.locator('#hud')).toBeVisible();
  await expect(guest.locator('#hud')).toBeVisible();

  await host.waitForFunction(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      remoteVehicles: { size: number };
    };
    return game.remoteVehicles.size > 0;
  }, { timeout: 15000 });

  await context.close();
});
