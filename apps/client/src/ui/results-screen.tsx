import type { MatchResult } from '@ice-water/shared';
export function ResultsScreen({
  result,
  onLeave,
}: {
  result: MatchResult;
  onLeave: () => void;
}) {
  const winnerText = result.winner === 'ice' ? 'ICE WINS' : 'WATER WINS';
  return (
    <div className="results-screen">
      <h1>{winnerText}</h1>
      <button className="primary" onClick={onLeave}>
        Back to lobby
      </button>
    </div>
  );
}
