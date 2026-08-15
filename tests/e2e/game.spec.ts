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
    pedestrianKills: number;
    coins: number;
    addPedestrianKill: () => void;
    addCoins: (amount: number) => void;
    checkIn: () => { streak: number; reward: number; ok: boolean };
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
  await page.waitForFunction(
    ({ x, z }: { x: number; z: number }) => {
      const g = window as unknown as GameWindow;
      const state = JSON.parse(g.render_game_to_text()) as {
        player: { x: number; z: number };
      };
      return (
        Math.abs(state.player.x - x) + Math.abs(state.player.z - z) > 2
      );
    },
    { x: before.player.x, z: before.player.z },
    { timeout: 8000 },
  );
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

test('pedestrian kill counter and titles update in HUD and pause menu', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '自由漫游' }).click();
  await expect(page.locator('#hud')).toBeVisible();

  await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    for (let i = 0; i < 10; i += 1) g.__GAME_STATE__.addPedestrianKill();
  });

  await expect(page.locator('#hud-kills')).toHaveText('10');
  await expect(page.locator('#hud-next-title')).toContainText('街头猎手');
  await expect(page.locator('#hud-next-title')).toContainText('10');

  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-overlay')).toBeVisible();
  const rookie = page.locator('.title-item[data-title="rookie"]');
  const hunter = page.locator('.title-item[data-title="street-hunter"]');
  await expect(rookie).toHaveClass(/title-item unlocked/);
  await expect(rookie.locator('.title-cond')).toHaveText('已解锁');
  await expect(rookie.locator('.title-name')).toHaveCSS('color', 'rgb(140, 233, 154)');
  await expect(hunter).toHaveClass(/title-item locked/);
  await expect(hunter.locator('.title-cond')).toHaveText('10/20');
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
    return { turning, before, id: npc.vehicle.visuals.group.uuid };
  });
  await page.waitForFunction(
    ({ x, z, id }: { x: number; z: number; id: string }) => {
      const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
        traffic: {
          npcs: Array<{
            vehicle: { x: number; z: number; visuals: { group: { uuid: string } } };
          }>;
        };
      };
      const npc = game.traffic.npcs.find(
        (item) => item.vehicle.visuals.group.uuid === id,
      );
      return npc && Math.hypot(npc.vehicle.x - x, npc.vehicle.z - z) > 0.5;
    },
    { x: setup.before.x, z: setup.before.z, id: setup.id },
    { timeout: 10000 },
  );
  const result = await page.evaluate(({ before, id }) => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      traffic: {
        npcs: Array<{
          vehicle: { heading: number; x: number; z: number; visuals: { group: { uuid: string } } };
        }>;
      };
    };
    const npc = game.traffic.npcs.find(
      (item) => item.vehicle.visuals.group.uuid === id,
    );
    if (!npc) throw new Error('tracked NPC disappeared');
    const after = {
      heading: npc.vehicle.heading,
      x: npc.vehicle.x,
      z: npc.vehicle.z,
    };
    return {
      headingDelta: Math.abs(after.heading - before.heading),
      moved: Math.hypot(after.x - before.x, after.z - before.z),
    };
  }, { before: setup.before, id: setup.id });
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

test('garage thumbnail, arrows, purchase and selection persist', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    g.__GAME_STATE__.addCoins(10000);
  });
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
  await expect(page.locator('#garage-name')).toHaveText('运动轿跑（未解锁）');
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

  await page.getByRole('button', { name: /购买并装备/ }).click();
  await expect(page.getByText('城市驾驶模拟')).toBeVisible();
  const saved = await page.evaluate(() => localStorage.getItem('fenza-road-save-v1'));
  expect(saved).toContain('"selectedVehicleId":"coupe"');
  expect(saved).toContain('"ownedVehicleIds"');
  expect(saved).toContain('"coupe"');

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

test('one-lap race does not finish at the first checkpoint', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '竞速模式' }).click();
  await page.evaluate(() => {
    const g = window as unknown as {
      __GAME_STATE__: { race: { totalLaps: number } };
    };
    g.__GAME_STATE__.race.totalLaps = 1;
  });
  await page.getByRole('button', { name: '开始比赛' }).click();
  await page.waitForFunction(() => {
    const g = window as unknown as GameWindow;
    return g.__GAME_STATE__.race.phase === 'racing';
  }, undefined, { timeout: 15000 });
  await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      player: { x: number; z: number; heading: number; speed: number };
    };
    game.player.x = 1200;
    game.player.z = 650;
    game.player.heading = 0;
    game.player.speed = 25;
  });
  await page.waitForFunction(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      player: { z: number };
    };
    return game.player.z > 610;
  }, undefined, { timeout: 5000 });
  const state = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      race: {
        phase: string;
        racers: {
          lap: number;
          checkpoint: number;
          finished: boolean;
        }[];
      };
    };
    const player = game.race.racers[0];
    return {
      phase: game.race.phase,
      lap: player.lap,
      checkpoint: player.checkpoint,
      finished: player.finished,
    };
  });
  expect(state.phase).toBe('racing');
  expect(state.lap).toBe(0);
  expect(state.checkpoint).toBe(0);
  expect(state.finished).toBe(false);
});

test('race menu selects opponents and laps before starting', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '竞速模式' }).click();
  await expect(page.locator('#race-opponents')).toHaveText('3 名');
  await expect(page.locator('#race-laps')).toHaveText('3 圈');
  await page.locator('[data-race-opponents="inc"]').click();
  await page.locator('[data-race-opponents="inc"]').click();
  await page.locator('[data-race-opponents="inc"]').click();
  await page.locator('[data-race-opponents="inc"]').click();
  await page.locator('[data-race-laps="inc"]').click();
  await page.locator('[data-race-laps="inc"]').click();
  await expect(page.locator('#race-opponents')).toHaveText('7 名');
  await expect(page.locator('#race-laps')).toHaveText('5 圈');
  await page.getByRole('button', { name: '开始比赛' }).click();
  await expect(page.locator('#hud-lap')).toHaveText('0/5');
  const state = await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      race: { racers: unknown[]; totalLaps: number };
    };
    return {
      totalRacers: g.__GAME_STATE__.race.totalRacers,
      totalLaps: g.__GAME_STATE__.race.totalLaps,
      racers: game.race.racers.length,
      raceTotalLaps: game.race.totalLaps,
    };
  });
  expect(state.totalRacers).toBe(8);
  expect(state.totalLaps).toBe(5);
  expect(state.racers).toBe(8);
  expect(state.raceTotalLaps).toBe(5);
});

test('race barriers stay off the perimeter race road', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      city: {
        raceBarriers: {
          minX: number;
          maxX: number;
          minZ: number;
          maxZ: number;
        }[];
        raceLayouts: {
          id: string;
          raceBarrierCircles: { radius: number }[];
        }[];
      };
    };
    const roadRects = [
      { minX: 0, maxX: 1200, minZ: 1192, maxZ: 1208 },
      { minX: 1192, maxX: 1208, minZ: 0, maxZ: 1200 },
      { minX: 0, maxX: 1200, minZ: -8, maxZ: 8 },
      { minX: -8, maxX: 8, minZ: 0, maxZ: 1200 },
    ];
    const overlaps = (
      a: { minX: number; maxX: number; minZ: number; maxZ: number },
      b: { minX: number; maxX: number; minZ: number; maxZ: number },
    ): boolean =>
      a.minX < b.maxX &&
      a.maxX > b.minX &&
      a.minZ < b.maxZ &&
      a.maxZ > b.minZ;
    const blocked = game.city.raceBarriers.filter((barrier) =>
      roadRects.some((road) => overlaps(barrier, road)),
    ).length;
    const perimeter = game.city.raceLayouts.find(
      (layout) => layout.id === 'perimeter',
    );
    return {
      count: game.city.raceBarriers.length,
      blocked,
      circleCount: perimeter?.raceBarrierCircles.length ?? 0,
      maxCircleRadius: Math.max(
        0,
        ...(perimeter?.raceBarrierCircles.map((circle) => circle.radius) ?? []),
      ),
    };
  });
  expect(result.count).toBeGreaterThan(0);
  expect(result.blocked).toBe(0);
  expect(result.circleCount).toBeGreaterThan(0);
  expect(result.maxCircleRadius).toBeLessThan(2.2);
});

test('race menu switches layouts and boundary fence sits outside the map', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await boot(page);
  await page.getByRole('button', { name: '竞速模式' }).click();
  await expect(page.locator('[data-race-layout="cityTour"]')).toBeVisible();
  await page.locator('[data-race-layout="cityTour"]').click();
  await expect(page.locator('[data-race-layout="cityTour"]')).toHaveClass(/active/);
  await page.getByRole('button', { name: '开始比赛' }).click();
  await page.waitForFunction(() => {
    const g = window as unknown as GameWindow;
    return g.__GAME_STATE__.race.phase === 'racing';
  }, undefined, { timeout: 15000 });
  const state = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      city: {
        activeRaceLayoutId: string;
        raceLayouts: {
          id: string;
          checkpoints: { x: number; z: number }[];
          checkpointRadius: number;
          corridorWidth: number;
        }[];
        raceBarriers: unknown[];
        group: {
          traverse: (fn: (obj: unknown) => void) => void;
        };
      };
      race: { checkpoints: unknown[]; racers: unknown[] };
    };
    let wallMinX = Infinity;
    let wallMaxX = -Infinity;
    game.city.group.traverse((raw) => {
      const obj = raw as {
        name?: string;
        geometry?: { attributes?: { position?: { array?: number[] } } };
      };
      if (obj.name === 'boundary-wall') {
        const positions = obj.geometry?.attributes?.position?.array;
        if (positions) {
          for (let i = 0; i < positions.length; i += 3) {
            wallMinX = Math.min(wallMinX, positions[i]);
            wallMaxX = Math.max(wallMaxX, positions[i]);
          }
        }
      }
    });
    return {
      layoutId: game.city.activeRaceLayoutId,
      layoutCount: game.city.raceLayouts.length,
      checkpointCount: game.race.checkpoints.length,
      barrierCount: game.city.raceBarriers.length,
      layoutSettings: game.city.raceLayouts.map((layout) => ({
        id: layout.id,
        checkpointRadius: layout.checkpointRadius,
        corridorWidth: layout.corridorWidth,
      })),
      cityTourCheckpoints: game.city.raceLayouts.find(
        (layout) => layout.id === 'cityTour',
      )?.checkpoints.length,
      interiorCityTour: game.city.raceLayouts
        .find((layout) => layout.id === 'cityTour')
        ?.checkpoints.every(
          (point) => point.x > 140 && point.x < 1060 && point.z > 140 && point.z < 1060,
        ),
      interiorHillLoop: game.city.raceLayouts
        .find((layout) => layout.id === 'hillLoop')
        ?.checkpoints.every(
          (point) => point.x > 140 && point.x < 1060 && point.z > 140 && point.z < 1060,
        ),
      racerCount: game.race.racers.length,
      wallMinX,
      wallMaxX,
    };
  });
  expect(state.layoutId).toBe('cityTour');
  expect(state.layoutCount).toBe(3);
  expect(state.checkpointCount).toBeGreaterThan(10);
  expect(state.checkpointCount).toBeGreaterThan(15);
  expect(state.barrierCount).toBeGreaterThan(0);
  expect(state.layoutSettings).toEqual([
    { id: 'perimeter', checkpointRadius: 22, corridorWidth: 26 },
    { id: 'cityTour', checkpointRadius: 18, corridorWidth: 20 },
    { id: 'hillLoop', checkpointRadius: 26, corridorWidth: 30 },
  ]);
  expect(state.checkpointCount).toBe(state.cityTourCheckpoints);
  expect(state.interiorCityTour).toBe(true);
  expect(state.interiorHillLoop).toBe(true);
  expect(state.racerCount).toBeGreaterThan(1);
  expect(state.wallMinX).toBeLessThan(-10);
  expect(state.wallMaxX).toBeGreaterThan(1210);
  expect(errors).toEqual([]);
});

test('race checkpoints sit on straights instead of turn corners', async ({ page }) => {
  await boot(page);
  const layouts = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      city: {
        raceLayouts: {
          id: string;
          checkpoints: { x: number; z: number }[];
          routePoints: { x: number; z: number }[];
        }[];
      };
    };
    const distToSegment = (
      px: number,
      pz: number,
      ax: number,
      az: number,
      bx: number,
      bz: number,
    ): number => {
      const abx = bx - ax;
      const abz = bz - az;
      const lenSq = abx * abx + abz * abz;
      let t = lenSq > 0 ? ((px - ax) * abx + (pz - az) * abz) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
    };
    return game.city.raceLayouts.map((layout) => {
      const route = layout.routePoints;
      const corners = route.filter((point, i) => {
        const prev = route[(i - 1 + route.length) % route.length];
        const next = route[(i + 1) % route.length];
        const cross =
          (point.x - prev.x) * (next.z - point.z) -
          (point.z - prev.z) * (next.x - point.x);
        return Math.abs(cross) > 1e-3;
      });
      let bad = 0;
      for (const cp of layout.checkpoints) {
        const onRoute = route.some((point, i) => {
          const next = route[(i + 1) % route.length];
          return distToSegment(cp.x, cp.z, point.x, point.z, next.x, next.z) < 1.5;
        });
        const nearCorner = corners.some(
          (corner) => Math.hypot(cp.x - corner.x, cp.z - corner.z) < 25,
        );
        if (!onRoute || nearCorner) bad += 1;
      }
      return { id: layout.id, count: layout.checkpoints.length, bad };
    });
  });
  for (const layout of layouts) {
    expect(layout.count).toBeGreaterThan(0);
    expect(layout.bad).toBe(0);
  }
});

test('race route is highlighted blue on the minimap', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '竞速模式' }).click();
  await page.getByRole('button', { name: '开始比赛' }).click();
  await page.waitForFunction(() => {
    const g = window as unknown as GameWindow;
    return g.__GAME_STATE__.mode === 'race';
  }, undefined, { timeout: 15000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#minimap') as HTMLCanvasElement | null;
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let bluePixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a > 0 && b > 120 && b > r * 1.4 && g > 90) bluePixels += 1;
    }
    return bluePixels > 40;
  }, undefined, { timeout: 15000 });
});

test('race AI opponents follow the route and keep moving', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '竞速模式' }).click();
  await page.getByRole('button', { name: '开始比赛' }).click();
  await page.waitForFunction(() => {
    const g = window as unknown as GameWindow;
    return g.__GAME_STATE__.race.phase === 'racing';
  }, undefined, { timeout: 15000 });
  const before = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      race: { racers: { vehicle: { x: number; z: number } }[] };
    };
    return game.race.racers.slice(1).map((racer) => ({
      x: racer.vehicle.x,
      z: racer.vehicle.z,
    }));
  });
  await page.waitForTimeout(6000);
  const after = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      race: {
        racers: {
          vehicle: { x: number; z: number };
          checkpoint: number;
          lap: number;
          finished: boolean;
        }[];
      };
    };
    return game.race.racers.slice(1).map((racer) => ({
      x: racer.vehicle.x,
      z: racer.vehicle.z,
      checkpoint: racer.checkpoint,
      lap: racer.lap,
      finished: racer.finished,
    }));
  });
  for (let i = 0; i < before.length; i += 1) {
    const moved = Math.hypot(
      after[i].x - before[i].x,
      after[i].z - before[i].z,
    );
    expect(moved).toBeGreaterThan(60);
    expect(after[i].finished).toBe(false);
  }
});

test('boundary collision stops the car at the visible fence', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '自由漫游' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      debug: { teleport: (x: number, z: number) => void };
      player: { groundY: number };
    };
    game.debug.teleport(-100, 450);
    game.player.groundY = 0;
  });
  await page.waitForTimeout(300);
  const pos = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      player: { x: number; z: number };
      city: { boundaryColliders: unknown[] };
    };
    return {
      x: game.player.x,
      z: game.player.z,
      colliders: game.city.boundaryColliders.length,
    };
  });
  expect(pos.colliders).toBe(4);
  expect(pos.x).toBeLessThan(-10);
  expect(pos.x).toBeGreaterThan(-25);
  expect(pos.z).toBeGreaterThan(300);
  expect(pos.z).toBeLessThan(600);
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
  await page.waitForFunction(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      input: { moveX: number; moveZ: number };
    };
    return game.input.moveX === 0 && game.input.moveZ === 0;
  }, { timeout: 3000 });
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
        if (obj.position.x < 905 || obj.position.x > 1195) hillsInside = false;
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

test('village houses avoid roads and have collision volume', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      city: {
        buildingColliders: {
          minX: number;
          maxX: number;
          minZ: number;
          maxZ: number;
        }[];
        group: {
          traverse: (fn: (obj: unknown) => void) => void;
        };
      };
    };
    const roadRects: {
      minX: number;
      maxX: number;
      minZ: number;
      maxZ: number;
    }[] = [
      { minX: 556, maxX: 564, minZ: 30, maxZ: 1170 },
      { minX: 480, maxX: 630, minZ: 222, maxZ: 228 },
      { minX: 480, maxX: 630, minZ: 372, maxZ: 378 },
      { minX: 480, maxX: 630, minZ: 522, maxZ: 528 },
      { minX: 480, maxX: 630, minZ: 672, maxZ: 678 },
    ];
    for (let i = 0; i <= 8; i += 1) {
      const line = i * 150;
      roadRects.push({ minX: line - 13, maxX: line + 13, minZ: 0, maxZ: 1200 });
      roadRects.push({ minX: 0, maxX: 1200, minZ: line - 13, maxZ: line + 13 });
    }
    roadRects.push({ minX: 0, maxX: 1200, minZ: 589, maxZ: 611 });
    const overlaps = (
      a: { minX: number; maxX: number; minZ: number; maxZ: number },
      b: { minX: number; maxX: number; minZ: number; maxZ: number },
      margin = 0,
    ): boolean =>
      a.minX < b.maxX + margin &&
      a.maxX > b.minX - margin &&
      a.minZ < b.maxZ + margin &&
      a.maxZ > b.minZ - margin;
    let houses = 0;
    let blocked = 0;
    let outsideVillage = 0;
    game.city.group.traverse((raw) => {
      const obj = raw as {
        name?: string;
        position?: { x: number; z: number };
      };
      if (obj.name !== 'village-house' || !obj.position) return;
      houses += 1;
      const collider = game.city.buildingColliders.find(
        (c) =>
          Math.hypot(
            (c.minX + c.maxX) / 2 - obj.position.x,
            (c.minZ + c.maxZ) / 2 - obj.position.z,
          ) < 0.5,
      );
      if (!collider) {
        blocked += 1;
        return;
      }
      if (roadRects.some((road) => overlaps(collider, road, 2))) blocked += 1;
      const centerX = (collider.minX + collider.maxX) / 2;
      if (centerX < 612 || centerX > 888) outsideVillage += 1;
    });
    return { houses, blocked, outsideVillage };
  });
  expect(result.houses).toBeGreaterThan(10);
  expect(result.blocked).toBe(0);
  expect(result.outsideVillage).toBe(0);
});

test('hills are visible four-sided pyramids and stay driveable', async ({ page }) => {
  await boot(page);
  const hill = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      city: {
        treeColliders: { x: number; z: number; radius: number }[];
        getTerrainHeight: (x: number, z: number) => number;
        group: {
          traverse: (fn: (obj: { name?: string; position?: { x: number; z: number }; geometry?: { attributes: { position: { getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number } }; index: { count: number; getX: (i: number) => number } } }) => void) => void;
        };
      };
    };
    const hills: { x: number; z: number }[] = [];
    let firstMesh: {
      geometry: {
        attributes: { position: { getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number } };
        index: { count: number; getX: (i: number) => number };
      };
    } | null = null;
    game.city.group.traverse((obj) => {
      if (obj.name === 'hill' && obj.position) {
        hills.push({ x: obj.position.x, z: obj.position.z });
        if (!firstMesh && obj.geometry) firstMesh = obj as typeof firstMesh;
      }
    });
    const first = hills[0];
    const centerHeight = game.city.getTerrainHeight(first.x, first.z);
    const position = firstMesh!.geometry.attributes.position;
    let minLocalX = Infinity;
    let maxLocalX = -Infinity;
    for (let i = 0; i < position.count; i += 1) {
      const px = position.getX(i);
      minLocalX = Math.min(minLocalX, px);
      maxLocalX = Math.max(maxLocalX, px);
    }
    const halfSize = (maxLocalX - minLocalX) / 2;
    const edgeHeight = game.city.getTerrainHeight(first.x + halfSize, first.z);
    const index = firstMesh!.geometry.index;
    const normals = new Set<string>();
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      const ax = position.getX(a);
      const ay = position.getY(a);
      const az = position.getZ(a);
      const bx = position.getX(b);
      const by = position.getY(b);
      const bz = position.getZ(b);
      const cx = position.getX(c);
      const cy = position.getY(c);
      const cz = position.getZ(c);
      const abx = bx - ax;
      const aby = by - ay;
      const abz = bz - az;
      const acx = cx - ax;
      const acy = cy - ay;
      const acz = cz - az;
      const nx = aby * acz - abz * acy;
      const ny = abz * acx - abx * acz;
      const nz = abx * acy - aby * acx;
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-6) continue;
      normals.add(
        `${(nx / len).toFixed(2)},${(ny / len).toFixed(2)},${(nz / len).toFixed(2)}`,
      );
    }
    const blocked = game.city.treeColliders.some(
      (t) => Math.hypot(t.x - first.x, t.z - first.z) < 1,
    );
    return {
      x: first.x,
      z: first.z,
      hillCount: hills.length,
      uniqueNormals: normals.size,
      centerHeight,
      edgeHeight,
      blocked,
    };
  });
  expect(hill.hillCount).toBeGreaterThan(6);
  expect(hill.uniqueNormals).toBeGreaterThanOrEqual(3);
  expect(hill.uniqueNormals).toBeLessThanOrEqual(8);
  expect(hill.centerHeight).toBeGreaterThan(2);
  expect(hill.edgeHeight).toBeLessThan(0.001);
  expect(hill.blocked).toBe(false);

  await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      startFreeRoam?: () => void;
    };
    game.startFreeRoam?.();
  });
  await expect(page.locator('#hud')).toBeVisible();
  await page.evaluate(
    ({ x, z }: { x: number; z: number }) => {
      const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
        debug: { teleport: (x: number, z: number) => void };
        player: { groundY: number };
      };
      game.debug.teleport(x, z);
      game.player.groundY = 0;
    },
    hill,
  );
  await page.waitForTimeout(300);
  const groundY = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      player: { groundY: number };
    };
    return game.player.groundY;
  });
  expect(groundY).toBeGreaterThan(1);
});

test('vehicle model reload removes the previous external model root', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const mod = (await import(
      '/src/gameplay/VehicleFactory.ts'
    )) as {
      attachExternalVehicleModel: (
        visuals: unknown,
        url: string,
        spec: unknown,
      ) => Promise<void>;
      vehicleModelUrl: (bodyStyle: string) => string;
    };
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      showcase: {
        visuals: {
          modelRoot: { uuid: string } | null;
          group: { children: { uuid: string }[] };
        };
        spec: { id: string };
      };
    };
    const visuals = game.showcase.visuals;
    const url = mod.vehicleModelUrl(game.showcase.spec.id);
    await mod.attachExternalVehicleModel(visuals, url, game.showcase.spec);
    const firstRoot = visuals.modelRoot;
    await mod.attachExternalVehicleModel(visuals, url, game.showcase.spec);
    const secondRoot = visuals.modelRoot;
    return {
      firstRemoved: firstRoot ? !visuals.group.children.includes(firstRoot) : false,
      secondAttached: secondRoot
        ? visuals.group.children.includes(secondRoot)
        : false,
      rootCount: visuals.group.children.filter(
        (child) => child.uuid === secondRoot?.uuid,
      ).length,
    };
  });
  expect(result.firstRemoved).toBe(true);
  expect(result.secondAttached).toBe(true);
  expect(result.rootCount).toBe(1);
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

test('endless chunk updates keep nearby NPCs and pedestrians', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      startFreeRoam?: (mode: string) => void;
    };
    game.startFreeRoam?.('endless');
  });
  await expect(page.locator('#hud')).toBeVisible();
  const beforeHandle = await page.waitForFunction(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      traffic: { getNpcs: () => unknown[] };
      pedestrians: { pedestrians: unknown[] };
    };
    const npcs = game.traffic.getNpcs().length;
    const pedestrians = game.pedestrians.pedestrians.length;
    return npcs > 0 && pedestrians > 0 ? { npcs, pedestrians } : false;
  }, { timeout: 15000 });
  const before = (await beforeHandle.jsonValue()) as {
    npcs: number;
    pedestrians: number;
  };
  expect(before.npcs).toBeGreaterThan(0);

  await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      debug: { teleport: (x: number, z: number) => void };
    };
    game.debug.teleport(300 + 450, 450);
  });
  const afterHandle = await page.waitForFunction(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      traffic: { getNpcs: () => unknown[] };
      pedestrians: { pedestrians: unknown[] };
    };
    const npcs = game.traffic.getNpcs().length;
    const pedestrians = game.pedestrians.pedestrians.length;
    return npcs > 0 && pedestrians > 0 ? { npcs, pedestrians } : false;
  }, { timeout: 15000 });
  const after = (await afterHandle.jsonValue()) as {
    npcs: number;
    pedestrians: number;
  };
  expect(after.npcs).toBeGreaterThan(0);
  expect(after.pedestrians).toBeGreaterThan(0);
});

test('pedestrians attach the realistic michelle model', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const state = (window as unknown as { __GAME_STATE__?: unknown }).__GAME_STATE__ as unknown as {
      settings: { density: string };
    };
    state.settings.density = 'high';
  });
  await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      startFreeRoam?: (mode: string) => void;
    };
    game.startFreeRoam?.('finite');
  });
  await expect(page.locator('#hud')).toBeVisible();
  await page.waitForFunction(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      pedestrians: {
        pedestrians: {
          group?: {
            userData?: {
              externalRoot?: unknown;
              modelUrl?: string;
              fitScale?: number;
              proceduralModel?: { visible?: boolean };
            };
          };
        }[];
      };
    };
    return game.pedestrians.pedestrians.some(
      (ped) =>
        ped.group?.userData?.externalRoot !== undefined &&
        ped.group.userData.modelUrl === '/models/pedestrians/michelle.glb',
    );
  }, { timeout: 15000 });
  const result = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as {
      pedestrians: {
        pedestrians: {
          group?: {
            userData?: {
              modelUrl?: string;
              fitScale?: number;
              proceduralModel?: { visible?: boolean };
            };
          };
        }[];
      };
    };
    const ped = game.pedestrians.pedestrians.find(
      (p) => p.group?.userData?.modelUrl === '/models/pedestrians/michelle.glb',
    );
    return {
      modelUrl: ped?.group?.userData?.modelUrl ?? '',
      fitScale: ped?.group?.userData?.fitScale ?? 0,
      proceduralVisible: ped?.group?.userData?.proceduralModel?.visible ?? null,
    };
  });
  expect(result.modelUrl).toBe('/models/pedestrians/michelle.glb');
  expect(result.fitScale).toBeGreaterThan(0.5);
  expect(result.fitScale).toBeLessThan(2);
  expect(result.proceduralVisible).toBe(false);
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

test('pause menu adjusts quality and volume', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      startFreeRoam?: () => void;
    };
    game.startFreeRoam?.();
  });
  await expect(page.locator('#hud')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-overlay')).toBeVisible();
  await page.locator('.pause-overlay [data-quality="low"]').click();
  const quality = await page.evaluate(() => {
    const state = (window as unknown as { __GAME_STATE__?: unknown }).__GAME_STATE__ as {
      settings: { quality: string };
    };
    return state.settings.quality;
  });
  expect(quality).toBe('low');
  await page.evaluate(() => {
    const slider = document.querySelector('#pause-bgm-volume') as HTMLInputElement;
    slider.value = '0.25';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const volume = await page.evaluate(() => {
    const state = (window as unknown as { __GAME_STATE__?: unknown }).__GAME_STATE__ as {
      settings: { bgmVolume: number };
    };
    return state.settings.bgmVolume;
  });
  expect(volume).toBe(0.25);
});

test('pause menu quality options put high on the right', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      startFreeRoam?: () => void;
    };
    game.startFreeRoam?.();
  });
  await expect(page.locator('#hud')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-overlay')).toBeVisible();
  const ids = await page.locator('.pause-overlay [data-quality]').evaluateAll((nodes) =>
    nodes.map((node) => (node as HTMLElement).dataset.quality ?? ''),
  );
  expect(ids).toEqual(['auto', 'low', 'medium', 'high']);
  const rightmost = await page
    .locator('.pause-overlay [data-quality="high"]')
    .evaluate((node) => (node as HTMLElement).getBoundingClientRect().right);
  const low = await page
    .locator('.pause-overlay [data-quality="low"]')
    .evaluate((node) => (node as HTMLElement).getBoundingClientRect().right);
  expect(rightmost).toBeGreaterThan(low);
});

test('pedestrian arms hang at the sides and swing with the walk cycle', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const state = (window as unknown as { __GAME_STATE__?: unknown }).__GAME_STATE__ as {
      settings: { density: string };
    };
    state.settings.density = 'high';
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      startFreeRoam?: (mode: string) => void;
    };
    game.startFreeRoam?.('finite');
  });
  await expect(page.locator('#hud')).toBeVisible();
  await page.waitForFunction(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      pedestrians: {
        pedestrians: {
          group?: {
            userData?: {
              externalRoot?: unknown;
              bones?: { leftForearm?: unknown[]; armPose?: unknown };
            };
          };
        }[];
      };
    };
    return game.pedestrians.pedestrians.some(
      (ped) =>
        ped.group?.userData?.externalRoot !== undefined &&
        (ped.group.userData.bones?.leftForearm?.length ?? 0) > 0 &&
        ped.group.userData.bones.armPose !== undefined,
    );
  }, { timeout: 15000 });
  const result = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      pedestrians: {
        pedestrians: {
          phase: number;
          moving: boolean;
          state: string;
          heading: number;
          group: { userData: { externalRoot: ExternalRoot; bones: PedestrianBonesShape } };
        }[];
        syncVisual: (ped: unknown) => void;
      };
    };
    type BoneLike = {
      name: string;
      isBone?: boolean;
      matrixWorld: { elements: number[] };
    };
    type ExternalRoot = {
      traverse: (fn: (obj: BoneLike) => void) => void;
    };
    type PedestrianBonesShape = {
      leftForearm: { rotation: { x: number } }[];
      rightForearm: { rotation: { x: number } }[];
    };
    const ped = game.pedestrians.pedestrians.find(
      (p) => p.group.userData.bones.leftForearm.length > 0,
    )!;
    const root = ped.group.userData.externalRoot;
    const findBone = (namePart: string): BoneLike => {
      let found: BoneLike | undefined;
      root.traverse((node) => {
        if (found) return;
        if (node.isBone && node.name.toLowerCase().includes(namePart)) found = node;
      });
      if (!found) throw new Error(`bone missing: ${namePart}`);
      return found;
    };
    const shoulderL = findBone('leftshoulder');
    const handL = findBone('lefthand');
    const shoulderR = findBone('rightshoulder');
    const handR = findBone('righthand');
    const pos = (obj: BoneLike) => ({
      x: obj.matrixWorld.elements[12],
      y: obj.matrixWorld.elements[13],
      z: obj.matrixWorld.elements[14],
    });
    ped.moving = true;
    ped.state = 'walk';
    ped.heading = 0;
    const sample = (phase: number) => {
      ped.phase = phase;
      game.pedestrians.syncVisual(ped);
      ped.group.updateMatrixWorld(true);
      const sl = pos(shoulderL);
      const hl = pos(handL);
      const sr = pos(shoulderR);
      const hr = pos(handR);
      return {
        leftElbow: ped.group.userData.bones.leftForearm[0]!.rotation.x,
        rightElbow: ped.group.userData.bones.rightForearm[0]!.rotation.x,
        leftHand: { dx: hl.x - sl.x, dy: hl.y - sl.y, dz: hl.z - sl.z },
        rightHand: { dx: hr.x - sr.x, dy: hr.y - sr.y, dz: hr.z - sr.z },
      };
    };
    const back = sample(Math.PI * 0.5);
    const forward = sample(Math.PI * 1.5);
    return { back, forward };
  });
  expect(result.back.leftHand.dy).toBeLessThan(-0.4);
  expect(result.back.rightHand.dy).toBeLessThan(-0.4);
  expect(Math.abs(result.back.leftHand.dz - result.forward.leftHand.dz)).toBeGreaterThan(0.1);
  expect(result.back.leftElbow).not.toBeCloseTo(result.forward.leftElbow, 3);
  expect(Math.abs(result.forward.leftElbow)).toBeGreaterThan(0.05);
  expect(result.back.rightElbow).toBeGreaterThan(result.back.leftElbow + 0.05);
});

test('mobile HUD moves bottom widgets to the top right', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      startFreeRoam?: () => void;
    };
    game.startFreeRoam?.();
  });
  await expect(page.locator('#hud')).toBeVisible();
  await page.evaluate(() => {
    const toast = document.querySelector('#hud-title-toast') as HTMLElement;
    toast.classList.remove('hidden');
    toast.textContent = '测试称号';
  });
  const mobile = await page.evaluate(() => {
    const rect = (selector: string) => {
      const r = (document.querySelector(selector) as HTMLElement).getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    return {
      width: window.innerWidth,
      height: window.innerHeight,
      gauge: rect('.gauge-cluster'),
      kill: rect('.kill-counter'),
      toast: rect('.title-toast'),
    };
  });
  for (const key of ['gauge', 'kill', 'toast'] as const) {
    const r = mobile[key];
    expect(r.left).toBeGreaterThan(mobile.width * 0.3);
    expect(r.right).toBeLessThanOrEqual(mobile.width);
    expect(r.top).toBeLessThan(mobile.height * 0.6);
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(150);
  const desktop = await page.evaluate(() => {
    const rect = (selector: string) => {
      const r = (document.querySelector(selector) as HTMLElement).getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    };
    return {
      height: window.innerHeight,
      gauge: rect('.gauge-cluster'),
      kill: rect('.kill-counter'),
    };
  });
  expect(desktop.gauge.top).toBeGreaterThan(desktop.height * 0.7);
  expect(desktop.kill.bottom).toBeGreaterThan(desktop.height * 0.7);
});

test('player vehicle exposes the requested body parts', async ({ page }) => {
  await boot(page);
  const parts = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      player: {
        visuals: {
          bodyParts: Map<
            string,
            { visible: boolean; type: string; children: unknown[] }
          >;
        };
      };
    };
    const map = game.player.visuals.bodyParts;
    const required = [
      'BodyMain',
      'Hood',
      'FrontDoor_L',
      'FrontDoor_R',
      'RearDoor_L',
      'RearDoor_R',
      'TrunkLid',
      'FrontBumper',
      'RearBumper',
      'Mirror_L',
      'Mirror_R',
      'Grille',
      'Headlight_L',
      'Headlight_R',
      'Taillight_L',
      'Taillight_R',
      'Spoiler',
      'Windows',
      'Wheel_LF',
      'Wheel_RF',
      'Wheel_LR',
      'Wheel_RR',
    ];
    return {
      missing: required.filter((name) => !map.has(name)),
      bodyVisible: required.filter(
        (name) => !name.startsWith('Wheel_') && map.get(name)?.visible === true,
      ).length,
      wheelVisible: required
        .filter((name) => name.startsWith('Wheel_'))
        .filter((name) => map.get(name)?.visible === true).length,
      windowsType: map.get('Windows')?.type,
      wheelTypes: required
        .filter((name) => name.startsWith('Wheel_'))
        .map((name) => `${name}:${map.get(name)?.type}`),
    };
  });
  expect(parts.missing).toEqual([]);
  expect(parts.bodyVisible).toBe(18);
  expect(parts.wheelVisible).toBe(4);
  expect(parts.windowsType).toBe('Mesh');
  expect(parts.wheelTypes).toEqual([
    'Wheel_LF:Group',
    'Wheel_RF:Group',
    'Wheel_LR:Group',
    'Wheel_RR:Group',
  ]);
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

test('daily check-in, daily quests, achievements and coins persist', async ({ page }) => {
  await boot(page);

  // 主菜单显示钱包与签到入口
  await expect(page.locator('#menu-coins')).toContainText('0');
  await expect(page.locator('#menu-checkin')).toHaveText('签到');

  // 进入生涯成就页
  await page.getByRole('button', { name: '生涯成就' }).click();
  await expect(page.locator('.progress-overlay')).toBeVisible();
  await expect(page.locator('#daily-list')).toBeVisible();

  // 每日任务应有 3 个，且首个未完成
  const dailyItems = await page.locator('.daily-item').count();
  expect(dailyItems).toBe(3);

  // 签到领取金币
  await page.locator('#progress-checkin').click();
  await expect(page.locator('#progress-checkin')).toHaveText('今日已签到');
  const afterCheckIn = await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    return { coins: g.__GAME_STATE__.coins, streak: g.__GAME_STATE__.checkIn().streak };
  });
  // checkIn() 同一天再调用应返回 ok:false，不会重复发币
  expect(afterCheckIn.coins).toBeGreaterThanOrEqual(50);
  expect(afterCheckIn.streak).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#progress-coins')).toContainText(String(afterCheckIn.coins));

  // 撞倒行人 → 获得击杀金币与击杀成就进度
  await page.getByRole('button', { name: '返回主菜单' }).click();
  await page.getByRole('button', { name: '自由漫游' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  for (let i = 0; i < 5; i += 1) {
    await page.evaluate(() => {
      (window as unknown as GameWindow).__GAME_STATE__.addPedestrianKill();
    });
  }
  const killsState = await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    return { kills: g.__GAME_STATE__.pedestrianKills, coins: g.__GAME_STATE__.coins };
  });
  expect(killsState.kills).toBe(5);
  expect(killsState.coins).toBeGreaterThanOrEqual(afterCheckIn.coins + 25);
  await expect(page.locator('#hud-kills')).toHaveText('5');
  await expect(page.locator('#hud-coins')).toHaveText(String(killsState.coins));

  // 击杀 5 人解锁“行人克星”成就（成就解锁 +80 金币）
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-overlay')).toBeVisible();
  await page.getByRole('button', { name: '返回主菜单' }).click();

  // 存档包含留存数据
  const saved = await page.evaluate(() => localStorage.getItem('fenza-road-save-v1'));
  expect(saved).toContain('"coins":');
  expect(saved).toContain('"unlockedAchievements"');
  expect(saved).toContain('"kill-5"');
});

test('race finish grants coins and updates stats', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '竞速模式' }).click();
  await page.getByRole('button', { name: '开始比赛' }).click();
  await page.waitForFunction(() => {
    const g = window as unknown as GameWindow;
    return g.__GAME_STATE__.race.phase === 'racing';
  }, { timeout: 15000 });
  await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    g.__GAME__.debug.finishRace();
  });
  await expect(page.locator('#result-title')).toBeVisible();
  await expect(page.locator('#result-reward')).toContainText('奖励');
  const result = await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    return {
      coins: g.__GAME_STATE__.coins,
      stats: (g.__GAME_STATE__ as unknown as { stats: { races: number } }).stats,
    };
  });
  expect(result.coins).toBeGreaterThanOrEqual(60);
  expect(result.stats.races).toBe(1);

  // 分享按钮存在（不触发分享，只验证按钮可点击）
  await expect(page.getByRole('button', { name: '分享成绩' })).toBeVisible();
});

test('task point prompts, opens race setup and returns to free roam', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '自由漫游' }).click();
  await expect(page.locator('#hud')).toBeVisible();

  // 传送玩家到任务点，出现 E 键提示
  await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    g.__GAME__.debug.teleport(300, 300);
  });
  await expect(page.locator('#task-hint')).toBeVisible();

  // E 打开竞速设置面板
  await page.keyboard.press('KeyE');
  await expect(page.locator('.task-race-overlay')).toBeVisible();
  await expect(page.locator('#task-race-title')).toHaveText('城市环路');

  // 选择 4 圈、5 名对手
  await page.locator('[data-task-laps="4"]').click();
  await page.locator('[data-task-opponents="5"]').click();
  await page.getByRole('button', { name: '开始比赛' }).click();

  // 进入竞速，参数生效
  await expect(page.locator('.countdown-overlay')).toBeVisible();
  await page.waitForFunction(() => {
    const g = window as unknown as GameWindow;
    return g.__GAME_STATE__.race.phase === 'racing';
  }, { timeout: 15000 });
  const raceState = await page.evaluate(() => {
    const g = window as unknown as {
      __GAME_STATE__: { race: { totalLaps: number; totalRacers: number } };
    };
    return { laps: g.__GAME_STATE__.race.totalLaps, racers: g.__GAME_STATE__.race.totalRacers };
  });
  expect(raceState.laps).toBe(4);
  expect(raceState.racers).toBe(6);

  // 结束比赛 → 结算页显示「返回自由漫游」
  await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    g.__GAME__.debug.finishRace();
  });
  await expect(page.locator('#result-title')).toBeVisible();
  await expect(page.locator('#result-return-free')).toBeVisible();

  // 返回自由漫游，玩家回到任务点附近
  await page.getByRole('button', { name: '返回自由漫游' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  await page.waitForFunction(() => {
    const g = window as unknown as GameWindow;
    return (
      g.__GAME_STATE__.mode === 'freeRoam' &&
      Math.hypot(g.__GAME_STATE__.player.x - 300, g.__GAME_STATE__.player.z - 300) < 30
    );
  }, { timeout: 5000 });
  const after = await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    return {
      mode: g.__GAME_STATE__.mode,
      x: g.__GAME_STATE__.player.x,
      z: g.__GAME_STATE__.player.z,
    };
  });
  expect(after.mode).toBe('freeRoam');
  expect(Math.hypot(after.x - 300, after.z - 300)).toBeLessThan(30);
});

test('task panel cancels with E or Escape and hint returns', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '自由漫游' }).click();
  await page.evaluate(() => {
    const g = window as unknown as GameWindow;
    g.__GAME__.debug.teleport(750, 450);
  });
  await expect(page.locator('#task-hint')).toBeVisible();
  await page.keyboard.press('KeyE');
  await expect(page.locator('.task-race-overlay')).toBeVisible();
  await expect(page.locator('#task-race-title')).toHaveText('城市巡回');
  // E 再次按下关闭面板，回到自由漫游且提示恢复
  await page.keyboard.press('KeyE');
  await expect(page.locator('.task-race-overlay')).toBeHidden();
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#task-hint')).toBeVisible();
  const mode = await page.evaluate(() => (window as unknown as GameWindow).__GAME_STATE__.mode);
  expect(mode).toBe('freeRoam');
});

test('minimap shows blue task point markers in free roam', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '自由漫游' }).click();
  await expect(page.locator('#hud')).toBeVisible();

  // 自由漫游时任务点进入小地图点位列表（玩家 + 3 个任务点）
  await page.waitForFunction(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      getMinimapDots: () => { kind?: string }[];
    };
    const dots = game.getMinimapDots();
    return dots.length === 4 && dots.filter((d) => d.kind === 'task').length === 3;
  }, undefined, { timeout: 5000 });

  // 任务点模型必须挂在场景中（防止渲染缺失回归）
  const mounted = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      taskPoints: { points: Array<{ group: { parent: unknown } }> };
    };
    return game.taskPoints.points.every((p) => p.group.parent !== null);
  });
  expect(mounted).toBe(true);

  // 小地图画布上出现蓝色高亮标记
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#minimap') as HTMLCanvasElement | null;
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let bluePixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a > 0 && b > 120 && b > r * 1.4 && g > 90) bluePixels += 1;
    }
    return bluePixels > 30;
  }, undefined, { timeout: 10000 });

  // 离开自由漫游（无尽模式）后任务点不再显示
  await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      startFreeRoam?: (mapMode?: string) => void;
    };
    game.startFreeRoam?.('endless');
  });
  await page.waitForFunction(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      getMinimapDots: () => { kind?: string }[];
    };
    return game.getMinimapDots().filter((d) => d.kind === 'task').length === 0;
  }, undefined, { timeout: 5000 });
});

test('right-drag orbits chase camera and resets on release', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '自由漫游' }).click();
  await expect(page.locator('#hud')).toBeVisible();
  // 等追尾相机从菜单环绕位平滑过渡并稳定下来
  await page.waitForTimeout(2000);

  const angle = () =>
    page.evaluate(() => {
      const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
        camera: { position: { x: number; z: number } };
        player: { x: number; z: number };
      };
      return Math.atan2(
        game.camera.position.x - game.player.x,
        game.camera.position.z - game.player.z,
      );
    });

  const before = await angle();
  // 按住右键向右拖动（幅度足够大，便于与复位区分）
  await page.mouse.move(640, 400);
  await page.mouse.down({ button: 'right' });
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(640 + i * 50, 400);
    await page.waitForTimeout(25);
  }
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(350);
  const during = await angle();
  // 松开后平滑复位
  await page.waitForTimeout(1600);
  const after = await angle();
  const inputState = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      input?: { isOrbitDragging: () => boolean };
      orbitYaw?: number;
    };
    return {
      dragging: game.input?.isOrbitDragging() ?? null,
      orbitYaw: game.orbitYaw ?? null,
    };
  });
  let delta = during - before;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  let reset = after - before;
  while (reset > Math.PI) reset -= Math.PI * 2;
  while (reset < -Math.PI) reset += Math.PI * 2;
  expect(Math.abs(delta)).toBeGreaterThan(0.08);
  expect(Math.abs(reset)).toBeLessThan(0.08);
});

test('npc collision offsets vehicle then returns to path smoothly', async ({ page }) => {
  await boot(page);
  await page.getByRole('button', { name: '自由漫游' }).click();
  await page.waitForFunction(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      traffic: { npcs: unknown[] };
    };
    return game.traffic.npcs.length > 0;
  }, { timeout: 15000 });

  // 等待一个「存活且离玩家不远」的 NPC：远离生成区（>680m）的 NPC 会被淡出回收，
  // 撞向它们会导致碰撞对象中途消失；只在 650m 内挑选（安全余量 < 回收距离）
  await page.waitForFunction(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      traffic: {
        npcs: Array<{ fading: boolean; vehicle: { x: number; z: number } }>;
      };
      player: { x: number; z: number };
    };
    return game.traffic.npcs.some(
      (n) =>
        !n.fading &&
        Math.hypot(n.vehicle.x - game.player.x, n.vehicle.z - game.player.z) < 650,
    );
  }, { timeout: 10000 });

  // 挑选离玩家最近且未在淡出的 NPC，把玩家高速撞向它
  const target = await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      traffic: {
        npcs: Array<{
          fading: boolean;
          vehicle: { x: number; z: number; heading: number; visuals: { group: { uuid: string } } };
        }>;
      };
      player: { x: number; z: number };
    };
    const npc = game.traffic.npcs
      .slice()
      .filter(
        (n) =>
          !n.fading &&
          Math.hypot(n.vehicle.x - game.player.x, n.vehicle.z - game.player.z) < 650,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.vehicle.x - game.player.x, a.vehicle.z - game.player.z) -
          Math.hypot(b.vehicle.x - game.player.x, b.vehicle.z - game.player.z),
      )[0];
    if (!npc) throw new Error('no safe npc');
    return {
      x: npc.vehicle.x,
      z: npc.vehicle.z,
      heading: npc.vehicle.heading,
      id: npc.vehicle.visuals.group.uuid,
    };
  });

  await page.evaluate((t) => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      player: { x: number; z: number; heading: number; speed: number; lateral: number };
    };
    game.player.x = t.x + Math.sin(t.heading) * 1.2;
    game.player.z = t.z + Math.cos(t.heading) * 1.2;
    game.player.heading = t.heading;
    game.player.speed = 22;
    game.player.lateral = 0;
  }, target);

  // NPC 进入碰撞偏移状态，随后让玩家停车（不再持续推挤，NPC 独自滑行并回归）
  await page.waitForFunction(
    (id: string) => {
      const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
        traffic: {
          npcs: Array<{
            state: string;
            vehicle: { visuals: { group: { uuid: string } } };
          }>;
        };
      };
      const npc = game.traffic.npcs.find((n) => n.vehicle.visuals.group.uuid === id);
      return npc && npc.state === 'offset';
    },
    target.id,
    { timeout: 5000 },
  );
  await page.evaluate(() => {
    const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
      player: { speed: number; lateral: number };
    };
    game.player.speed = 0;
    game.player.lateral = 0;
  });

  // 采样 3s：无大跳变（无瞬移），期间进入过回归/巡航
  const samples = await page.evaluate(
    async (id: string) => {
      const game = (window as unknown as { __GAME__?: unknown }).__GAME__ as unknown as {
        traffic: {
          npcs: Array<{
            state: string;
            vehicle: { x: number; z: number; visuals: { group: { uuid: string } } };
          }>;
        };
      };
      const out: { x: number; z: number; state: string }[] = [];
      for (let i = 0; i < 30; i += 1) {
        const npc = game.traffic.npcs.find((n) => n.vehicle.visuals.group.uuid === id);
        if (!npc) throw new Error('tracked NPC disappeared mid-sampling');
        out.push({ x: npc.vehicle.x, z: npc.vehicle.z, state: npc.state });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return out;
    },
    target.id,
  );

  let maxStep = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const step = Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
    maxStep = Math.max(maxStep, step);
  }
  expect(samples.some((s) => s.state === 'offset')).toBe(true);
  expect(samples.some((s) => s.state === 'return' || s.state === 'cruise')).toBe(true);
  expect(maxStep).toBeLessThan(6);
});
