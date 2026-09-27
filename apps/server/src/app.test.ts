import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { matchMaker, type Room as ServerRoom } from '@colyseus/core';
import { Client, type Room } from '@colyseus/sdk';
import {
  GAMEPLAY,
  type ChatMessage,
  type GuestSession,
  type RoomReservation,
  type SessionError,
  type PlayerView,
  type MatchPhase,
  type MapId,
} from '@ice-water/shared';
import { startServer } from './app.js';
import { readConfig } from './config/environment.js';

interface TestState {
  mapId: MapId;
  arenaHalfExtent: number;
  phase: MatchPhase;
  phaseDeadline: number;
  serverTime: number;
  hostPlayerId: string;
  players: Map<string, PlayerView>;
  gameMode: 'tdm';
  iceScore: number;
  matchWinner: string;
}
type TestRoom = Room<unknown, TestState>;
type AuthoritativeRoom = ServerRoom & { state: TestState };
interface Participant {
  identity: GuestSession;
  room: TestRoom;
}
let app: Awaited<ReturnType<typeof startServer>>;
let url: string;
const rooms: TestRoom[] = [];
let isDatabaseReady = true;
const saveMatchSummary = vi.fn(async () => true);
const config = {
  ...readConfig({
    GUEST_SESSION_SIGNING_SECRET: 'test-secret-with-at-least-32-characters',
    GAME_SERVER_PORT: '0',
    ROOM_MAX_PLAYERS: '6',
    COUNTDOWN_SECONDS: '1',
  }),
  // Keep production validation at 20–30 seconds; only accelerate integration expiry.
  reconnectSeconds: 1,
};
async function post(path: string, body: unknown, token?: string) {
  return fetch(`${url}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}
async function guest(name = 'Snow Guest'): Promise<GuestSession> {
  return (await post('/api/guest-session', { displayName: name })).json() as Promise<GuestSession>;
}
async function enter(
  identity: GuestSession,
  inviteCode?: string,
): Promise<{ room: TestRoom; code: string }> {
  const response = await post(
    inviteCode ? '/api/rooms/join' : '/api/rooms',
    inviteCode ? { inviteCode } : {},
    identity.token,
  );
  expect(response.status).toBe(inviteCode ? 200 : 201);
  const reservation = (await response.json()) as RoomReservation;
  const room: TestRoom = await new Client(url).consumeSeatReservation<TestState>(reservation.seat);
  rooms.push(room);
  room.onMessage('match/phase-changed', () => {});
  room.onMessage('match/result', () => {});
  await waitFor(() => !!room.state?.players);
  return { room, code: reservation.inviteCode };
}
async function waitFor(predicate: () => boolean, timeout = 5000) {
  await expect.poll(predicate, { timeout, interval: 25 }).toBe(true);
}
async function startMatch(prefix: string): Promise<{ participants: Participant[]; code: string }> {
  const hostIdentity = await guest(`${prefix} Host`);
  const first = await enter(hostIdentity);
  const participants: Participant[] = [{ identity: hostIdentity, room: first.room }];
  for (let index = 1; index < 6; index++) {
    const identity = await guest(`${prefix} ${index}`);
    participants.push({ identity, room: (await enter(identity, first.code)).room });
  }
  await waitFor(() => first.room.state.players.size === 6);
  first.room.send('room/start', {});
  await waitFor(() => first.room.state.phase === 'playing');
  return { participants, code: first.code };
}
function authoritativeRoom(room: TestRoom): AuthoritativeRoom {
  const current = matchMaker.getLocalRoomById(room.roomId);
  if (!current) throw new Error('Authoritative room is unavailable');
  return current as AuthoritativeRoom;
}
function advanceRoom(room: AuthoritativeRoom, now: number): void {
  const advance: unknown = Reflect.get(room, 'advance');
  if (typeof advance !== 'function') throw new Error('Room advance hook is unavailable');
  Reflect.apply(advance, room, [now]);
  room.broadcastPatch();
}
function errorInbox(room: TestRoom) {
  const errors: SessionError[] = [];
  room.onMessage<SessionError>('session/error', (error) => errors.push(error));
  return errors;
}
async function sendForError(
  room: TestRoom,
  errors: SessionError[],
  type: string,
  payload: unknown,
): Promise<SessionError> {
  const index = errors.length;
  room.send(type, payload);
  await waitFor(() => errors.length > index);
  return errors[index]!;
}

beforeAll(async () => {
  app = await startServer(config, {
    isReady: async () => isDatabaseReady,
    saveMatchSummary,
    close: async () => {},
  });
  url = `http://127.0.0.1:${app.port}`;
});
afterAll(async () => {
  for (const room of rooms) room.reconnection.enabled = false;
  await app.stop();
});

describe('HTTP and real WebSocket room flow', () => {
  it('handles guest-session preflights for configured, preview, and Quick Tunnel origins', async () => {
    for (const origin of [
      'http://localhost:5173',
      'http://127.0.0.1:4173',
      'https://venture-demand-mouse-marion.trycloudflare.com',
    ]) {
      const preflight = await fetch(`${url}/api/guest-session`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'content-type',
        },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
      expect(preflight.headers.get('vary')).toBe('Origin');
      expect(preflight.headers.get('access-control-allow-methods')).toContain('POST');
      expect(preflight.headers.get('access-control-allow-headers')).toContain('Content-Type');

      const response = await fetch(`${url}/api/guest-session`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: 'CORS Guest' }),
      });
      expect(response.status).toBe(201);
      expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    }

    const rejectedPreflight = await fetch(`${url}/api/guest-session`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://untrusted.example',
        'Access-Control-Request-Method': 'POST',
      },
    });
    expect(rejectedPreflight.status).toBe(403);
    expect(rejectedPreflight.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('reports health and readiness, sanitizes guests, and validates requests', async () => {
    expect((await fetch(`${url}/health`)).status).toBe(200);
    expect((await fetch(`${url}/ready`)).status).toBe(200);
    isDatabaseReady = false;
    expect((await fetch(`${url}/ready`)).status).toBe(503);
    expect((await fetch(`${url}/health`)).status).toBe(200);
    isDatabaseReady = true;
    expect((await guest('  Ｓnow  Guest! ')).displayName).toBe('Snow Guest');
    expect((await post('/api/guest-session', { displayName: '<>' })).status).toBe(400);
    expect((await post('/api/rooms', {})).status).toBe(401);
    expect((await post('/api/rooms', {}, 'forged')).status).toBe(401);
    expect(
      (await fetch(`${url}/health`, { headers: { Origin: 'https://untrusted.example' } })).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${url}/api/guest-session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{bad',
        })
      ).status,
    ).toBe(400);
    expect((await post('/api/guest-session', { displayName: 'a'.repeat(5000) })).status).toBe(400);
  });
  it('blocks built-in matchmaking, room enumeration, and custom capacity injection', async () => {
    expect((await post('/matchmake/create/private-game', {})).status).toBe(403);
    expect((await post('/matchmake/joinOrCreate/private-game', {})).status).toBe(403);
    expect((await fetch(`${url}/matchmake/private-game`)).status).toBe(403);
    const identity = await guest();
    expect((await post('/api/rooms', { maxPlayers: 1000 }, identity.token)).status).toBe(400);
    expect((await post('/api/rooms/join', { inviteCode: 'ABCDEFGH' }, identity.token)).status).toBe(
      404,
    );
  });
  it('creates and joins by invite; enforces identity, capacity, host start and late-join rejection', async () => {
    const host = await guest('Host');
    const { room, code } = await enter(host);
    expect(room.state.hostPlayerId).toBe(host.playerId);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect((await post('/api/rooms/join', { inviteCode: code }, host.token)).status).toBe(409);
    const others: TestRoom[] = [];
    for (let index = 0; index < 5; index++)
      others.push((await enter(await guest(`Guest ${index}`), code)).room);
    await waitFor(() => room.state.players.size === 6);
    const intruder = await guest('Extra Guest');
    expect((await post('/api/rooms/join', { inviteCode: code }, intruder.token)).status).toBe(409);
    const other = others[0]!;
    const unauthorized = new Promise<SessionError>((resolve) =>
      other.onMessage('session/error', resolve),
    );
    other.send('room/start', {});
    expect((await unauthorized).message).toContain('host');
    const invalid = new Promise<SessionError>((resolve) =>
      room.onMessage('session/error', resolve),
    );
    room.send('room/start', { playerId: host.playerId });
    expect((await invalid).code).toBe('invalid-message');
    room.send('room/start', {});
    await waitFor(() => room.state.phase === 'countdown');
    await waitFor(() => room.state.phase === 'playing');
    expect([...room.state.players.values()].filter((p) => p.team === 'ice')).toHaveLength(1);
    expect([...room.state.players.values()].filter((p) => p.team === 'water')).toHaveLength(5);
    expect((await post('/api/rooms/join', { inviteCode: code }, intruder.token)).status).toBe(409);
    await Promise.all([room, ...others].map((client) => client.leave()));
  });
  it('defaults rooms and matches to Frostline and rejects other map choices', async () => {
    const first = await enter(await guest('Frostline Host'));
    const second = await enter(await guest('Frostline Guest'), first.code);
    try {
      expect(first.room.state.mapId).toBe('frostline');
      const frostlineExtent = first.room.state.arenaHalfExtent;
      const authoritative = authoritativeRoom(first.room);

      const unauthorized = new Promise<SessionError>((resolve) =>
        second.room.onMessage('session/error', resolve),
      );
      second.room.send('room/configure', { mapId: 'frostline' });
      expect((await unauthorized).message).toContain('host');

      authoritative.state.mapId = 'original';
      authoritative.state.arenaHalfExtent = 125;
      authoritative.broadcastPatch();
      await waitFor(() => first.room.state.mapId === 'original');
      first.room.send('room/configure', { mapId: 'frostline' });
      await waitFor(() => first.room.state.mapId === 'frostline');
      expect(first.room.state.arenaHalfExtent).toBe(frostlineExtent);

      for (const mapId of ['island', 'original'] as const) {
        const invalid = new Promise<SessionError>((resolve) =>
          first.room.onMessage('session/error', resolve),
        );
        first.room.send('room/configure', { mapId });
        expect((await invalid).code).toBe('invalid-message');
        expect(first.room.state.mapId).toBe('frostline');
      }

      first.room.send('room/start', {});
      await waitFor(() => first.room.state.phase === 'countdown');
      await waitFor(() => first.room.state.phase === 'playing');
      expect(first.room.state.mapId).toBe('frostline');
      expect(first.room.state.arenaHalfExtent).toBe(frostlineExtent);
    } finally {
      await Promise.all([first.room.leave(), second.room.leave()]);
    }
  });
  it('validates chat and broadcasts it only within the active room', async () => {
    const host = await enter(await guest('Chat Host'));
    const peer = await enter(await guest('Chat Peer'), host.code);
    const outside = await enter(await guest('Other Room'));
    const hostErrors = errorInbox(host.room);
    const peerErrors = errorInbox(peer.room);
    const hostMessages: ChatMessage[] = [];
    const peerMessages: ChatMessage[] = [];
    const outsideMessages: ChatMessage[] = [];
    host.room.onMessage<ChatMessage>('chat/message', (message) => hostMessages.push(message));
    peer.room.onMessage<ChatMessage>('chat/message', (message) => peerMessages.push(message));
    outside.room.onMessage<ChatMessage>('chat/message', (message) => outsideMessages.push(message));

    try {
      expect(
        await sendForError(host.room, hostErrors, 'chat/send', { message: 'Too early' }),
      ).toMatchObject({ code: 'chat-unavailable' });
      host.room.send('room/start', {});
      await waitFor(() => host.room.state.phase === 'playing');
      const hostPlayer = host.room.state.players.get(host.room.state.hostPlayerId)!;
      const peerPlayer = [...peer.room.state.players.values()].find(
        (player) => player.playerId !== peer.room.state.hostPlayerId,
      )!;
      expect(hostPlayer.team).not.toBe(peerPlayer.team);

      host.room.send('chat/send', { message: '  Hello\nroom  ' });
      await waitFor(() => peerMessages.length === 1);
      expect(peerMessages[0]).toMatchObject({
        playerId: host.room.state.hostPlayerId,
        displayName: 'Chat Host',
        message: 'Hello room',
      });

      expect(
        await sendForError(peer.room, peerErrors, 'chat/send', {
          message: 'x'.repeat(161),
        }),
      ).toMatchObject({ code: 'invalid-message' });
      peer.room.send('chat/send', { message: 'Reply from the other team' });
      await waitFor(() => hostMessages.length === 2);
      expect(hostMessages[1]).toMatchObject({
        playerId: peerPlayer.playerId,
        displayName: 'Chat Peer',
        message: 'Reply from the other team',
      });

      for (let index = 0; index < 4; index++) {
        host.room.send('chat/send', { message: `Message ${index}` });
        await waitFor(() => peerMessages.length === index + 3);
      }
      expect(peerMessages).toHaveLength(6);
      expect(
        await sendForError(host.room, hostErrors, 'chat/send', { message: 'Rate limited' }),
      ).toMatchObject({ code: 'rate-limit' });

      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(outsideMessages).toHaveLength(0);
    } finally {
      await Promise.all([host.room.leave(), peer.room.leave(), outside.room.leave()]);
    }
  });
  it('transfers the host on leave and disposes empty invite codes', async () => {
    const host = await guest('Old Host');
    const next = await guest('Next Host');
    const first = await enter(host);
    const second = await enter(next, first.code);
    await first.room.leave();
    await waitFor(() => second.room.state.hostPlayerId === next.playerId);
    await second.room.leave();
    await expect
      .poll(
        async () =>
          (await post('/api/rooms/join', { inviteCode: first.code }, (await guest()).token)).status,
      )
      .toBe(404);
  });
  it('reclaims the same player after an unexpected socket drop', async () => {
    const identity = await guest('Reconnect Guest');
    const first = await enter(identity);
    const watcher = await enter(await guest('Watcher'), first.code);
    const token = first.room.reconnectionToken;
    first.room.reconnection.enabled = false;
    first.room.connection.close(4010);
    await waitFor(() => watcher.room.state.players.get(identity.playerId)?.isConnected === false);
    const reconnected: TestRoom = await new Client(url).reconnect<TestState>(token);
    rooms.push(reconnected);
    reconnected.onMessage('match/phase-changed', () => {});
    await waitFor(() => watcher.room.state.players.get(identity.playerId)?.isConnected === true);
    expect(watcher.room.state.players.size).toBe(2);
    await reconnected.leave();
    await watcher.room.leave();
  });
  it('rejects malformed gameplay, stale sequences, forged outcomes, and action floods', async () => {
    const { participants } = await startMatch('Authority');
    const actor = participants[0]!;
    const rateActor = participants[1]!;
    const actorErrors = errorInbox(actor.room);
    const rateErrors = errorInbox(rateActor.room);
    const before = actor.room.state.players.get(actor.identity.playerId)!;
    const original = {
      x: before.x,
      y: before.y,
      z: before.z,
      team: before.team,
      status: before.status,
    };

    expect(
      await sendForError(actor.room, actorErrors, 'input/move', {
        x: 2,
        z: 0,
        sequence: 1,
      }),
    ).toMatchObject({ code: 'invalid-action', message: 'Invalid movement input' });
    expect(
      await sendForError(actor.room, actorErrors, 'input/move', {
        x: 0,
        z: 0,
        sequence: 1,
        jump: 'yes',
      }),
    ).toMatchObject({ code: 'invalid-action', message: 'Invalid movement input' });
    expect(
      await sendForError(actor.room, actorErrors, 'action/interact', { forged: true }),
    ).toMatchObject({ code: 'invalid-action', message: 'Invalid interaction' });
    expect(
      await sendForError(actor.room, actorErrors, 'match/result', {
        winner: 'water',
      }),
    ).toMatchObject({ code: 'invalid-message' });

    actor.room.send('input/move', { x: 1, z: 0, sequence: 1, jump: true });
    await waitFor(() => actor.room.state.players.get(actor.identity.playerId)?.inputSequence === 1);
    await waitFor(() => actor.room.state.players.get(actor.identity.playerId)!.y > original.y);
    expect(
      await sendForError(actor.room, actorErrors, 'input/move', {
        x: 1,
        z: 0,
        sequence: 1,
      }),
    ).toMatchObject({ code: 'invalid-action', message: 'Stale or invalid input sequence' });

    const authoritative = actor.room.state.players.get(actor.identity.playerId)!;
    expect({ team: authoritative.team, status: authoritative.status }).toEqual({
      team: original.team,
      status: original.status,
    });
    expect(
      Math.hypot(authoritative.x - original.x, authoritative.z - original.z),
    ).toBeLessThanOrEqual(GAMEPLAY.moveSpeed * 0.2);

    const rateStart = rateErrors.length;
    for (let index = 0; index < 26; index++) rateActor.room.send('action/interact', {});
    await waitFor(() => rateErrors.length > rateStart);
    expect(rateErrors.slice(rateStart)).toContainEqual({
      code: 'invalid-action',
      message: 'Too many gameplay requests',
    });

    await Promise.all(participants.map(({ room }) => room.leave()));
  });
  it('expires a dropped host reservation, transfers host, rejects reconnect, and disposes', async () => {
    const host = await guest('Expiring Host');
    const watcherIdentity = await guest('Expiry Watcher');
    const first = await enter(host);
    const watcher = await enter(watcherIdentity, first.code);
    const token = first.room.reconnectionToken;
    first.room.reconnection.enabled = false;
    first.room.connection.close(4010);

    await waitFor(() => watcher.room.state.players.get(host.playerId)?.isConnected === false);
    await waitFor(() => !watcher.room.state.players.has(host.playerId), 3000);
    expect(watcher.room.state.hostPlayerId).toBe(watcherIdentity.playerId);
    await expect(new Client(url).reconnect<TestState>(token)).rejects.toThrow();

    await watcher.room.leave();
    await waitFor(() => !matchMaker.getLocalRoomById(first.room.roomId));
    await expect
      .poll(
        async () =>
          (await post('/api/rooms/join', { inviteCode: first.code }, (await guest()).token)).status,
      )
      .toBe(404);
  });
  it('synchronizes proximity freeze and frozen-player reconnect through real sockets', async () => {
    const { participants } = await startMatch('Combat');
    const actor = participants[0]!,
      target = participants[1]!;
    const serverRoom = authoritativeRoom(actor.room);
    const a = serverRoom.state.players.get(actor.identity.playerId)!,
      b = serverRoom.state.players.get(target.identity.playerId)!;
    Object.assign(a, { team: 'ice', x: -50, z: -30, y: 0, protectedUntil: 0 });
    Object.assign(b, { team: 'water', x: -50, z: -30.2, y: 0, protectedUntil: 0 });
    actor.room.send('action/interact', {});
    await waitFor(
      () => actor.room.state.players.get(target.identity.playerId)?.status === 'frozen',
    );
    const token = target.room.reconnectionToken;
    target.room.reconnection.enabled = false;
    target.room.connection.close(4010);
    await waitFor(() => !b.isConnected);
    const reconnected: TestRoom = await new Client(url).reconnect<TestState>(token);
    rooms.push(reconnected);
    for (const type of ['player/frozen', 'player/rescued', 'match/phase-changed', 'match/result'])
      reconnected.onMessage(type, () => {});
    await waitFor(
      () => reconnected.state?.players.get(target.identity.playerId)?.status === 'frozen',
    );
    expect(b.status).toBe('frozen');
    await Promise.all([
      reconnected.leave(),
      ...participants.filter((p) => p !== target).map((p) => p.room.leave()),
    ]);
  });
  it('keeps match results through their deadline, then disposes the room and invite once', async () => {
    const { participants, code } = await startMatch('Cleanup');
    const observer = participants[0]!;
    const serverRoom = authoritativeRoom(observer.room);
    serverRoom.setTimestep(() => {}, 60_000);
    const reconnectToken = observer.room.reconnectionToken;
    const writesBefore = saveMatchSummary.mock.calls.length;
    for (const player of serverRoom.state.players.values())
      if (player.team === 'water') player.status = 'frozen';
    const completedAt = Date.now();
    advanceRoom(serverRoom, completedAt);
    await waitFor(() => ['finished', 'intermission'].includes(observer.room.state.phase));
    await vi.waitFor(() => expect(saveMatchSummary).toHaveBeenCalled());
    const deadline = serverRoom.state.phaseDeadline;

    advanceRoom(serverRoom, deadline - 1);
    expect(matchMaker.getLocalRoomById(observer.room.roomId)).toBe(serverRoom);
    expect(serverRoom.state.serverTime).toBe(deadline - 1);

    advanceRoom(serverRoom, deadline);
    await waitFor(() => !matchMaker.getLocalRoomById(observer.room.roomId));
    expect(saveMatchSummary).toHaveBeenCalledTimes(writesBefore + 1);
    await expect(new Client(url).reconnect<TestState>(reconnectToken)).rejects.toThrow();
    expect(
      (await post('/api/rooms/join', { inviteCode: code }, (await guest()).token)).status,
    ).toBe(404);
  });
  it('rate-limits repeated room operations by authenticated guest', async () => {
    const identity = await guest('Rate Guest');
    const responses = [];
    for (let index = 0; index < 11; index++)
      responses.push(await post('/api/rooms/join', { inviteCode: 'ABCDEFGH' }, identity.token));
    expect(responses.at(-1)?.status).toBe(429);
  });
});
