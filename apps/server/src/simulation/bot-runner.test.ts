import { describe, expect, it, vi } from 'vitest';
import { LobbyState, PlayerState } from '../rooms/lobby-state.js';
import { LobbyController } from '../rooms/lobby-controller.js';
import { GameplayController } from '../gameplay/gameplay-controller.js';
import { BotRunner } from './bot-runner.js';

describe('BotRunner and freeze-tag practice', () => {
  it('populates active bot seats so the host can meet the match minimum', () => {
    const state = new LobbyState();
    state.maxPlayers = 6;
    state.hostPlayerId = 'human-host';

    // Add human host
    const host = new PlayerState();
    host.playerId = 'human-host';
    host.displayName = 'Freeze Tag Host';
    state.players.set(host.playerId, host);

    const gameplay = new GameplayController(state, () => {});
    const bots = new BotRunner(state, gameplay, 5);
    const lobby = new LobbyController(state, 5000);

    expect(lobby.connectedCount()).toBe(1);

    // Start bots
    bots.start();
    expect(lobby.connectedCount()).toBe(6);
    expect(state.players.size).toBe(6);

    // Host starts
    const error = lobby.start('human-host', 1000);
    expect(error).toBeNull();
    expect(state.phase).toBe('countdown');

    // Ticking moves bots
    bots.tick(1050);

    // Countdown finishes -> regular round starts
    const transitioned = lobby.tick(6001);
    expect(transitioned).toBe(true);
    expect(state.phase).toBe('playing');

    // Stop bots
    bots.stop();
    expect(state.players.size).toBe(1);
  });

  it('ensures bots are never selected as host in transferHost', () => {
    const state = new LobbyState();
    state.hostPlayerId = 'bot-0';

    const gameplay = new GameplayController(state, () => {});
    const bots = new BotRunner(state, gameplay, 3);
    bots.start();

    const lobby = new LobbyController(state, 5000);
    lobby.transferHost();
    // No humans connected, so hostPlayerId should become empty string
    expect(state.hostPlayerId).toBe('');

    // Add human
    const human = new PlayerState();
    human.playerId = 'human-player';
    state.players.set(human.playerId, human);

    lobby.transferHost();
    expect(state.hostPlayerId).toBe('human-player');
  });

  it('refuses to add bots beyond the total room capacity', () => {
    const state = new LobbyState();
    state.maxPlayers = 6;
    const human = new PlayerState();
    human.playerId = 'human-player';
    state.players.set(human.playerId, human);
    const gameplay = new GameplayController(state, () => {});

    expect(() => new BotRunner(state, gameplay, 6).start()).toThrow(
      'Development bots exceed room capacity',
    );
    expect(state.players.size).toBe(1);
  });

  it('processes Island bot movement and human tag intent in the same authoritative tick', () => {
    const state = new LobbyState();
    state.mapId = 'island';
    state.maxPlayers = 6;
    state.phase = 'playing';
    state.phaseDeadline = 60_000;
    const host = new PlayerState();
    host.playerId = 'human-host';
    host.displayName = 'Island Host';
    host.team = 'ice';
    state.players.set(host.playerId, host);

    const gameplay = new GameplayController(state, () => {}),
      bots = new BotRunner(state, gameplay, 5);
    bots.start();
    for (const player of state.players.values())
      if (player.isBot) player.team = 'water';
    gameplay.start(1_000);
    const positions = new Map(
      [...state.players.values()].map((player) => [player.playerId, { x: player.x, z: player.z }]),
    );
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    try {
      bots.tick(1_050);
      gameplay.advance(1_050);
    } finally {
      random.mockRestore();
    }

    const botPlayers = [...state.players.values()].filter((player) => player.isBot);
    expect(botPlayers.every((player) => player.inputSequence === 1)).toBe(true);
    expect(
      botPlayers.some((player) => {
        const before = positions.get(player.playerId)!;
        return Math.hypot(player.x - before.x, player.z - before.z) > 0.01;
      }),
    ).toBe(true);
    expect(gameplay.handle(host.playerId, 'action/interact', {}, 1_051)).toBeNull();
  });
});
