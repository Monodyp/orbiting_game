import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { GameInput } from '../input/game-input.js';
import { TouchControls } from './touch-controls.js';

it('renders dedicated touch movement, sprint, slide, lunge, tag, and jump controls', () => {
  const html = renderToStaticMarkup(createElement(TouchControls, { input: new GameInput() }));

  expect(html).toContain('aria-label="Movement joystick"');
  expect(html).toContain('aria-label="Tag or rescue"');
  expect(html).toContain('Tag / Rescue');
  expect(html).toContain('Lunge');
  expect(html).toContain('Jump');
  expect(html).toContain('Slide');
  expect(html).toContain('Sprint');
});