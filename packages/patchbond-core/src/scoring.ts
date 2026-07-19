import type { PatchTask, ScoredBid, SolverBid } from './types.js'

const clamp = (value: number): number => Math.max(0, Math.min(100, value))
const round = (value: number): number => Math.round(value * 10) / 10

/** Quality-aware procurement score. Lowest price alone cannot win the auction. */
export function scoreBid(task: PatchTask, bid: SolverBid): ScoredBid {
  const price = bid.priceSol <= task.budgetSol
    ? clamp(100 * (1 - bid.priceSol / task.budgetSol))
    : 0
  const deadlineFit = bid.etaSeconds <= task.deadlineSeconds
    ? clamp(100 * (1 - bid.etaSeconds / (task.deadlineSeconds * 2)))
    : 0
  const breakdown = {
    price: round(price),
    reputation: round(clamp(bid.reputation)),
    successRate: round(clamp(bid.successRate)),
    specialization: round(clamp(bid.specialization)),
    deadlineFit: round(deadlineFit),
  }
  const score = round(
    breakdown.price * 0.10 +
    breakdown.reputation * 0.30 +
    breakdown.successRate * 0.20 +
    breakdown.specialization * 0.25 +
    breakdown.deadlineFit * 0.15,
  )
  return { ...bid, score, breakdown }
}

export function rankBids(task: PatchTask, bids: SolverBid[]): ScoredBid[] {
  return bids
    .filter((bid) => Number.isFinite(bid.priceSol) && bid.priceSol > 0 && bid.priceSol <= task.budgetSol)
    .map((bid) => scoreBid(task, bid))
    .sort((a, b) => b.score - a.score || a.priceSol - b.priceSol || a.seller.localeCompare(b.seller))
}

export function awardReason(winner: ScoredBid, runnerUp?: ScoredBid): string {
  const comparison = runnerUp ? `, ${round(winner.score - runnerUp.score)} points ahead of ${runnerUp.seller}` : ''
  return `${winner.seller} won on verified value: score ${winner.score}${comparison}; ` +
    `reputation ${winner.reputation}, specialization ${winner.specialization}, ETA ${winner.etaSeconds}s`
}
