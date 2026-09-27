import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  NIGHTFALL_START_MS,
  NIGHT_WARNING_DURATION_MS,
  ICE_VISION_RADIUS,
  iceVisionDomeProgress,
  isIceNightWindowActive,
  isNightWarningVisible,
  matchEnvironmentFor,
  matchNightProgress,
  nightVisibilityProgress,
} from './match-night.js';
import { waterEnvironmentFor } from './water-presentation.js';
import { ResultsScreen } from '../ui/results-screen.js';

describe('match nightfall', () => {
  it('is active from exactly 2:00 elapsed through 3:00 elapsed', () => {
    const nightAtElapsed = (elapsedMs: number) =>
      matchNightProgress('frostline', 300_000 - elapsedMs);

    expect(nightAtElapsed(0)).toBe(0);
    expect(nightAtElapsed(119_000)).toBeGreaterThan(0.99);
    expect(nightAtElapsed(120_000)).toBe(1);
    expect(nightAtElapsed(150_000)).toBeCloseTo(0.5, 2);
    expect(nightAtElapsed(180_000)).toBe(0);
    expect(matchNightProgress('island', 180_000)).toBe(1);
    expect(matchNightProgress('island', 120_000)).toBe(0);
  });

  it('keeps Original World at night', () => {
    expect(matchNightProgress('original', 300_000)).toBe(1);
  });

  it('shows the Night warning once during its opening five seconds', () => {
    expect(isNightWarningVisible(NIGHTFALL_START_MS + 1)).toBe(false);
    expect(isNightWarningVisible(NIGHTFALL_START_MS)).toBe(true);
    expect(isNightWarningVisible(NIGHTFALL_START_MS - NIGHT_WARNING_DURATION_MS + 1)).toBe(
      true,
    );
    expect(isNightWarningVisible(NIGHTFALL_START_MS - NIGHT_WARNING_DURATION_MS)).toBe(
      false,
    );
  });

  it('fades the Ice vision dome in from 1:00 to 2:00 and out by 2:30', () => {
    expect(ICE_VISION_RADIUS).toBe(45);
    const day = matchEnvironmentFor('frostline', false, 0);
    const night = matchEnvironmentFor('frostline', false, 1);
    expect(night.fogFar).toBeLessThan(day.fogFar);
    const iceProgressAtElapsed = (elapsedMs: number) =>
      iceVisionDomeProgress('frostline', 300_000 - elapsedMs);

    expect(iceProgressAtElapsed(59_999)).toBe(0);
    expect(iceProgressAtElapsed(60_000)).toBe(0);
    expect(iceProgressAtElapsed(90_000)).toBeCloseTo(0.5, 2);
    expect(iceProgressAtElapsed(119_999)).toBeCloseTo(1, 4);
    expect(iceProgressAtElapsed(120_000)).toBe(1);
    expect(iceProgressAtElapsed(135_000)).toBe(0.5);
    expect(iceProgressAtElapsed(149_999)).toBeCloseTo(0, 4);
    expect(iceProgressAtElapsed(150_000)).toBe(0);
    expect(iceProgressAtElapsed(150_001)).toBe(0);

    expect(isIceNightWindowActive('frostline', 300_000)).toBe(false);
    expect(isIceNightWindowActive('frostline', 240_000)).toBe(true);
    expect(isIceNightWindowActive('frostline', 150_000)).toBe(true);
    expect(isIceNightWindowActive('frostline', 120_000)).toBe(false);
    expect(nightVisibilityProgress('ice', 0.5, false)).toBe(0);
    expect(nightVisibilityProgress('ice', 0.5, true)).toBeCloseTo(0.5, 2);
    expect(nightVisibilityProgress('water', 1, true)).toBe(0);
    expect(nightVisibilityProgress(undefined, 1, true)).toBe(0);
  });

  it('darkens surface distance fog without changing underwater visibility', () => {
    const day = matchEnvironmentFor('frostline', false, 0);
    const night = matchEnvironmentFor('frostline', false, 1);
    expect(night.background).not.toBe(day.background);
    expect(night.fogFar).toBeLessThan(day.fogFar);
    expect(matchEnvironmentFor('island', true, 1)).toEqual(waterEnvironmentFor('island', true));
  });

  it('renders a simple winner-only result and removes KDA-style stats', () => {
    const html = renderToStaticMarkup(
      createElement(ResultsScreen, {
        result: { winner: 'ice', reason: 'all-frozen', gameMode: 'tdm' },
        onLeave: () => {},
      }),
    );
    expect(html).toContain('ICE WINS');
    expect(html).not.toContain('KDA');
    expect(html).not.toContain('kills');
    expect(html).not.toContain('deaths');
  });
});
