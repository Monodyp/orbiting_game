import { Client, type Room } from '@colyseus/sdk';
import {
  isRecord,
  type GuestSession,
  type LobbyView,
  type PlayerView,
  type RoomReservation,
} from '@ice-water/shared';

interface WireLobby extends Omit<LobbyView, 'players'> {
  players: { values(): IterableIterator<PlayerView> };
}
export type LobbyRoom = Room<unknown, WireLobby>;
function resolveGameServerUrl(): string {
  const configured = (import.meta.env.VITE_GAME_SERVER_URL ?? 'ws://127.0.0.1:2567').trim();
  const isLocalHost = ['localhost', '127.0.0.1', '0.0.0.0'].includes(location.hostname);
  const isEphemeralTunnel = /trycloudflare\.com|discordsays\.com/i.test(configured);
  return isLocalHost && isEphemeralTunnel ? 'ws://127.0.0.1:2567' : configured;
}
const endpoint = new URL(resolveGameServerUrl());
if (!['ws:', 'wss:'].includes(endpoint.protocol)) throw new Error('Invalid game server URL');
if (location.protocol === 'https:' && endpoint.protocol !== 'wss:')
  throw new Error('Secure pages require a secure game server');
const httpEndpoint = new URL(endpoint);
httpEndpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
const client = new Client(endpoint.toString());
const SESSION_KEY = 'ice-water/guest';
const RECONNECT_KEY = 'ice-water/reconnect';

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(new URL(path, httpEndpoint), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new Error('Cannot reach the game server. Check your connection and try again.');
  }
  const data: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      isRecord(data) && typeof data.message === 'string'
        ? data.message
        : 'Request failed. Try again.',
    );
  return data as T;
}

export function readGuest(): GuestSession | null {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    if (
      isRecord(raw) &&
      typeof raw.token === 'string' &&
      typeof raw.playerId === 'string' &&
      typeof raw.displayName === 'string' &&
      typeof raw.expiresAt === 'number' &&
      raw.expiresAt > Date.now()
    )
      return raw as unknown as GuestSession;
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
  return null;
}
export function forgetGuest(): void {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(RECONNECT_KEY);
}
export async function createGuest(displayName: string): Promise<GuestSession> {
  const guest = await post<GuestSession>('/api/guest-session', { displayName });
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(guest));
  return guest;
}
export async function reserveRoom(guest: GuestSession, inviteCode?: string): Promise<LobbyRoom> {
  const reservation = await post<RoomReservation>(
    inviteCode ? '/api/rooms/join' : '/api/rooms',
    inviteCode ? { inviteCode } : {},
    guest.token,
  );
  const room: LobbyRoom = await client.consumeSeatReservation<WireLobby>(reservation.seat);
  saveReconnect(room);
  return room;
}
export function saveReconnect(room: LobbyRoom): void {
  sessionStorage.setItem(RECONNECT_KEY, room.reconnectionToken);
}
export function clearReconnect(): void {
  sessionStorage.removeItem(RECONNECT_KEY);
}
export async function reconnectRoom(): Promise<LobbyRoom | null> {
  const token = sessionStorage.getItem(RECONNECT_KEY);
  if (!token || !readGuest()) return null;
  try {
    const room: LobbyRoom = await client.reconnect<WireLobby>(token);
    saveReconnect(room);
    return room;
  } catch {
    clearReconnect();
    throw new Error(
      'Your room connection expired. If the match has started, it can no longer be rejoined.',
    );
  }
}
export function snapshot(state: WireLobby): LobbyView {
  return {
    inviteCode: state.inviteCode,
    hostPlayerId: state.hostPlayerId,
    phase: state.phase,
    phaseDeadline: state.phaseDeadline,
    serverTime: state.serverTime,
    maxPlayers: state.maxPlayers,
    minPlayers: state.minPlayers,
    arenaHalfExtent: state.arenaHalfExtent,
    gameMode: state.gameMode,
    roleAssignmentMode: state.roleAssignmentMode,
    mapId: state.mapId,
    iceScore: state.iceScore,
    waterScore: state.waterScore,
    waterStartedCount: state.waterStartedCount,
    waterUnfrozenCount: state.waterUnfrozenCount,
    snowStarted: state.snowStarted,
    blizzardEnabled: state.blizzardEnabled,
    blizzardStarted: state.blizzardStarted,
    matchWinner: state.matchWinner,
    resultReason: state.resultReason,
    players: [...state.players.values()].map((p) => ({
      playerId: p.playerId,
      displayName: p.displayName,
      team: p.team,
      roleChoice: p.roleChoice,
      isConnected: p.isConnected,
      isBot: p.isBot,
      reconnectDeadline: p.reconnectDeadline,
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: p.yaw,
      pitch: p.pitch,
      velocityX: p.velocityX,
      velocityZ: p.velocityZ,
      verticalVelocity: p.verticalVelocity,
      isGrounded: p.isGrounded,
      inputSequence: p.inputSequence,
      status: p.status,
      protectedUntil: p.protectedUntil,
      isSliding: p.isSliding,
      isCrouching: p.isCrouching,
      slideUntil: p.slideUntil,
      slideReadyAt: p.slideReadyAt,
      kills: p.kills,
      deaths: p.deaths,
      spawnGeneration: p.spawnGeneration,
      ping: p.ping,
      rescueProgress: p.rescueProgress,
      lungeUntil: p.lungeUntil,
      lungeReadyAt: p.lungeReadyAt,
      lungeDirectionX: p.lungeDirectionX,
      lungeDirectionZ: p.lungeDirectionZ,
      isWallRunning: p.isWallRunning,
    })),
  };
}
