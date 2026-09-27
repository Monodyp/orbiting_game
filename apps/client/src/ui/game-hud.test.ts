import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { LobbyView } from '@ice-water/shared';
import { GameHud, roundInstructionFor, weatherNotificationFor } from './game-hud.js';

it('selects round instructions exclusively from the authoritative team value', () => {
  expect(roundInstructionFor('ice')).toEqual({
    title: 'You are Ice!',
    message: 'Tag all Water players to freeze them and win the game.',
  });
  expect(roundInstructionFor('water')).toEqual({
    title: 'You are Water!',
    message:
      'Avoid getting frozen, and save your teammates by unfreezing them! Survive until the end of the round.',
  });
  expect(roundInstructionFor('unassigned')).toBeNull();
});

it('announces Snow only on its authoritative state transition with truthful wording', () => {
  const initial = { snowStarted: false, blizzardEnabled: false, blizzardStarted: false };
  expect(weatherNotificationFor(initial, { ...initial, snowStarted: true })).toEqual({
    kind: 'snow',
    message: 'SNOW HAS BEGUN.',
  });
  expect(
    weatherNotificationFor(initial, {
      ...initial,
      snowStarted: true,
      blizzardEnabled: true,
    }),
  ).toEqual({
    kind: 'snow',
    message: 'SNOW HAS BEGUN. A BLIZZARD MAY FOLLOW.',
  });
  expect(
    weatherNotificationFor(
      { ...initial, snowStarted: true },
      { ...initial, snowStarted: true },
    ),
  ).toBeNull();
});

it('announces Blizzard only on its enabled authoritative start transition', () => {
  const before = { snowStarted: true, blizzardEnabled: true, blizzardStarted: false };
  expect(
    weatherNotificationFor(before, { ...before, blizzardStarted: true }),
  ).toEqual({ kind: 'blizzard', message: 'BLIZZARD HAS ARRIVED!' });
  expect(
    weatherNotificationFor(
      { ...before, blizzardEnabled: false },
      { ...before, blizzardEnabled: false, blizzardStarted: true },
    ),
  ).toBeNull();
  expect(
    weatherNotificationFor(before, { ...before, blizzardStarted: false }),
  ).toBeNull();
});

it('does not replay Blizzard arrival from an already-started initial HUD snapshot', () => {
  const view = {
    phase: 'playing',
    phaseDeadline: 10_000,
    mapId: 'frostline',
    waterUnfrozenCount: 1,
    waterStartedCount: 1,
    snowStarted: true,
    blizzardEnabled: true,
    blizzardStarted: true,
    players: [
      {
        playerId: 'ice-1',
        team: 'ice',
        status: 'alive',
        velocityX: 0,
        velocityZ: 0,
        rescueProgress: 0,
      },
    ],
  } as LobbyView;
  const html = renderToStaticMarkup(
    createElement(GameHud, {
      view,
      localPlayerId: 'ice-1',
      serverNow: 1_000,
      crosshair: '#fff',
      isRoundInstructionVisible: false,
      onRoundInstructionDismiss: () => {},
      chatMessages: [
        {
          playerId: 'ice-1',
          displayName: 'Ice Player',
          message: 'Hold the north lane',
          serverTime: 2_000,
        },
      ],
      onChatSend: () => {},
      onChatFocusChange: () => {},
    }),
  );

  expect(html).not.toContain('BLIZZARD HAS ARRIVED');
  expect(html).not.toContain('weather-notification');
  expect(html).toContain('Room chat');
  expect(html).toContain('Ice Player');
  expect(html).toContain('Hold the north lane');
  expect(html).toContain('Press Enter to chat');
  expect(html).toContain('WASD');
  expect(html).toContain('Move');
  expect(html).toContain('Left Click');
  expect(html).toContain('Tag / interact');
  expect(html).toContain('SHIFT');
  expect(html).toContain('Sprint');
  expect(html).toContain('C</span>');
  expect(html).toContain('Slide');
  expect(html).toContain('RMB');
  expect(html).toContain('Lunge');
  expect(html).toContain('Space');
  expect(html).toContain('Jump');
  expect(html).not.toContain('>Q<');
});
