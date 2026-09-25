import { ARENA_BLOCKS, ARENA_RAMPS } from '@ice-water/shared';
import { Mesh, MeshStandardMaterial, Scene } from 'three';
import { describe, expect, it } from 'vitest';
import { FrostlineMap } from './frostline-map.js';

describe('FrostlineMap storm accumulation', () => {
  it('reveals presentation-only snow caps gradually without replacing map geometry', () => {
    const scene = new Scene();
    const map = new FrostlineMap(scene);
    const baseChildCount = map.group.children.length;
    const caps = map.group.children.filter((child) => child.name.startsWith('snow-cap-')) as Mesh[];

    expect(caps).toHaveLength(ARENA_BLOCKS.length + ARENA_RAMPS.length);
    expect(caps.every((cap) => !cap.visible)).toBe(true);

    map.setSnowAccumulation(0.5);
    expect(map.group.children).toHaveLength(baseChildCount);
    expect(caps.every((cap) => cap.visible)).toBe(true);
    expect((caps[0]!.material as MeshStandardMaterial).opacity).toBeCloseTo(0.41);

    map.setSnowAccumulation(0);
    expect(caps.every((cap) => !cap.visible)).toBe(true);
    map.destroy();
    expect(scene.children).not.toContain(map.group);
  });
});
