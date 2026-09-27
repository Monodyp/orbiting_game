import { afterEach, expect, it, vi } from 'vitest';
import { GameInput, cameraRelative, touchAxes } from './game-input.js';

afterEach(() => vi.unstubAllGlobals());

function fakeWindow(): Window {
  const target = new EventTarget() as EventTarget & { document: Document };
  target.document = new EventTarget() as Document;
  return target as unknown as Window;
}

function dispatchKey(target: Window, type: 'keydown' | 'keyup', code: string): void {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    code: { value: code },
    repeat: { value: false },
  });
  target.dispatchEvent(event);
}

it('normalizes keyboard/touch axes and maps movement to camera forward', () => {
  expect(Math.hypot(...Object.values(cameraRelative({ x: 1, z: 1 }, 0)))).toBeCloseTo(1);
  expect(cameraRelative({ x: 0, z: -1 }, Math.PI / 2).x).toBeCloseTo(-1);
  expect(touchAxes(1, 1, 45)).toEqual({ x: 0, z: 0 });
  expect(touchAxes(90, 0, 45)).toEqual({ x: 1, z: 0 });
});
it('clamps mouse look and clears one-shot and held input on reset', () => {
  const input = new GameInput();
  input.look(100000, 100000);
  expect(Math.abs(input.cameraPitch)).toBeLessThan(Math.PI / 2);
  input.pressJump();
  input.pressSlide();
  input.pressInteract();
  input.pressLunge();
  input.pressInteract();
  expect(input.sample()).toMatchObject({ jump: true, slide: true, hasInteraction: true, hasLunge: true });
  expect(input.sample()).toMatchObject({ jump: false, slide: false, hasInteraction: false, hasLunge: false });
  input.reset();
  expect(input.sample().hasInteraction).toBe(false);
});

it('uses browser-standard desktop bindings for sprint, slide, and crouch', () => {
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  const target = fakeWindow();
  const input = new GameInput();
  input.isEnabled = true;
  const unbind = input.bind(target);

  dispatchKey(target, 'keydown', 'ShiftLeft');
  expect(input.sample()).toMatchObject({ slide: false, crouch: false, sprint: true });
  dispatchKey(target, 'keyup', 'ShiftLeft');

  dispatchKey(target, 'keydown', 'KeyC');
  expect(input.sample()).toMatchObject({ slide: true, crouch: false, sprint: false });
  expect(input.sample().slide).toBe(false);
  dispatchKey(target, 'keyup', 'KeyC');

  dispatchKey(target, 'keydown', 'ControlLeft');
  expect(input.sample()).toMatchObject({ slide: false, crouch: true, sprint: false });
  dispatchKey(target, 'keyup', 'ControlLeft');

  dispatchKey(target, 'keydown', 'KeyQ');
  expect(input.sample().hasLunge).toBe(false);
  dispatchKey(target, 'keyup', 'KeyQ');

  dispatchPointer(target, 0);
  expect(input.sample().hasLunge).toBe(false);
  dispatchPointer(target, 2);
  expect(input.sample().hasLunge).toBe(true);

  unbind();
});

it('maps dedicated touch inputs to movement and every required gameplay action', () => {
  const input = new GameInput();
  input.touch = { x: 0.6, z: -0.8 };
  input.isTouchSprinting = true;
  input.pressSlide();
  input.pressLunge();
  input.pressInteract();
  input.pressJump();

  expect(input.sample()).toMatchObject({
    x: 0.6,
    z: -0.8,
    sprint: true,
    slide: true,
    hasLunge: true,
    hasInteraction: true,
    jump: true,
  });
});

function dispatchPointer(target: Window, button: number): void {
  const event = new Event('pointerdown', { cancelable: true });
  Object.defineProperties(event, {
    button: { value: button },
    pointerType: { value: 'mouse' },
  });
  target.dispatchEvent(event);
}
