import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface ServerConfig {
  host: string;
  port: number;
  clientOrigin: string;
  signingSecret: string;
  databaseUrl?: string;
  isProduction: boolean;
  /** Total room population, including development bots. */
  maxPlayers: number;
  /** Non-zero only in development. Bots fill seats so solo testing is possible. */
  devBotCount: number;
  /** Development-only host-team override for local Ice testing. */
  devForceIce: boolean;
  /** Human seats remaining after development bots reserve part of maxPlayers. */
  maxHumanPlayers: number;
  countdownSeconds: number;
  reconnectSeconds: number;
  sessionTtlSeconds: number;
}

export function isAllowedClientOrigin(
  origin: string,
  config: Pick<ServerConfig, 'clientOrigin' | 'isProduction'>,
): boolean {
  if (origin === config.clientOrigin) return true;

  if (config.isProduction) return false;

  let candidate: URL;
  try {
    candidate = new URL(origin);
  } catch {
    return false;
  }

  // Allow temporary Cloudflare Quick Tunnel frontends during development.
  if (
    candidate.protocol === 'https:' &&
    (candidate.hostname === 'trycloudflare.com' ||
      candidate.hostname.endsWith('.trycloudflare.com'))
  ) {
    return true;
  }

  const configured = new URL(config.clientOrigin);
  if (!['localhost', '127.0.0.1'].includes(configured.hostname)) return false;

  const allowedOrigins = new Set([configured.origin]);

  for (const hostname of ['localhost', '127.0.0.1']) {
    const localOrigin = new URL(configured);
    localOrigin.hostname = hostname;
    allowedOrigins.add(localOrigin.origin);

    localOrigin.port = '4173';
    allowedOrigins.add(localOrigin.origin);
  }

  return allowedOrigins.has(origin);
}

export function loadEnvironment(): void {
  const path = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
    return value;
  };
  const boolean = (key: string, fallback: boolean) => {
    const value = env[key];
    if (value === undefined) return fallback;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`Invalid ${key}`);
  };
  const secret = env.GUEST_SESSION_SIGNING_SECRET ?? '';
  if (secret.length < 32 || /replace|example/i.test(secret))
    throw new Error(
      'Set GUEST_SESSION_SIGNING_SECRET to a random secret of at least 32 characters',
    );
  const isProduction = env.NODE_ENV === 'production';
  const origin = new URL(env.CLIENT_ORIGIN ?? 'http://localhost:5173');
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.origin !== origin.href.replace(/\/$/, '') ||
    origin.username ||
    origin.password
  )
    throw new Error('Invalid CLIENT_ORIGIN');
  if (isProduction && origin.protocol !== 'https:')
    throw new Error('Production CLIENT_ORIGIN must use HTTPS');
  if (isProduction && !env.DATABASE_URL) throw new Error('Production requires DATABASE_URL');
  if (env.DATABASE_URL) {
    const database = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(database.protocol))
      throw new Error('Invalid DATABASE_URL');
  }
  const maxPlayers = integer('ROOM_MAX_PLAYERS', 150, 1, 150);
  const requestedDevBotCount = integer('DEV_BOT_COUNT', 0, 0, 149);
  if (requestedDevBotCount > maxPlayers - 1)
    throw new Error('DEV_BOT_COUNT must be at most ROOM_MAX_PLAYERS - 1');
  const devBotCount = isProduction ? 0 : requestedDevBotCount;
  const devForceIce = !isProduction && boolean('DEV_FORCE_ICE', false);
  return {
    host: env.GAME_SERVER_HOST ?? '127.0.0.1',
    port: integer('GAME_SERVER_PORT', 2567, 0, 65535),
    clientOrigin: origin.origin,
    signingSecret: secret,
    databaseUrl: env.DATABASE_URL || undefined,
    isProduction,
    maxPlayers,
    devBotCount,
    devForceIce,
    maxHumanPlayers: maxPlayers - devBotCount,
    countdownSeconds: integer('COUNTDOWN_SECONDS', 5, 1, 30),
    reconnectSeconds: integer('RECONNECT_SECONDS', 25, 20, 30),
    sessionTtlSeconds: integer('GUEST_SESSION_TTL_SECONDS', 3600, 60, 86400),
  };
}
