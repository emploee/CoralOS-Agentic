/**
 * Buyer award selection — deterministic best-value pick over the collected BID pool.
 *
 * Blends price (60%) against seller track record (40%, a neutral 50 for a newcomer with no
 * history) into a 0-100 value score per bid; the highest score wins, ties broken by price. A cheap
 * seller that fails verification or no-shows is not a bargain — see reputation.ts's
 * `fetchReputation`.
 */
import type { Bid, Want } from '@pay/agent-runtime'
import { fetchReputation } from '../reputation/reputation.js'

/** No history yet - don't penalize a newcomer to zero. */
const NEUTRAL_REP_SCORE = 50

function valueScore(bid: Bid, budgetSol: number, repScore: number): number {
  const withinBudget = bid.priceSol <= budgetSol
  const priceScore = withinBudget ? 100 - Math.min(1, bid.priceSol / budgetSol) * 100 : 0
  return Math.round(0.6 * priceScore + 0.4 * repScore)
}

/** Best-value selection: price weighed against track record. Deterministic. */
export async function pickWinner(
  want: Want, pool: Bid[], buyerName: string, reputationUrl?: string, doFetch: typeof fetch = fetch,
): Promise<{ winner: Bid; reason: string }> {
  if (pool.length === 1) {
    return { winner: pool[0], reason: 'single bid; no selection needed' }
  }

  const reputation = (reputationUrl && (await fetchReputation(reputationUrl, doFetch))) || []
  const scored = pool
    .map((bid) => ({
      bid,
      score: valueScore(bid, want.budgetSol, reputation.find((r) => r.seller === bid.by)?.score ?? NEUTRAL_REP_SCORE),
    }))
    .sort((a, b) => b.score - a.score || a.bid.priceSol - b.bid.priceSol)
  const best = scored[0]

  console.error(`[${buyerName}] picked ${best.bid.by} (${best.bid.priceSol} SOL): value score ${best.score}`)
  return { winner: best.bid, reason: `best value (score ${best.score})` }
}
