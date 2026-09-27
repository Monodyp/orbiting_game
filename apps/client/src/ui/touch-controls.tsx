import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { GameInput } from '../input/game-input.js';
import { touchAxes } from '../input/game-input.js';
export function TouchControls({ input }: { input: GameInput }) {
  const move = useRef<{ id: number; x: number; y: number } | null>(null),
    look = useRef<{ id: number; x: number; y: number } | null>(null);
  const capture = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const endMove = () => {
    move.current = null;
    input.touch = { x: 0, z: 0 };
  };
  return (
    <div className="touch-controls">
      <div
        className="touch-look"
        aria-label="Drag to look"
        onPointerDown={(e) => {
          capture(e);
          look.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const p = look.current;
          if (!p || p.id !== e.pointerId) return;
          input.look(e.clientX - p.x, e.clientY - p.y);
          p.x = e.clientX;
          p.y = e.clientY;
        }}
        onPointerUp={() => (look.current = null)}
        onPointerCancel={() => (look.current = null)}
        onLostPointerCapture={() => (look.current = null)}
      />
      <div
        className="touch-stick"
        role="application"
        aria-label="Movement joystick"
        onPointerDown={(e) => {
          capture(e);
          move.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const p = move.current;
          if (p?.id === e.pointerId) input.touch = touchAxes(e.clientX - p.x, e.clientY - p.y, 45);
        }}
        onPointerUp={endMove}
        onPointerCancel={endMove}
        onLostPointerCapture={endMove}
      >
        <span>Move</span>
      </div>
      <div className="touch-actions">
        <button
          className="touch-interact"
          aria-label="Tag or rescue"
          onPointerDown={(e) => {
            capture(e);
            input.pressInteract();
          }}
          onPointerUp={() => undefined}
          onPointerCancel={() => undefined}
          onLostPointerCapture={() => undefined}
        >
          Tag / Rescue
        </button>
        <button
          onPointerDown={(e) => {
            capture(e);
            input.pressLunge();
          }}
        >
          Lunge
        </button>
        <button
          onPointerDown={(e) => {
            capture(e);
            input.pressJump();
          }}
        >
          Jump
        </button>
        <button
          onPointerDown={(e) => {
            capture(e);
            input.pressSlide();
          }}
        >
          Slide
        </button>
        <button
          onPointerDown={(e) => {
            capture(e);
            input.isScoreboard = !input.isScoreboard;
          }}
        >
          Scores
        </button>
        <button
          aria-pressed={input.isTouchCrouching}
          onPointerDown={(e) => {
            capture(e);
            input.isTouchCrouching = !input.isTouchCrouching;
          }}
        >
          Crouch / Dive
        </button>
        <button
          aria-pressed={input.isTouchSprinting}
          onPointerDown={(e) => {
            capture(e);
            input.isTouchSprinting = !input.isTouchSprinting;
          }}
        >
          Sprint
        </button>
      </div>
    </div>
  );
}
