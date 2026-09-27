import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  sanitizeDisplayName,
  normalizeInviteCode,
  type GameMode,
  type GuestSession,
  type LobbyView,
} from '@ice-water/shared';
import type { LobbyRoom } from '../network/lobby-client.js';
import type { FpsSettings } from '../game/fps-settings.js';
import type { LobbySection } from '../game/lobby-preview.js';
import { SettingsPanel } from './settings-panel.js';
import assetCreditsUrl from '../../../../assets/ATTRIBUTION.txt?url&no-inline';

const LobbyPreview = lazy(() =>
  import('../game/lobby-preview.js').then((module) => ({ default: module.LobbyPreview })),
);

interface LobbyScreenProps {
  guest: GuestSession | null;
  room: LobbyRoom | null;
  view: LobbyView | null;
  error: string;
  isBusy: boolean;
  now: number;
  settings: FpsSettings;
  onSettings: (settings: FpsSettings) => void;
  onIdentify: (name: string) => void;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onLeave: () => void;
  onForgetGuest: () => void;
  onAudioUnlock: () => void;
  onUiCue: (cue: 'hover' | 'select' | 'deploy') => void;
}

const MODE_DETAILS: Record<GameMode, { name: string; summary: string; limit: string }> = {
  tdm: {
    name: 'Ice Ice Water',
    summary: 'Ice and Water squads collide.',
    limit: '5 minutes · Freeze and rescue',
  },
};

export function LobbyScreen(props: LobbyScreenProps) {
  const { guest, room, view, error, isBusy, now, settings } = props;
  const [section, setSection] = useState<LobbySection>(guest ? 'play' : 'main');
  const [name, setName] = useState(''),
    [code, setCode] = useState(''),
    [mode, setMode] = useState<GameMode>('tdm');
  const [copy, setCopy] = useState('Copy invite code');
  const previousGuest = useRef(guest?.playerId),
    previousRoom = useRef(room);

  useEffect(() => {
    if (guest && !previousGuest.current) setSection('play');
    if (room && !previousRoom.current) setSection('play');
    if (!room && previousRoom.current) setSection('play');
    previousGuest.current = guest?.playerId;
    previousRoom.current = room;
  }, [guest, room]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && section !== 'main' && section !== 'play') setSection('play');
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [room, section]);

  const navigate = (next: LobbySection) => {
    setSection(next);
    props.onUiCue(next === 'play' ? 'deploy' : 'select');
  };
  const identify = (event: FormEvent) => {
    event.preventDefault();
    const value = sanitizeDisplayName(name);
    if (!value) {
      props.onIdentify(name);
      return;
    }
    props.onIdentify(value);
  };
  const join = (event: FormEvent) => {
    event.preventDefault();
    const invite = normalizeInviteCode(code);
    props.onJoin(invite ?? code);
  };
  const hover = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest('button,select,input')) props.onUiCue('hover');
  };

  return (
    <main
      className={`lobby-shell lobby-view-${section}${section === 'settings' ? ' is-panel-focus' : ''}`}
      onPointerDown={props.onAudioUnlock}
      onPointerOver={hover}
    >
      <section className="lobby-stage" aria-label="3D lobby stage">
        <Suspense
          fallback={
            <div className="preview-fallback">
              <span>Opening facility…</span>
            </div>
          }
        >
          <LobbyPreview
            section={section}
            reducedEffects={settings.reducedEffects}
            isRoomActive={!!room || isBusy}
          />
        </Suspense>
        <div className="stage-vignette" />
        <div className="facility-readout" aria-hidden="true">
          <span>FR-07</span>
          <i />
          <span>CRYO BAY</span>
        </div>
        <div className="lobby-wordmark" aria-label="Ice Ice Water">
          <span>ICE ICE</span>
          <strong>WATER</strong>
          <small>Frostline operations</small>
        </div>
        {section === 'customize' && (
          <p className="showcase-hint">Drag to rotate · Wheel to zoom · Esc to return</p>
        )}
      </section>

      <header className="lobby-topbar">
        <button
          className="brand-lockup"
          onClick={() => navigate(guest ? 'main' : 'main')}
          aria-label="Ice Ice Water home"
        >
          <i />
          <span>IIW</span>
          <small>Frostline // private network</small>
        </button>
        <div className="network-state">
          <span className="status-dot" />
          Invite-only servers
        </div>
        {guest && (
          <button className="profile-chip" onClick={() => navigate('profile')}>
            <span className="profile-avatar">{guest.displayName.slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{guest.displayName}</strong>
              <small>Guest operative</small>
            </span>
            <i>›</i>
          </button>
        )}
      </header>

      {guest && (
        <nav className="main-navigation" aria-label="Main navigation">
          <NavButton label="Play" section="play" current={section} onClick={navigate} accent />
          <NavButton label="Game modes" section="modes" current={section} onClick={navigate} />
          <NavButton label="Customize" section="customize" current={section} onClick={navigate} />
          <NavButton label="Settings" section="settings" current={section} onClick={navigate} />
        </nav>
      )}

      <section
        className="command-panel"
        aria-label="Private room lobby"
        aria-busy={isBusy}
        key={`${section}-${room ? 'room' : 'solo'}-${guest ? 'guest' : 'new'}`}
      >
        {!guest ? (
          <IdentityPanel name={name} setName={setName} identify={identify} isBusy={isBusy} />
        ) : room && !view ? (
          <>
            <div className="panel-kicker">Secure room link</div>
            <h1>Joining room</h1>
            <p className="panel-lede" role="status">
              Synchronizing the private lobby and operator roster…
            </p>
          </>
        ) : room && view ? (
          <RoomAwarePanel
            section={section}
            guest={guest}
            room={room}
            view={view}
            settings={settings}
            now={now}
            isBusy={isBusy}
            copy={copy}
            setCopy={setCopy}
            onSettings={props.onSettings}
            onSection={navigate}
            onLeave={props.onLeave}
          />
        ) : (
          <SoloPanel
            section={section}
            guest={guest}
            mode={mode}
            setMode={setMode}
            code={code}
            setCode={setCode}
            settings={settings}
            isBusy={isBusy}
            onSettings={props.onSettings}
            onSection={navigate}
            onCreate={() => {
              props.onUiCue('deploy');
              props.onCreate();
            }}
            onJoin={join}
            onForget={props.onForgetGuest}
          />
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </section>

    </main>
  );
}
function NavButton({
  label,
  section,
  current,
  onClick,
  accent = false,
}: {
  label: string;
  section: LobbySection;
  current: LobbySection;
  onClick: (section: LobbySection) => void;
  accent?: boolean;
}) {
  const isActive = current === section;
  return (
    <button
      className={`${accent ? 'nav-primary ' : 'nav-item '}${isActive ? 'is-active' : ''}`}
      aria-current={isActive ? 'page' : undefined}
      onClick={() => onClick(section)}
    >
      <span>{label}</span>
      <i />
    </button>
  );
}
function IdentityPanel({
  name,
  setName,
  identify,
  isBusy,
}: {
  name: string;
  setName: (name: string) => void;
  identify: (event: FormEvent) => void;
  isBusy: boolean;
}) {
  return (
    <>
      <div className="panel-kicker">Secure guest access</div>
      <h1>Enter Frostline</h1>
      <p className="panel-lede">
        Claim a callsign and step into the private arena network. No account required.
      </p>
      <form onSubmit={identify}>
        <label htmlFor="display-name">Display name</label>
        <input
          id="display-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          autoComplete="nickname"
          placeholder="Your player name"
          required
        />
        <small>2–20 letters or numbers.</small>
        <button className="primary" disabled={isBusy}>
          {isBusy ? 'Connecting…' : 'Let’s go'}
        </button>
      </form>
      <div className="panel-footnote">
        <span>WebGL 2</span>
        <span>Keyboard + touch</span>
        <span>Private rooms</span>
      </div>
    </>
  );
}
interface SoloPanelProps {
  section: LobbySection;
  guest: GuestSession;
  mode: GameMode;
  setMode: (mode: GameMode) => void;
  code: string;
  setCode: (code: string) => void;
  settings: FpsSettings;
  isBusy: boolean;
  onSettings: (settings: FpsSettings) => void;
  onSection: (section: LobbySection) => void;
  onCreate: () => void;
  onJoin: (event: FormEvent) => void;
  onForget: () => void;
}
function SoloPanel(props: SoloPanelProps) {
  const { section } = props;
  if (section === 'modes') return <GameModePanel value={props.mode} onChange={props.setMode} />;
  if (section === 'customize') return <CustomizationPanel />;
  if (section === 'profile') return <ProfilePanel guest={props.guest} />;
  if (section === 'settings')
    return (
      <SettingsPanel
        value={props.settings}
        onChange={props.onSettings}
        onClose={() => props.onSection('play')}
        isEmbedded
      />
    );
  if (section === 'main')
    return (
      <>
        <div className="panel-kicker">Welcome back</div>
        <h1>{props.guest.displayName}</h1>
        <p className="panel-lede">
          Your field kit is staged. Choose a private deployment or join an operator by invite code.
        </p>
        <button className="primary deployment-button" onClick={() => props.onSection('play')}>
          <span>Play</span>
          <small>Create or join a private room</small>
        </button>
        <button className="text-button" onClick={props.onForget}>
          Change callsign
        </button>
      </>
    );
  return (
    <>
      <div className="panel-kicker">Frostline deployment</div>
      <h1>Find your fight</h1>
      <p className="panel-lede">
        Public matchmaking is not enabled. Create an invite-only room in your selected format.
      </p>
      <div className="field-row">
        <label htmlFor="game-mode">Game mode</label>
        <select
          id="game-mode"
          value={props.mode}
          onChange={(event) => props.setMode(event.target.value as GameMode)}
        >
          {Object.entries(MODE_DETAILS).filter(([id]) => id === 'tdm').map(([id, detail]) => (
            <option key={id} value={id}>
              {detail.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <label>Map</label>
        <strong>Frostline</strong>
      </div>
      <button
        className="primary deployment-button"
        onClick={props.onCreate}
        disabled={props.isBusy || props.guest.expiresAt <= Date.now()}
      >
        <span>{props.isBusy ? 'Opening room…' : 'Create private room'}</span>
        <small>
          {MODE_DETAILS[props.mode].name} · Proximity tag rules
        </small>
      </button>
      <form className="join-form" onSubmit={props.onJoin}>
        <label htmlFor="invite-code">Invite code</label>
        <div>
          <input
            id="invite-code"
            value={props.code}
            onChange={(event) => props.setCode(event.target.value)}
            maxLength={8}
            placeholder="ABCDEFGH"
            autoCapitalize="characters"
            required
          />
          <button type="submit" disabled={props.isBusy}>
            Join room
          </button>
        </div>
      </form>
      <button className="text-button" onClick={props.onForget}>
        Change callsign
      </button>
    </>
  );
}

interface RoomAwareProps {
  section: LobbySection;
  guest: GuestSession;
  room: LobbyRoom;
  view: LobbyView;
  settings: FpsSettings;
  now: number;
  isBusy: boolean;
  copy: string;
  setCopy: (copy: string) => void;
  onSettings: (settings: FpsSettings) => void;
  onSection: (section: LobbySection) => void;
  onLeave: () => void;
}
function RoomAwarePanel(props: RoomAwareProps) {
  const { section, view, guest, room } = props,
    isHost = view.hostPlayerId === guest.playerId,
    connectedPlayers = view.players.filter((player) => player.isConnected),
    count = connectedPlayers.length,
    participantCount = connectedPlayers.filter((player) => player.roleChoice !== 'spectator').length,
    localPlayer = connectedPlayers.find((player) => player.playerId === guest.playerId);
  if (section === 'modes')
    return (
      <GameModePanel
        value={view.gameMode}
        onChange={(mode) => room.send('room/configure', { gameMode: mode })}
        disabled={!isHost || view.phase !== 'lobby'}
      />
    );
  if (section === 'customize') return <CustomizationPanel />;
  if (section === 'profile') return <ProfilePanel guest={guest} />;
  if (section === 'settings')
    return (
      <SettingsPanel
        value={props.settings}
        onChange={props.onSettings}
        onClose={() => props.onSection('play')}
        isEmbedded
      />
    );
  const seconds = Math.max(0, Math.ceil((view.phaseDeadline - props.now) / 1000));
  return (
    <>
      <div className="panel-kicker">Private room // live</div>
      <h1>{view.phase === 'countdown' ? `Deploying in ${seconds}` : 'Squad assembled'}</h1>
      <p role="status" aria-label="Connected players" className="room-count">
        <strong>{count}</strong>
        <span>/ {view.maxPlayers} connected</span>
      </p>
      <div className="invite-block">
        <span>Room invite code</span>
        <output className="invite-output" aria-label="Room invite code">
          {view.inviteCode}
        </output>
        <button
          onClick={() =>
            void navigator.clipboard.writeText(view.inviteCode).then(
              () => props.setCopy('Copied'),
              () => props.setCopy('Select the code above'),
            )
          }
        >
          {props.copy}
        </button>
      </div>
      <div className="field-row">
        <label htmlFor="room-mode">Game mode</label>
        <select
          id="room-mode"
          value={view.gameMode}
          disabled={!isHost || view.phase !== 'lobby'}
          onChange={(event) => room.send('room/configure', { gameMode: event.target.value })}
        >
          {Object.entries(MODE_DETAILS).filter(([id]) => id === 'tdm').map(([id, detail]) => (
            <option key={id} value={id}>
              {detail.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row">
        <label>Map</label>
        <strong>Frostline</strong>
      </div>
      <section className="role-assignment" aria-label="Role assignment">
        <div className="panel-kicker">ROLE</div>
        <div className="role-mode-selector" role="group" aria-label="Role assignment mode">
          <button
            type="button"
            aria-pressed={view.roleAssignmentMode === 'random'}
            disabled={!isHost || view.phase !== 'lobby'}
            onClick={() => room.send('room/configure', { roleAssignmentMode: 'random' })}
          >
            Random
          </button>
          <button
            type="button"
            aria-pressed={view.roleAssignmentMode === 'user-picks'}
            disabled={!isHost || view.phase !== 'lobby'}
            onClick={() => room.send('room/configure', { roleAssignmentMode: 'user-picks' })}
          >
            User picks
          </button>
        </div>
        <div className="role-choice">
          <div className="role-choice-selector" role="group" aria-label="Your role choice">
            {(['ice', 'water', 'spectator'] as const).map((role) => (
              <button
                type="button"
                key={role}
                aria-pressed={localPlayer?.roleChoice === role}
                disabled={
                  view.phase !== 'lobby' ||
                  !localPlayer ||
                  (view.roleAssignmentMode === 'random' && role !== 'spectator')
                }
                onClick={() =>
                  room.send('room/role', {
                    role:
                      role === 'spectator' && localPlayer?.roleChoice === 'spectator'
                        ? 'ice'
                        : role,
                  })
                }
              >
                {role === 'ice'
                  ? 'Ice'
                  : role === 'water'
                    ? 'Water'
                    : `Spectator: ${localPlayer?.roleChoice === 'spectator' ? 'ON' : 'OFF'}`}
              </button>
            ))}
          </div>
          <small>
            {localPlayer?.roleChoice === 'spectator'
              ? 'You will watch this match and cannot join either team.'
              : view.roleAssignmentMode === 'random'
                ? 'Active players are assigned randomly; Spectator is always opt-in.'
                : 'Your Ice or Water choice is balanced with the room.'}
          </small>
        </div>
      </section>
      <section className="room-roster" aria-label="Players in room">
        <div className="panel-kicker">Players</div>
        <ul className="roster">
          {connectedPlayers.map((player) => {
            const isLocal = player.playerId === guest.playerId;
            const isRoomHost = player.playerId === view.hostPlayerId;
            const roleLabel =
              player.team === 'none' || player.roleChoice === 'spectator'
                ? 'SPECTATOR'
                : player.team === 'ice' || player.team === 'water'
                  ? player.team.toUpperCase()
                  : view.roleAssignmentMode === 'user-picks' && player.roleChoice !== 'random'
                    ? `PREFERS ${player.roleChoice.toUpperCase()}`
                    : 'RANDOM';
            return (
              <li className={isLocal ? 'is-local' : undefined} key={player.playerId}>
                <span className="roster-name">
                  <i className="roster-state is-online" />
                  {player.displayName}
                  {isLocal && <strong>You</strong>}
                </span>
                <small>
                  {roleLabel} · {isRoomHost ? 'Room host' : player.isBot ? 'Practice bot' : 'Connected'}
                </small>
              </li>
            );
          })}
        </ul>
      </section>
      {isHost ? (
        <button
          className="primary deployment-button"
          disabled={view.phase !== 'lobby' || participantCount < view.minPlayers}
          onClick={() => room.send('room/start', {})}
        >
          <span>Start countdown</span>
          <small>Lock the room and deploy</small>
        </button>
      ) : (
        <p className="waiting-state">Waiting for the room host to deploy.</p>
      )}
      <small>
        {participantCount < view.minPlayers
          ? 'At least two Ice or Water players are required to start.'
          : 'New joins close when the countdown starts.'}
      </small>
      <button className="text-button" onClick={props.onLeave} disabled={props.isBusy}>
        Leave room
      </button>
    </>
  );
}

function GameModePanel({
  value,
  onChange,
  disabled = false,
}: {
  value: GameMode;
  onChange: (mode: GameMode) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <div className="panel-kicker">Match format</div>
      <h1>Ice Ice Water</h1>
      <p className="panel-lede">The team format for every private room.</p>
      <div className="mode-grid">
        {(Object.entries(MODE_DETAILS) as [GameMode, (typeof MODE_DETAILS)[GameMode]][]).map(
          ([id, detail]) => (
            <button
              key={id}
              className={value === id ? 'mode-card is-selected' : 'mode-card'}
              aria-pressed={value === id}
              disabled={disabled}
              onClick={() => onChange(id)}
            >
              <span className="mode-mark">◫</span>
              <span>
                <strong>{detail.name}</strong>
                <small>{detail.summary}</small>
                <em>{detail.limit}</em>
              </span>
            </button>
          ),
        )}
      </div>
      {disabled && (
        <p className="locked-note">Only the party leader can change the mode before countdown.</p>
      )}
    </>
  );
}

function CustomizationPanel() {
  return (
    <>
      <div className="panel-kicker">Operator bay</div>
      <h1>Customize</h1>
      <p className="panel-lede">
        Inspect the current field-issued operator model in the live scene.
      </p>
      <div className="system-notice">
        <strong>Field kit active</strong>
        <span>
          Cosmetic inventory, saved skins, accessories, emotes, and banners are not connected in
          this playtest.
        </span>
      </div>
      <div className="control-hint">
        <span>Drag</span>
        <strong>Rotate operator</strong>
      </div>
      <div className="control-hint">
        <span>Wheel</span>
        <strong>Adjust camera</strong>
      </div>
      <div className="control-hint">
        <span>Esc</span>
        <strong>Return to lobby</strong>
      </div>
    </>
  );
}

function ProfilePanel({ guest }: { guest: GuestSession }) {
  return (
    <>
      <div className="panel-kicker">Player dossier</div>
      <h1>{guest.displayName}</h1>
      <div className="profile-large">
        <span>{guest.displayName.slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>Guest operative</strong>
          <small>Session identity</small>
        </div>
      </div>
      <dl className="profile-facts">
        <div>
          <dt>Access</dt>
          <dd>Private playtest</dd>
        </div>
        <div>
          <dt>Progression</dt>
          <dd>Not enabled</dd>
        </div>
        <div>
          <dt>Rank</dt>
          <dd>Unranked</dd>
        </div>
      </dl>
      <p className="system-note">
        Accounts, currency, and persistent progression are outside the current playable release.
        Your callsign remains active for this browser tab.
      </p>
      <p>
        <a href={assetCreditsUrl} target="_blank" rel="noreferrer">
          Asset credits
        </a>
      </p>
    </>
  );
}

