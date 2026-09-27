import type { PlayerView } from '@ice-water/shared';

export interface SpectatorCameraPose {
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
  yaw: number;
}

export function eligibleSpectatorTargets(players: readonly PlayerView[]): PlayerView[] {
  return players.filter(
    (player) =>
      player.isConnected &&
      (player.team === 'ice' || player.team === 'water') &&
      (player.status === 'alive' || player.status === 'frozen'),
  );
}

export function resolveSpectatorTarget(
  players: readonly PlayerView[],
  playerId?: string,
): PlayerView | undefined {
  const eligible = eligibleSpectatorTargets(players);
  return eligible.find((player) => player.playerId === playerId) ?? eligible[0];
}

export function cycleSpectatorTarget(
  players: readonly PlayerView[],
  playerId: string | undefined,
  direction: -1 | 1,
): PlayerView | undefined {
  const eligible = eligibleSpectatorTargets(players);
  if (eligible.length === 0) return undefined;
  const current = eligible.findIndex((player) => player.playerId === playerId);
  if (current < 0) return direction === 1 ? eligible[0] : eligible.at(-1);
  return eligible[(current + direction + eligible.length) % eligible.length];
}

export function spectatorCameraPose(
  target: Pick<PlayerView, 'x' | 'y' | 'z' | 'yaw'>,
): SpectatorCameraPose {
  return {
    position: {
      x: target.x + Math.sin(target.yaw) * 5,
      y: target.y + 2.3,
      z: target.z + Math.cos(target.yaw) * 5,
    },
    lookAt: { x: target.x, y: target.y + 1.2, z: target.z },
    yaw: target.yaw,
  };
}