/**
 * Buyer award selection — deterministic best-value pick over the collected BID pool.
 *
 * Blends price (60%) against seller track record (40%, a neutral 50 for a newcomer with no
 * history) into a 0-100 value score per bid; the highest score wins, ties broken by price. A cheap
 * seller that fails verification or no-shows is not a bargain — see reputation.ts's
 * `fetchReputation`.
 */
import type { Bid, Want } from '@pay/agent-runtime'
import { DISCOUNT_TASK, awardReason, rankBids } from '@patchbond/core'
import { fetchReputation } from '../reputation/reputation.js'

/** No history yet - don't penalize a newcomer to zero. */
const NEUTRAL_REP_SCORE = 50

function valueScore(bid: Bid, budgetSol: number, repScore: number): number {
  const withinBudget = bid.priceSol <= budgetSol
  const priceScore = withinBudget ? 100 - Math.min(1, bid.priceSol / budgetSol) * 100 : 0
  return Math.round(0.6 * priceScore + 0.4 * repScore)
}

/** Parse PatchBond capability claims carried in a BID note. Missing values remain neutral. */
function patchProfile(bid: Bid) {
  const values = new Map<string, number>()
  for (const match of bid.note?.matchAll(/(eta|rep|success|spec)=(\d+(?:\.\d+)?)/g) ?? []) {
    values.set(match[1], Number(match[2]))
  }
  return {
    seller: bid.by,
    priceSol: bid.priceSol,
    etaSeconds: values.get('eta') ?? 120,
    reputation: values.get('rep') ?? NEUTRAL_REP_SCORE,
    successRate: values.get('success') ?? NEUTRAL_REP_SCORE,
    specialization: values.get('spec') ?? NEUTRAL_REP_SCORE,
  }
}

/** Best-value selection: price weighed against track record. Deterministic. */
export async function pickWinner(
  want: Want, pool: Bid[], buyerName: string, reputationUrl?: string, doFetch: typeof fetch = fetch,
): Promise<{ winner: Bid; reason: string }> {
  if (want.service === 'patchbond') {
    const ranked = rankBids({ ...DISCOUNT_TASK, budgetSol: want.budgetSol }, pool.map(patchProfile))
    const best = ranked[0]
    if (!best) throw new Error('no eligible PatchBond bids')
    const winner = pool.find((bid) => bid.by === best.seller)
    if (!winner) throw new Error('winning PatchBond bid disappeared')
    const reason = awardReason(best, ranked[1])
    console.error(`[${buyerName}] ${reason}`)
    return { winner, reason }
  }
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
