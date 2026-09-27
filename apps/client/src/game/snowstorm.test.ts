import { describe, expect, it } from 'vitest';
import { Mesh, Points, Scene, Vector3 } from 'three';
import {
  STORM_MAX_MS,
  STORM_MID_MS,
  Snowstorm,
  snowAccumulation,
  snowEmissionRate,
  snowParticleFallElapsedSeconds,
  snowstormIntensity,
} from './snowstorm.js';

describe('Snowstorm mechanic (Frostline only)', () => {
  describe('Map restriction', () => {
    it('is only active on frostline and remains inactive on island and original', () => {
      // Intensity & accumulation
      expect(snowstormIntensity(STORM_MID_MS, 'frostline')).toBeGreaterThan(0);
      expect(snowstormIntensity(STORM_MID_MS, 'island')).toBe(0);
      expect(snowstormIntensity(STORM_MID_MS, 'original')).toBe(0);

      expect(snowAccumulation(STORM_MID_MS, 'frostline')).toBeGreaterThan(0);
      expect(snowAccumulation(STORM_MID_MS, 'island')).toBe(0);
      expect(snowAccumulation(STORM_MID_MS, 'original')).toBe(0);
    });
  });

  describe('Snowfall intensity and emission progression', () => {
    it('starts minimal at the 1:00 gameplay mark and ramps through the storm window', () => {
      expect(snowstormIntensity(300_000, 'frostline')).toBe(0);
      expect(snowstormIntensity(240_000, 'frostline')).toBeCloseTo(0.2, 2);
      expect(snowstormIntensity(180_000, 'frostline')).toBeCloseTo(0.47, 2);
      expect(snowstormIntensity(120_000, 'frostline')).toBeCloseTo(0.73, 2);
    });

    it('reaches full snowfall by the 1:00 remaining threshold without a sudden jump', () => {
      expect(snowstormIntensity(120_000, 'frostline')).toBeCloseTo(0.73, 2);
      expect(snowstormIntensity(STORM_MAX_MS, 'frostline')).toBe(1.0);
      expect(snowstormIntensity(STORM_MAX_MS - 15_000, 'frostline')).toBe(1.0);
    });

    it('stops emission exactly at 4:00 elapsed while in-flight flakes keep aging', () => {
      expect(snowEmissionRate(STORM_MAX_MS + 1, 'frostline')).toBeGreaterThan(0);
      expect(snowEmissionRate(STORM_MAX_MS, 'frostline')).toBe(0);
      expect(snowEmissionRate(STORM_MAX_MS - 1, 'frostline')).toBe(0);
      expect(snowEmissionRate(STORM_MAX_MS, 'frostline', false)).toBe(0);
      expect(snowEmissionRate(STORM_MAX_MS, 'island')).toBe(0);

      expect(snowParticleFallElapsedSeconds(STORM_MAX_MS)).toBe(0);
      expect(snowParticleFallElapsedSeconds(STORM_MAX_MS - 15_000)).toBe(15);
    });
  });

  describe('Ground snow accumulation progression', () => {
    it('matches the same visible snow ramp and fade-out curve', () => {
      expect(snowAccumulation(300_000, 'frostline')).toBe(0);
      expect(snowAccumulation(240_000, 'frostline')).toBeCloseTo(0.2, 2);
      expect(snowAccumulation(180_000, 'frostline')).toBeCloseTo(0.47, 2);
      expect(snowAccumulation(120_000, 'frostline')).toBeCloseTo(0.73, 2);
      expect(snowAccumulation(STORM_MAX_MS, 'frostline')).toBe(1.0);
      expect(snowAccumulation(STORM_MAX_MS - 15_000, 'frostline')).toBe(1.0);
    });
  });

  describe('Snowstorm Three.js lifecycle', () => {
    it('creates GPU points and ground mesh on the scene and disposes cleanly', () => {
      const scene = new Scene();
      const storm = new Snowstorm(scene, 'frostline', 'low');

      expect(scene.children).toContain(storm.group);
      expect(storm.group.name).toBe('SNOWSTORM');
      expect(storm.group.visible).toBe(false);
      const ground = storm.group.children.find((child) => child.name === 'snowstorm-ground');
      expect(ground).toBeInstanceOf(Mesh);
      if (ground instanceof Mesh)
        expect((ground.material as import('three').ShaderMaterial).vertexShader).toContain(
          'vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);',
        );

      const cameraPos = new Vector3(0, 1.7, 0);

      // Before the 1:00 gameplay mark, the storm should be inactive.
      storm.update(10, 300_000, cameraPos);
      expect(storm.group.visible).toBe(false);

      // At 1:00 elapsed, minimal snow should become visible.
      storm.update(60, 240_000, cameraPos);
      expect(storm.group.visible).toBe(true);

      // During the ramp toward the 3:00 mark, visible and growing.
      storm.update(120, 180_000, cameraPos);
      expect(storm.group.visible).toBe(true);

      storm.update(240, STORM_MAX_MS + 1, cameraPos, true);
      expect(storm.emissionRate).toBeGreaterThan(0);
      storm.update(240, STORM_MAX_MS, cameraPos, true);
      expect(storm.emissionRate).toBe(0);
      expect(storm.group.visible).toBe(true);
      const particles = storm.group.children.find((child) => child.name === 'snowstorm-particles');
      expect(particles).toBeInstanceOf(Points);
      if (particles instanceof Points) {
        expect(particles.geometry.drawRange.count).toBeGreaterThan(0);
      }
      storm.update(255, STORM_MAX_MS - 15_000, cameraPos, true);
      expect(storm.emissionRate).toBe(0);
      expect(storm.group.visible).toBe(true);

      // Disposes cleanly without errors
      storm.destroy();
      expect(scene.children).not.toContain(storm.group);
    });

    it('remains invisible and inactive when configured for non-frostline map', () => {
      const scene = new Scene();
      const storm = new Snowstorm(scene, 'island', 'low');
      const cameraPos = new Vector3(0, 1.7, 0);

      storm.update(15, STORM_MID_MS, cameraPos);
      expect(storm.group.visible).toBe(false);
      storm.destroy();
    });
  });
});
