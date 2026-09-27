import {
  GAMEPLAY,
  isPlayPhase,
  type LobbyView,
  type PlayerView,
  type GameplayEvent,
  type GameplayEvents,
} from '@ice-water/shared';
import { GameInput } from '../input/game-input.js';
import { snapshot, type LobbyRoom } from './lobby-client.js';
import { LocalPrediction, RemoteInterpolation } from './player-motion.js';
import { ServerClock } from './server-clock.js';

export class GameSession {
  readonly input = new GameInput();
  readonly prediction = new LocalPrediction();
  readonly remotes = new Map<string, RemoteInterpolation>();
  readonly events: GameplayEvent[] = [];
  view: LobbyView;
  isConnected = true;
  ping = 0;
  private readonly clock = new ServerClock();
  private readonly cleanups: (() => void)[] = [];

  constructor(private readonly room: LobbyRoom, readonly playerId: string) {
    this.view = snapshot(room.state);
    const update = () => {
      this.view = snapshot(room.state);
      this.prediction.mapId = this.view.mapId;
      this.clock.update(this.view.serverTime);
      for (const player of this.view.players) {
        if (player.playerId === playerId) {
          if (player.status !== 'alive') {
            this.input.reset();
            this.prediction.reset();
          }
          this.prediction.reconcile(player, this.canMove(player));
        }
        else {
          let motion = this.remotes.get(player.playerId);
          if (!motion) {
            motion = new RemoteInterpolation();
            this.remotes.set(player.playerId, motion);
          }
          motion.push(player, this.view.serverTime);
        }
      }
    };
    room.onStateChange(update);
    this.cleanups.push(() => room.onStateChange.remove(update));
    const drop = () => {
      this.isConnected = false;
      this.input.reset();
      this.prediction.reset();
    };
    const reconnect = () => {
      this.isConnected = true;
      this.input.reset();
      this.prediction.reset();
      update();
    };
    room.onDrop(drop);
    room.onReconnect(reconnect);
    this.cleanups.push(() => room.onDrop.remove(drop), () => room.onReconnect.remove(reconnect));
    const subscribe = <K extends keyof GameplayEvents>(type: K) => {
      this.cleanups.push(
        room.onMessage<GameplayEvents[K]>(type, (payload) => {
          this.events.push({ type, payload } as GameplayEvent);
          if (this.events.length > 32) this.events.shift();
        }),
      );
    };
    subscribe('player/frozen');
    subscribe('player/rescued');
    this.cleanups.push(
      room.onMessage<{ sentAt: number }>('session/pong', (message) => {
        this.ping = Math.max(0, Math.round(performance.now() - message.sentAt));
      }),
    );
    update();
    const tick = window.setInterval(() => this.tick(), GAMEPLAY.tickMs);
    const ping = window.setInterval(() => {
      if (this.isConnected) room.send('session/ping', { sentAt: performance.now() });
    }, 2000);
    this.cleanups.push(
      () => window.clearInterval(tick),
      () => window.clearInterval(ping),
      this.input.bind(window),
    );
  }

  serverNow(): number {
    return this.clock.now();
  }

  local(): PlayerView | undefined {
    return this.view.players.find((player) => player.playerId === this.playerId);
  }

  canMove(player: PlayerView): boolean {
    return (
      this.isConnected &&
      player.isConnected &&
      player.status === 'alive' &&
      isPlayPhase(this.view.phase) &&
      this.view.phaseDeadline > 0 &&
      this.serverNow() < this.view.phaseDeadline
    );
  }

  destroy(): void {
    this.cleanups.forEach((cleanup) => cleanup());
    this.input.reset();
  }

  private tick(): void {
    const local = this.local();
    if (
      !local ||
      local.status !== 'alive' ||
      !this.isConnected ||
      !isPlayPhase(this.view.phase)
    )
      return;
    const input = this.input.sample();
    const now = this.serverNow();
    const canMove = this.canMove(local) && this.input.isEnabled && !document.hidden;
    const movement = {
      x: input.x,
      z: input.z,
      yaw: input.yaw,
      pitch: input.pitch,
      jump: input.jump,
      slide: input.slide,
      sprint: input.sprint,
      crouch: input.crouch,
    };
    const move = this.prediction.predict(canMove ? movement : { x: 0, z: 0 }, canMove, now, 1);
    this.room.send('input/move', move);
    if (local.status === 'alive' && canMove && input.hasInteraction)
      this.room.send('action/interact', {});
    if (local.status === 'alive' && canMove && input.hasLunge)
      this.room.send('action/lunge', {});
  }
}
