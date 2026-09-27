import { useEffect, useRef, useState } from 'react';
import {
  sanitizeDisplayName,
  normalizeInviteCode,
  type ChatMessage,
  type GuestSession,
  type LobbyView,
  type SessionError,
} from '@ice-water/shared';
import {
  createGuest,
  readGuest,
  forgetGuest,
  reserveRoom,
  reconnectRoom,
  saveReconnect,
  clearReconnect,
  snapshot,
  type LobbyRoom,
} from '../network/lobby-client.js';
import { ServerClock } from '../network/server-clock.js';
import type { GameScene } from '../game/game-scene.js';
import { readSettings, saveSettings } from '../game/fps-settings.js';
import { LobbyAudio } from '../audio/lobby-audio.js';
import { GameHud } from './game-hud.js';
import { TouchControls } from './touch-controls.js';
import { Scoreboard } from './scoreboard.js';
import { ResultsScreen } from './results-screen.js';
import { SettingsPanel } from './settings-panel.js';
import { LobbyScreen } from './lobby-screen.js';

export function App() {
  const [guest, setGuest] = useState<GuestSession | null>(readGuest);
  const [room, setRoom] = useState<LobbyRoom | null>(null),
    [view, setView] = useState<LobbyView | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState(''),
    [isBusy, setBusy] = useState(true),
    [connection, setConnection] = useState('Connected');
  const [scene, setScene] = useState<GameScene | null>(null),
    [now, setNow] = useState(0),
    [settings, setSettings] = useState(readSettings);
  const [, refreshMapStatus] = useState(0);
  const [isSettings, setIsSettings] = useState(false);
  const [isChatFocused, setIsChatFocused] = useState(false);
  const [hasEnteredArena, setHasEnteredArena] = useState(false);
  const [spectatorTargetId, setSpectatorTargetId] = useState<string | null>(null);
  const [dismissedRoundInstruction, setDismissedRoundInstruction] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null),
    roomRef = useRef<LobbyRoom | null>(null),
    sceneRef = useRef<GameScene | null>(null);
  const clock = useRef(new ServerClock()),
    roomCleanup = useRef<(() => void)[]>([]);
  const lobbyAudio = useRef<LobbyAudio | null>(null);
  if (!lobbyAudio.current) lobbyAudio.current = new LobbyAudio(settings);
  const isInGame = !!view && !['lobby', 'countdown'].includes(view.phase);
  const isComplete = view?.phase === 'finished' || view?.phase === 'intermission';
  const local = view?.players.find((player) => player.playerId === guest?.playerId);
  const activeSpectatorTargets =
    view?.players.filter(
      (player) =>
        player.isConnected &&
        (player.team === 'ice' || player.team === 'water') &&
        (player.status === 'alive' || player.status === 'frozen'),
    ) ?? [];
  const activeSpectatorTargetKey = activeSpectatorTargets.map((player) => player.playerId).join('|');
  const spectatorTarget = activeSpectatorTargets.find(
    (player) => player.playerId === spectatorTargetId,
  ) ?? activeSpectatorTargets[0];
  const roundInstructionKey =
    view?.phase === 'playing' && (local?.team === 'ice' || local?.team === 'water')
      ? `${view.phaseDeadline}:${local.team}`
      : null;
  const isRoundInstructionVisible =
    hasEnteredArena &&
    roundInstructionKey !== null &&
    dismissedRoundInstruction !== roundInstructionKey;

  useEffect(() => {
    if (isComplete) {
      document.exitPointerLock();
      sceneRef.current?.getInput().reset();
    }
  }, [isComplete]);
  useEffect(() => {
    if (local?.team !== 'none') return;
    document.exitPointerLock();
    scene?.getInput().reset();
  }, [local?.status, scene]);
  useEffect(() => {
    if (local?.team !== 'none' || !scene) {
      if (spectatorTargetId !== null) setSpectatorTargetId(null);
      return;
    }
    const candidates = scene.session.view.players.filter(
      (player) =>
        player.isConnected &&
        (player.team === 'ice' || player.team === 'water') &&
        (player.status === 'alive' || player.status === 'frozen'),
    );
    const current = candidates.find((player) => player.playerId === spectatorTargetId);
    const target = current ?? candidates[0];
    const nextId = scene.setSpectatorTarget(target?.playerId) ?? null;
    setSpectatorTargetId((previous) => (previous === nextId ? previous : nextId));
  }, [activeSpectatorTargetKey, local?.status, scene, spectatorTargetId]);
  useEffect(() => {
    if (!isInGame) {
      setHasEnteredArena(false);
      setDismissedRoundInstruction(null);
      setIsChatFocused(false);
    }
    if (isComplete) setIsChatFocused(false);
  }, [isInGame, isComplete]);
  useEffect(() => {
    let active = true;
    void reconnectRoom()
      .then((next) => {
        if (next && active) attach(next);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to reconnect');
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    const timer = window.setInterval(() => setNow(clock.current.now()), 100);
    return () => {
      active = false;
      window.clearInterval(timer);
      roomCleanup.current.forEach((cleanup) => cleanup());
    };
  }, []);
  useEffect(() => {
    const audio = lobbyAudio.current;
    audio?.start();
    return () => audio?.destroy();
  }, []);
  useEffect(() => {
    if (!isInGame || !room || !guest || !canvas.current) return;
    let active = true;
    const element = canvas.current;
    void import('../game/game-scene.js').then(({ GameScene }) => {
      if (!active) return;
      try {
        const next = new GameScene(element, room, guest.playerId, () =>
          refreshMapStatus((value) => value + 1),
        );
        sceneRef.current = next;
        setScene(next);
      } catch {
        setError('Unable to start 3D. Enable WebGL 2 in your browser and reload.');
      }
    });
    return () => {
      active = false;
      sceneRef.current?.destroy();
      sceneRef.current = null;
      setScene(null);
    };
  }, [isInGame, room, guest]);
  useEffect(() => {
    saveSettings(settings);
    if (scene) scene.settings = settings;
    lobbyAudio.current?.setSettings(settings);
  }, [settings, scene]);
  useEffect(() => {
    if (!scene) return;
    const shouldBlockInput = isSettings || isRoundInstructionVisible || isChatFocused;
    scene.isPaused = shouldBlockInput;
    if (shouldBlockInput) {
      document.exitPointerLock();
      scene.getInput().reset();
      scene.getInput().isEnabled = false;
    } else scene.getInput().isEnabled = scene.isTouch || scene.isLocked;
  }, [isSettings, isRoundInstructionVisible, isChatFocused, scene]);
  useEffect(() => {
    if (scene?.isTouch && scene.isMapReady) setHasEnteredArena(true);
  }, [scene, scene?.isMapReady]);

  function resumeArena() {
    setHasEnteredArena(true);
    setIsSettings(false);
    if (!scene) return;
    scene.isPaused = false;
    scene.getInput().reset();
    scene.getInput().isEnabled = !scene.isPaused;
    if (!scene.isTouch) scene.lock();
  }

  function attach(next: LobbyRoom) {
    roomCleanup.current.forEach((cleanup) => cleanup());
    roomCleanup.current = [];
    roomRef.current = next;
    setChatMessages([]);
    setIsChatFocused(false);
    setRoom(next);
    setError('');
    setConnection('Connected');
    const update = () => {
      if (!next.state?.players) return;
      const current = snapshot(next.state);
      setView(current);
      clock.current.update(current.serverTime);
      setNow(clock.current.now());
    };
    next.onStateChange(update);
    roomCleanup.current.push(() => next.onStateChange.remove(update));
    roomCleanup.current.push(
      next.onMessage<SessionError>('session/error', (message) => setError(message.message)),
      next.onMessage<ChatMessage>('chat/message', (message) =>
        setChatMessages((current) => [...current.slice(-19), message]),
      ),
    );
    roomCleanup.current.push(
      next.onMessage('match/phase-changed', () => setError('')),
      next.onMessage('match/result', () => {}),
    );
    const drop = () => setConnection('Reconnecting…'),
      reconnect = () => {
        setConnection('Connected');
        saveReconnect(next);
      };
    next.onDrop(drop);
    next.onReconnect(reconnect);
    roomCleanup.current.push(
      () => next.onDrop.remove(drop),
      () => next.onReconnect.remove(reconnect),
    );
    next.onError((_code, message) => setError(message ?? 'Room connection failed'));
    next.onLeave(() => {
      if (roomRef.current !== next) return;
      const complete = next.state.phase === 'finished' || next.state.phase === 'intermission';
      roomRef.current = null;
      clearReconnect();
      setRoom(null);
      setView(null);
      setChatMessages([]);
      setIsChatFocused(false);
      setError(complete ? '' : 'Your room connection ended. Create a room or join again.');
    });
    update();
  }

  async function run(action: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to complete this action. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  function identify(name: string) {
    const value = sanitizeDisplayName(name);
    if (!value) {
      setError('Choose a name with 2–20 letters or numbers.');
      return;
    }
    void run(async () => setGuest(await createGuest(value)));
  }
  async function create() {
    if (!guest) return;
    const next = await reserveRoom(guest);
    attach(next);
  }
  function join(code: string) {
    const invite = normalizeInviteCode(code);
    if (!invite) {
      setError('Enter the eight-character invite code from your host.');
      return;
    }
    if (guest)
      void run(async () => {
        const next = await reserveRoom(guest, invite);
        attach(next);
      });
  }
  async function leave() {
    if (!room) return;
    roomRef.current = null;
    clearReconnect();
    await room.leave();
    setRoom(null);
    setView(null);
    setError('');
  }
  function sendChat(message: string) {
    if (roomRef.current && view?.phase === 'playing')
      roomRef.current.send('chat/send', { message });
  }

  const settingsPanel = isSettings && (
    <div className="modal-backdrop">
      <SettingsPanel value={settings} onChange={setSettings} onClose={() => setIsSettings(false)} />
    </div>
  );
  if (isInGame && view && guest) {
    const complete = view.phase === 'finished' || view.phase === 'intermission';
    return (
      <main className={scene?.isTouch ? 'game-shell is-touch' : 'game-shell'}>
        <canvas className="game-canvas" ref={canvas} aria-label="3D game arena" />
        {!complete && (
          <GameHud
            view={view}
            localPlayerId={guest.playerId}
            serverNow={now}
            crosshair={settings.crosshair}
            chatMessages={chatMessages}
            onChatSend={sendChat}
            onChatFocusChange={(isFocused) => {
              if (isFocused) {
                sceneRef.current?.getInput().reset();
                document.exitPointerLock();
              } else if (
                view?.phase === 'playing' &&
                hasEnteredArena &&
                !sceneRef.current?.isTouch &&
                !isSettings &&
                !isRoundInstructionVisible
              ) {
                sceneRef.current?.lock();
              }
              setIsChatFocused(isFocused);
            }}
            isRoundInstructionVisible={isRoundInstructionVisible}
            onRoundInstructionDismiss={() => {
              if (!roundInstructionKey) return;
              setDismissedRoundInstruction(roundInstructionKey);
              if (!scene?.isTouch) scene?.lock();
            }}
          />
        )}
          {!complete && local?.team === 'none' && (
            <section className="spectator-panel" aria-label="Spectator controls" role="status">
              <span>Spectating</span>
              <strong>Watching: {spectatorTarget?.displayName ?? 'No active players'}</strong>
              <div>
                <button
                  type="button"
                  aria-label="Previous spectator target"
                  disabled={activeSpectatorTargets.length < 2}
                  onClick={() =>
                    setSpectatorTargetId(scene?.cycleSpectatorTarget(-1) ?? null)
                  }
                >
                  Previous
                </button>
                <button
                  type="button"
                  aria-label="Next spectator target"
                  disabled={activeSpectatorTargets.length < 2}
                  onClick={() =>
                    setSpectatorTargetId(scene?.cycleSpectatorTarget(1) ?? null)
                  }
                >
                  Next
                </button>
              </div>
              {!scene?.isTouch && <small>[ / ] or Arrow keys</small>}
            </section>
          )}
          {scene?.isTouch && !complete && !isSettings && local?.team !== 'none' && (
          <TouchControls input={scene.getInput()} />
        )}
        {!complete && scene?.getInput().isScoreboard && (
          <div className="scoreboard-overlay">
            <Scoreboard view={view} localPlayerId={guest.playerId} ping={scene.session.ping} />
          </div>
        )}
        {!complete && scene && !scene.isMapReady && (
          <div className="pause-screen">
            <h2>{scene.hasMapError ? 'Frostline failed to load' : 'Loading Frostline…'}</h2>
            {scene.hasMapError && <button onClick={() => leave()}>Back to lobby</button>}
          </div>
        )}
        {!complete &&
          scene &&
          scene.isMapReady &&
          !scene.isTouch &&
          !scene.isLocked &&
          (local?.team === 'ice' || local?.team === 'water') &&
          local.status !== 'spectator' &&
          !isSettings && (
            <div className="pause-screen">
              <h2>Frostline</h2>
              <p>Click to aim. Esc releases your cursor.</p>
              <button className="primary" type="button" onClick={resumeArena}>
                Enter arena
              </button>
            </div>
          )}
        {complete && (
          <ResultsScreen
            result={{
              winner: view.matchWinner,
              reason: view.resultReason || 'water-survived',
              gameMode: view.gameMode,
            }}
            onLeave={() => void run(leave)}
          />
        )}
        <nav className="game-menu">
          <button onClick={() => setIsSettings(true)}>Settings</button>
          <button onClick={() => void run(leave)} disabled={isBusy}>
            Leave room
          </button>
        </nav>
        {connection !== 'Connected' && (
          <p className="connection-banner" role="status">
            {connection}
          </p>
        )}
        {error && (
          <p className="error-toast" role="alert">
            {error}
          </p>
        )}
        {settingsPanel}
      </main>
    );
  }

  return (
    <LobbyScreen
      guest={guest}
      room={room}
      view={view}
      error={error}
      isBusy={isBusy}
      now={now}
      settings={settings}
      onSettings={setSettings}
      onIdentify={identify}
      onCreate={() => void run(create)}
      onJoin={join}
      onLeave={() => void run(leave)}
      onForgetGuest={() => {
        forgetGuest();
        setGuest(null);
        setError('');
      }}
      onAudioUnlock={() => void lobbyAudio.current?.unlock()}
      onUiCue={(cue) => lobbyAudio.current?.cue(cue)}
    />
  );
}
