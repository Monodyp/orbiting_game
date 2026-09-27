import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerStatus } from '@ice-water/shared';
import { GuestSessions, type GuestIdentity } from '../auth/guest-session.js';
import { readConfig } from '../config/environment.js';
import { createPrivateRoom } from './private-room.js';
import { PlayerState } from './lobby-state.js';
import { RoomDirectory } from './room-directory.js';
const NOW = 1800000000000;
const config = readConfig({
  GUEST_SESSION_SIGNING_SECRET: 'test-secret-with-at-least-32-characters',
});
const PrivateRoom = createPrivateRoom({
  config,
  sessions: new GuestSessions(config.signingSecret, config.sessionTtlSeconds),
  directory: new RoomDirectory(),
  database: {
    isReady: async () => true,
    saveMatchSummary: async () => true,
    close: async () => {},
  },
});
function fixture(status: PlayerStatus) {
  const room = new PrivateRoom();
  room.state.phase = 'playing';
  room.state.phaseDeadline = NOW + 10000;
  const player = new PlayerState();
  Object.assign(player, {
    playerId: 'player',
    displayName: 'Player',
    team: status === 'spectator' ? 'none' : 'water',
    roleChoice: status === 'spectator' ? 'spectator' : 'random',
    status,
    x: 12,
    z: -7,
  });
  room.state.players.set(player.playerId, player);
  const identity: GuestIdentity = {
    playerId: player.playerId,
    sessionId: 'guest',
    displayName: 'Player',
    expiresAt: NOW + 60000,
  };
  const leave = vi.fn(async () => {}),
    client = { auth: identity, sessionId: 'session', leave } as unknown as Parameters<
      typeof room.onDrop
    >[0];
  vi.spyOn(room, 'broadcast').mockImplementation(() => {});
  vi.spyOn(room, 'allowReconnection').mockReturnValue(
    Promise.resolve(client) as unknown as ReturnType<typeof room.allowReconnection>,
  );
  return { room, player, client, leave };
}
describe('role and freeze-state reconnect reservations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());
  it.each<PlayerStatus>(['alive', 'frozen', 'spectator'])(
    'preserves authoritative %s state, role, position and deadline',
    async (status) => {
      const { room, player, client } = fixture(status);
      await room.onDrop(client);
      expect(player.isConnected).toBe(false);
      expect(player.reconnectDeadline).toBe(NOW + 25000);
      room.onReconnect(client);
      expect(player).toMatchObject({
        isConnected: true,
        reconnectDeadline: 0,
        status,
        team: status === 'spectator' ? 'none' : 'water',
        roleChoice: status === 'spectator' ? 'spectator' : 'random',
        x: 12,
        z: -7,
      });
    },
  );
  it('rejects expired sessions and reservations without resetting the body', async () => {
    const { room, player, client, leave } = fixture('frozen');
    await room.onDrop(client);
    vi.setSystemTime(NOW + 25000);
    room.onReconnect(client);
    expect(leave).toHaveBeenCalledWith(4001);
    expect(player.status).toBe('frozen');
  });
  it.each<PlayerStatus>(['alive', 'frozen', 'spectator'])(
    'does not change a %s role or freeze state on intentional leave',
    (status) => {
      const { room, player, client } = fixture(status);
    room.onLeave(client);
    expect(player).toMatchObject({
        status,
        team: status === 'spectator' ? 'none' : 'water',
        isConnected: false,
      });
    },
  );
});
