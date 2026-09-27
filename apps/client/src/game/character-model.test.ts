import { AnimationClip, Group, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';
import {
  CharacterModelFactory,
  findCharacterClip,
  FrozenIceFactory,
} from './character-model.js';
import { GAMEPLAY_TEAM_COLORS, gameplayTeamColor } from './team-colors.js';

it('uses white for Ice while retaining the existing Water color', () => {
  expect(GAMEPLAY_TEAM_COLORS).toEqual({
    ice: { hex: 0xffffff, css: '#FFFFFF' },
    water: { hex: 0x43c6d6, css: '#43c6d6' },
  });
  expect(gameplayTeamColor('ice')).toBe('#FFFFFF');
  expect(gameplayTeamColor('water')).toBe('#43c6d6');
});

describe('findCharacterClip', () => {
  it('selects the default idle clip instead of FallingIdle', () => {
    const fallingIdle = new AnimationClip('Armature|FallingIdle');
    const idle = new AnimationClip('Armature|Idle');

    expect(findCharacterClip([fallingIdle, idle], ['idle'])).toBe(idle);
  });

  it('selects the character freeze clip', () => {
    const freeze = new AnimationClip('Armature|freeze');

    expect(findCharacterClip([freeze], ['freeze', 'frozen'])).toBe(freeze);
  });

  it('prioritizes the latest authored lunge variation', () => {
    const original = new AnimationClip('Armature|Lunge');
    const latest = new AnimationClip('Armature|Lunge.001');

    expect(findCharacterClip([original, latest], ['lunge001', 'lunge'])).toBe(latest);
  });

  it('selects the supplied Lunge.001 clip when a model has no native lunge', () => {
    const run = new AnimationClip('Armature|Run');
    const iceLunge = new AnimationClip('Armature|Lunge.001');

    expect(findCharacterClip([run, iceLunge], ['lunge001', 'lunge'])).toBe(iceLunge);
  });

  it('clears a completed lunge pose when returning to idle', () => {
    const source = new Group();
    const bone = new Group();
    bone.name = 'Bone';
    source.add(bone);
    const idle = new AnimationClip('Armature|Idle', 0.1, [
      new VectorKeyframeTrack('Bone.position', [0, 0.1], [0, 0, 0, 0, 0, 0]),
    ]);
    const lunge = new AnimationClip('Armature|Lunge.001', 0.1, [
      new VectorKeyframeTrack('Bone.position', [0, 0.1], [0, 0, 0, 2, 0, 0]),
    ]);
    const instance = new CharacterModelFactory(source, [idle, lunge]).instantiate('#ffffff', 'Idle');

    instance.play('Lunge');
    instance.update(0.2);
    instance.play('Idle');
    instance.update(0.2);
    const posedBone = instance.root.getObjectByName('Bone');
    expect(posedBone?.position.x).toBeCloseTo(0);
  });

  it('aligns supplied models with the gameplay forward direction', () => {
    const instance = new CharacterModelFactory(new Group(), []).instantiate('#ffffff', 'Idle');

    expect(instance.root.rotation.y).toBe(0);
    expect(instance.root.scale.x).toBe(0.3);
  });

  it('keeps the ice overlay visible after freezing until unfreezing completes', () => {
    const freeze = new AnimationClip('freeze', 0.1, [
      new VectorKeyframeTrack('.scale', [0, 0.1], [0, 0, 0, 1, 1, 1]),
    ]);
    const instance = new FrozenIceFactory(new Group(), [freeze]).instantiate();

    expect(instance.root.scale.x).toBe(0.15);
    instance.playFreeze();
    instance.update(0.2);
    expect(instance.root.visible).toBe(true);

    instance.playUnfreeze();
    instance.update(0.2);
    expect(instance.root.visible).toBe(false);
  });
});
