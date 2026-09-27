import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { Client, type Room } from '@colyseus/sdk';
import type { GuestSession, PlayerView, RoomReservation } from '@ice-water/shared';
import { startServer } from '../../apps/server/src/app.js';
import { readConfig } from '../../apps/server/src/config/environment.js';

interface LoadState {
  phase: string;
  gameMode: string;
  players: Map<string, PlayerView>;
}
const requested = process.argv.slice(2).map(Number);
const sizes = requested.length ? requested : [20, 50, 100, 150];
if (sizes.some((size) => ![20, 50, 100, 150].includes(size)))
  throw new Error('Use staged sizes: 20, 50, 100, 150');
const app = await startServer(
  readConfig({
    GUEST_SESSION_SIGNING_SECRET: 'load-test-only-secret-at-least-32-characters',
    GAME_SERVER_PORT: '0',
    COUNTDOWN_SECONDS: '1',
  }),
);
const url = `http://127.0.0.1:${app.port}`;
async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(url + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  assert.ok(response.ok, `HTTP ${response.status} from ${path}`);
  return response.json() as Promise<T>;
}
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Lobby state synchronization timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
try {
  for (const size of sizes) {
    const rooms: Room<unknown, LoadState>[] = [];
    const ids: string[] = [];
    let timer: ReturnType<typeof setInterval> | undefined;
    const started = performance.now();
    try {
      let code: string | undefined;
      for (let index = 0; index < size; index++) {
        const guest = await post<GuestSession>('/api/guest-session', {
          displayName: `Load ${size} ${index}`,
        });
        const seat = await post<RoomReservation>(
          code ? '/api/rooms/join' : '/api/rooms',
          code ? { inviteCode: code } : {},
          guest.token,
        );
        code = seat.inviteCode;
        const room: Room<unknown, LoadState> = await new Client(
          url,
        ).consumeSeatReservation<LoadState>(seat.seat);
        room.onMessage('match/phase-changed', () => {});
        for (const type of [
          'weapon/fired',
          'player/hit',
          'player/killed',
          'match/result',
          'session/error',
        ])
          room.onMessage(type, () => {});
        rooms.push(room);
        ids.push(guest.playerId);
      }
      await until(() => rooms.every((room) => room.state?.players.size === size));
      const joinMs = Math.round(performance.now() - started);
      rooms[0]!.send('room/start', {});
      await until(() => rooms.every((room) => room.state.phase === 'playing'));
      let sequence = 0;
      const tickDurations: number[] = [];
      timer = setInterval(() => {
        const tickStart = performance.now();
        sequence++;
        rooms.forEach((room, index) => {
          const local = room.state.players.get(ids[index]!);
          if (!local) return;
          const angle = sequence * 0.025 + index;
          room.send('input/move', {
            sequence,
            x: Math.cos(angle),
            z: Math.sin(angle),
            yaw: local.yaw,
            pitch: 0,
            jump: sequence % 40 === 0,
            slide: sequence % 30 === 0,
          });
          if (sequence % 4 || local.status !== 'alive') return;
          room.send('action/interact', {});
        });
        tickDurations.push(performance.now() - tickStart);
      }, 50);
      await new Promise((resolve) => setTimeout(resolve, 5000));
      clearInterval(timer);
      timer = undefined;
      await until(() =>
        rooms.every((room, i) => (room.state.players.get(ids[i]!)?.inputSequence ?? 0) > 0),
      );
      const snapshots = [...rooms[0]!.state.players.values()];
      assert.ok(
        snapshots.every(
          (p) =>
            Number.isFinite(p.x) &&
            Number.isFinite(p.y) &&
            Number.isFinite(p.z) &&
            p.status === 'alive' || p.status === 'frozen' || p.status === 'spectator',
        ),
      );
      assert.ok(snapshots.every((p) => p.team === 'none'));
      tickDurations.sort((a, b) => a - b);
      console.log(
        JSON.stringify({
          scenario: 'fps-five-second-gameplay-smoke',
          clients: size,
          joinMs,
          gameplayMs: 5000,
          inputTicks: sequence,
          kills: snapshots.reduce((sum, p) => sum + p.kills, 0),
          driverP95Ms: Math.round(tickDurations[Math.floor(tickDurations.length * 0.95)] ?? 0),
          elapsedMs: Math.round(performance.now() - started),
          result: 'passed',
        }),
      );
    } finally {
      if (timer) clearInterval(timer);
      await Promise.all(rooms.map((room) => room.leave().catch(() => {})));
    }
  }
} finally {
  await app.stop();
}
