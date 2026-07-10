import type { SellerReputation } from '../types'

function scoreClass(score: number): string {
  if (score >= 70) return 'rep-good'
  if (score >= 40) return 'rep-mid'
  return 'rep-bad'
}

/**
 * The ledger-derived seller leaderboard as a ranked scoreboard — the same `/api/reputation` data
 * `ReputationPanel` shows as a compact strip, here as a full ranked view with the delivered/settled/
 * verify-fail breakdown per seller. A score is earned from settled rounds, never asserted by the
 * seller itself (see `reputation()` in packages/agent-runtime/src/ledger/reputation.ts).
 */
export function ArenaLeaderboard({ reputation }: { reputation: SellerReputation[] }) {
  if (reputation.length === 0) return null
  return (
    <article className="arena" data-testid="arena-leaderboard">
      <div className="arena-head">
        <h2>Arena Leaderboard</h2>
        <span className="pill">{reputation.length} seller{reputation.length === 1 ? '' : 's'}</span>
      </div>
      <ol className="arena-list">
        {reputation.map((r, i) => (
          <li key={r.seller} className="arena-row" data-testid="arena-row" data-seller={r.seller}>
            <span className="arena-rank">{i + 1}</span>
            <span className="arena-seller">{r.seller}</span>
            <div className="arena-bar">
              <div className={`arena-bar-fill ${scoreClass(r.score)}`} style={{ width: `${Math.max(0, Math.min(100, r.score))}%` }} />
            </div>
            <span className={`arena-score ${scoreClass(r.score)}`}>{r.score}</span>
            <span className="arena-stats">
              {r.awarded} won · {r.delivered} delivered · {r.settled} settled
              {r.verifiedFail ? ` · ${r.verifiedFail} verify-fail` : ''}
              {r.refunded ? ` · ${r.refunded} refunded` : ''}
            </span>
          </li>
        ))}
      </ol>
    </article>
  )
}
