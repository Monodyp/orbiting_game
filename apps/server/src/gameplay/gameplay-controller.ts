import {
  GAMEPLAY,
  simulateMovement,
  terrainHeightAt,
  islandSupportHeightAt,
  isMoveInput,
  isInteractionIntent,
  distanceSquared3d,
  type GameplayEvent,
  type GameplayMessages,
  type MoveInput,
} from '@ice-water/shared';
import type { LobbyState, PlayerState } from '../rooms/lobby-state.js';
import { selectSpawn } from './spawn-manager.js';
interface PendingInput {
  input: MoveInput;
  receivedAt: number;
}
export class GameplayController {
  private readonly inputs = new Map<string, PendingInput[]>();
  private readonly latestInputs = new Map<string, MoveInput>();
  private readonly sequences = new Map<string, number>();
  private readonly budgets = new Map<
    string,
    { moves: number; actions: number; resetsAt: number }
  >();
  private lastTick = 0;
  private hasStarted = false;
  constructor(
    private readonly state: LobbyState,
    private readonly emit: (event: GameplayEvent) => void = () => {},
  ) {}
  start(now: number): void {
    this.hasStarted = true;
    this.lastTick = now;
    this.inputs.clear();
    this.latestInputs.clear();
    for (const p of this.state.players.values())
      if (p.team === 'none') {
        p.status = 'spectator';
        p.velocityX = 0;
        p.velocityZ = 0;
        p.verticalVelocity = 0;
      } else if (p.isConnected && (p.team === 'ice' || p.team === 'water'))
        this.spawn(p, now);
  }
  advance(now: number): void {
    if (!this.hasStarted || now < this.lastTick) return;
    this.lastTick = Math.max(this.lastTick, now - 250);
    while (now - this.lastTick >= GAMEPLAY.tickMs) {
      this.lastTick += GAMEPLAY.tickMs;
      this.step(this.lastTick);
    }
  }
  handle(id: string, type: keyof GameplayMessages, payload: unknown, now: number): string | null {
    const player = this.state.players.get(id);
    if (!player?.isConnected || player.team === 'unassigned') return 'Player is not available';
    if (player.team === 'none') return 'Spectators cannot perform gameplay actions';
    let budget = this.budgets.get(id);
    if (!budget || now >= budget.resetsAt) {
      budget = { moves: 0, actions: 0, resetsAt: now + 1000 };
      this.budgets.set(id, budget);
    }
    if (type === 'input/move' ? ++budget.moves > 30 : ++budget.actions > 25)
      return 'Too many gameplay requests';
    if (!this.hasStarted || !this.canPlay(now)) return 'Gameplay is unavailable in this phase';
    if (player.status === 'spectator') return 'Spectators cannot perform gameplay actions';
    if (type === 'input/move') {
      if (!isMoveInput(payload)) return 'Invalid movement input';
      const previous = this.sequences.get(id) ?? player.inputSequence;
      if (payload.sequence <= previous || payload.sequence > previous + 128)
        return 'Stale or invalid input sequence';
      this.sequences.set(id, payload.sequence);
      this.latestInputs.set(id, payload);
      if (player.status !== 'alive') {
        player.inputSequence = payload.sequence;
        return null;
      }
      const queue = this.inputs.get(id) ?? [];
      if (queue.length >= GAMEPLAY.maxInputQueue) queue.shift();
      queue.push({ input: payload, receivedAt: now });
      this.inputs.set(id, queue);
      return null;
    }
    this.advance(now);
    if (player.status !== 'alive') return 'Player is not alive';
    if (type === 'action/lunge') {
      if (!isInteractionIntent(payload)) return 'Invalid lunge request';
      if (player.team !== 'ice' && player.team !== 'water') return null;
      if (player.lungeUntil > now || player.lungeReadyAt > now) return null;
      player.lungeUntil = now + GAMEPLAY.lungeDurationMs;
      player.lungeReadyAt = now + GAMEPLAY.lungeCooldownMs;
      player.isGrounded = false;
      player.isSliding = false;
      player.isCrouching = false;
      const input = this.latestInputs.get(id);
      const yaw = input?.yaw ?? player.yaw;
      if (input?.yaw !== undefined) player.yaw = input.yaw;
      const length = Math.hypot(input?.x ?? 0, input?.z ?? 0);
      player.lungeDirectionX = length > 0 ? (input?.x ?? 0) / length : -Math.sin(yaw);
      player.lungeDirectionZ = length > 0 ? (input?.z ?? 0) / length : -Math.cos(yaw);
      player.verticalVelocity = GAMEPLAY.lungeVerticalSpeed;
      player.velocityX =
        player.lungeDirectionX * GAMEPLAY.moveSpeed * GAMEPLAY.sprintMultiplier * GAMEPLAY.lungeSpeedMultiplier;
      player.velocityZ =
        player.lungeDirectionZ * GAMEPLAY.moveSpeed * GAMEPLAY.sprintMultiplier * GAMEPLAY.lungeSpeedMultiplier;
      return null;
    }
    if (type === 'action/interact') {
      if (!isInteractionIntent(payload)) return 'Invalid interaction';
      this.interact(player, now);
      return null;
    }
    return 'Unknown gameplay request';
  }
  disconnect(id: string): void {
    this.inputs.delete(id);
    this.latestInputs.delete(id);
    const p = this.state.players.get(id);
    if (p) {
      p.velocityX = 0;
      p.velocityZ = 0;
      p.isSliding = false;
    }
  }
  /** Applies the ordinary authoritative frozen status for a Blizzard selection. */
  freezeForBlizzard(target: PlayerState, now: number): void {
    if (target.team !== 'water' || target.status !== 'alive') return;
    target.status = 'frozen';
    target.rescueProgress = 0;
    target.velocityX = 0;
    target.velocityZ = 0;
    target.verticalVelocity = 0;
    target.isSliding = false;
    this.emit({
      type: 'player/frozen',
      payload: { playerId: target.playerId, attackerId: 'blizzard', serverTime: now },
    });
  }
  private canPlay(now: number): boolean {
    return this.state.phase === 'playing' && now < this.state.phaseDeadline;
  }
  private step(now: number): void {
    if (!this.canPlay(now)) return;
    for (const p of this.state.players.values()) {
      if (p.status === 'frozen') {
        this.advanceFrozen(p, now);
        continue;
      }
      if (p.status !== 'alive') continue;
      const queue = this.inputs.get(p.playerId);
      let pending = queue?.[0];
      while (pending && now - pending.receivedAt > GAMEPLAY.inputExpiryMs) {
        p.inputSequence = pending.input.sequence;
        queue!.shift();
        pending = queue?.[0];
      }
      const ready = pending && pending.receivedAt <= now ? queue!.shift() : undefined;
      const input = ready?.input ?? { x: 0, z: 0, sequence: p.inputSequence };
      if (ready) {
        p.inputSequence = input.sequence;
        p.yaw = input.yaw ?? p.yaw;
        p.pitch = input.pitch ?? p.pitch;
      }
      if (p.lungeUntil && now >= p.lungeUntil) {
        p.lungeUntil = 0;
      }
      const isLunging = p.lungeUntil > now;
      const movementInput = isLunging
        ? {
            ...input,
            x: p.lungeDirectionX,
            z: p.lungeDirectionZ,
            jump: false,
            slide: false,
            sprint: false,
            crouch: false,
          }
        : input;
      Object.assign(
        p,
        simulateMovement(
          p,
          movementInput,
          now,
          GAMEPLAY.tickMs / 1000,
          isLunging ? GAMEPLAY.sprintMultiplier * GAMEPLAY.lungeSpeedMultiplier : 1,
          this.state.mapId,
          1,
        ),
      );
    }
  }
  private advanceFrozen(target: PlayerState, now: number): void {
    Object.assign(
      target,
      simulateMovement(
        target,
        { x: 0, z: 0, sequence: target.inputSequence },
        now,
        GAMEPLAY.tickMs / 1000,
        1,
        this.state.mapId,
      ),
    );
  }
  private interact(player: PlayerState, now: number): void {
    const target = [...this.state.players.values()]
      .filter((candidate) => candidate.playerId !== player.playerId)
      .filter((candidate) =>
        player.team === 'ice'
          ? candidate.team === 'water' && candidate.status === 'alive'
          : player.team === 'water' && candidate.team === 'water' && candidate.status === 'frozen',
      )
      .filter((candidate) => distanceSquared3d(player, candidate) <= GAMEPLAY.interactionRange ** 2)
      .sort((a, b) => distanceSquared3d(player, a) - distanceSquared3d(player, b))[0];
    if (!target) return;
    if (player.team === 'ice' && target.team === 'water' && target.status === 'alive') {
      target.status = 'frozen';
      target.rescueProgress = 0;
      this.applyFreezeKnockback(target, player);
      this.emit({
        type: 'player/frozen',
        payload: { playerId: target.playerId, attackerId: player.playerId, serverTime: now },
      });
    } else if (player.team === 'water' && target.team === 'water' && target.status === 'frozen') {
      target.status = 'alive';
      target.protectedUntil = now + GAMEPLAY.freezeProtectionMs;
      target.rescueProgress = 0;
      this.applyFreezeKnockback(target, player);
      this.emit({
        type: 'player/rescued',
        payload: { playerId: target.playerId, rescuerIds: [player.playerId], serverTime: now },
      });
    }
  }
  private applyFreezeKnockback(target: PlayerState, source: PlayerState): void {
    const distance = Math.hypot(target.x - source.x, target.z - source.z);
    if (distance > 0) {
      target.velocityX = ((target.x - source.x) / distance) * GAMEPLAY.freezeKnockbackSpeed;
      target.velocityZ = ((target.z - source.z) / distance) * GAMEPLAY.freezeKnockbackSpeed;
    } else {
      target.velocityX = 0;
      target.velocityZ = -GAMEPLAY.freezeKnockbackSpeed;
    }
    target.verticalVelocity = GAMEPLAY.freezeKnockbackVerticalSpeed;
    target.isGrounded = false;
  }
  private spawn(p: PlayerState, now: number): void {
    const spawn = selectSpawn(this.state, p);
    this.inputs.delete(p.playerId);
    p.inputSequence = this.sequences.get(p.playerId) ?? p.inputSequence;
    // Use islandSupportHeightAt for the island map so the spawn Y correctly
    // samples the multi-cell mesh surface. islandHeightAt (called by
    // terrainHeightAt) only queries one grid cell and returns 0 at cell
    // boundaries, causing players/bots to spawn at sea level.
    const spawnY =
      this.state.mapId === 'island'
        ? islandSupportHeightAt(spawn, 30, GAMEPLAY.playerRadius)
        : terrainHeightAt(spawn, this.state.mapId);
    Object.assign(p, spawn, {
      y: spawnY,
      velocityX: 0,
      velocityZ: 0,
      verticalVelocity: 0,
      isGrounded: true,
      isSliding: false,
      isCrouching: false,
      slideUntil: 0,
      slideReadyAt: 0,
      rescueProgress: 0,
      lungeUntil: 0,
      lungeReadyAt: 0,
      lungeDirectionX: 0,
      lungeDirectionZ: 0,
      isWallRunning: false,
    });
    p.status = 'alive';
    p.protectedUntil = now + GAMEPLAY.spawnProtectionMs;
    p.spawnGeneration++;
    p.yaw = Math.atan2(spawn.x, spawn.z);
    p.pitch = 0;
  }
}
