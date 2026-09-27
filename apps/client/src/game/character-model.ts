import characterModelUrl from '../../../../assets/character/test_char_model.glb?url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

// Supplied GLBs face +Z, matching the scene's model-space forward direction.
const MODEL_FACING_OFFSET = 0;
const CHARACTER_MODEL_SCALE = 0.3;
const FROZEN_ICE_OVERLAY_SCALE = 0.15;
export type CharacterAnimation =
  | 'Idle'
  | 'Run'
  | 'Jump'
  | 'FallIdle'
  | 'Frozen'
  | 'Wave'
  | 'Lunge';

const CLIPS: Record<CharacterAnimation, { aliases: string[]; speed: number; loop: boolean }> = {
  Idle: { aliases: ['idle', 'breathing'], speed: 1, loop: true },
  Run: { aliases: ['run', 'running', 'walk'], speed: 1.15, loop: true },
  Jump: { aliases: ['jump', 'jumping'], speed: 1, loop: false },
  FallIdle: { aliases: ['fallidle', 'falling', 'fall'], speed: 1, loop: true },
  Frozen: { aliases: ['freeze', 'frozen'], speed: 1, loop: false },
  Wave: { aliases: ['wave', 'waving'], speed: 0.9, loop: true },
  Lunge: { aliases: ['lunge001', 'lunge', 'pounce'], speed: 1, loop: false },
};

export interface CharacterInstance {
  root: THREE.Object3D;
  material: THREE.MeshStandardMaterial;
  play(animation: CharacterAnimation, blendTime?: number): void;
  update(deltaSeconds: number): void;
}

export class CharacterModelFactory {
  constructor(
    private readonly source: THREE.Object3D,
    private readonly animations: readonly THREE.AnimationClip[],
  ) {}

  instantiate(color: string, initialAnimation: CharacterAnimation): CharacterInstance {
    const root = cloneSkeleton(this.source);
    root.name = 'character-model';
    root.scale.setScalar(CHARACTER_MODEL_SCALE);
    root.rotation.y = MODEL_FACING_OFFSET;
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.58, metalness: 0 });
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.material = material;
      object.castShadow = true;
      object.receiveShadow = true;
    });

    const mixer = new THREE.AnimationMixer(root);
    const actions = new Map<CharacterAnimation, THREE.AnimationAction>();
    for (const [name, definition] of Object.entries(CLIPS) as [
      CharacterAnimation,
      (typeof CLIPS)[CharacterAnimation],
    ][]) {
      let clip = this.findClip(definition.aliases);
      if (!clip && name === 'Lunge')
        clip = this.animations.find((candidate) => {
          const normalized = candidate.name.toLowerCase().replace(/[^a-z0-9]/g, '');
          return normalized.includes('run') || normalized.includes('running');
        });
      if (!clip) continue;
      const action = mixer.clipAction(clip);
      action.timeScale = definition.speed;
      action.setLoop(
        definition.loop ? THREE.LoopRepeat : THREE.LoopOnce,
        definition.loop ? Infinity : 1,
      );
      action.clampWhenFinished = !definition.loop;
      actions.set(name, action);
    }

    const idleAction = actions.get('Idle');
    if (idleAction) idleAction.play();

    let currentAnimation = initialAnimation;
    actions.get(initialAnimation)?.reset().play();
    return {
      root,
      material,
      play(animation, blendTime = 0.12) {
        if (animation === currentAnimation) return;
        const previous = actions.get(currentAnimation);
        const previousDefinition = CLIPS[currentAnimation];
        const next = actions.get(animation);
        currentAnimation = animation;
        if (!next) {
          if (animation !== 'Idle') {
            if (previous && !previousDefinition.loop) previous.stop();
            else previous?.fadeOut(blendTime);
            actions.get('Idle')?.reset().fadeIn(blendTime).play();
          }
          return;
        }
        next.reset().fadeIn(blendTime).play();
        // LoopOnce actions clamp on their final pose. Stop them outright so a
        // completed lunge/freeze cannot keep contributing bone transforms.
        if (previous && !previousDefinition.loop) previous.stop();
        else previous?.fadeOut(blendTime);
      },
      update(deltaSeconds) {
        mixer.update(deltaSeconds);
      },
    };
  }

  private findClip(aliases: string[]): THREE.AnimationClip | undefined {
    return findCharacterClip(this.animations, aliases);
  }
}

export function findCharacterClip(
  animations: readonly THREE.AnimationClip[],
  aliases: readonly string[],
): THREE.AnimationClip | undefined {
  const normalizedAliases = aliases.map((alias) => alias.replace(/[^a-z0-9]/gi, '').toLowerCase());
  const normalized = (clip: THREE.AnimationClip) =>
    clip.name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const terminalName = (clip: THREE.AnimationClip) =>
    clip.name.split('|').at(-1)?.replace(/[^a-z0-9]/gi, '').toLowerCase() ?? '';

  for (const alias of normalizedAliases) {
    const exactMatch = animations.find((clip) => normalized(clip) === alias);
    if (exactMatch) return exactMatch;
  }
  for (const alias of normalizedAliases) {
    const terminalMatch = animations.find((clip) => terminalName(clip) === alias);
    if (terminalMatch) return terminalMatch;
  }
  return undefined;
}

export async function loadCharacterModel(): Promise<CharacterModelFactory> {
  const gltf = await new GLTFLoader().loadAsync(characterModelUrl);
  return new CharacterModelFactory(gltf.scene, gltf.animations);
}

export type GameplayCharacterFactories = {
  ice?: CharacterModelFactory;
  water?: CharacterModelFactory;
  frozenIce?: FrozenIceFactory;
};

async function loadOptional(url: string): Promise<ReturnType<typeof GLTFLoader.prototype.loadAsync> | undefined> {
  try {
    return await new GLTFLoader().loadAsync(url);
  } catch {
    return undefined;
  }
}

export async function loadGameplayCharacterFactories(): Promise<GameplayCharacterFactories> {
  const [ice, water, frozen] = await Promise.all([
    loadOptional('/ice_model.glb'),
    loadOptional('/water_model.glb'),
    loadOptional('/frozen_ice.glb'),
  ]);
  // Water shares the Ice skeleton but has no authored lunge clip. Reuse the
  // latest Ice lunge so every player has the same action presentation.
  const lunge = ice ? findCharacterClip(ice.animations, ['lunge001']) : undefined;
  const waterAnimations = water && lunge ? [...water.animations, lunge] : water?.animations;
  return {
    ice: ice ? new CharacterModelFactory(ice.scene, ice.animations) : undefined,
    water: water ? new CharacterModelFactory(water.scene, waterAnimations ?? water.animations) : undefined,
    frozenIce: frozen ? new FrozenIceFactory(frozen.scene, frozen.animations) : undefined,
  };
}

export type LobbyCharacterFactories = {
  ice?: CharacterModelFactory;
  water?: CharacterModelFactory;
};

/** Loads the two supplied team actors used by the lobby presentation. */
export async function loadLobbyCharacterFactories(): Promise<LobbyCharacterFactories> {
  const [ice, water] = await Promise.all([
    loadOptional('/ice_model.glb'),
    loadOptional('/water_model.glb'),
  ]);
  return {
    ice: ice ? new CharacterModelFactory(ice.scene, ice.animations) : undefined,
    water: water ? new CharacterModelFactory(water.scene, water.animations) : undefined,
  };
}

export interface FrozenIceInstance {
  root: THREE.Object3D;
  isActive: boolean;
  playFreeze(): void;
  playUnfreeze(): void;
  update(deltaSeconds: number): void;
}

export class FrozenIceFactory {
  constructor(
    private readonly source: THREE.Object3D,
    private readonly animations: readonly THREE.AnimationClip[],
  ) {}

  instantiate(): FrozenIceInstance {
    const root = cloneSkeleton(this.source);
    root.name = 'frozen-ice-overlay';
    root.scale.setScalar(FROZEN_ICE_OVERLAY_SCALE);
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    const mixer = new THREE.AnimationMixer(root);
    const grow = this.findClip(['grow', 'freeze', 'appear']) ?? this.animations[0];
    const shrink = this.findClip(['shrink', 'unfreeze', 'disappear']) ?? grow;
    const growAction = grow ? mixer.clipAction(grow) : undefined;
    const shrinkAction = shrink ? mixer.clipAction(shrink) : undefined;
    let active = false;
    let isUnfreezing = false;
    let currentAction: THREE.AnimationAction | undefined;
    const play = (action: THREE.AnimationAction | undefined, reverse = false) => {
      if (!action) return;
      currentAction?.stop();
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.timeScale = reverse ? -1 : 1;
      if (reverse) action.time = action.getClip().duration;
      action.play();
      currentAction = action;
      active = true;
    };
    root.visible = false;
    return {
      root,
      get isActive() {
        return active;
      },
      playFreeze() {
        root.visible = true;
        isUnfreezing = false;
        play(growAction);
      },
      playUnfreeze() {
        root.visible = true;
        isUnfreezing = true;
        play(shrinkAction, shrink === grow);
      },
      update(deltaSeconds) {
        if (!active) return;
        mixer.update(deltaSeconds);
        if (currentAction && !currentAction.isRunning()) {
          active = false;
          if (isUnfreezing) root.visible = false;
        }
      },
    };
  }

  private findClip(aliases: string[]): THREE.AnimationClip | undefined {
    return this.animations.find((candidate) => {
      const normalized = candidate.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      return aliases.some((alias) => normalized.includes(alias));
    });
  }
}
