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

/**
 * What a service has actually cleared for, per WANT.service - the field's real pricing behavior,
 * derived from awarded bids, not a range a seller has to guess blind in. A seller pricing itself
 * can weigh this instead of picking a number between its floor and the buyer's budget with no
 * signal either way.
 */
export interface ServiceClearingPrices {
  service: string
  /** Rounds this service has been awarded across. */
  n: number
  medianPriceSol: number
  minPriceSol: number
  maxPriceSol: number
  /** Most recent awarded price first, capped to a short recent window. */
  recentPricesSol: number[]
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function clearingPrices(runs: RunRecord[]): ServiceClearingPrices[] {
  const byService = new Map<string, { priceSol: number; updatedAt: string }[]>()
  for (const run of runs) {
    const service = run.want?.service
    const winner = run.award?.to
    if (!service || !winner) continue
    const bid = run.bids.find((b) => b.by === winner)
    if (!bid) continue
    const list = byService.get(service) ?? []
    list.push({ priceSol: bid.priceSol, updatedAt: run.updatedAt })
    byService.set(service, list)
  }

  return [...byService.entries()].map(([service, entries]) => {
    const recent = [...entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const prices = recent.map((e) => e.priceSol)
    return {
      service,
      n: prices.length,
      medianPriceSol: median(prices),
      minPriceSol: Math.min(...prices),
      maxPriceSol: Math.max(...prices),
      recentPricesSol: prices.slice(0, 5),
    }
  })
}

/** One line per service: "txline: median 0.00055 SOL (12 awarded, range 0.00045-0.00085)". */
export function formatClearingPrices(prices: ServiceClearingPrices[]): string {
  return prices
    .map((p) => `${p.service}: median ${p.medianPriceSol} SOL (${p.n} awarded, range ${p.minPriceSol}-${p.maxPriceSol})`)
    .join('\n')
}
