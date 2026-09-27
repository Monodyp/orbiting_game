import { describe, expect, it, vi } from 'vitest';
import { GAMEPLAY } from '@ice-water/shared';
import { LobbyState, PlayerState } from '../rooms/lobby-state.js';
import { MatchController } from './match-controller.js';

function fixture(waterCount = 0, iceCount = 1) {
  const state = new LobbyState();
  for (let index = 0; index < iceCount; index++) {
    const player = new PlayerState();
    player.playerId = `ice-${index}`;
    player.team = 'ice';
    state.players.set(player.playerId, player);
  }
  for (let index = 0; index < waterCount; index++) {
    const player = new PlayerState();
    player.playerId = `water-${index}`;
    player.team = 'water';
    state.players.set(player.playerId, player);
  }
  const onResult = vi.fn();
  const onResultExpired = vi.fn();
  const start = vi.fn();
  const controller = new MatchController(state, () => {}, start, { onResult, onResultExpired });
  controller.start(1_000);
  return { state, controller, onResult, onResultExpired, start };
}

function weatherStateAtSnowCheckpoint(waterCount: number, unfrozenCount: number) {
  const state = new LobbyState();
  for (let index = 0; index < waterCount; index++) {
    const player = new PlayerState();
    player.playerId = `water-${index}`;
    player.team = 'water';
    if (index >= unfrozenCount) player.status = 'frozen';
    state.players.set(player.playerId, player);
  }
  const controller = new MatchController(state, () => {}, vi.fn());
  controller.start(1_000);
  controller.tick(state.phaseDeadline - GAMEPLAY.snowStartRemainingMs);
  return { state, controller };
}

describe('Ice Ice Water match resolution', () => {
  it('records original Water count once and updates the authoritative unfrozen count', () => {
    const { state, controller } = fixture(5);
    expect(state.waterStartedCount).toBe(5);
    expect(state.waterUnfrozenCount).toBe(5);

    state.players.get('water-0')!.status = 'frozen';
    const spectator = new PlayerState();
    Object.assign(spectator, {
      playerId: 'spectator',
      team: 'none',
      roleChoice: 'spectator',
      status: 'spectator',
    });
    state.players.set(spectator.playerId, spectator);
    controller.tick(1_100);
    expect(state.waterStartedCount).toBe(5);
    expect(state.waterUnfrozenCount).toBe(4);

    state.players.get('water-0')!.status = 'alive';
    controller.tick(1_150);
    expect(state.waterUnfrozenCount).toBe(5);
  });

  it('ends immediately only when every original Water player is frozen', () => {
    const { state, controller, onResult } = fixture(2);
    state.players.get('water-0')!.status = 'frozen';
    state.players.get('water-1')!.status = 'frozen';
    controller.tick(2_000);

    expect(state.phase).toBe('finished');
    expect(state.matchWinner).toBe('ice');
    expect(state.resultReason).toBe('all-frozen');
    expect(onResult).toHaveBeenCalledWith(
      { winner: 'ice', reason: 'all-frozen', gameMode: 'tdm' },
      1_000,
      2_000,
    );
  });

  it('awards Water at the exact deadline when at least 60% remain unfrozen', () => {
    const { state, controller, onResult } = fixture(20);
    for (let index = 0; index < 8; index++) state.players.get(`water-${index}`)!.status = 'frozen';
    const deadline = state.phaseDeadline;
    controller.tick(deadline - 1);
    expect(state.phase).toBe('playing');
    controller.tick(deadline);
    expect(state.waterUnfrozenCount).toBe(12);
    expect(state.matchWinner).toBe('water');
    expect(state.resultReason).toBe('water-survived');
    expect(onResult.mock.calls[0]?.[2]).toBe(deadline);
  });

  it('awards Ice at timeout when fewer than 60% remain unfrozen', () => {
    const { state, controller } = fixture(20);
    for (let index = 0; index < 9; index++) state.players.get(`water-${index}`)!.status = 'frozen';
    controller.tick(state.phaseDeadline);
    expect(state.waterUnfrozenCount).toBe(11);
    expect(state.matchWinner).toBe('ice');
    expect(state.resultReason).toBe('water-below-threshold');
  });

  it.each([
    [9, 6],
    [11, 7],
    [19, 12],
  ])('rounds the %i-player Water threshold up to %i', (waterCount, requiredUnfrozen) => {
    const win = fixture(waterCount);
    for (let index = requiredUnfrozen; index < waterCount; index++)
      win.state.players.get(`water-${index}`)!.status = 'frozen';
    win.controller.tick(win.state.phaseDeadline);
    expect(win.state.matchWinner).toBe('water');

    const loss = fixture(waterCount);
    for (let index = requiredUnfrozen - 1; index < waterCount; index++)
      loss.state.players.get(`water-${index}`)!.status = 'frozen';
    loss.controller.tick(loss.state.phaseDeadline);
    expect(loss.state.matchWinner).toBe('ice');
  });

  it('requires at least 30 starting Water and ceil(70%) alive at snow start', () => {
    const { state: underMinimum, controller: underMinimumController } =
      weatherStateAtSnowCheckpoint(29, 29);
    expect(underMinimum.snowStarted).toBe(true);
    expect(underMinimum.waterStartedCount).toBe(29);
    expect(underMinimum.blizzardEnabled).toBe(false);
    underMinimumController.tick(
      underMinimum.phaseDeadline - GAMEPLAY.blizzardStartRemainingMs,
    );
    expect(underMinimum.blizzardStarted).toBe(false);

    expect(weatherStateAtSnowCheckpoint(30, 21).state.blizzardEnabled).toBe(true);
    expect(weatherStateAtSnowCheckpoint(30, 20).state.blizzardEnabled).toBe(false);
    expect(weatherStateAtSnowCheckpoint(40, 28).state.blizzardEnabled).toBe(true);
    expect(weatherStateAtSnowCheckpoint(40, 27).state.blizzardEnabled).toBe(false);
  });

  it('does not flip the Blizzard decision after snow has started', () => {
    const state = new LobbyState();
    for (let index = 0; index < 30; index++) {
      const player = new PlayerState();
      player.playerId = `water-${index}`;
      player.team = 'water';
      state.players.set(player.playerId, player);
    }
    const controller = new MatchController(state, () => {}, vi.fn());
    controller.start(1_000);

    controller.tick(state.phaseDeadline - GAMEPLAY.snowStartRemainingMs);
    expect(state.blizzardEnabled).toBe(true);

    const unfrozen = [...state.players.values()].filter((player) => player.team === 'water');
    for (const player of unfrozen.slice(0, 3)) player.status = 'frozen';
    controller.tick(state.phaseDeadline - GAMEPLAY.blizzardStartRemainingMs);
    expect(state.blizzardEnabled).toBe(true);
    state.players.get('water-0')!.status = 'alive';
    controller.tick(state.phaseDeadline - 500);
    expect(state.blizzardEnabled).toBe(true);
  });

  it('uses the 30% Blizzard freeze calculation against currently unfrozen Water only', () => {
    const state = new LobbyState();
    const frozenByBlizzard: string[] = [];
    for (let index = 0; index < 30; index++) {
      const player = new PlayerState();
      player.playerId = `water-${index}`;
      player.team = 'water';
      if (index >= 21) {
        player.status = 'frozen';
      }
      state.players.set(player.playerId, player);
    }
    const controller = new MatchController(state, () => {}, vi.fn(), {
      freezeForBlizzard: (player) => {
        player.status = 'frozen';
        frozenByBlizzard.push(player.playerId);
      },
    });
    controller.start(1_000);
    controller.tick(state.phaseDeadline - GAMEPLAY.snowStartRemainingMs);
    for (let index = 0; index < 6; index++)
      state.players.get(`water-${index}`)!.status = 'frozen';
    controller.tick(state.phaseDeadline - GAMEPLAY.blizzardStartRemainingMs);

    const remainingAlive = [...state.players.values()].filter(
      (player) => player.team === 'water' && player.status === 'alive',
    );
    expect(remainingAlive).toHaveLength(10);
    expect(frozenByBlizzard).toHaveLength(5);
    expect(new Set(frozenByBlizzard).size).toBe(5);
    expect(
      frozenByBlizzard.every((id) => {
        const index = Number(id.slice('water-'.length));
        return index >= 6 && index < 21;
      }),
    ).toBe(true);
    expect(state.blizzardStarted).toBe(true);
  });

  it('persists and disposes once through intermission', () => {
    const { state, controller, onResult, onResultExpired, start } = fixture(1);
    state.players.get('water-0')!.status = 'frozen';
    controller.tick(1_100);
    controller.tick(1_150);
    expect(state.phase).toBe('intermission');
    controller.tick(1_100 + GAMEPLAY.intermissionMs);
    controller.tick(999_999);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResultExpired).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
  });
});
