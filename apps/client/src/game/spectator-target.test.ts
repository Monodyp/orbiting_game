import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@ice-water/shared';
import {
  cycleSpectatorTarget,
  eligibleSpectatorTargets,
  resolveSpectatorTarget,
  spectatorCameraPose,
} from './spectator-target.js';

const players = [
  { playerId: 'active-a', team: 'ice', status: 'alive', isConnected: true },
  { playerId: 'frozen', team: 'water', status: 'frozen', isConnected: true },
  { playerId: 'spectator', team: 'none', status: 'spectator', isConnected: true },
  { playerId: 'active-b', team: 'water', status: 'alive', isConnected: true },
  { playerId: 'disconnected', team: 'ice', status: 'alive', isConnected: false },
] as PlayerView[];

describe('spectator target selection', () => {
  it('includes only connected active players', () => {
    expect(eligibleSpectatorTargets(players).map((player) => player.playerId)).toEqual([
      'active-a',
      'frozen',
      'active-b',
    ]);
  });

  it('resolves spectators and disconnected players to a connected Ice/Water member', () => {
    expect(resolveSpectatorTarget(players, 'spectator')?.playerId).toBe('active-a');
    expect(resolveSpectatorTarget(players, 'active-b')?.playerId).toBe('active-b');
  });

  it('cycles between Ice/Water targets and wraps in either direction', () => {
    expect(cycleSpectatorTarget(players, 'active-a', 1)?.playerId).toBe('frozen');
    expect(cycleSpectatorTarget(players, 'active-b', 1)?.playerId).toBe('active-a');
    expect(cycleSpectatorTarget(players, 'active-a', -1)?.playerId).toBe('active-b');
  });

  it('chooses a replacement when the old target disconnects or becomes a spectator', () => {
    expect(cycleSpectatorTarget(players, 'spectator', 1)?.playerId).toBe('active-a');
    expect(resolveSpectatorTarget(players, 'disconnected')?.playerId).toBe('active-a');
  });

  it('handles a room with no connected Ice/Water players', () => {
    const spectators = players.filter((player) => player.team === 'none');
    expect(eligibleSpectatorTargets(spectators).length).toBe(0);
    expect(resolveSpectatorTarget(spectators, 'spectator')).toBeUndefined();
    expect(cycleSpectatorTarget(spectators, 'spectator', 1)).toBeUndefined();
  });

  it('moves the spectator camera with its selected player and facing direction', () => {
    expect(spectatorCameraPose({ x: 1, y: 2, z: 3, yaw: 0 })).toEqual({
      position: { x: 1, y: 4.3, z: 8 },
      lookAt: { x: 1, y: 3.2, z: 3 },
      yaw: 0,
    });
    const pose = spectatorCameraPose({ x: 10, y: 4, z: -2, yaw: Math.PI / 2 });
    expect(pose.position.x).toBeCloseTo(15);
    expect(pose.position.y).toBeCloseTo(6.3);
    expect(pose.position.z).toBeCloseTo(-2);
    expect(pose.lookAt).toEqual({ x: 10, y: 5.2, z: -2 });
    expect(pose.yaw).toBe(Math.PI / 2);
  });
});