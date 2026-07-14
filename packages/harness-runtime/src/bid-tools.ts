/**
 * Tools for the seller's bounded bid-decision loop (see quote.ts's decideBid). The model proposes
 * through these tools; decideBid still re-clamps the final price afterward regardless of what the
 * model reports - a tool call here is the audit trail's honesty, not the enforcement itself.
 */
import type { Tool, Want, ServiceClearingPrices, SellerReputation } from '@pay/agent-runtime'
import type { SellerConfig } from './types.js'

export interface ClampPriceInput {
  proposedPriceSol: number
}

export interface ClampPriceOutput {
  clampedPriceSol: number
  wasClamped: boolean
  floorSol: number
  budgetSol: number
}

export function clampPriceTool(floorSol: number, budgetSol: number): Tool<ClampPriceInput, ClampPriceOutput> {
  return {
    name: 'clamp_price',
    description: 'Given a proposed price in SOL, returns it clamped into [floor, budget]. Call this before submitting.',
    async execute(input) {
      const clampedPriceSol = Math.min(budgetSol, Math.max(floorSol, input.proposedPriceSol))
      return { clampedPriceSol, wasClamped: clampedPriceSol !== input.proposedPriceSol, floorSol, budgetSol }
    },
  }
}

export interface FetchOwnReputationOutput {
  found: boolean
  awarded?: number
  delivered?: number
  verifiedPass?: number
  verifiedFail?: number
  score?: number
}

/**
 * This seller's own track record from the run ledger (wins, deliveries, verification history), via
 * the feed's `/api/reputation` - lets the model weigh whether a round is worth pursuing at all
 * alongside how to price it, in the same call. Only meaningful when `cfg.reputationUrl` is set;
 * quote.ts omits this tool entirely otherwise.
 */
export function fetchOwnReputationTool(cfg: SellerConfig, doFetch: typeof fetch): Tool<Record<string, never>, FetchOwnReputationOutput> {
  return {
    name: 'fetch_own_reputation',
    description: "Fetch this seller's own track record from the run ledger (wins, deliveries, verification history) - useful for deciding whether this round is worth pursuing at all.",
    async execute() {
      try {
        const res = await doFetch(cfg.reputationUrl!)
        if (!res.ok) return { found: false }
        const body = (await res.json()) as { reputation?: SellerReputation[] } | null
        const rep = body?.reputation?.find((r) => r.seller === cfg.name)
        if (!rep) return { found: false }
        return {
          found: true, awarded: rep.awarded, delivered: rep.delivered,
          verifiedPass: rep.verifiedPass, verifiedFail: rep.verifiedFail, score: rep.score,
        }
      } catch {
        return { found: false }
      }
    },
  }
}

export interface FetchClearingPricesOutput {
  found: boolean
  n?: number
  medianPriceSol?: number
  minPriceSol?: number
  maxPriceSol?: number
  recentPricesSol?: number[]
}

/**
 * What `want.service` has actually cleared for recently, from the run ledger via the feed's
 * `/api/reputation` - the same feed fetch_own_reputation reads, but for pricing instead of the
 * go/no-go decision. Only meaningful when `cfg.reputationUrl` is set; quote.ts omits this tool
 * entirely otherwise.
 */
export function fetchClearingPricesTool(
  want: Want, cfg: SellerConfig, doFetch: typeof fetch,
): Tool<Record<string, never>, FetchClearingPricesOutput> {
  return {
    name: 'fetch_clearing_prices',
    description: "Fetch what this service has actually cleared for recently across all sellers, so pricing isn't a blind guess between floor and budget.",
    async execute() {
      try {
        const res = await doFetch(cfg.reputationUrl!)
        if (!res.ok) return { found: false }
        const body = (await res.json()) as { clearingPrices?: ServiceClearingPrices[] } | null
        const stats = body?.clearingPrices?.find((p) => p.service === want.service)
        if (!stats) return { found: false }
        const { medianPriceSol, minPriceSol, maxPriceSol, recentPricesSol, n } = stats
        return { found: true, n, medianPriceSol, minPriceSol, maxPriceSol, recentPricesSol }
      } catch {
        return { found: false }
      }
    },
  }
}

export interface SubmitBidInput {
  bid: boolean
  priceSol: number
  note: string
}

/** Forced final tool - the loop terminates only when the model calls this. */
export const submitBidDecisionTool: Tool<SubmitBidInput, SubmitBidInput> = {
  name: 'submit_bid_decision',
  description: 'Submit the final bid decision: {bid, priceSol, note}. Ends the loop.',
  capability: 'bid',
  async execute(input) {
    return input
  },
}
