import { describe, expect, it, vi } from 'vitest';
import { DirectionalLight, InstancedMesh, Matrix4, Scene, Vector3 } from 'three';
import { CloudSky, cloudLightingFactor } from './cloud-sky.js';

describe('CloudSky', () => {
  it('uses a small instanced budget and scales it down with quality', () => {
    const scene = new Scene();
    const sky = new CloudSky(scene, 'frostline');
    try {
      const batches = sky.group.children as InstancedMesh[];
      expect(batches).toHaveLength(3);
      expect(batches.every((batch) => batch instanceof InstancedMesh)).toBe(true);
      expect(batches.reduce((sum, batch) => sum + batch.count, 0)).toBe(15);
      expect(batches.every((batch) => !batch.castShadow && !batch.receiveShadow)).toBe(true);

      sky.update(10, new Vector3(), 'medium');
      expect(batches.reduce((sum, batch) => sum + batch.count, 0)).toBe(12);
      sky.update(20, new Vector3(), 'low');
      expect(batches.reduce((sum, batch) => sum + batch.count, 0)).toBe(6);
    } finally {
      sky.destroy();
    }
  });

  it('moves slowly, follows the playable area and hides underwater', () => {
    const sky = new CloudSky(new Scene(), 'island');
    try {
      const batch = sky.group.children[0] as InstancedMesh;
      const before = new Matrix4();
      const after = new Matrix4();
      batch.getMatrixAt(0, before);
      sky.update(30, new Vector3(75, 2, -40), 'high');
      batch.getMatrixAt(0, after);
      expect(after.equals(before)).toBe(false);
      const position = new Vector3().setFromMatrixPosition(after);
      expect(Math.abs(position.x - 75)).toBeLessThanOrEqual(175);
      expect(Math.abs(position.z + 40)).toBeLessThanOrEqual(175);

      sky.setUnderwater(true);
      expect(sky.group.visible).toBe(false);
      sky.setUnderwater(false);
      expect(sky.group.visible).toBe(true);
    } finally {
      sky.destroy();
    }
  });

  it('only makes subtle lighting changes and restores light intensity on teardown', () => {
    const light = new DirectionalLight(0xffffff, 2);
    const sky = new CloudSky(new Scene(), 'frostline', [light]);
    const batch = sky.group.children[0] as InstancedMesh;
    const geometryDispose = vi.spyOn(batch.geometry, 'dispose');
    const material = batch.material as import('three').MeshBasicMaterial;
    const materialDispose = vi.spyOn(material, 'dispose');
    const textureDispose = vi.spyOn(material.map!, 'dispose');

    sky.update(80, new Vector3(12, 2, -9), 'high');
    expect(light.intensity).toBeLessThanOrEqual(2);
    expect(light.intensity).toBeGreaterThanOrEqual(1.92);
    expect(cloudLightingFactor(80, 12, -9, 0.04, true)).toBeGreaterThanOrEqual(0.96);
    expect(cloudLightingFactor(80, 12, -9, 0.04, true)).toBeLessThanOrEqual(1);

    sky.destroy();
    expect(light.intensity).toBe(2);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
  });

  it('blends day clouds and their source light into the two-minute night state', () => {
    const light = new DirectionalLight(0xffffff, 2);
    const sky = new CloudSky(new Scene(), 'frostline', [light]);
    try {
      const batch = sky.group.children[0] as InstancedMesh;
      const material = batch.material as import('three').MeshBasicMaterial;
      const dayColor = material.color.getHex();
      const dayOpacity = material.opacity;

      sky.update(0, new Vector3(), 'low', 1);

      expect(material.color.getHex()).not.toBe(dayColor);
      expect(material.opacity).toBeLessThan(dayOpacity);
      expect(light.intensity).toBeLessThan(1);
    } finally {
      sky.destroy();
    }
  });

  it('darkens, densifies and accelerates Frostline clouds as the blizzard rises', () => {
    const sky = new CloudSky(new Scene(), 'frostline');
    try {
      const batch = sky.group.children[0] as InstancedMesh;
      const material = batch.material as import('three').MeshBasicMaterial;
      sky.update(10, new Vector3(), 'high', 0, 0, 0);
      const calmColor = material.color.getHex();
      const calmOpacity = material.opacity;
      const calmMatrix = new Matrix4();
      batch.getMatrixAt(0, calmMatrix);

      sky.update(10, new Vector3(), 'high', 0, 1, 1);
      const stormMatrix = new Matrix4();
      batch.getMatrixAt(0, stormMatrix);
      expect(material.color.getHex()).not.toBe(calmColor);
      expect(material.opacity).toBeGreaterThan(calmOpacity);
      expect(stormMatrix.equals(calmMatrix)).toBe(false);
    } finally {
      sky.destroy();
    }
  });
});
