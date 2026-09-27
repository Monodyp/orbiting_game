import { Server, matchMaker } from '@colyseus/core';
import type { IncomingMessage } from 'node:http';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Encoder } from '@colyseus/schema';
import express, { type ErrorRequestHandler } from 'express';
import {
  ROOM_NAME,
  isEmptyPayload,
  isRecord,
  normalizeInviteCode,
  sanitizeDisplayName,
} from '@ice-water/shared';
import { GuestSessions, type GuestIdentity } from './auth/guest-session.js';
import { RateLimiter } from './auth/rate-limiter.js';
import { isAllowedClientOrigin, type ServerConfig } from './config/environment.js';
import { createDatabase, type Database } from './persistence/database.js';
import { createPrivateRoom } from './rooms/private-room.js';
import { RoomDirectory } from './rooms/room-directory.js';

export async function startServer(
  config: ServerConfig,
  database: Database = createDatabase(config.databaseUrl),
) {
  // The measured 150-player initial state exceeds the encoder's 16 KiB default.
  // This is Colyseus's explicit process-wide allocation setting.
  // The measured 150-player FPS schema exceeds the previous 32 KiB buffer.
  Encoder.BUFFER_SIZE = 64 * 1024;
  const sessions = new GuestSessions(config.signingSecret, config.sessionTtlSeconds);
  const directory = new RoomDirectory();
  const sessionRate = new RateLimiter(600, 60000);
  const roomIpRate = new RateLimiter(600, 60000);
  const roomGuestRate = new RateLimiter(10, 60000);
  const upgradeRate = new RateLimiter(600, 60000);
  let isListening = false;
  const transport = new WebSocketTransport({
    maxPayload: 4096,
    verifyClient({ req }: { req: IncomingMessage }) {
      const origin = req.headers.origin;
      return (
        (!origin || isAllowedClientOrigin(origin, config)) &&
        upgradeRate.take(req.socket.remoteAddress ?? 'unknown')
      );
    },
  });
  const server = new Server({
    transport,
    greet: false,
    gracefullyShutdown: false,
    express(app) {
      app.disable('x-powered-by');
      app.use((request, response, next) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
        const origin = request.headers.origin;
        if (origin && !isAllowedClientOrigin(origin, config)) {
          response.status(403).json({ message: 'Origin not allowed' });
          return;
        }
        response.setHeader('Access-Control-Allow-Origin', origin ?? config.clientOrigin);
        response.setHeader('Vary', 'Origin');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        response.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        if (request.method === 'OPTIONS') {
          response.sendStatus(204);
          return;
        }
        next();
      });
      app.get('/health', (_request, response) => {
        response.json({ status: 'ok' });
      });
      app.get('/ready', async (_request, response) => {
        const isDatabaseReady = await database.isReady();
        const isReady = isListening && isDatabaseReady;
        response.status(isReady ? 200 : 503).json({
          status: isReady ? 'ready' : 'not-ready',
          database: isDatabaseReady ? 'ready' : 'unavailable',
        });
      });
      app.use('/api', (request, response, next) => {
        const ip = request.socket.remoteAddress ?? 'unknown';
        const limiter = request.path === '/guest-session' ? sessionRate : roomIpRate;
        if (!limiter.take(ip)) {
          response.setHeader('Retry-After', '60');
          response.status(429).json({ message: 'Too many requests. Try again in a minute.' });
          return;
        }
        if (!request.is('application/json')) {
          response.status(415).json({ message: 'Send JSON' });
          return;
        }
        next();
      });
      app.use('/api', express.json({ limit: '4kb', strict: true }));
      const authenticate = (header?: string): GuestIdentity => {
        if (!header?.startsWith('Bearer ')) throw new Error('Guest session required');
        return sessions.verify(header.slice(7));
      };
      app.post('/api/guest-session', (request, response) => {
        const body: unknown = request.body;
        if (!isRecord(body) || Object.keys(body).some((key) => key !== 'displayName')) {
          response.status(400).json({ message: 'Enter a valid display name' });
          return;
        }
        let previous: GuestIdentity | undefined;
        if (request.headers.authorization) {
          try {
            previous = authenticate(request.headers.authorization);
          } catch {
            response
              .status(401)
              .json({ message: 'Guest session expired. Choose a name to continue.' });
            return;
          }
        }
        const name = previous?.displayName ?? sanitizeDisplayName(body.displayName);
        if (!name) {
          response.status(400).json({
            message:
              'Use 2–20 letters or numbers. Spaces, apostrophes, hyphens, and underscores are allowed.',
          });
          return;
        }
        response.status(previous ? 200 : 201).json(sessions.issue(name, previous));
      });
      app.use('/api/rooms', (request, response, next) => {
        let identity: GuestIdentity;
        try {
          identity = authenticate(request.headers.authorization);
        } catch {
          response
            .status(401)
            .json({ message: 'Guest session expired. Choose a name to continue.' });
          return;
        }
        if (!roomGuestRate.take(identity.sessionId)) {
          response.status(429).json({ message: 'Too many room requests. Try again in a minute.' });
          return;
        }
        response.locals.identity = identity;
        next();
      });
      app.post(['/api/rooms', '/api/rooms/join'], async (request, response) => {
        const identity = response.locals.identity as GuestIdentity;
        const isCreating = request.path === '/api/rooms';
        const body: unknown = request.body;
        if (
          isCreating
            ? !isEmptyPayload(body)
            : !isRecord(body) || Object.keys(body).some((key) => key !== 'inviteCode')
        ) {
          response.status(400).json({ message: 'Invalid room request' });
          return;
        }
        const code = isCreating
          ? directory.newCode()
          : normalizeInviteCode(isRecord(body) ? body.inviteCode : undefined);
        if (!code) {
          response.status(400).json({ message: 'Enter an eight-character invite code' });
          return;
        }
        if (!directory.claim(identity.sessionId, 'pending', Date.now() + 15000)) {
          if (isCreating) directory.dispose(code, 'unused');
          response
            .status(409)
            .json({ message: 'This guest already has a room. Leave it or reconnect first.' });
          return;
        }
        let roomId = '';
        try {
          if (isCreating) {
            const listing = await matchMaker.createRoom(ROOM_NAME, {
              inviteCode: code,
              hostPlayerId: identity.playerId,
            });
            roomId = listing.roomId;
          } else {
            roomId = directory.find(code) ?? '';
          }
          if (!roomId) {
            response.status(404).json({ message: 'Room not found. Check the invite code.' });
            return;
          }
          directory.release(identity.sessionId, 'pending');
          directory.claim(identity.sessionId, roomId, Date.now() + 15000);
          const room = await matchMaker.getRoomById(roomId);
          if (!room || room.locked) {
            response.status(409).json({ message: 'Room is full or has already started' });
            directory.release(identity.sessionId, roomId);
            return;
          }
          const seat = await matchMaker.reserveSeatFor(room, {
            token: request.headers.authorization?.slice(7),
            inviteCode: code,
          });
          response.status(isCreating ? 201 : 200).json({ inviteCode: code, seat });
        } catch {
          directory.release(identity.sessionId, roomId);
          if (isCreating) directory.dispose(code, roomId);
          response
            .status(409)
            .json({ message: 'Room is unavailable, full, or already started. Try again.' });
        } finally {
          directory.release(identity.sessionId, 'pending');
        }
      });
      // All initial matchmaking must pass signed-session and invite-code checks above.
      app.use('/matchmake', (request, response, next) => {
        if (
          request.method === 'POST' &&
          /^\/reconnect\/[^/]+$/.test(request.path) &&
          upgradeRate.take(request.socket.remoteAddress ?? 'unknown')
        ) {
          next();
          return;
        }
        response.status(403).json({ message: 'Use the private-room lobby' });
      });
      const errors: ErrorRequestHandler = (_error, _request, response, _next) => {
        response.status(400).json({ message: 'Invalid request body' });
      };
      app.use(errors);
    },
  });
  server.define(ROOM_NAME, createPrivateRoom({ config, sessions, directory, database }));
  await server.listen(config.port, config.host);
  // Colyseus routes precede Express in 0.18. Guard the HTTP boundary, including
  // built-in matchmaking, rather than relying on Express middleware ordering.
  const http = transport.server;
  if (!http) throw new Error('HTTP transport unavailable');
  const handlers = http.listeners('request');
  http.removeAllListeners('request');
  http.on('request', (request, response) => {
    const origin = request.headers.origin;
    if (origin && !isAllowedClientOrigin(origin, config)) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      response.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    const path = (request.url ?? '/').split('?')[0] ?? '/';
    const isApi = [
      '/health',
      '/ready',
      '/api/guest-session',
      '/api/rooms',
      '/api/rooms/join',
    ].includes(path);
    const isReconnect = request.method === 'POST' && /^\/matchmake\/reconnect\/[\w-]+$/.test(path);
    if (!isApi && !isReconnect) {
      response.writeHead(403, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ message: 'Use the private-room lobby' }));
      return;
    }
    if (isReconnect && !upgradeRate.take(request.socket.remoteAddress ?? 'unknown')) {
      response.writeHead(429);
      response.end();
      return;
    }
    for (const handler of handlers) handler.call(http, request, response);
  });
  isListening = true;
  const address = transport.server?.address();
  if (!address || typeof address === 'string') throw new Error('Server address unavailable');
  return {
    server,
    port: address.port,
    async stop() {
      isListening = false;
      await server.gracefullyShutdown(false);
      await database.close();
    },
  };
}
