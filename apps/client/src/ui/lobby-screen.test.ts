import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { LobbyView, PlayerView } from '@ice-water/shared';
import { DEFAULT_SETTINGS } from '../game/fps-settings.js';
import type { LobbyRoom } from '../network/lobby-client.js';
import { LobbyScreen } from './lobby-screen.js';

function player(
  playerId: string,
  displayName: string,
  roleChoice: 'ice' | 'water' | 'spectator' | 'random' = 'random',
) {
  return {
    playerId,
    displayName,
    team: 'unassigned',
    roleChoice,
    isConnected: true,
    isBot: false,
  } as PlayerView;
}

function view(players: PlayerView[], roleAssignmentMode: 'random' | 'user-picks' = 'random'): LobbyView {
  return {
    inviteCode: 'ABCDEFGH',
    hostPlayerId: 'local-id',
    phase: 'lobby',
    phaseDeadline: 0,
    serverTime: 1_000,
    maxPlayers: 150,
    minPlayers: 2,
    arenaHalfExtent: 60,
    gameMode: 'tdm',
    roleAssignmentMode,
    mapId: 'frostline',
    iceScore: 0,
    waterScore: 0,
    waterStartedCount: 0,
    waterUnfrozenCount: 0,
    snowStarted: false,
    blizzardEnabled: false,
    blizzardStarted: false,
    matchWinner: '',
    resultReason: '',
    players,
  };
}

function renderLobby(lobbyView: LobbyView): string {
  return renderToStaticMarkup(
    createElement(LobbyScreen, {
      guest: {
        token: 'test-token',
        playerId: 'local-id',
        displayName: 'Twin Name',
        expiresAt: Date.now() + 60_000,
      },
      room: { send: () => {} } as unknown as LobbyRoom,
      view: lobbyView,
      error: '',
      isBusy: false,
      now: 1_000,
      settings: DEFAULT_SETTINGS,
      onSettings: () => {},
      onIdentify: () => {},
      onCreate: () => {},
      onJoin: () => {},
      onLeave: () => {},
      onForgetGuest: () => {},
      onAudioUnlock: () => {},
      onUiCue: () => {},
    }),
  );
}

function rosterMarkup(html: string): string {
  const start = html.indexOf('aria-label="Players in room"');
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
}

it('renders the room player roster by ID without party UI and updates from room snapshots', () => {
  const twoPlayers = renderLobby(
    view([player('local-id', 'Twin Name'), player('other-id', 'Twin Name')]),
  );
  expect(twoPlayers.match(/class="is-local"/g)).toHaveLength(1);
  expect(rosterMarkup(twoPlayers).match(/Twin Name/g)).toHaveLength(2);
  expect(twoPlayers).toContain('You');
  expect(twoPlayers).not.toContain('local-id');
  expect(twoPlayers).not.toContain('other-id');
  expect(twoPlayers).not.toContain('Your party');
  expect(twoPlayers).not.toContain('party-dock');
  expect(twoPlayers).not.toContain('Social');
  expect(twoPlayers).toContain('Frostline');
  expect(twoPlayers).not.toContain('Frost Island');
  expect(twoPlayers).not.toContain('Original World');

  const onePlayer = renderLobby(view([player('local-id', 'Twin Name')]));
  expect(onePlayer.match(/class="is-local"/g)).toHaveLength(1);
  expect(rosterMarkup(onePlayer).match(/Twin Name/g)).toHaveLength(1);
});

it('exposes synchronized role mode and per-player role choices', () => {
  const randomMode = renderLobby(view([player('local-id', 'Twin Name')]));
  expect(randomMode).toContain('aria-label="Role assignment mode"');
  expect(randomMode).toContain('aria-pressed="true">Random</button>');
  expect(randomMode).toContain('aria-label="Your role choice"');
  expect(randomMode).toContain('disabled="">Ice</button>');
  expect(randomMode).toContain('disabled="">Water</button>');
  expect(randomMode).toContain('aria-pressed="false">Spectator: OFF</button>');

  const userPicks = renderLobby(
    view(
      [player('local-id', 'Twin Name', 'ice'), player('other-id', 'Other', 'water')],
      'user-picks',
    ),
  );
  expect(userPicks).toContain('aria-label="Your role choice"');
  expect(userPicks).toContain('aria-pressed="true">Ice</button>');
  expect(userPicks).toContain('PREFERS WATER');

  const spectator = renderLobby(
    view([player('local-id', 'Twin Name', 'spectator'), player('other-id', 'Other', 'spectator')]),
  );
  expect(rosterMarkup(spectator)).toContain('SPECTATOR');
  expect(spectator).toContain('aria-pressed="true">Spectator: ON</button>');
  expect(spectator).toContain('You will watch this match and cannot join either team.');
  expect(spectator).toContain('<button class="primary deployment-button" disabled="">');
});