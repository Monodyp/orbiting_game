import { randomInt } from 'node:crypto';
import { arenaHalfExtentForMap, MIN_PLAYERS } from '@ice-water/shared';
import type { PlayerRole, RoleAssignmentMode } from '@ice-water/shared';
import type { LobbyState } from './lobby-state.js';

export function isRoleAssignmentMode(value: unknown): value is RoleAssignmentMode {
  return value === 'random' || value === 'user-picks';
}

export function isRoleChoice(value: unknown): value is PlayerRole {
  return value === 'ice' || value === 'water' || value === 'spectator';
}

export class LobbyController {
  constructor(
    private readonly state: LobbyState,
    private readonly countdownMs: number,
    private readonly pick: (max: number) => number = randomInt,
    private readonly shouldForceHostIce = false,
  ) {}
  start(playerId: string, now: number): string | null {
    if (this.state.hostPlayerId !== playerId) return 'Only the host can start the match';
    if (this.state.phase !== 'lobby') return 'The match has already started';
    if (this.participatingCount() < MIN_PLAYERS)
      return 'At least two active players are needed';
    this.state.phase = 'countdown';
    this.state.phaseDeadline = now + this.countdownMs;
    this.state.serverTime = now;
    return null;
  }
  tick(now: number): boolean {
    this.state.serverTime = now;
    if (this.state.phase !== 'countdown') return false;
    if (this.participatingCount() < MIN_PLAYERS) {
      this.state.phase = 'lobby';
      this.state.phaseDeadline = 0;
      return true;
    }
    if (now < this.state.phaseDeadline) return false;
    this.state.mapId = 'frostline';
    this.state.arenaHalfExtent = arenaHalfExtentForMap('frostline');
    const roster = [...this.state.players.values()];
    for (const player of roster)
      if (player.roleChoice === 'spectator') player.team = 'none';
    const players = roster.filter((player) => player.isConnected && player.roleChoice !== 'spectator');
    for (let i = players.length - 1; i > 0; i--) {
      const j = this.pick(i + 1);
      [players[i], players[j]] = [players[j]!, players[i]!];
    }
    // Keep the one-to-four target while guaranteeing both teams are populated.
    const iceCount = Math.min(players.length - 1, Math.max(1, Math.round(players.length / 5)));
    const host = this.state.players.get(this.state.hostPlayerId);
    const forcedHost =
      this.shouldForceHostIce &&
      host?.isConnected &&
      !host.isBot &&
      host.roleChoice !== 'spectator'
        ? host
        : undefined;
    const assignablePlayers = forcedHost
      ? players.filter((player) => player.playerId !== forcedHost.playerId)
      : players;
    let iceSlots = Math.max(0, iceCount - Number(!!forcedHost));
    let waterSlots = players.length - iceCount;
    if (forcedHost) forcedHost.team = 'ice';
    if (this.state.roleAssignmentMode === 'user-picks') {
      for (const team of ['ice', 'water'] as const) {
        for (const player of assignablePlayers) {
          if (player.roleChoice !== team) continue;
          const hasSlot = team === 'ice' ? iceSlots > 0 : waterSlots > 0;
          if (!hasSlot) continue;
          player.team = team;
          if (team === 'ice') iceSlots--;
          else waterSlots--;
        }
      }
      for (const player of assignablePlayers) {
        if (player.team !== 'unassigned') continue;
        if (iceSlots > 0) {
          player.team = 'ice';
          iceSlots--;
        } else {
          player.team = 'water';
          waterSlots--;
        }
      }
    } else {
      for (const [index, player] of assignablePlayers.entries())
        player.team = index < iceSlots ? 'ice' : 'water';
    }
    this.state.phase = 'playing';
    this.state.phaseDeadline = 0;
    return true;
  }
  connectedCount(): number {
    return [...this.state.players.values()].filter((p) => p.isConnected).length;
  }
  participatingCount(): number {
    return [...this.state.players.values()].filter(
      (player) => player.isConnected && player.roleChoice !== 'spectator',
    ).length;
  }
  transferHost(): void {
    const host = this.state.players.get(this.state.hostPlayerId);
    if (host?.isConnected && !host.isBot) return;
    this.state.hostPlayerId =
      [...this.state.players.values()].find((p) => p.isConnected && !p.isBot)?.playerId ?? '';
  }
}
