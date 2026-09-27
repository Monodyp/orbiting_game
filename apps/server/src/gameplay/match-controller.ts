import { GAMEPLAY, type MatchResult, type ServerMessages } from '@ice-water/shared';
import type { LobbyState, PlayerState } from '../rooms/lobby-state.js';
type MatchEvent =
  | { type: 'match/result'; payload: MatchResult }
  | { type: 'match/phase-changed'; payload: ServerMessages['match/phase-changed'] };
export interface MatchLifecycle {
  onResult?: (result: MatchResult, startedAt: number, completedAt: number) => void;
  onResultExpired?: () => void;
  freezeForBlizzard?: (player: PlayerState, now: number) => void;
}
export class MatchController {
  private hasStarted = false;
  private startedAt = 0;
  private hasExpired = false;
  constructor(
    private readonly state: LobbyState,
    private readonly emit: (event: MatchEvent) => void,
    private readonly onStart: (now: number) => void,
    private readonly lifecycle: MatchLifecycle = {},
  ) {}
  start(now: number): void {
    if (this.hasStarted) return;
    this.hasStarted = true;
    this.startedAt = now;
    this.state.phase = 'playing';
    this.state.phaseDeadline = now + GAMEPLAY.tdmTimeLimitMs;
    this.state.waterStartedCount = this.waterPlayers().length;
    this.state.snowStarted = false;
    this.state.blizzardEnabled = false;
    this.state.blizzardStarted = false;
    this.syncWaterUnfrozenCount();
    this.onStart(now);
    this.changed(now);
  }
  tick(now: number): boolean {
    if (!this.hasStarted) return false;
    if (this.state.phase === 'finished') {
      this.state.phase = 'intermission';
      this.changed(now);
      return true;
    }
    if (this.state.phase === 'intermission') {
      if (!this.hasExpired && now >= this.state.phaseDeadline) {
        this.hasExpired = true;
        this.lifecycle.onResultExpired?.();
        return true;
      }
      return false;
    }
    if (this.state.phase !== 'playing') return false;
    const waterPlayers = this.waterPlayers();
    this.syncWaterUnfrozenCount();
    this.advanceWeather(now);
    this.syncWaterUnfrozenCount();
    if (waterPlayers.length > 0 && waterPlayers.every((p) => p.status === 'frozen')) {
      const result: MatchResult = {
        winner: 'ice',
        reason: 'all-frozen',
        gameMode: this.state.gameMode,
      };
      this.state.phase = 'finished';
      this.state.matchWinner = result.winner;
      this.state.resultReason = result.reason;
      this.state.phaseDeadline = now + GAMEPLAY.intermissionMs;
      this.emit({ type: 'match/result', payload: result });
      this.changed(now);
      this.lifecycle.onResult?.(result, this.startedAt, now);
      return true;
    }
    if (waterPlayers.length > 0 && waterPlayers.every((p) => p.status === 'frozen')) {
      const result: MatchResult = {
        winner: 'ice',
        reason: 'all-frozen',
        gameMode: this.state.gameMode,
      };
      this.state.phase = 'finished';
      this.state.matchWinner = result.winner;
      this.state.resultReason = result.reason;
      this.state.phaseDeadline = now + GAMEPLAY.intermissionMs;
      this.emit({ type: 'match/result', payload: result });
      this.changed(now);
      this.lifecycle.onResult?.(result, this.startedAt, now);
      return true;
    }
    if (now < this.state.phaseDeadline) return false;
    const requiredUnfrozen = Math.ceil(this.state.waterStartedCount * 0.6);
    const waterSurvived = this.state.waterUnfrozenCount >= requiredUnfrozen;
    const result: MatchResult = {
      winner: waterSurvived ? 'water' : 'ice',
      reason: waterSurvived ? 'water-survived' : 'water-below-threshold',
      gameMode: this.state.gameMode,
    };
    const completedAt = this.state.phaseDeadline;
    this.state.phase = 'finished';
    this.state.matchWinner = result.winner;
    this.state.resultReason = result.reason;
    this.state.phaseDeadline = completedAt + GAMEPLAY.intermissionMs;
    this.emit({ type: 'match/result', payload: result });
    this.changed(now);
    this.lifecycle.onResult?.(result, this.startedAt, completedAt);
    return true;
  }
  private changed(now: number): void {
    this.emit({
      type: 'match/phase-changed',
      payload: {
        phase: this.state.phase,
        phaseDeadline: this.state.phaseDeadline,
        serverTime: now,
      },
    });
  }
  private waterPlayers() {
    return [...this.state.players.values()].filter((player) => player.team === 'water');
  }
  private syncWaterUnfrozenCount(): void {
    this.state.waterUnfrozenCount = this.waterPlayers().filter(
      (player) => player.status === 'alive',
    ).length;
  }
  private advanceWeather(now: number): void {
    const snowStartAt = this.state.phaseDeadline - GAMEPLAY.snowStartRemainingMs;
    const blizzardStartAt = this.state.phaseDeadline - GAMEPLAY.blizzardStartRemainingMs;

    if (!this.state.snowStarted && now >= snowStartAt) {
      this.state.snowStarted = true;
      this.syncWaterUnfrozenCount();
      const requiredUnfrozenForBlizzard = Math.ceil(this.state.waterStartedCount * 0.7);
      this.state.blizzardEnabled =
        this.state.waterStartedCount >= 30 &&
        this.state.waterUnfrozenCount >= requiredUnfrozenForBlizzard;
    }

    if (
      !this.state.blizzardStarted &&
      this.state.blizzardEnabled &&
      now >= blizzardStartAt
    ) {
      this.state.blizzardStarted = true;
      const eligible = this.waterPlayers().filter((player) => player.status === 'alive');
      const freezeCount = Math.max(0, Math.ceil(eligible.length * 0.3));
      for (const player of this.shuffle(eligible).slice(0, freezeCount)) {
        this.lifecycle.freezeForBlizzard?.(player, now);
      }
    }
  }
  private shuffle<T>(players: T[]): T[] {
    const result = [...players];
    for (let index = result.length - 1; index > 0; index--) {
      const target = Math.floor(Math.random() * (index + 1));
      [result[index], result[target]] = [result[target]!, result[index]!];
    }
    return result;
  }
}
