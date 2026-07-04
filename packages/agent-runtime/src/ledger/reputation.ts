/**
 * Reputation — the run ledger as a track record.
 *
 * Sellers stop being stateless: every persisted round is ground truth (who won, who delivered,
 * what the verifier said, what settled on-chain), so reputation is DERIVED, not asserted. Buyers
 * weigh it at award time; a seller that no-shows or fails verification carries that history into
 * every future bid. This is also the on-ramp to credit (Normandy-style): score is collateral.
 */
import type { RunRecord } from './run.js'

export interface SellerReputation {
  seller: string
  /** Rounds this seller won. */
  awarded: number
  /** ...in which it delivered a payload. */
  delivered: number
  /** ...that settled on-chain (a release tx exists). */
  settled: number
  verifiedPass: number
  verifiedFail: number
  refunded: number
  /** 0–100 composite: 60% settle rate, 30% delivery rate, 10% verification cleanliness. */
  score: number
}

export function reputation(runs: RunRecord[]): SellerReputation[] {
  const bySeller = new Map<string, SellerReputation>()
  const get = (seller: string): SellerReputation => {
    let r = bySeller.get(seller)
    if (!r) {
      r = { seller, awarded: 0, delivered: 0, settled: 0, verifiedPass: 0, verifiedFail: 0, refunded: 0, score: 0 }
      bySeller.set(seller, r)
    }
    return r
  }

  for (const run of runs) {
    const winner = run.award?.to
    if (!winner) continue
    const r = get(winner)
    r.awarded++
    if (run.delivery) r.delivered++
    if (run.txs.some((t) => t.kind === 'release')) r.settled++
    const verdict = (run.verification as { verdict?: string } | undefined)?.verdict
    if (verdict === 'pass') r.verifiedPass++
    if (verdict === 'fail') r.verifiedFail++
    if (run.status === 'refunded') r.refunded++
  }

  for (const r of bySeller.values()) {
    const settleRate = r.settled / r.awarded
    const deliveryRate = r.delivered / r.awarded
    const cleanliness = 1 - r.verifiedFail / Math.max(1, r.delivered)
    r.score = Math.round(100 * (0.6 * settleRate + 0.3 * deliveryRate + 0.1 * cleanliness))
  }
  return [...bySeller.values()].sort((a, b) => b.score - a.score)
}

/** One line per seller for an award prompt: "seller-x: score 87 (12 won, 11 settled, 1 verify-fail)". */
export function formatReputation(reps: SellerReputation[]): string {
  return reps
    .map((r) => `${r.seller}: score ${r.score} (${r.awarded} won, ${r.settled} settled${r.verifiedFail ? `, ${r.verifiedFail} verify-fail` : ''}${r.refunded ? `, ${r.refunded} refunded` : ''})`)
    .join('\n')
}
