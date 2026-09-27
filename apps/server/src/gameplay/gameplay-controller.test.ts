import { describe, expect, it } from 'vitest';
import { GAMEPLAY, distanceSquared3d, type GameplayEvent } from '@ice-water/shared';
import { LobbyState, PlayerState } from '../rooms/lobby-state.js';
import { GameplayController } from './gameplay-controller.js';

function fixture() {
  const state = new LobbyState();
  state.phase = 'playing';
  state.phaseDeadline = 300_000;
  const ice = new PlayerState();
  const water = new PlayerState();
  Object.assign(ice, { playerId: 'ice', team: 'ice', x: 0, y: 0, z: 0, protectedUntil: 0 });
  Object.assign(water, { playerId: 'water', team: 'water', x: 0, y: 0, z: -0.29, protectedUntil: 0 });
  state.players.set(ice.playerId, ice);
  state.players.set(water.playerId, water);
  const events: GameplayEvent[] = [];
  const controller = new GameplayController(state, (event) => events.push(event));
  controller.start(1_000);
  Object.assign(ice, { x: 0, y: 0, z: 0, protectedUntil: 0 });
  Object.assign(water, { x: 0, y: 0, z: -0.29, protectedUntil: 0 });
  return { state, ice, water, controller, events };
}

describe('authoritative proximity interactions', () => {
  it('accepts interaction exactly at the new two-metre boundary', () => {
    const { ice, water, controller } = fixture();
    expect(GAMEPLAY.interactionRange).toBe(2);
    water.z = -GAMEPLAY.interactionRange;
    expect(distanceSquared3d(ice, water)).toBe(GAMEPLAY.interactionRange ** 2);

    expect(controller.handle(ice.playerId, 'action/interact', {}, 1_000)).toBeNull();
    expect(water.status).toBe('frozen');
  });

  it('freezes a Water player when Ice interacts within 1 metre', () => {
    const { ice, water, controller, events } = fixture();

    expect(controller.handle(ice.playerId, 'action/interact', {}, 2_000)).toBeNull();
    expect(water.status).toBe('frozen');
    expect(water.velocityZ).toBeLessThan(0);
    expect(water.verticalVelocity).toBe(GAMEPLAY.freezeKnockbackVerticalSpeed);
    controller.advance(2_050);
    expect(water.y).toBeGreaterThan(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'player/frozen',
        payload: { playerId: 'water', attackerId: 'ice', serverTime: 2_000 },
      }),
    );
  });

  it.each([GAMEPLAY.interactionRange + 0.01, 5])(
    'does not freeze a Water player at the old or farther range (%s metres)',
    (distance) => {
    const { ice, water, controller } = fixture();
    water.z = -distance;

    expect(controller.handle(ice.playerId, 'action/interact', {}, 2_000)).toBeNull();
    expect(water.status).toBe('alive');
    },
  );

  it('unfreezes a frozen Water teammate with the same proximity interaction', () => {
    const { state, water, controller, events } = fixture();
    water.status = 'frozen';
    water.y = 3.5;
    state.players.delete('ice');
    const rescuer = new PlayerState();
    Object.assign(rescuer, { playerId: 'rescuer', team: 'water', x: 0, y: 3.5, z: 0 });
    state.players.set(rescuer.playerId, rescuer);
    expect(rescuer.team).toBe('water');
    expect(rescuer.status).toBe('alive');
    expect(distanceSquared3d(rescuer, water)).toBeLessThanOrEqual(GAMEPLAY.interactionRange ** 2);

    expect(controller.handle(rescuer.playerId, 'action/interact', {}, 3_000)).toBeNull();
    expect(water.status).toBe('alive');
    expect(water.isGrounded).toBe(false);
    expect(water.velocityZ).toBeLessThan(0);
    expect(water.verticalVelocity).toBe(GAMEPLAY.freezeKnockbackVerticalSpeed);
    expect(water.protectedUntil).toBe(3_000 + GAMEPLAY.freezeProtectionMs);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'player/rescued',
        payload: expect.objectContaining({ playerId: 'water', rescuerIds: ['rescuer'] }),
      }),
    );
  });

  it('uses forward facing direction when lunge starts without movement input and transfers momentum at expiry', () => {
    const { ice, water, controller } = fixture();
    Object.assign(ice, { x: -50, y: 0, z: -30, yaw: 0 });
    Object.assign(water, { x: -50, y: 0, z: -30.29 });

    expect(controller.handle(ice.playerId, 'action/lunge', {}, 2_000)).toBeNull();
    expect(ice.lungeUntil).toBe(2_000 + GAMEPLAY.lungeDurationMs);
    expect(ice.lungeReadyAt).toBe(2_000 + GAMEPLAY.lungeCooldownMs);
    expect(ice.velocityZ).toBeLessThan(-GAMEPLAY.moveSpeed);
    expect(ice.verticalVelocity).toBe(GAMEPLAY.lungeVerticalSpeed);
    expect(controller.handle(ice.playerId, 'action/interact', {}, 2_000)).toBeNull();
    expect(water.status).toBe('frozen');
    expect(controller.handle(ice.playerId, 'action/lunge', {}, 2_100)).toBeNull();

    controller.advance(2_550);
    const lungeVelocityX = ice.velocityX;
    const lungeVelocityZ = ice.velocityZ;
    const lungeVerticalVelocity = ice.verticalVelocity;
    controller.advance(2_600);
    expect(ice.lungeUntil).toBe(0);
    expect(Math.hypot(ice.velocityX, ice.velocityZ)).toBeGreaterThan(0);
    expect(Math.hypot(ice.velocityX, ice.velocityZ)).toBeLessThan(
      Math.hypot(lungeVelocityX, lungeVelocityZ),
    );
    expect(ice.verticalVelocity).not.toBe(lungeVerticalVelocity);
    controller.advance(2_650);
    expect(controller.handle(ice.playerId, 'action/lunge', {}, 2_600)).toBeNull();
  });

  it('lets Water lunge and silently ignores lunge requests during cooldown', () => {
    const { water, controller } = fixture();

    expect(controller.handle(water.playerId, 'action/lunge', {}, 2_000)).toBeNull();
    expect(water.lungeUntil).toBe(2_000 + GAMEPLAY.lungeDurationMs);
    expect(controller.handle(water.playerId, 'action/lunge', {}, 2_100)).toBeNull();
  });

  it.each([
    ['D', 'ice', 1, 0],
    ['A', 'ice', -1, 0],
    ['W', 'water', 0, -1],
    ['S', 'water', 0, 1],
    ['W + D', 'ice', Math.SQRT1_2, -Math.SQRT1_2],
    ['W + A', 'water', -Math.SQRT1_2, -Math.SQRT1_2],
    ['S + D', 'ice', Math.SQRT1_2, Math.SQRT1_2],
    ['S + A', 'water', -Math.SQRT1_2, Math.SQRT1_2],
  ])('captures %s movement for a %s directional lunge', (_keys, team, x, z) => {
    const { ice, water, controller } = fixture();
    const player = team === 'ice' ? ice : water;
    expect(controller.handle(player.playerId, 'input/move', { x, z, sequence: 1 }, 2_000)).toBeNull();
    expect(controller.handle(player.playerId, 'action/lunge', {}, 2_000)).toBeNull();
    expect(player.lungeDirectionX).toBeCloseTo(x);
    expect(player.lungeDirectionZ).toBeCloseTo(z);
    expect(Math.hypot(player.lungeDirectionX, player.lungeDirectionZ)).toBeCloseTo(1);
  });

  it('keeps the captured lunge direction when later movement input changes', () => {
    const { ice, controller } = fixture();
    controller.handle(ice.playerId, 'input/move', { x: 1, z: 0, sequence: 1 }, 2_000);
    controller.handle(ice.playerId, 'action/lunge', {}, 2_000);
    controller.handle(ice.playerId, 'input/move', { x: 0, z: -1, sequence: 2 }, 2_050);
    controller.advance(2_050);
    expect(ice.lungeDirectionX).toBe(1);
    expect(ice.lungeDirectionZ).toBe(0);
  });
});

describe('pre-game spectator role', () => {
  it('keeps a lobby-selected spectator out of gameplay when the match starts', () => {
    const state = new LobbyState();
    state.phase = 'playing';
    state.phaseDeadline = 300_000;
    const spectator = new PlayerState();
    const water = new PlayerState();
    Object.assign(spectator, { playerId: 'spectator', team: 'none', roleChoice: 'spectator' });
    Object.assign(water, { playerId: 'water', team: 'water' });
    state.players.set(spectator.playerId, spectator);
    state.players.set(water.playerId, water);
    const controller = new GameplayController(state);

    controller.start(1_000);

    expect(spectator).toMatchObject({ team: 'none', roleChoice: 'spectator', status: 'spectator' });
    expect(water).toMatchObject({ team: 'water', status: 'alive', spawnGeneration: 1 });
  });

  it('rejects movement, tag, and lunge intents from a lobby-selected spectator', () => {
    const { ice, water, controller } = fixture();
    ice.team = 'none';
    ice.roleChoice = 'spectator';
    ice.status = 'spectator';

    expect(
      controller.handle(
        ice.playerId,
        'input/move',
        { x: 1, z: 0, sequence: 1, slide: true, sprint: true },
        2_000,
      ),
    ).toContain('Spectators');
    expect(controller.handle(ice.playerId, 'action/interact', {}, 2_000)).toContain('Spectators');
    expect(controller.handle(ice.playerId, 'action/lunge', {}, 2_000)).toContain('Spectators');
    expect(water.status).toBe('alive');
    expect(ice.lungeUntil).toBe(0);
    expect(ice.isSliding).toBe(false);
  });

  it('keeps frozen Water players in the frozen game state', () => {
    const { water, controller } = fixture();
    water.status = 'frozen';

    controller.advance(1_050);

    expect(water.status).toBe('frozen');
  });
});
