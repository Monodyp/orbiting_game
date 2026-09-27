import type { Position } from '@ice-water/shared';
export function cameraRelative(axes: Position, yaw: number): Position {
  const length = Math.max(1, Math.hypot(axes.x, axes.z)),
    x = axes.x / length,
    z = axes.z / length;
  return { x: x * Math.cos(yaw) + z * Math.sin(yaw), z: z * Math.cos(yaw) - x * Math.sin(yaw) };
}
export function touchAxes(dx: number, dy: number, radius: number): Position {
  if (Math.hypot(dx, dy) < radius * 0.12) return { x: 0, z: 0 };
  const length = Math.max(radius, Math.hypot(dx, dy));
  return { x: dx / length, z: dy / length };
}
export class GameInput {
  cameraYaw = 0;
  cameraPitch = 0;
  sensitivity = 0.002;
  touch: Position = { x: 0, z: 0 };
  isScoreboard = false;
  isEnabled = false;
  isTouchCrouching = false;
  isTouchSprinting = false;
  private keys = new Set<string>();
  private hasJump = false;
  private hasSlide = false;
  private hasInteraction = false;
  private hasLunge = false;
  look(dx: number, dy: number): void {
    this.cameraYaw = Math.atan2(
      Math.sin(this.cameraYaw - dx * this.sensitivity),
      Math.cos(this.cameraYaw - dx * this.sensitivity),
    );
    this.cameraPitch = Math.max(
      (-Math.PI * 89) / 180,
      Math.min((Math.PI * 89) / 180, this.cameraPitch - dy * this.sensitivity),
    );
  }
  pressJump(): void {
    this.hasJump = true;
  }
  pressSlide(): void {
    this.hasSlide = true;
  }
  pressInteract(): void {
    this.hasInteraction = true;
  }
  pressLunge(): void {
    this.hasLunge = true;
  }
  sample() {
    const axes = cameraRelative(
      {
        x:
          Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) -
          Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft')) +
          this.touch.x,
        z:
          Number(this.keys.has('KeyS') || this.keys.has('ArrowDown')) -
          Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) +
          this.touch.z,
      },
      this.cameraYaw,
    );
    const result = {
      ...axes,
      yaw: this.cameraYaw,
      pitch: this.cameraPitch,
      jump: this.hasJump,
      slide: this.hasSlide,
      crouch:
        this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.isTouchCrouching,
      sprint:
        this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.isTouchSprinting,
      hasInteraction: this.hasInteraction,
      hasLunge: this.hasLunge,
    };
    this.hasJump = false;
    this.hasSlide = false;
    this.hasInteraction = false;
    this.hasLunge = false;
    return result;
  }
  reset(): void {
    this.keys.clear();
    this.touch = { x: 0, z: 0 };
    this.isScoreboard = false;
    this.isTouchCrouching = false;
    this.isTouchSprinting = false;
    this.hasJump = false;
    this.hasSlide = false;
    this.hasInteraction = false;
    this.hasLunge = false;
  }
  bind(target: Window): () => void {
    const down = (event: KeyboardEvent) => {
      if (
        !this.isEnabled ||
        (event.target instanceof HTMLElement &&
          (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(event.target.tagName) ||
            event.target.isContentEditable))
      )
        return;
      const codes = [
        'KeyW',
        'KeyA',
        'KeyS',
        'KeyD',
        'ArrowUp',
        'ArrowLeft',
        'ArrowDown',
        'ArrowRight',
        'Space',
        'ShiftLeft',
        'ShiftRight',
        'ControlLeft',
        'ControlRight',
        'KeyC',
        'Tab',
      ];
      if (!codes.includes(event.code)) return;
      event.preventDefault();
      this.keys.add(event.code);
      if (event.code === 'Tab') this.isScoreboard = true;
      if (event.repeat) return;
      if (event.code === 'Space') this.pressJump();
      if (event.code === 'KeyC') this.pressSlide();
    };
    const pointerDown = (event: PointerEvent) => {
      if (!this.isEnabled || event.pointerType === 'touch' || event.button !== 2) return;
      this.pressLunge();
    };
    const up = (event: KeyboardEvent) => {
      this.keys.delete(event.code);
      if (event.code === 'Tab') this.isScoreboard = false;
    };
    const reset = () => this.reset();
    target.addEventListener('keydown', down);
    target.addEventListener('keyup', up);
    target.addEventListener('pointerdown', pointerDown);
    target.addEventListener('blur', reset);
    target.document.addEventListener('visibilitychange', reset);
    return () => {
      target.removeEventListener('keydown', down);
      target.removeEventListener('keyup', up);
      target.removeEventListener('pointerdown', pointerDown);
      target.removeEventListener('blur', reset);
      target.document.removeEventListener('visibilitychange', reset);
      this.reset();
    };
  }
}
