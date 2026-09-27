import { Room, ServerError, type AuthContext, type Client } from '@colyseus/core';
import { randomUUID } from 'node:crypto';
import {
  GAMEPLAY,
  MAX_CHAT_MESSAGE_LENGTH,
  arenaHalfExtentForMap,
  isEmptyPayload,
  isRecord,
  type ChatMessage,
  type GameplayMessages,
  type MatchResult,
} from '@ice-water/shared';
import type { GuestIdentity, GuestSessions } from '../auth/guest-session.js';
import { RateLimiter } from '../auth/rate-limiter.js';
import type { ServerConfig } from '../config/environment.js';
import { isAllowedClientOrigin } from '../config/environment.js';
import { isRoleAssignmentMode, isRoleChoice, LobbyController } from './lobby-controller.js';
import { LobbyState, PlayerState } from './lobby-state.js';
import type { RoomDirectory } from './room-directory.js';
import { GameplayController } from '../gameplay/gameplay-controller.js';
import { MatchController } from '../gameplay/match-controller.js';
import { advanceAuthoritativeTick } from '../gameplay/authoritative-tick.js';
import { BotRunner } from '../simulation/bot-runner.js';
import type { Database } from '../persistence/database.js';

type GuestClient = Client<{ auth: GuestIdentity }>;
export interface RoomDependencies {
  config: ServerConfig;
  sessions: GuestSessions;
  directory: RoomDirectory;
  database: Database;
}

export function createPrivateRoom({ config, sessions, directory, database }: RoomDependencies) {
  return class PrivateRoom extends Room<{ state: LobbyState; client: GuestClient }> {
    override state = new LobbyState();
    private readonly controller = new LobbyController(
      this.state,
      config.countdownSeconds * 1000,
      undefined,
      config.devForceIce,
    );
    private readonly actions = new RateLimiter(4, 1000);
    private readonly chatRate = new RateLimiter(5, 5000);
    private readonly matchId = randomUUID();
    private readonly gameplay = new GameplayController(this.state, (event) =>
      this.broadcast(event.type, event.payload),
    );
    private readonly match = new MatchController(
      this.state,
      (event) => this.broadcast(event.type, event.payload as never),
      (now) => this.gameplay.start(now),
      {
        onResult: (result, startedAt, completedAt) =>
          this.persistResult(result, startedAt, completedAt),
        onResultExpired: () => this.cleanupCompletedMatch(),
        freezeForBlizzard: (player, now) => this.gameplay.freezeForBlizzard(player, now),
      },
    );
    private readonly bots: BotRunner | null =
      config.devBotCount > 0 ? new BotRunner(this.state, this.gameplay, config.devBotCount) : null;
    private createdAt = Date.now();
    private hasPersistedResult = false;
    private hasReleasedDirectory = false;
    private hasRequestedCleanup = false;

    override async onCreate(options: unknown): Promise<void> {
      if (
        !isRecord(options) ||
        typeof options.inviteCode !== 'string' ||
        typeof options.hostPlayerId !== 'string'
      )
        throw new ServerError(403, 'Create a room through the guest lobby');
      this.maxClients = config.maxHumanPlayers;
      this.maxMessagesPerSecond = 60;
      this.seatReservationTimeout = 15;
      this.state.inviteCode = options.inviteCode;
      this.state.hostPlayerId = options.hostPlayerId;
      this.state.maxPlayers = config.maxPlayers;
      await this.setMatchmaking({ private: true, unlisted: true });
      directory.register(this.state.inviteCode, this.roomId);
      // Populate bot seats before registering message handlers so bots appear
      // in the lobby roster from the moment the first real player joins.
      this.bots?.start();
      this.setTimestep(() => this.advance(), GAMEPLAY.tickMs);
      this.patchRate = GAMEPLAY.tickMs;
      const gameplayMessages: (keyof GameplayMessages)[] = [
        'input/move',
        'action/interact',
        'action/lunge',
      ];
      for (const type of gameplayMessages)
        this.onMessage(type, (client: GuestClient, payload: unknown) => {
          if (!client.auth || client.auth.expiresAt <= Date.now())
            return this.fail(client, 'unauthorized', 'Guest session expired');
          const now = Date.now();
          this.state.serverTime = now;
          // Receiving client messages must not grant extra bot ticks.
          advanceAuthoritativeTick(now, this.gameplay, this.match);
          const error = this.gameplay.handle(client.auth.playerId, type, payload, now);
          this.match.tick(now);
          if (error) this.fail(client, 'invalid-action', error);
        });
      this.onMessage('chat/send', (client: GuestClient, payload: unknown) => {
        if (!client.auth || client.auth.expiresAt <= Date.now())
          return this.fail(client, 'unauthorized', 'Guest session expired');
        if (this.state.phase !== 'playing')
          return this.fail(client, 'chat-unavailable', 'Chat is available during a match');
        if (!this.chatRate.take(client.sessionId))
          return this.fail(client, 'rate-limit', 'Slow down before sending another chat message');
        if (
          !isRecord(payload) ||
          Object.keys(payload).length !== 1 ||
          typeof payload.message !== 'string' ||
          payload.message.length > MAX_CHAT_MESSAGE_LENGTH
        )
          return this.fail(client, 'invalid-message', 'Invalid chat message');

        const message = payload.message
          .replace(/[\u0000-\u001f\u007f]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (!message || message.length > MAX_CHAT_MESSAGE_LENGTH)
          return this.fail(client, 'invalid-message', 'Invalid chat message');

        const player = this.state.players.get(client.auth.playerId);
        if (!player) return this.fail(client, 'unauthorized', 'Player is not in this room');
        const chatMessage: ChatMessage = {
          playerId: player.playerId,
          displayName: player.displayName,
          message,
          serverTime: Date.now(),
        };
        this.broadcast('chat/message', chatMessage);
      });
      this.onMessage('room/start', (client: GuestClient, payload: unknown) => {
        if (!this.actions.take(client.sessionId))
          return this.fail(client, 'rate-limit', 'Slow down and try again');
        if (!isEmptyPayload(payload))
          return this.fail(client, 'invalid-message', 'Invalid start request');
        if (!client.auth || client.auth.expiresAt <= Date.now())
          return this.fail(client, 'unauthorized', 'Guest session expired');
        const error = this.controller.start(client.auth.playerId, Date.now());
        if (error) return this.fail(client, 'cannot-start', error);
        void this.lock();
        this.phaseChanged();
      });
      this.onMessage('room/configure', (client: GuestClient, payload: unknown) => {
        if (!client.auth || client.auth.expiresAt <= Date.now())
          return this.fail(client, 'unauthorized', 'Guest session expired');
        if (!this.actions.take(client.sessionId))
          return this.fail(client, 'rate-limit', 'Slow down and try again');
        if (this.state.phase !== 'lobby' || client.auth.playerId !== this.state.hostPlayerId)
          return this.fail(client, 'cannot-configure', 'Only the host can change the waiting room');
        if (
          !isRecord(payload) ||
          Object.keys(payload).length < 1 ||
          Object.keys(payload).some((key) => !['mapId', 'roleAssignmentMode'].includes(key)) ||
          (payload.mapId !== undefined && payload.mapId !== 'frostline') ||
          (payload.roleAssignmentMode !== undefined &&
            !isRoleAssignmentMode(payload.roleAssignmentMode))
        )
          return this.fail(client, 'invalid-message', 'Invalid room configuration');
        if (payload.mapId === 'frostline') {
          this.state.mapId = 'frostline';
          this.state.arenaHalfExtent = arenaHalfExtentForMap('frostline');
        }
        if (payload.roleAssignmentMode !== undefined)
          this.state.roleAssignmentMode = payload.roleAssignmentMode;
        this.broadcastPatch();
      });
      this.onMessage('room/role', (client: GuestClient, payload: unknown) => {
        if (!client.auth || client.auth.expiresAt <= Date.now())
          return this.fail(client, 'unauthorized', 'Guest session expired');
        if (!this.actions.take(client.sessionId))
          return this.fail(client, 'rate-limit', 'Slow down and try again');
        if (this.state.phase !== 'lobby')
          return this.fail(client, 'cannot-configure', 'Role choices are locked');
        if (!isRecord(payload) || Object.keys(payload).length !== 1 || !isRoleChoice(payload.role))
          return this.fail(client, 'invalid-message', 'Invalid role choice');
        const player = this.state.players.get(client.auth.playerId);
        if (!player) return this.fail(client, 'unauthorized', 'Player is not in this room');
        player.roleChoice =
          payload.role !== 'spectator' && this.state.roleAssignmentMode === 'random'
            ? 'random'
            : payload.role;
        this.broadcastPatch();
      });
      this.onMessage('session/ping', (client: GuestClient, payload: unknown) => {
        if (
          !client.auth ||
          client.auth.expiresAt <= Date.now() ||
          !this.actions.take(client.sessionId)
        )
          return;
        if (
          isRecord(payload) &&
          Object.keys(payload).length === 1 &&
          typeof payload.sentAt === 'number' &&
          Number.isFinite(payload.sentAt)
        )
          client.send('session/pong', { sentAt: payload.sentAt });
      });
      this.onMessage('*', (client) => this.fail(client, 'invalid-message', 'Unknown room action'));
    }

    override onAuth(_client: GuestClient, options: unknown, context: AuthContext): GuestIdentity {
      if (
        context.headers.get('origin') &&
        !isAllowedClientOrigin(context.headers.get('origin')!, config)
      )
        throw new ServerError(403, 'Origin not allowed');
      if (!isRecord(options)) throw new ServerError(401, 'Guest session required');
      let identity: GuestIdentity;
      try {
        identity = sessions.verify(options.token);
      } catch {
        throw new ServerError(401, 'Guest session is invalid or expired');
      }
      if (options.inviteCode !== this.state.inviteCode || this.state.phase !== 'lobby')
        throw new ServerError(403, 'Room is unavailable');
      if (this.state.players.has(identity.playerId))
        throw new ServerError(409, 'This guest is already in the room');
      if (this.state.players.size >= config.maxPlayers) throw new ServerError(409, 'Room is full');
      return identity;
    }

    override onJoin(client: GuestClient): void {
      const identity = client.auth;
      if (!identity) throw new ServerError(401, 'Guest session required');
      if (
        this.state.phase !== 'lobby' ||
        this.state.players.has(identity.playerId) ||
        this.state.players.size >= config.maxPlayers ||
        identity.expiresAt <= Date.now()
      )
        throw new ServerError(409, 'Seat is no longer available');
      const player = new PlayerState();
      player.playerId = identity.playerId;
      player.displayName = identity.displayName;
      this.state.players.set(player.playerId, player);
      directory.connected(identity.sessionId, this.roomId);
      if (!this.state.hostPlayerId) this.state.hostPlayerId = player.playerId;
    }

    override async onDrop(client: GuestClient): Promise<void> {
      if (!client.auth) return;
      const now = Date.now();
      const player = this.state.players.get(client.auth.playerId);
      if (player) {
        player.isConnected = false;
        player.reconnectDeadline = now + config.reconnectSeconds * 1000;
      }
      this.gameplay.disconnect(client.auth.playerId);
      this.controller.transferHost();
      this.advance(now);
      try {
        await this.allowReconnection(client, config.reconnectSeconds);
      } catch {
        /* onLeave releases the expired seat. */
      }
    }

    override onReconnect(client: GuestClient): void {
      if (!client.auth) {
        void client.leave(4001);
        return;
      }
      const now = Date.now();
      this.state.serverTime = now;
      const player = this.state.players.get(client.auth.playerId);
      if (
        !player ||
        client.auth.expiresAt <= now ||
        player.reconnectDeadline === 0 ||
        now >= player.reconnectDeadline ||
        (!['lobby', 'countdown'].includes(this.state.phase) && player.team === 'unassigned')
      ) {
        void client.leave(4001);
        return;
      }
      player.isConnected = true;
      player.reconnectDeadline = 0;
      this.controller.transferHost();
    }

    override onLeave(client: GuestClient): void {
      const identity = client.auth;
      if (!identity) return;
      const now = Date.now();
      this.gameplay.disconnect(identity.playerId);
      if (this.state.phase === 'lobby' || this.state.phase === 'countdown') {
        this.state.players.delete(identity.playerId);
      } else {
        // Resolve an authoritative phase deadline before applying a disconnect
        // forfeit when both happen in the same event-loop turn.
        this.advance(now);
        const player = this.state.players.get(identity.playerId);
        if (player) {
          player.isConnected = false;
          player.reconnectDeadline = 0;
          if (player.status === 'alive') player.protectedUntil = 0;
        }
      }
      directory.release(identity.sessionId, this.roomId);
      this.controller.transferHost();
      this.advance(now);
    }

    override onDispose(): void {
      this.bots?.stop();
      this.releaseDirectory();
    }

    private advance(now = Date.now()): void {
      // Every room patch carries a fresh authoritative time, including phases
      // that are owned by MatchController rather than LobbyController.
      this.state.serverTime = now;
      if (now - this.createdAt > 15000) this.controller.transferHost();
      // Drive bot movement each tick so they count toward gameplay.
      this.bots?.tick(now);
      if (this.controller.tick(now)) {
        if (this.state.phase === 'lobby') void this.unlock();
        // When the countdown finishes and roles are assigned, start the match.
        if (this.state.phase === 'playing') {
          this.match.start(now);
          // MatchController.start() emits the first phase-changed — skip duplicate.
          this.gameplay.advance(now);
          return;
        }
        this.phaseChanged();
      }
      if (advanceAuthoritativeTick(now, this.gameplay, this.match)) {
        // MatchController already emitted the phase-changed event.
      }
    }
    private persistResult(result: MatchResult, startedAt: number, completedAt: number): void {
      if (this.hasPersistedResult) return;
      this.hasPersistedResult = true;
      const summary = {
        matchId: this.matchId,
        winner: result.winner,
        resultReason: result.reason,
        gameMode: this.state.gameMode,
        mapId: this.state.mapId,
        startedAt: new Date(startedAt),
        completedAt: new Date(completedAt),
        players: [...this.state.players.values()].map((player) => ({
          playerId: player.playerId,
          team: player.team,
          finalStatus: player.status,
          kills: player.kills,
          deaths: player.deaths,
        })),
      };
      void database.saveMatchSummary(summary).catch(() => {
        console.error(
          JSON.stringify({ event: 'match-summary/write-failed', matchId: this.matchId }),
        );
      });
    }
    private cleanupCompletedMatch(): void {
      if (this.hasRequestedCleanup) return;
      this.hasRequestedCleanup = true;
      this.releaseDirectory();
      void this.disconnect(1000);
    }
    private releaseDirectory(): void {
      if (this.hasReleasedDirectory) return;
      this.hasReleasedDirectory = true;
      directory.dispose(this.state.inviteCode, this.roomId);
    }
    private phaseChanged(): void {
      this.broadcast('match/phase-changed', {
        phase: this.state.phase,
        phaseDeadline: this.state.phaseDeadline,
        serverTime: this.state.serverTime,
      });
    }
    private fail(client: GuestClient, code: string, message: string): void {
      client.send('session/error', { code, message });
    }
  };
}

