import { expect, it } from 'vitest';
import { GAMEPLAY, isMoveInput, isSwimming, simulateMovement, type PlayerView } from '@ice-water/shared';
import { LocalPrediction, RemoteInterpolation } from './player-motion.js';
function player(): PlayerView {
  return {
    playerId: 'p',
    displayName: 'Player',
    team: 'none',
    roleChoice: 'random',
    isConnected: true,
    isBot: false,
    reconnectDeadline: 0,
    x: 0,
    y: 0,
    z: -34,
    yaw: 0,
    pitch: 0,
    velocityX: 0,
    velocityZ: 0,
    verticalVelocity: 0,
    isGrounded: true,
    inputSequence: 0,
    status: 'alive',
    protectedUntil: 0,
    isSliding: false,
    isCrouching: false,
    slideUntil: 0,
    slideReadyAt: 0,
    kills: 0,
    deaths: 0,
    spawnGeneration: 1,
    ping: 0,
    rescueProgress: 0,
    lungeUntil: 0,
    lungeReadyAt: 0,
    lungeDirectionX: 0,
    lungeDirectionZ: 0,
    isWallRunning: false,
  };
}
it('replays pending inputs identically to the server and clears prediction on spawn', () => {
  const p = player(),
    prediction = new LocalPrediction();
  prediction.reconcile(p, true);
  const first = prediction.predict({ x: 1, z: 0 }, true, 50);
  const second = prediction.predict({ x: 1, z: 0, jump: true }, true, 100);
  const server = simulateMovement(p, first, 50);
  prediction.reconcile({ ...p, ...server, inputSequence: first.sequence }, true);
  expect(prediction.motion).toEqual(simulateMovement(server, second, 100));
  prediction.reconcile({ ...p, spawnGeneration: 2 }, true);
  expect(prediction.motion.x).toBe(0);
});
it('keeps interaction-only fields out of movement payloads', () => {
  const prediction = new LocalPrediction();
  const move = prediction.predict(
    { x: 1, z: 0, yaw: 0, pitch: 0, jump: false, slide: false, sprint: false, crouch: false },
    true,
    50,
  );
  expect(isMoveInput(move)).toBe(true);
  expect('hasInteraction' in move).toBe(false);
});
it('predicts Frost Island buoyancy identically to authoritative movement', () => {
  const prediction = new LocalPrediction();
  prediction.mapId = 'island';
  let authoritative: PlayerView = {
    ...player(),
    x: 20,
    y: GAMEPLAY.waterSurfaceY,
    z: -54,
  };
  prediction.reconcile(authoritative, true);
  for (let tick = 1; tick <= 20; tick++) {
    const now = tick * GAMEPLAY.tickMs;
    const input = prediction.predict({ x: 0, z: 0 }, true, now);
    const serverMotion = simulateMovement(
      authoritative,
      input,
      now,
      GAMEPLAY.tickMs / 1000,
      1,
      'island',
    );
    authoritative = {
      ...authoritative,
      ...serverMotion,
      inputSequence: input.sequence,
    };
    prediction.reconcile(authoritative, true);
    expect(prediction.motion).toEqual(serverMotion);
  }
  expect(prediction.motion.y).toBeLessThan(-0.4);
  expect(isSwimming(prediction.motion, 'island')).toBe(true);
});
it('interpolates remote poses and snaps generations instead of flying across the map', () => {
  const remote = new RemoteInterpolation(),
    p = player();
  remote.push(p, 100);
  remote.push({ ...p, x: 2 }, 200);
  expect(remote.at(150)?.x).toBe(1);
  remote.push({ ...p, x: 30, spawnGeneration: 2 }, 300);
  expect(remote.at(250)?.x).toBe(30);
});
