import type { LobbyView } from '@ice-water/shared';
import type { CSSProperties } from 'react';
import { isTwoMinuteWarningVisible } from '../game/match-night.js';
import {
  isSnowstormWarningVisible,
  isSnowstormBegunVisible,
  snowstormIntensity,
  stormGustStrength,
} from '../game/snowstorm.js';
export type KillEntry = never;

export function GameHud({
  view,
  localPlayerId,
  serverNow,
  crosshair,
}: {
  view: LobbyView;
  localPlayerId: string;
  serverNow: number;
  crosshair: string;
}) {
  const p = view.players.find((p) => p.playerId === localPlayerId);
  if (!p) return null;
  const remainingMs = view.phaseDeadline - serverNow;
  const time = Math.max(0, Math.ceil(remainingMs / 1000));
  const isTwoMinuteWarning = view.phase === 'playing' && isTwoMinuteWarningVisible(remainingMs);
  const isPlaying = view.phase === 'playing';
  const showSnowstormWarning = isPlaying && isSnowstormWarningVisible(remainingMs, view.mapId);
  const showSnowstormBegun = isPlaying && isSnowstormBegunVisible(remainingMs, view.mapId);
  const stormIntensity = isPlaying ? snowstormIntensity(remainingMs, view.mapId) : 0;
  const stormGust = isPlaying ? stormGustStrength(remainingMs, view.mapId) : 0;
  const stormStyle = {
    '--storm-intensity': stormIntensity,
    '--storm-gust': stormGust,
  } as CSSProperties;
  return (
    <div className="game-hud">
      {stormIntensity > 0 && (
        <div className="snowstorm-lens" style={stormStyle} aria-hidden="true" />
      )}
      <div className="match-clock">
        <span>Ice Ice Water</span>
        <strong>
          {Math.floor(time / 60)}:{String(time % 60).padStart(2, '0')}
        </strong>
        <span>{`Water unfrozen: ${view.waterUnfrozenCount} / ${view.waterStartedCount}`}</span>
      </div>
      {isTwoMinuteWarning && (
        <div className="two-minute-warning" role="alert" aria-live="assertive">
          Only 2 minutes left
        </div>
      )}
      {showSnowstormWarning && (
        <div className="snowstorm-warning" role="alert" aria-live="assertive">
          ⚠ SNOWSTORM APPROACHING ⚠
        </div>
      )}
      {showSnowstormBegun && (
        <div className="snowstorm-begun" role="status" aria-live="polite">
          The snowstorm has begun!
        </div>
      )}
      {p.status === 'frozen' && (
        <div className="frozen-status" role="status">
          <strong>FROZEN</strong>
          <span>Wait for a Water teammate to rescue you.</span>
          <meter min={0} max={1} value={p.rescueProgress} aria-label="Rescue progress" />
        </div>
      )}
      {p.status === 'alive' && (
        <div
          className="crosshair"
          style={{
            color: crosshair,
            fontSize: 27 + Math.min(10, Math.hypot(p.velocityX, p.velocityZ)),
          }}
          aria-label="Crosshair"
        >
          +
        </div>
      )}
      <div className="desktop-controls">
        WASD move · Mouse aim · Space jump/swim · Shift slide · C crouch/dive · Ctrl sprint
        <br />
        Click tag / rescue at close range · Q lunge · Tab scores · Esc pause
      </div>
    </div>
  );
}
