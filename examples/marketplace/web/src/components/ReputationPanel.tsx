import type { SellerReputation } from '../types'

/**
 * Track records derived from the run ledger — never asserted. The buyer folds these lines into
 * its award prompt, so a cheap seller with verify-fails loses to an honest one on history.
 */
export function ReputationPanel({ reputation }: { reputation: SellerReputation[] }) {
  if (reputation.length === 0) return null
  return (
    <div className="rep" data-testid="reputation">
      <span className="rep-label">track record (from the run ledger):</span>
      {reputation.map((r) => (
        <span key={r.seller} className="rep-row" data-testid="rep-row" data-seller={r.seller} title={
          `${r.awarded} won · ${r.delivered} delivered · ${r.settled} settled · ${r.verifiedFail} verify-fails · ${r.refunded} refunded`
        }>
          {r.seller} <strong className={r.score >= 70 ? 'rep-good' : r.score >= 40 ? 'rep-mid' : 'rep-bad'}>{r.score}</strong>
        </span>
      ))}
    </div>
  )
}
