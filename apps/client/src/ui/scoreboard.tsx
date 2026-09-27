import type { LobbyView } from '@ice-water/shared';
export function Scoreboard({
  view,
  localPlayerId,
  ping = 0,
}: {
  view: LobbyView;
  localPlayerId: string;
  ping?: number;
}) {
  const teamOrder = { ice: 0, water: 1, none: 2, unassigned: 3 } as const;
  const rows = [...view.players].sort(
    (a, b) =>
      teamOrder[a.team] - teamOrder[b.team] || a.displayName.localeCompare(b.displayName),
  );
  return (
    <section className="scoreboard" aria-label="Scoreboard">
      <h2>
        Ice Ice Water
      </h2>
      <table>
        <thead>
          <tr>
            <th>Player</th>
            <th>Role</th>
            <th>State</th>
            <th>Ping</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.playerId} className={p.playerId === localPlayerId ? 'is-local' : ''}>
              <td>
                {p.displayName}
                {p.playerId === localPlayerId ? ' (you)' : ''}
                {!p.isConnected ? ' · Away' : ''}
              </td>
              <td>{p.team === 'none' ? 'Spectator' : p.team}</td>
              <td>
                {p.status === 'frozen'
                  ? 'Frozen'
                  : p.status === 'spectator'
                    ? 'Spectating'
                    : 'Active'}
              </td>
              <td>
                {p.isBot ? 'Bot' : p.playerId === localPlayerId && ping > 0 ? `${ping} ms` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
