import type { MapId, Team } from '@ice-water/shared';
import { waterEnvironmentFor, type WaterEnvironment } from './water-presentation.js';

export const NIGHTFALL_START_MS = 180_000;
export const NIGHTFALL_DURATION_MS = 60_000;
export const NIGHT_WARNING_DURATION_MS = 5_000;
export const ICE_VISION_RADIUS = 45;

const NIGHT_ENVIRONMENT: WaterEnvironment = {
  background: 0x071426,
  fogColor: 0x102842,
  fogNear: 75,
  fogFar: 150,
};

export function matchNightProgress(
  mapId: MapId,
  remainingMs: number,
): number {
  if (mapId === 'original') return 1;

  const elapsedMs = 300_000 - remainingMs;
  if (elapsedMs <= 0) return 0;
  if (elapsedMs <= 120_000) return smoothstep(0, 120_000, elapsedMs);
  if (elapsedMs <= 180_000) return 1 - smoothstep(0, 60_000, elapsedMs - 120_000);
  return 0;
}

/**
 * Ice-only vision remains fully off until 1:00 elapsed. The dome then fades in
 * linearly from 0% → 100% from 1:00 → 2:00 elapsed, then fades out linearly
 * from 100% → 0% from 2:00 → 2:30 elapsed.
 */
export function isIceNightWindowActive(mapId: MapId, remainingMs: number): boolean {
  if (mapId === 'original') return true;

  return remainingMs <= 240_000 && remainingMs > 120_000;
}

export function iceVisionDomeProgress(mapId: MapId, remainingMs: number): number {
  if (mapId === 'original') return 0;

  const elapsedMs = 300_000 - remainingMs;
  if (elapsedMs < 60_000) return 0;
  if (elapsedMs < 120_000) return (elapsedMs - 60_000) / 60_000;
  if (elapsedMs < 150_000) return 1 - (elapsedMs - 120_000) / 30_000;
  return 0;
}

/**
 * Selects the local Ice-only vision restriction from the shared Night lifecycle.
 * The debuff is active only during the exact Night window and is not a
 * continuous multiplier tied to the sky darkening progress.
 */
export function nightVisibilityProgress(
  team: Team | undefined,
  progress: number,
  isNightWindowActive = true,
): number {
  if (team !== 'ice') return 0;
  return isNightWindowActive ? clamp01(progress) : 0;
}

export function isNightWarningVisible(remainingMs: number): boolean {
  return (
    remainingMs <= NIGHTFALL_START_MS &&
    remainingMs > NIGHTFALL_START_MS - NIGHT_WARNING_DURATION_MS
  );
}

export function matchEnvironmentFor(
  mapId: MapId,
  isUnderwater: boolean,
  nightProgress: number,
): WaterEnvironment {
  const environment = waterEnvironmentFor(mapId, isUnderwater);
  if (mapId === 'original' || isUnderwater) return environment;
  const progress = clamp01(nightProgress);
  return {
    background: mixHexColor(environment.background, NIGHT_ENVIRONMENT.background, progress),
    fogColor: mixHexColor(environment.fogColor, NIGHT_ENVIRONMENT.fogColor, progress),
    fogNear: mix(environment.fogNear, NIGHT_ENVIRONMENT.fogNear, progress),
    fogFar: mix(environment.fogFar, NIGHT_ENVIRONMENT.fogFar, progress),
  };
}

function mixHexColor(from: number, to: number, progress: number): number {
  const red = Math.round(mix((from >> 16) & 0xff, (to >> 16) & 0xff, progress));
  const green = Math.round(mix((from >> 8) & 0xff, (to >> 8) & 0xff, progress));
  const blue = Math.round(mix(from & 0xff, to & 0xff, progress));
  return (red << 16) | (green << 8) | blue;
}

function mix(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(min: number, max: number, value: number): number {
  const t = clamp01((value - min) / (max - min));
  return t * t * (3 - 2 * t);
}
