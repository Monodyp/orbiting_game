import { expect, test, type CDPSession, type Locator, type Page } from '@playwright/test';
import { matchMaker, type Room } from '@colyseus/core';
import type { RoomReservation } from '@ice-water/shared';
import { PlayerState } from '../../apps/server/src/rooms/lobby-state.js';
import type { LobbyState } from '../../apps/server/src/rooms/lobby-state.js';
import { startServer } from '../../apps/server/src/app.js';
import { readConfig } from '../../apps/server/src/config/environment.js';
let server: Awaited<ReturnType<typeof startServer>>;
test.beforeAll(async () => {
  server = await startServer(
    readConfig({
      GUEST_SESSION_SIGNING_SECRET: 'e2e-only-secret-at-least-32-characters',
      GAME_SERVER_PORT: '2568',
      COUNTDOWN_SECONDS: '1',
      CLIENT_ORIGIN: 'http://localhost:5174',
      DEV_BOT_COUNT: '0',
    }),
    { isReady: async () => true, saveMatchSummary: async () => true, close: async () => {} },
  );
});
test.afterAll(async () => {
  await server?.stop();
});
async function identify(page: Page, name: string, controls: 'auto' | 'touch' = 'auto') {
  await disableLobbyPreviewWebgl(page, controls);
  await page.goto('/');
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Let’s go' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create private room' })).toBeVisible();
}
async function disableLobbyPreviewWebgl(page: Page, controls: 'auto' | 'touch' = 'auto') {
  await page.addInitScript((selectedControls) => {
    if (selectedControls === 'touch') {
      const settings = JSON.parse(localStorage.getItem('ice-water/fps-settings') ?? '{}');
      localStorage.setItem(
        'ice-water/fps-settings',
        JSON.stringify({ ...settings, controls: 'touch' }),
      );
    }
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: function (this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
        if (this.classList.contains('lobby-preview') && contextId.startsWith('webgl')) return null;
        return Reflect.apply(originalGetContext, this, [contextId, ...args]);
      },
    });
  }, controls);
}
async function create(page: Page) {
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/rooms') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create private room' }).click();
  const reservation = (await (await response).json()) as RoomReservation;
  await expect(page.getByLabel('Room invite code')).toBeVisible();
  const room = matchMaker.getLocalRoomById(reservation.seat.roomId) as Room<{ state: LobbyState }>;
  if (!room) throw new Error('Test room not found');
  return { room, code: reservation.inviteCode };
}
async function start(page: Page, room: Room<{ state: LobbyState }>) {
  await page.getByRole('button', { name: 'Start countdown' }).click();
  await expect.poll(() => room.state.phase).toBe('playing');
  await expect(page.getByText(/^ROLE: (ICE|WATER)$/)).toBeVisible({ timeout: 15000 });
}
async function enterTouchArena(page: Page) {
  await expect(page.getByRole('button', { name: 'Tag or rescue' })).toBeVisible({
    timeout: 15000,
  });
  const instruction = page.getByRole('button', { name: 'Got it' });
  if (await instruction.count())
    await instruction.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(instruction).toHaveCount(0);
}
async function chooseRole(page: Page, role: 'Ice' | 'Water' | 'Spectator') {
  await page
    .getByRole('group', { name: 'Your role choice' })
    .getByRole('button', { name: role === 'Spectator' ? 'Spectator: OFF' : role, exact: true })
    .click();
}
async function enableTouch(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  return cdp;
}
async function touchTap(cdp: CDPSession, target: Locator) {
  const box = (await target.boundingBox())!;
  const point = { id: 7, x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function join(page: Page, name: string, code: string, controls: 'auto' | 'touch' = 'auto') {
  await identify(page, name, controls);
  await page.getByLabel('Invite code', { exact: true }).fill(code);
  await page.getByRole('button', { name: 'Join room', exact: true }).click();
}

test('room chat sends without activating movement or lunge keys', async ({ page }) => {
  test.setTimeout(90000);
  await identify(page, 'Chat Host');
  const { room, code } = await create(page);
  const friend = await page.context().newPage();
  await join(friend, 'Chat Friend', code);
  await expect
    .poll(() => [...room.state.players.values()].filter((player) => player.isConnected).length)
    .toBe(2);

  await start(page, room);
  await friend.close({ runBeforeUnload: false });
  const host = room.state.players.get(room.state.hostPlayerId)!;
  const before = { x: host.x, z: host.z, lungeUntil: host.lungeUntil };
  const input = page.getByLabel('Chat message');
  await expect(input).toBeVisible();
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(input).toBeFocused();
  await page.keyboard.type('wq Hold the north lane');
  await input.press('Enter');

  await expect(page.getByRole('log')).toContainText('Hold the north lane');
  await page.waitForTimeout(150);
  expect(Math.hypot(host.x - before.x, host.z - before.z)).toBeLessThan(0.01);
  expect(host.lungeUntil).toBe(before.lungeUntil);

  await input.press('Escape');
  await expect(input).not.toBeFocused();
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect(input).toBeFocused();
  await page.mouse.click(400, 400);
  await expect(input).not.toBeFocused();
});

test('room roster removes party UI and synchronizes role choices by player identity', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await identify(page, 'Twin Name');
  const { room, code } = await create(page);
  const friend = await page.context().newPage();
  await join(friend, 'Twin Name', code);
  await expect
    .poll(() => [...room.state.players.values()].filter((player) => player.isConnected).length)
    .toBe(2);

  const hostRoster = page.getByLabel('Players in room');
  const friendRoster = friend.getByLabel('Players in room');
  await expect(hostRoster.locator('li')).toHaveCount(2);
  await expect(hostRoster.locator('li.is-local')).toHaveCount(1);
  await expect(friendRoster.locator('li.is-local')).toHaveCount(1);
  await expect(hostRoster.locator('li.is-local')).toContainText('You');
  await expect(friendRoster.locator('li.is-local')).toContainText('You');
  await expect(page.getByLabel('Your party')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Social' })).toHaveCount(0);

  await page.getByRole('button', { name: 'User picks' }).click();
  await expect.poll(() => room.state.roleAssignmentMode).toBe('user-picks');
  await expect(page.getByRole('button', { name: 'User picks' })).toHaveAttribute(
    'aria-pressed',
    'true',
    { timeout: 5_000 },
  );
  const hostPlayerId = room.state.hostPlayerId;
  expect(room.state.players.get(hostPlayerId)?.roleChoice).toBe('random');
  await page
    .getByRole('group', { name: 'Your role choice' })
    .getByRole('button', { name: 'Ice', exact: true })
    .click();
  await friend
    .getByRole('group', { name: 'Your role choice' })
    .getByRole('button', { name: 'Water', exact: true })
    .click();
  await expect.poll(() => room.state.players.get(hostPlayerId)?.roleChoice).toBe('ice');
  const friendPlayer = [...room.state.players.values()].find(
    (player) => player.playerId !== room.state.hostPlayerId,
  )!;
  await expect.poll(() => friendPlayer.roleChoice).toBe('water');
  await expect(hostRoster).toContainText('PREFERS WATER');

  const leaveRoom = friend.getByRole('button', { name: 'Leave room' });
  await leaveRoom.scrollIntoViewIfNeeded();
  await leaveRoom.click({ timeout: 10_000 });
  await expect.poll(() => room.state.players.size, { timeout: 10_000 }).toBe(1);
  await expect(hostRoster.locator('li')).toHaveCount(1, { timeout: 10_000 });
});

test('spectator toggle restores random participation and hides arena entry from spectators', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await identify(page, 'Toggle Host');
  const { room, code } = await create(page);
  const togglerPage = await page.context().newPage();
  const spectatorPage = await page.context().newPage();
  try {
    await join(togglerPage, 'Toggle Player', code);
    await join(spectatorPage, 'Room Spectator', code);
    await expect
      .poll(() => [...room.state.players.values()].filter((player) => player.isConnected).length)
      .toBe(3);

    const togglerChoice = togglerPage.getByRole('group', { name: 'Your role choice' });
    await togglerChoice.getByRole('button', { name: 'Spectator: OFF' }).click();
    const toggler = [...room.state.players.values()].find(
      (player) => player.displayName === 'Toggle Player',
    )!;
    await expect.poll(() => toggler.roleChoice).toBe('spectator');
    await togglerChoice.getByRole('button', { name: 'Spectator: ON' }).click();
    await expect.poll(() => toggler.roleChoice).toBe('random');

    const spectatorChoice = spectatorPage.getByRole('group', { name: 'Your role choice' });
    await spectatorChoice.getByRole('button', { name: 'Spectator: OFF' }).click();
    const spectator = [...room.state.players.values()].find(
      (player) => player.displayName === 'Room Spectator',
    )!;
    await expect.poll(() => spectator.roleChoice).toBe('spectator');

    await start(page, room);
    await expect.poll(() => toggler.team).toMatch(/^(ice|water)$/);
    expect(spectator).toMatchObject({ team: 'none', status: 'spectator' });

    await expect(page.getByRole('button', { name: 'Enter arena' })).toBeVisible({ timeout: 15_000 });
    await expect(togglerPage.getByRole('button', { name: 'Enter arena' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(spectatorPage.getByLabel('Spectator controls')).toBeVisible();
    await expect(spectatorPage.getByRole('button', { name: 'Enter arena' })).toHaveCount(0);
  } finally {
    await togglerPage.close();
    await spectatorPage.close();
  }
});

test('a lobby-selected spectator watches active roles while Water freezes and rescues', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await identify(page, 'Ice Host', 'touch');
  const { room, code } = await create(page);
  const icePlayerId = room.state.hostPlayerId;
  const rescuerPage = await page.context().newPage();
  const spectatorPage = await page.context().newPage();
  const frozenPlayer = new PlayerState();
  Object.assign(frozenPlayer, {
    playerId: 'e2e-frozen-water',
    displayName: 'Frozen Water',
    roleChoice: 'water',
  });
  room.state.players.set(frozenPlayer.playerId, frozenPlayer);
  try {
    await join(rescuerPage, 'Rescue Water', code, 'touch');
    await join(spectatorPage, 'Room Spectator', code);
    await expect
      .poll(() => [...room.state.players.values()].filter((player) => player.isConnected).length)
      .toBe(4);
    await page.getByRole('button', { name: 'User picks' }).click();
    await expect.poll(() => room.state.roleAssignmentMode).toBe('user-picks');
    await chooseRole(page, 'Ice');
    await chooseRole(rescuerPage, 'Water');
    await chooseRole(spectatorPage, 'Spectator');
    await expect.poll(() => room.state.players.get(icePlayerId)?.roleChoice).toBe('ice');
    const spectator = [...room.state.players.values()].find(
      (player) => player.displayName === 'Room Spectator',
    )!;
    await expect.poll(() => spectator.roleChoice).toBe('spectator');
    await start(page, room);

    const ice = room.state.players.get(icePlayerId)!;
    const rescuer = [...room.state.players.values()].find(
      (player) => player.displayName === 'Rescue Water',
    )!;
    expect(ice.team).toBe('ice');
    expect(frozenPlayer.team).toBe('water');
    expect(rescuer.team).toBe('water');
    expect(room.state.waterStartedCount).toBe(2);
    expect(spectator).toMatchObject({ team: 'none', roleChoice: 'spectator', status: 'spectator' });

    await enterTouchArena(page);
    const spectatorPanel = spectatorPage.getByLabel('Spectator controls');
    await expect(spectatorPanel).toContainText('Watching: Ice Host');
    await expect(spectatorPage.getByLabel('Movement joystick')).toHaveCount(0);
    await expect(spectatorPage.getByRole('button', { name: 'Tag or rescue' })).toHaveCount(0);
    await spectatorPage.getByRole('button', { name: 'Next spectator target' }).click();
    await expect(spectatorPanel).toContainText('Watching: Frozen Water');
    await spectatorPage.getByRole('button', { name: 'Next spectator target' }).click();
    await expect(spectatorPanel).toContainText('Watching: Rescue Water');
    await spectatorPage.close({ runBeforeUnload: false });
    await enterTouchArena(rescuerPage);

    const iceCdp = await enableTouch(page);
    const rescuerCdp = await enableTouch(rescuerPage);
    Object.assign(ice, {
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      velocityX: 0,
      velocityZ: 0,
      verticalVelocity: 0,
      lungeUntil: 0,
      protectedUntil: 0,
    });
    Object.assign(frozenPlayer, {
      x: 0,
      y: 0,
      z: -1,
      velocityX: 0,
      velocityZ: 0,
      verticalVelocity: 0,
      protectedUntil: 0,
    });
    Object.assign(rescuer, {
      x: 0,
      y: 0,
      z: -7,
      velocityX: 0,
      velocityZ: 0,
      verticalVelocity: 0,
      protectedUntil: 0,
    });
    room.broadcastPatch();
    await touchTap(iceCdp, page.getByRole('button', { name: 'Tag or rescue' }));
    await expect.poll(() => frozenPlayer.status).toBe('frozen');
    expect(frozenPlayer.team).toBe('water');
    expect(frozenPlayer.status).toBe('frozen');
    expect(spectator.status).toBe('spectator');

    Object.assign(frozenPlayer, {
      x: 0,
      y: 0,
      z: -0.75,
      velocityX: 0,
      velocityZ: 0,
      verticalVelocity: 0,
      isGrounded: true,
    });
    Object.assign(rescuer, { x: 0, y: 0, z: -0.5, protectedUntil: 0 });
    room.broadcastPatch();
    await touchTap(rescuerCdp, rescuerPage.getByRole('button', { name: 'Tag or rescue' }));
    await expect.poll(() => frozenPlayer.status).toBe('alive');
    await expect.poll(() => frozenPlayer.protectedUntil).toBeGreaterThan(Date.now());

    Object.assign(frozenPlayer, { status: 'frozen' });
    Object.assign(rescuer, { status: 'frozen' });
    room.broadcastPatch();
    await expect.poll(() => ['finished', 'intermission'].includes(room.state.phase)).toBe(true);
    expect(spectator).toMatchObject({ team: 'none', roleChoice: 'spectator', status: 'spectator' });
    expect(frozenPlayer.team).toBe('water');
    expect(frozenPlayer.status).toBe('frozen');
    expect(errors).toEqual([]);
  } finally {
    await rescuerPage.close();
    if (!spectatorPage.isClosed()) await spectatorPage.close();
  }
});

test('the lobby exposes only Frostline and new rooms stay on Frostline', async ({ page }) => {
  await identify(page, 'Frostline Guest');
  await expect(page.getByLabel('Map', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Frostline', { exact: true }).first()).toBeVisible();
  const { room } = await create(page);
  await expect.poll(() => room.state.mapId).toBe('frostline');
  await expect(page.getByLabel('Map', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Leave room' }).click();
});

test('mobile touch movement, sprint, lunge, tag and controls work without overflow', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const cdp = await enableTouch(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await disableLobbyPreviewWebgl(page, 'touch');
    await page.goto('/');
    await page.getByLabel('Display name').fill('<>');
    await page.getByRole('button', { name: 'Let’s go' }).tap();
    await expect(page.getByRole('alert')).toContainText('2–20');
    await page.getByLabel('Display name').fill('Touch Player');
    await page.getByRole('button', { name: 'Let’s go' }).tap();
    await page.getByRole('button', { name: 'Play', exact: true }).tap();
    await expect(page.getByRole('button', { name: 'Create private room' })).toBeVisible();
    await expect(page.getByLabel('Map', { exact: true })).toHaveCount(0);
    const { room } = await create(page);
    const water = new PlayerState();
    Object.assign(water, {
      playerId: 'e2e-touch-water',
      displayName: 'Touch Water',
      roleChoice: 'water',
    });
    room.state.players.set(water.playerId, water);
    const secondWater = new PlayerState();
    Object.assign(secondWater, {
      playerId: 'e2e-second-water',
      displayName: 'Second Water',
      roleChoice: 'water',
    });
    room.state.players.set(secondWater.playerId, secondWater);
    room.broadcastPatch();
    await page.getByRole('button', { name: 'User picks' }).click();
    await expect.poll(() => room.state.roleAssignmentMode).toBe('user-picks');
    await chooseRole(page, 'Ice');
    await expect.poll(() => room.state.players.get(room.state.hostPlayerId)?.roleChoice).toBe('ice');
    await start(page, room);
    await expect
      .poll(() => [...room.state.players.values()].filter((player) => player.team === 'ice').length)
      .toBe(1);
    const ice = [...room.state.players.values()].find((player) => player.team === 'ice')!;
    await enterTouchArena(page);

    const stick = (await page.getByLabel('Movement joystick').boundingBox())!;
    const stickX = stick.x + stick.width / 2;
    const stickY = stick.y + stick.height / 2;
    const initialPosition = { x: ice.x, z: ice.z, yaw: ice.yaw };
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ id: 1, x: stickX, y: stickY }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ id: 1, x: stickX, y: stickY - 50 }],
    });
    await expect
      .poll(() => Math.hypot(ice.x - initialPosition.x, ice.z - initialPosition.z))
      .toBeGreaterThan(0.5);
    const viewport = page.viewportSize()!;
    const lookX = viewport.width * 0.2;
    const lookY = viewport.height * 0.42;
    const beforeLook = { yaw: ice.yaw, pitch: ice.pitch };
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { id: 1, x: stickX, y: stickY - 50 },
        { id: 2, x: lookX, y: lookY },
      ],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { id: 1, x: stickX, y: stickY - 50 },
        { id: 2, x: lookX + 80, y: lookY + 45 },
      ],
    });
    await expect.poll(() => ice.yaw).not.toBe(beforeLook.yaw);
    await expect.poll(() => ice.pitch).not.toBe(beforeLook.pitch);

    const sprint = page.getByRole('button', { name: 'Sprint', exact: true });
    const sprintBox = (await sprint.boundingBox())!;
    const sprintPoint = {
      id: 7,
      x: sprintBox.x + sprintBox.width / 2,
      y: sprintBox.y + sprintBox.height / 2,
    };
    const lookYawBeforeSprint = ice.yaw;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { id: 1, x: stickX, y: stickY - 50 },
        { id: 2, x: lookX + 80, y: lookY + 45 },
        sprintPoint,
      ],
    });
    await expect(sprint).toHaveAttribute('aria-pressed', 'true');
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { id: 1, x: stickX, y: stickY - 50 },
        { id: 2, x: lookX + 110, y: lookY + 65 },
        sprintPoint,
      ],
    });
    await expect.poll(() => ice.yaw).not.toBe(lookYawBeforeSprint);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const yawBeforeControlDrag = ice.yaw;
    const sequenceBeforeControlDrag = ice.inputSequence;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [sprintPoint] });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ ...sprintPoint, x: sprintPoint.x - 70, y: sprintPoint.y - 70 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => ice.inputSequence).toBeGreaterThan(sequenceBeforeControlDrag);
    expect(ice.yaw).toBe(yawBeforeControlDrag);
    await expect(sprint).toHaveAttribute('aria-pressed', 'false');
    await touchTap(cdp, sprint);
    await expect(sprint).toHaveAttribute('aria-pressed', 'true');
    await touchTap(cdp, sprint);
    await expect(sprint).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: 'Slide', exact: true })).toBeVisible();
    await touchTap(cdp, page.getByRole('button', { name: 'Lunge', exact: true }));
    await expect.poll(() => ice.lungeUntil).toBeGreaterThan(Date.now());

    Object.assign(ice, {
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      velocityX: 0,
      velocityZ: 0,
      verticalVelocity: 0,
      lungeUntil: 0,
      protectedUntil: 0,
    });
    expect(water.team).toBe('water');
    Object.assign(water, {
      x: 0,
      y: 0,
      z: -1,
      velocityX: 0,
      velocityZ: 0,
      verticalVelocity: 0,
      protectedUntil: 0,
    });
    room.broadcastPatch();
    await touchTap(cdp, page.getByRole('button', { name: 'Tag or rescue' }));
    await expect.poll(() => water.status).toBe('frozen');
    await touchTap(cdp, page.getByRole('button', { name: 'Scores', exact: true }));
    const scoreboard = page.getByRole('region', { name: 'Scoreboard' });
    await expect(scoreboard).toBeVisible();
    await expect(scoreboard).toContainText('ice');
    await expect(scoreboard).toContainText('Frozen');
    await expect(scoreboard).not.toContainText('Kills');
    await expect(scoreboard).not.toContainText('Deaths');
    await touchTap(cdp, page.getByRole('button', { name: 'Scores', exact: true }));
    await expect(page.getByRole('region', { name: 'Scoreboard' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: 'test-results/freeze-tag-mobile-portrait.png' });
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByRole('button', { name: 'Tag or rescue' })).toBeVisible();
    await page.screenshot({ path: 'test-results/freeze-tag-mobile-landscape.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    Object.assign(secondWater, { status: 'frozen' });
    room.broadcastPatch();
    await expect.poll(() => ['finished', 'intermission'].includes(room.state.phase)).toBe(true);
    await expect(page.getByRole('heading', { name: 'ICE WINS' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    if (context.pages().length) await context.close();
  }
});

test('settings persist locally and the only match mode stays Ice Ice Water', async ({ page }) => {
  await identify(page, 'Settings Guest');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Field of view', { exact: false }).press('End');
  for (let i = 0; i < 6; i++)
    await page.getByLabel('Field of view', { exact: false }).press('ArrowLeft');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create private room' })).toBeVisible();
  await expect(page.getByLabel('Game mode', { exact: true })).toHaveValue('tdm');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Field of view')).toHaveValue('104');
  await page.getByRole('button', { name: 'Done' }).click();
  const { room } = await create(page);
  await expect.poll(() => room.state.gameMode).toBe('tdm');
  await page.screenshot({ path: 'test-results/freeze-tag-lobby-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Leave room' }).click();
});
