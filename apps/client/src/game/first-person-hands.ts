import { GAMEPLAY } from '@ice-water/shared';
import { GAMEPLAY_TEAM_COLORS } from './team-colors.js';
import {
  BoxGeometry,
  Euler,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from 'three';

export type FirstPersonHandState = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'slide';

export interface FirstPersonHandMotion {
  velocityX: number;
  velocityZ: number;
  verticalVelocity: number;
  isGrounded: boolean;
  isSliding: boolean;
  isCrouching: boolean;
  isWallRunning: boolean;
}

export interface FirstPersonHandAnimation {
  state: FirstPersonHandState;
  speed: number;
  speedRatio: number;
  cycleRate: number;
  amplitude: number;
}

const WALK_THRESHOLD = 0.35;
const RUN_THRESHOLD = GAMEPLAY.moveSpeed * 1.05;
const HAND_RENDER_ORDER = 10_000;
const LEFT = -1;
const RIGHT = 1;
const INTERACTION_DURATION_SECONDS = 0.24;

interface ArmRig {
  pivot: Group;
  restPosition: Vector3;
}

interface ArmTarget {
  position: Vector3;
  rotation: Euler;
}

export function firstPersonHandAnimation(motion: FirstPersonHandMotion): FirstPersonHandAnimation {
  const speed = Math.hypot(motion.velocityX, motion.velocityZ);
  const speedRatio = MathUtils.clamp(speed / GAMEPLAY.moveSpeed, 0, 1.5);
  let state: FirstPersonHandState;
  if (motion.isSliding) state = 'slide';
  else if (!motion.isGrounded && !motion.isWallRunning)
    state = motion.verticalVelocity >= 0 ? 'jump' : 'fall';
  else if (speed >= RUN_THRESHOLD || motion.isWallRunning) state = 'run';
  else if (speed >= WALK_THRESHOLD) state = 'walk';
  else state = 'idle';

  const movementRatio = MathUtils.clamp(speed / RUN_THRESHOLD, 0, 1);
  return {
    state,
    speed,
    speedRatio,
    cycleRate: MathUtils.lerp(5.5, 11.5, movementRatio),
    amplitude: MathUtils.smoothstep(speed, WALK_THRESHOLD, RUN_THRESHOLD),
  };
}

/**
 * A deliberately weapon-free camera-space rig. It uses small procedural parts
 * so the local player gets readable arms on every map without loading an asset.
 */
export class FirstPersonHands {
  private readonly root = new Group();
  private readonly arms: readonly [ArmRig, ArmRig];
  private readonly sleeveMaterial = this.material(GAMEPLAY_TEAM_COLORS.ice.hex);
  private readonly cuffMaterial = this.material(0x17374a);
  private readonly handMaterial = this.material(GAMEPLAY_TEAM_COLORS.ice.hex);
  private readonly geometries = [
    new BoxGeometry(0.15, 0.34, 0.15),
    new BoxGeometry(0.17, 0.065, 0.17),
    new BoxGeometry(0.155, 0.135, 0.17),
  ] as const;
  private readonly targetObject = new Object3D();
  private readonly targetQuaternion = new Quaternion();
  private gaitPhase = 0;
  private breathingPhase = 0;
  private interactionRemaining = 0;
  private team: 'ice' | 'water' = 'ice';

  constructor(camera: PerspectiveCamera) {
    this.root.name = 'first-person-hands';
    this.root.position.set(0, -0.015, -0.02);
    this.root.frustumCulled = false;
    const left = this.createArm(LEFT);
    const right = this.createArm(RIGHT);
    this.arms = [left, right];
    this.root.add(left.pivot, right.pivot);
    camera.add(this.root);
  }

  setVisible(isVisible: boolean): void {
    this.root.visible = isVisible;
  }

  setTeam(team: string): void {
    const nextTeam = team === 'water' ? 'water' : 'ice';
    if (this.team === nextTeam) return;
    this.team = nextTeam;
    this.sleeveMaterial.color.setHex(
      nextTeam === 'water' ? 0x245e88 : GAMEPLAY_TEAM_COLORS.ice.hex,
    );
    this.handMaterial.color.setHex(
      nextTeam === 'water' ? 0x74d9ec : GAMEPLAY_TEAM_COLORS.ice.hex,
    );
  }

  /**
   * Local-only feedback for an authoritative tag or rescue attempt. The
   * short window also keeps a held/repeated click from restarting the pose.
   */
  playInteraction(): boolean {
    if (this.interactionRemaining > 0) return false;
    this.interactionRemaining = INTERACTION_DURATION_SECONDS;
    return true;
  }

  update(
    motion: FirstPersonHandMotion,
    seconds: number,
    reducedEffects = false,
  ): FirstPersonHandState {
    const animation = firstPersonHandAnimation(motion);
    const delta = MathUtils.clamp(seconds, 0, 0.05);
    this.interactionRemaining = Math.max(0, this.interactionRemaining - delta);
    const motionScale = reducedEffects ? 0.35 : 1;
    this.breathingPhase = (this.breathingPhase + delta * 2.25) % (Math.PI * 2);
    if (animation.state === 'walk' || animation.state === 'run')
      this.gaitPhase = (this.gaitPhase + delta * animation.cycleRate) % (Math.PI * 2);

    const blendRate = animation.state === 'slide' ? 14 : 10;
    const alpha = 1 - Math.exp(-blendRate * delta);
    for (const [index, arm] of this.arms.entries()) {
      const side = index === 0 ? LEFT : RIGHT;
      const target = this.targetFor(arm, side, animation, motion, motionScale);
      arm.pivot.position.lerp(target.position, alpha);
      this.targetObject.rotation.copy(target.rotation);
      this.targetQuaternion.copy(this.targetObject.quaternion);
      arm.pivot.quaternion.slerp(this.targetQuaternion, alpha);
    }
    return animation.state;
  }

  destroy(): void {
    this.root.removeFromParent();
    this.geometries.forEach((geometry) => geometry.dispose());
    this.sleeveMaterial.dispose();
    this.cuffMaterial.dispose();
    this.handMaterial.dispose();
  }

  private material(color: number): MeshStandardMaterial {
    return new MeshStandardMaterial({
      color,
      roughness: 0.72,
      metalness: 0,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
    });
  }

  private createArm(side: number): ArmRig {
    const pivot = new Group();
    pivot.name = side === LEFT ? 'first-person-left-arm' : 'first-person-right-arm';
    pivot.frustumCulled = false;
    const restPosition = new Vector3(side * 0.35, -0.315, -0.255);
    pivot.position.copy(restPosition);

    const forearm = new Mesh(this.geometries[0], this.sleeveMaterial);
    forearm.name = side === LEFT ? 'left-forearm' : 'right-forearm';
    forearm.position.set(-side * 0.018, 0.025, -0.155);
    forearm.rotation.x = Math.PI / 2.35;
    forearm.rotation.z = side * 0.08;
    this.preparePart(forearm, 0);

    const cuff = new Mesh(this.geometries[1], this.cuffMaterial);
    cuff.name = side === LEFT ? 'left-cuff' : 'right-cuff';
    cuff.position.set(-side * 0.035, 0.061, -0.3);
    cuff.rotation.x = Math.PI / 2.25;
    cuff.rotation.z = side * 0.08;
    this.preparePart(cuff, 1);

    const palm = new Mesh(this.geometries[2], this.handMaterial);
    palm.name = side === LEFT ? 'left-hand' : 'right-hand';
    palm.position.set(-side * 0.04, 0.076, -0.405);
    palm.rotation.z = -side * 0.04;
    this.preparePart(palm, 2);

    pivot.add(forearm, cuff, palm);
    return { pivot, restPosition };
  }

  private preparePart(mesh: Mesh, layer: number): void {
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = HAND_RENDER_ORDER + layer;
  }

  private targetFor(
    arm: ArmRig,
    side: number,
    animation: FirstPersonHandAnimation,
    motion: FirstPersonHandMotion,
    motionScale: number,
  ): ArmTarget {
    const position = arm.restPosition.clone();
    const rotation = new Euler(0, 0, 0, 'XYZ');
    const breath = Math.sin(this.breathingPhase) * 0.006 * motionScale;
    position.y += breath;
    rotation.x += breath * 0.75;

    if (animation.state === 'walk' || animation.state === 'run') {
      const stride = Math.sin(this.gaitPhase + (side === LEFT ? 0 : Math.PI));
      const step = Math.cos(this.gaitPhase * 2);
      const runBlend =
        animation.state === 'run' ? MathUtils.smoothstep(animation.speedRatio, 1, 1.3) : 0;
      const intensity =
        (animation.state === 'run' ? MathUtils.lerp(0.7, 1, runBlend) : 0.42) *
        animation.amplitude *
        motionScale;
      position.x += side * step * 0.008 * intensity;
      position.y += (Math.abs(stride) * 0.021 + step * 0.006) * intensity;
      position.z += stride * 0.042 * intensity;
      rotation.x += stride * 0.34 * intensity;
      rotation.y += -side * stride * 0.055 * intensity;
      rotation.z += side * (0.035 + step * 0.045) * intensity;
      if (animation.state === 'run') {
        position.y -= 0.018 * motionScale;
        position.x += side * 0.012 * motionScale;
      }
    } else if (animation.state === 'slide') {
      position.x -= side * 0.042;
      position.y += 0.085;
      position.z -= 0.105;
      rotation.set(-0.38, side * 0.12, -side * 0.17);
    } else if (animation.state === 'jump') {
      const lift = MathUtils.clamp(motion.verticalVelocity / GAMEPLAY.jumpSpeed, 0, 1);
      position.x += side * 0.018 * motionScale;
      position.y += (0.035 + lift * 0.025) * motionScale;
      position.z -= 0.026 * motionScale;
      rotation.set(-0.11 - lift * 0.09, side * 0.04, -side * 0.055);
    } else if (animation.state === 'fall') {
      const fall = MathUtils.clamp(-motion.verticalVelocity / GAMEPLAY.jumpSpeed, 0, 1);
      position.x += side * 0.025 * fall * motionScale;
      position.y -= 0.018 * fall * motionScale;
      position.z -= 0.018 * motionScale;
      rotation.set(0.08 + fall * 0.06, side * 0.05, -side * 0.07);
    }

    if (motion.isCrouching && animation.state !== 'slide') {
      position.y -= 0.018;
      position.x += side * 0.012;
    }
    if (side === RIGHT && this.interactionRemaining > 0) {
      const progress = 1 - this.interactionRemaining / INTERACTION_DURATION_SECONDS;
      // A quick reach with a smooth return so it layers over movement poses.
      const reach = Math.sin(progress * Math.PI);
      position.y += 0.05 * reach;
      position.z -= 0.24 * reach;
      rotation.x -= 0.78 * reach;
      rotation.y -= 0.08 * reach;
    }
    return { position, rotation };
  }
}
