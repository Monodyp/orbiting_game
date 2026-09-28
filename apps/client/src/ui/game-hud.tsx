import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { MAX_CHAT_MESSAGE_LENGTH, type ChatMessage, type LobbyView } from '@ice-water/shared';
import { isNightWarningVisible } from '../game/match-night.js';
import { KeyboardKeyIcon, MouseButtonIcon } from './control-icons.js';
import {
  isSnowstormWarningVisible,
  isSnowstormBegunVisible,
  snowstormIntensity,
  stormGustStrength,
} from '../game/snowstorm.js';
export type KillEntry = never;

type WeatherNotification = { kind: 'snow' | 'blizzard'; message: string };
type WeatherState = Pick<LobbyView, 'snowStarted' | 'blizzardEnabled' | 'blizzardStarted'>;

export function weatherNotificationFor(
  previous: WeatherState,
  current: WeatherState,
): WeatherNotification | null {
  if (!previous.blizzardStarted && current.blizzardStarted && current.blizzardEnabled) {
    return { kind: 'blizzard', message: 'BLIZZARD HAS ARRIVED!' };
  }
  if (!previous.snowStarted && current.snowStarted) {
    return {
      kind: 'snow',
      message: current.blizzardEnabled
        ? 'SNOW HAS BEGUN. A BLIZZARD MAY FOLLOW.'
        : 'SNOW HAS BEGUN.',
    };
  }
  return null;
}

type RoundInstruction = { title: string; message: string };

export function roundInstructionFor(team: string): RoundInstruction | null {
  if (team === 'ice')
    return {
      title: 'You are Ice!',
      message: 'Tag all Water players to freeze them and win the game.',
    };
  if (team === 'water')
    return {
      title: 'You are Water!',
      message:
        'Avoid getting frozen, and save your teammates by unfreezing them! Survive until the end of the round.',
    };
  return null;
}

export function GameHud({
  view,
  localPlayerId,
  serverNow,
  crosshair,
  isRoundInstructionVisible,
  onRoundInstructionDismiss,
  chatMessages,
  onChatSend,
  onChatFocusChange,
}: {
  view: LobbyView;
  localPlayerId: string;
  serverNow: number;
  crosshair: string;
  isRoundInstructionVisible: boolean;
  onRoundInstructionDismiss: () => void;
  chatMessages: ChatMessage[];
  onChatSend: (message: string) => void;
  onChatFocusChange: (isFocused: boolean) => void;
}) {
  const previousWeatherState = useRef<WeatherState>({
    snowStarted: view.snowStarted,
    blizzardEnabled: view.blizzardEnabled,
    blizzardStarted: view.blizzardStarted,
  });
  const [weatherNotification, setWeatherNotification] = useState<WeatherNotification | null>(null);

  useEffect(() => {
    const current: WeatherState = {
      snowStarted: view.snowStarted,
      blizzardEnabled: view.blizzardEnabled,
      blizzardStarted: view.blizzardStarted,
    };
    const notification = weatherNotificationFor(previousWeatherState.current, current);
    previousWeatherState.current = current;
    if (notification) setWeatherNotification(notification);
  }, [view.snowStarted, view.blizzardEnabled, view.blizzardStarted]);

  useEffect(() => {
    if (!weatherNotification) return;
    const timeout = window.setTimeout(() => setWeatherNotification(null), 5_000);
    return () => window.clearTimeout(timeout);
  }, [weatherNotification]);

  const p = view.players.find((p) => p.playerId === localPlayerId);
  if (!p) return null;
  const remainingMs = view.phaseDeadline - serverNow;
  const time = Math.max(0, Math.ceil(remainingMs / 1000));
  const isNightWarning = view.phase === 'playing' && isNightWarningVisible(remainingMs);
  const isPlaying = view.phase === 'playing';
  const role = p.team === 'ice' ? 'ICE' : p.team === 'water' ? 'WATER' : null;
  const roundInstruction = isRoundInstructionVisible ? roundInstructionFor(p.team) : null;
  const showSnowstormWarning = isPlaying && isSnowstormWarningVisible(remainingMs, view.mapId);
  const showSnowstormBegun = isPlaying && isSnowstormBegunVisible(remainingMs, view.mapId);
  const stormIntensity =
    isPlaying && view.snowStarted ? snowstormIntensity(remainingMs, view.mapId) : 0;
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
      {role && (
        <div
          className={`role-indicator role-indicator--${p.team}`}
          role="status"
          aria-live="polite"
        >
          {`ROLE: ${role}`}
        </div>
      )}
      {roundInstruction && (
        <section
          className={`round-instruction round-instruction--${p.team}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="round-instruction-title"
        >
          <div className="round-instruction__card">
            <strong id="round-instruction-title">{roundInstruction.title}</strong>
            <span>{roundInstruction.message}</span>
            <button className="primary" type="button" onClick={onRoundInstructionDismiss}>
              Got it
            </button>
          </div>
        </section>
      )}
      {isNightWarning && (
        <div className="two-minute-warning" role="alert" aria-live="assertive">
          Night begins
        </div>
      )}
      {isPlaying && weatherNotification && !showSnowstormWarning && !showSnowstormBegun && (
        <div
          className={`weather-notification weather-notification--${weatherNotification.kind}`}
          role="status"
          aria-live="polite"
        >
          {weatherNotification.message}
        </div>
      )}
      {showSnowstormWarning && (
        <div className="snowstorm-warning" role="alert" aria-live="assertive">
          ⚠ SNOWSTORM APPROACHING ⚠
        </div>
      )}
      {showSnowstormBegun && (
        <div className="snowstorm-begun" role="status" aria-live="polite">
          THE SNOWSTORM HAS BEGUN
        </div>
      )}
      {isPlaying && (
        <GameChat messages={chatMessages} onSend={onChatSend} onFocusChange={onChatFocusChange} />
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
      {role && p.status === 'alive' && (
        <div className="desktop-controls" aria-label="Gameplay controls">
          <div className="control-prompt">
            <KeyboardKeyIcon keyLabel="WASD" />
            <span>WASD</span>
            <strong>Move</strong>
          </div>
          <div className="control-prompt">
            <KeyboardKeyIcon keyLabel="SHIFT" />
            <span>SHIFT</span>
            <strong>Sprint</strong>
          </div>
          <div className="control-prompt">
            <KeyboardKeyIcon keyLabel="C" />
            <span>C</span>
            <strong>Slide</strong>
          </div>
          <div className="control-prompt">
            <MouseButtonIcon />
            <span>Left Click</span>
            <strong>Tag / interact</strong>
          </div>
          <div className="control-prompt">
            <MouseButtonIcon button="right" />
            <span>RMB</span>
            <strong>Lunge</strong>
          </div>
          <div className="control-prompt">
            <KeyboardKeyIcon keyLabel="SPACE" />
            <span>Space</span>
            <strong>Jump</strong>
          </div>
        </div>
      )}
    </div>
  );
}

function GameChat({
  messages,
  onSend,
  onFocusChange,
}: {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  onFocusChange: (isFocused: boolean) => void;
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const focusChat = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.defaultPrevented) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.matches('input, textarea, select, button') || target.isContentEditable)
      )
        return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', focusChat);
    return () => window.removeEventListener('keydown', focusChat);
  }, []);

  useEffect(() => {
    const releaseOnOutsidePointer = (event: PointerEvent) => {
      const chat = inputRef.current?.closest('.game-chat');
      if (chat && !chat.contains(event.target as Node)) inputRef.current?.blur();
    };
    document.addEventListener('pointerdown', releaseOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', releaseOnOutsidePointer);
  }, []);

  useEffect(() => {
    const list = messagesRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    onSend(message);
    setDraft('');
  }

  return (
    <section className="game-chat" aria-label="Room chat">
      <div className="game-chat__heading">
        <strong>Room chat</strong>
        <button type="button" onClick={() => inputRef.current?.focus()}>
          Focus
        </button>
      </div>
      <ol className="game-chat__messages" ref={messagesRef} role="log" aria-live="polite">
        {messages.slice(-8).map((message, index) => (
          <li key={`${message.serverTime}-${message.playerId}-${index}`}>
            <strong>{message.displayName}</strong>
            <span>{message.message}</span>
          </li>
        ))}
      </ol>
      <form className="game-chat__form" onSubmit={submit}>
        <input
          ref={inputRef}
          aria-label="Chat message"
          autoComplete="off"
          maxLength={MAX_CHAT_MESSAGE_LENGTH}
          placeholder="Press Enter to chat"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => onFocusChange(true)}
          onBlur={() => onFocusChange(false)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              inputRef.current?.blur();
            }
          }}
        />
        <button type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
