import { describe, expect, it } from 'vitest';
import { CueCooldowns, landingIntensity, stormAudioMix } from './audio-manager.js';

describe('action audio helpers', () => {
  it('scales landing intensity with downward speed and caps hard falls', () => {
    expect(landingIntensity(2)).toBeCloseTo(0.52);
    expect(landingIntensity(-4)).toBeGreaterThan(landingIntensity(-1));
    expect(landingIntensity(-100)).toBe(1);
  });

  it('throttles duplicate cues without suppressing a different action', () => {
    const cooldowns = new CueCooldowns();

    expect(cooldowns.allow('lunge', 1_000)).toBe(true);
    expect(cooldowns.allow('lunge', 1_001)).toBe(false);
    expect(cooldowns.allow('jump', 1_001)).toBe(true);
    expect(cooldowns.allow('lunge', 1_160)).toBe(true);
  });

  it('keeps confirmed tag and untag cues independently noticeable', () => {
    const cooldowns = new CueCooldowns();

    expect(cooldowns.allow('tag', 2_000)).toBe(true);
    expect(cooldowns.allow('tag', 2_020)).toBe(false);
    expect(cooldowns.allow('untag', 2_020)).toBe(true);
  });

  it('layers storm audio progressively and emphasizes gusts without clipping', () => {
    expect(stormAudioMix(0, 1)).toEqual({ wind: 0, rumble: 0, gust: 0, snow: 0 });
    const steady = stormAudioMix(0.45, 0);
    const whiteout = stormAudioMix(1, 1);
    expect(whiteout.wind).toBeGreaterThan(steady.wind);
    expect(whiteout.rumble).toBeGreaterThan(steady.rumble);
    expect(whiteout.gust).toBeGreaterThan(0);
    expect(Math.max(...Object.values(whiteout))).toBeLessThan(0.5);
  });
});
