import {
  distanceSquared,
  hasGameplayLineOfSight,
  spawnPointsForMap,
  terrainHeightAt,
  type Position,
} from '@ice-water/shared';
import type { LobbyState, PlayerState } from '../rooms/lobby-state.js';
export function selectSpawn(
  state: LobbyState,
  player: PlayerState,
): Position {
  const spawnPoints = spawnPointsForMap(state.mapId);
  let best = spawnPoints[0]!,
    bestScore = -Infinity;
  for (const spawn of spawnPoints) {
    let score = 10000;
    const eye = { ...spawn, y: terrainHeightAt(spawn, state.mapId) + 1.6 };
    for (const other of state.players.values()) {
      if (
        other.playerId === player.playerId ||
        other.status !== 'alive' ||
        (state.gameMode === 'tdm' && other.team === player.team)
      )
        continue;
      const distance = distanceSquared(spawn, other);
      score = Math.min(
        score,
        distance -
          (hasGameplayLineOfSight(eye, { x: other.x, y: other.y + 1.6, z: other.z }, state.mapId)
            ? 350
            : 0),
      );
    }
    if (score > bestScore) {
      best = spawn;
      bestScore = score;
    }
  }
  return { ...best };
}
