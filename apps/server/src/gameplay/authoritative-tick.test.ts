import { expect, it } from 'vitest';
import { LobbyState, PlayerState } from '../rooms/lobby-state.js';
import { GameplayController } from './gameplay-controller.js';
import { MatchController } from './match-controller.js';
import { advanceAuthoritativeTick } from './authoritative-tick.js';
it('applies only pre-deadline steps and locks gameplay before survival-threshold resolution', () => {
  const state = new LobbyState(),
    p = new PlayerState();
  p.playerId = 'p';
  p.team = 'ice';
  state.players.set('p', p);
  const gameplay = new GameplayController(state),
    match = new MatchController(
      state,
      () => {},
      (now) => gameplay.start(now),
    );
  match.start(1000);
  Object.assign(p, { x: 0, y: 0, z: -34 });
  state.phaseDeadline = 1100;
  gameplay.handle('p', 'input/move', { sequence: 1, x: 1, z: 0 }, 1000);
  gameplay.handle('p', 'input/move', { sequence: 2, x: 1, z: 0 }, 1050);
  advanceAuthoritativeTick(1100, gameplay, match);
  expect(p.inputSequence).toBe(1);
  expect(p.x).toBeGreaterThan(0);
  expect(state.phase).toBe('finished');
  expect(gameplay.handle('p', 'action/interact', {}, 1100)).toContain('phase');
});
