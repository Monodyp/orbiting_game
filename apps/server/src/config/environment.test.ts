import { expect, it } from 'vitest';
import { isAllowedClientOrigin, readConfig } from './environment.js';

const valid = { GUEST_SESSION_SIGNING_SECRET: 'test-only-valid-signing-secret-with-32-characters' };
it('validates secrets, capacity, reconnection windows, and production transport configuration', () => {
  expect(readConfig(valid)).toMatchObject({
    maxPlayers: 150,
    devBotCount: 0,
    devForceIce: false,
    maxHumanPlayers: 150,
    countdownSeconds: 5,
    reconnectSeconds: 25,
  });
  for (const override of [
    { GUEST_SESSION_SIGNING_SECRET: 'replace-with-a-long-random-secret' },
    { GUEST_SESSION_SIGNING_SECRET: '' },
    { ROOM_MAX_PLAYERS: '151' },
    { ROOM_MAX_PLAYERS: '0' },
    { ROOM_MAX_PLAYERS: '6', DEV_BOT_COUNT: '6' },
    { ROOM_MAX_PLAYERS: '100', DEV_BOT_COUNT: '100' },
    { DEV_BOT_COUNT: '150' },
    { DEV_FORCE_ICE: 'yes' },
    { RECONNECT_SECONDS: '19' },
    { RECONNECT_SECONDS: '31' },
    { COUNTDOWN_SECONDS: '0' },
    { GAME_SERVER_PORT: 'nope' },
    { CLIENT_ORIGIN: 'https://game.example/path' },
    { NODE_ENV: 'production', CLIENT_ORIGIN: 'http://game.example' },
    { NODE_ENV: 'production', CLIENT_ORIGIN: 'https://game.example' },
    { DATABASE_URL: 'http://db.example' },
  ])
    expect(() => readConfig({ ...valid, ...override })).toThrow();
});

it('allows forcing only a development host onto Ice', () => {
  expect(readConfig({ ...valid, DEV_FORCE_ICE: 'true' }).devForceIce).toBe(true);
  expect(
    readConfig({
      ...valid,
      NODE_ENV: 'production',
      CLIENT_ORIGIN: 'https://game.example',
      DATABASE_URL: 'postgresql://localhost/game',
      DEV_FORCE_ICE: 'true',
    }).devForceIce,
  ).toBe(false);
});

it('reserves bot seats from room capacity while retaining at least one human seat', () => {
  expect(readConfig({ ...valid, ROOM_MAX_PLAYERS: '150', DEV_BOT_COUNT: '149' })).toMatchObject({
    maxPlayers: 150,
    devBotCount: 149,
    maxHumanPlayers: 1,
  });
  expect(
    readConfig({
      ...valid,
      NODE_ENV: 'production',
      CLIENT_ORIGIN: 'https://game.example',
      DATABASE_URL: 'postgresql://localhost/game',
      ROOM_MAX_PLAYERS: '6',
      DEV_BOT_COUNT: '5',
    }),
  ).toMatchObject({ maxPlayers: 6, devBotCount: 0, maxHumanPlayers: 6 });
  expect(() =>
    readConfig({
      ...valid,
      NODE_ENV: 'production',
      CLIENT_ORIGIN: 'https://game.example',
      DATABASE_URL: 'postgresql://localhost/game',
      ROOM_MAX_PLAYERS: '6',
      DEV_BOT_COUNT: '6',
    }),
  ).toThrow('DEV_BOT_COUNT must be at most ROOM_MAX_PLAYERS - 1');
});

it('allows either loopback hostname during local development only', () => {
  const config = readConfig({ ...valid, CLIENT_ORIGIN: 'http://localhost:5173' });
  expect(isAllowedClientOrigin('http://localhost:5173', config)).toBe(true);
  expect(isAllowedClientOrigin('http://127.0.0.1:5173', config)).toBe(true);
  expect(isAllowedClientOrigin('http://localhost:4173', config)).toBe(true);
  expect(isAllowedClientOrigin('http://127.0.0.1:4173', config)).toBe(true);
  const tunnelOrigin = 'https://venture-demand-mouse-marion.trycloudflare.com';
  expect(isAllowedClientOrigin(tunnelOrigin, config)).toBe(true);
  expect(
    isAllowedClientOrigin(tunnelOrigin, {
      ...config,
      isProduction: true,
    }),
  ).toBe(false);
  expect(
    isAllowedClientOrigin('http://127.0.0.1:4173', {
      ...config,
      isProduction: true,
    }),
  ).toBe(false);
  expect(
    isAllowedClientOrigin('http://127.0.0.1:5173', {
      ...config,
      isProduction: true,
    }),
  ).toBe(false);
});
