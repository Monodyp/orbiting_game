import { expect, it } from 'vitest';
import { arenaHalfExtentForMap } from '@ice-water/shared';
import { LobbyState, PlayerState } from './lobby-state.js';
import { isRoleAssignmentMode, isRoleChoice, LobbyController } from './lobby-controller.js';

function fixture(count: number) {
  const state = new LobbyState();
  for (let index = 0; index < count; index++) {
    const player = new PlayerState();
    player.playerId = String(index);
    state.players.set(player.playerId, player);
  }
  state.hostPlayerId = '0';
  return { state, controller: new LobbyController(state, 1_000, () => 0) };
}

function assignedCount(state: LobbyState, team: 'ice' | 'water') {
  return [...state.players.values()].filter((player) => player.team === team).length;
}

it('accepts only supported role-assignment modes and player choices', () => {
  expect(isRoleAssignmentMode('random')).toBe(true);
  expect(isRoleAssignmentMode('user-picks')).toBe(true);
  expect(isRoleAssignmentMode('host-ice')).toBe(false);
  expect(isRoleAssignmentMode(null)).toBe(false);
  expect(isRoleChoice('ice')).toBe(true);
  expect(isRoleChoice('water')).toBe(true);
  expect(isRoleChoice('spectator')).toBe(true);
  expect(isRoleChoice('random')).toBe(false);
  expect(isRoleChoice(0)).toBe(false);
});

it('defaults room role mode and player choices to random', () => {
  const { state } = fixture(2);
  expect(state.roleAssignmentMode).toBe('random');
  expect([...state.players.values()].every((player) => player.roleChoice === 'random')).toBe(true);
});

it('rejects a one-player start because it cannot populate both teams', () => {
  const { controller } = fixture(1);
  expect(controller.start('intruder', 0)).toContain('host');
  expect(controller.start('0', 0)).toContain('two active players');
});

it('allows the host to start a two-player match', () => {
  const { state, controller } = fixture(2);
  expect(controller.start('0', 0)).toBeNull();
  expect(controller.start('0', 1)).toContain('already');
  controller.tick(999);
  expect(state.phase).toBe('countdown');
  controller.tick(1_000);
  expect(state.phase).toBe('playing');
  expect(assignedCount(state, 'ice')).toBe(1);
  expect(assignedCount(state, 'water')).toBe(1);
});

it('cancels a countdown with no connected players and transfers host', () => {
  const { state, controller } = fixture(2);
  controller.start('0', 0);
  for (const player of state.players.values()) player.isConnected = false;
  controller.tick(1_000);
  controller.transferHost();
  expect(state.phase).toBe('lobby');
  expect(state.hostPlayerId).toBe('');
});

it('forces Frostline when the countdown starts the match', () => {
  const { state, controller } = fixture(2);
  controller.start('0', 0);
  state.mapId = 'original';
  state.arenaHalfExtent = 125;

  controller.tick(1_000);

  expect(state.phase).toBe('playing');
  expect(state.mapId).toBe('frostline');
  expect(state.arenaHalfExtent).toBe(arenaHalfExtentForMap('frostline'));
});

it.each([
  [5, 1, 4],
  [6, 1, 5],
  [8, 2, 6],
  [10, 2, 8],
  [25, 5, 20],
  [50, 10, 40],
  [100, 20, 80],
])('automatically assigns %i connected players as %i Ice and %i Water', (count, ice, water) => {
  const { state, controller } = fixture(count);
  controller.start('0', 0);
  controller.tick(1_000);
  expect(assignedCount(state, 'ice')).toBe(ice);
  expect(assignedCount(state, 'water')).toBe(water);
});

it('does not assign disconnected roster entries at countdown completion', () => {
  const { state, controller } = fixture(5);
  state.players.get('4')!.isConnected = false;
  controller.start('0', 0);
  controller.tick(1_000);
  expect(assignedCount(state, 'ice')).toBe(1);
  expect(assignedCount(state, 'water')).toBe(3);
  expect(state.players.get('4')!.team).toBe('unassigned');
});

it('excludes explicit spectators from the active Ice/Water ratio', () => {
  const { state, controller } = fixture(10);
  state.players.get('8')!.roleChoice = 'spectator';
  state.players.get('9')!.roleChoice = 'spectator';

  expect(controller.participatingCount()).toBe(8);
  controller.start('0', 0);
  controller.tick(1_000);

  expect(assignedCount(state, 'ice')).toBe(2);
  expect(assignedCount(state, 'water')).toBe(6);
  expect(state.players.get('8')!.team).toBe('none');
  expect(state.players.get('9')!.team).toBe('none');
});

it('does not start when fewer than two active players remain after spectator choices', () => {
  const { state, controller } = fixture(3);
  state.players.get('1')!.roleChoice = 'spectator';
  state.players.get('2')!.roleChoice = 'spectator';

  expect(controller.participatingCount()).toBe(1);
  expect(controller.start('0', 0)).toContain('two active players');
});

it('keeps spectator as an explicit choice in both assignment modes', () => {
  for (const roleAssignmentMode of ['random', 'user-picks'] as const) {
    const { state, controller } = fixture(4);
    state.roleAssignmentMode = roleAssignmentMode;
    state.players.get('3')!.roleChoice = 'spectator';

    controller.start('0', 0);
    controller.tick(1_000);

    expect(state.players.get('3')!.team).toBe('none');
    expect(assignedCount(state, 'ice') + assignedCount(state, 'water')).toBe(3);
  }
});

it('reserves the human host as Ice in development while keeping the normal team total', () => {
  const { state } = fixture(5);
  state.players.get('1')!.isBot = true;
  const controller = new LobbyController(state, 1_000, () => 0, true);

  controller.start('0', 0);
  controller.tick(1_000);

  expect(state.players.get('0')!.team).toBe('ice');
  expect(state.players.get('1')!.team).toBe('water');
  expect(assignedCount(state, 'ice')).toBe(1);
  expect(assignedCount(state, 'water')).toBe(4);
});

it('uses normal shuffled assignment when the development override is disabled', () => {
  const { state } = fixture(5);
  const controller = new LobbyController(state, 1_000, () => 0, false);

  controller.start('0', 0);
  controller.tick(1_000);

  expect(state.players.get('0')!.team).toBe('water');
  expect(assignedCount(state, 'ice')).toBe(1);
  expect(assignedCount(state, 'water')).toBe(4);
});

it('honors valid role requests while enforcing balanced team sizes', () => {
  const { state, controller } = fixture(5);
  state.roleAssignmentMode = 'user-picks';
  state.players.get('0')!.roleChoice = 'water';
  state.players.get('1')!.roleChoice = 'water';
  state.players.get('2')!.roleChoice = 'ice';
  state.players.get('3')!.roleChoice = 'ice';

  controller.start('0', 0);
  controller.tick(1_000);

  expect(assignedCount(state, 'ice')).toBe(1);
  expect(assignedCount(state, 'water')).toBe(4);
  expect(state.players.get('0')!.team).toBe('water');
  expect(state.players.get('2')!.team).toBe('ice');
  expect(state.players.get('3')!.team).toBe('water');
});

it('resolves unanimous role requests without leaving either team empty', () => {
  const { state, controller } = fixture(4);
  state.roleAssignmentMode = 'user-picks';
  for (const player of state.players.values()) player.roleChoice = 'ice';

  controller.start('0', 0);
  controller.tick(1_000);

  expect(assignedCount(state, 'ice')).toBe(1);
  expect(assignedCount(state, 'water')).toBe(3);
});
