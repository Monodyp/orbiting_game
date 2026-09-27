import type { MatchPhase } from './lobby.js';
export interface Position {
  x: number;
  z: number;
}
export interface SpatialPosition extends Position {
  y: number;
}
export interface MoveInput extends Position {
  sequence: number;
  yaw?: number;
  pitch?: number;
  jump?: boolean;
  slide?: boolean;
  sprint?: boolean;
  crouch?: boolean;
}
export type InteractionIntent = Record<string, never>;
export type PlayerStatus = 'alive' | 'frozen' | 'spectator';
export const MAX_CHAT_MESSAGE_LENGTH = 160;
export interface ChatMessage {
  playerId: string;
  displayName: string;
  message: string;
  serverTime: number;
}
/** Ice Ice Water is the only supported match format. */
export type GameMode = 'tdm';
export type MapId = 'frostline' | 'island' | 'original';
export interface GameplayMessages {
  'input/move': MoveInput;
  'action/interact': InteractionIntent;
  'action/lunge': InteractionIntent;
}
export interface GameplayEvents {
  'player/frozen': { playerId: string; attackerId: string; serverTime: number };
  'player/rescued': { playerId: string; rescuerIds: string[]; serverTime: number };
}
export type GameplayEvent = {
  [K in keyof GameplayEvents]: { type: K; payload: GameplayEvents[K] };
}[keyof GameplayEvents];
export function isPlayPhase(phase: MatchPhase): boolean {
  return phase === 'playing';
}
