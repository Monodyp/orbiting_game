import type {
  GameplayEvents,
  GameplayMessages,
  ChatMessage,
  PlayerStatus,
  GameMode,
  MapId,
} from './gameplay.js';
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 150;
export const ROOM_NAME = 'private-game';
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const INVITE_LENGTH = 8;
export type Team = 'unassigned' | 'none' | 'ice' | 'water';
export type RoleAssignmentMode = 'random' | 'user-picks';
export type PlayerRole = 'ice' | 'water' | 'spectator';
export type RoleChoice = PlayerRole | 'random';
export type MatchPhase = 'lobby' | 'countdown' | 'playing' | 'finished' | 'intermission';
export interface PlayerView {
  playerId: string;
  displayName: string;
  team: Team;
  roleChoice: RoleChoice;
  isConnected: boolean;
  isBot: boolean;
  reconnectDeadline: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  velocityX: number;
  velocityZ: number;
  verticalVelocity: number;
  isGrounded: boolean;
  inputSequence: number;
  status: PlayerStatus;
  protectedUntil: number;
  isSliding: boolean;
  isCrouching: boolean;
  slideUntil: number;
  slideReadyAt: number;
  kills: number;
  deaths: number;
  spawnGeneration: number;
  ping: number;
  rescueProgress: number;
  lungeUntil: number;
  lungeReadyAt: number;
  lungeDirectionX: number;
  lungeDirectionZ: number;
  isWallRunning: boolean;
}
export interface LobbyView {
  inviteCode: string;
  hostPlayerId: string;
  phase: MatchPhase;
  phaseDeadline: number;
  serverTime: number;
  maxPlayers: number;
  minPlayers: number;
  arenaHalfExtent: number;
  gameMode: GameMode;
  roleAssignmentMode: RoleAssignmentMode;
  mapId: MapId;
  iceScore: number;
  waterScore: number;
  waterStartedCount: number;
  waterUnfrozenCount: number;
  snowStarted: boolean;
  blizzardEnabled: boolean;
  blizzardStarted: boolean;
  matchWinner: string;
  resultReason: MatchResult['reason'] | '';
  players: PlayerView[];
}
export interface GuestSession {
  token: string;
  playerId: string;
  displayName: string;
  expiresAt: number;
}
export interface SeatReservation {
  name: string;
  roomId: string;
  processId: string;
  sessionId: string;
  publicAddress?: string;
}
export interface RoomReservation {
  inviteCode: string;
  seat: SeatReservation;
}
export interface SessionError {
  code: string;
  message: string;
}
export interface MatchResult {
  winner: string;
  reason: 'all-frozen' | 'water-survived' | 'water-below-threshold';
  gameMode: GameMode;
}
export interface ClientMessages extends GameplayMessages {
  'room/start': Record<string, never>;
  'room/configure': { mapId?: MapId; roleAssignmentMode?: RoleAssignmentMode };
  'room/role': { role: PlayerRole };
  'session/ping': { sentAt: number };
  'chat/send': { message: string };
}
export interface ServerMessages extends GameplayEvents {
  'session/error': SessionError;
  'session/pong': { sentAt: number };
  'match/phase-changed': { phase: MatchPhase; phaseDeadline: number; serverTime: number };
  'match/result': MatchResult;
  'chat/message': ChatMessage;
}
