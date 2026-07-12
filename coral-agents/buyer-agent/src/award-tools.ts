/**
 * Tools for the buyer's bounded award-selection loop (see award.ts's pickWinner). Reputation is
 * fetched once before the loop starts and closed over here, so compute_value_score stays a pure
 * function of its input rather than doing a live fetch per tool call.
 */
import type { SellerReputation, Tool } from '@pay/agent-runtime'

export interface FetchSellerReputationOutput {
  available: boolean
  reputation: SellerReputation[]
}

export function fetchSellerReputationTool(reputation: SellerReputation[]): Tool<Record<string, never>, FetchSellerReputationOutput> {
  return {
    name: 'fetch_seller_reputation',
    description: "Fetch each bidding seller's track record from the run ledger (score, wins, verification history).",
    async execute() {
      return { available: reputation.length > 0, reputation }
    },
  }
}

export interface ComputeValueScoreInput {
  by: string
  priceSol: number
}

export interface ComputeValueScoreOutput {
  by: string
  priceSol: number
  valueScore: number
  repScore: number
  withinBudget: boolean
}

/** No history yet - don't penalize a newcomer to zero. */
const NEUTRAL_REP_SCORE = 50

export function computeValueScoreTool(budgetSol: number, reputation: SellerReputation[]): Tool<ComputeValueScoreInput, ComputeValueScoreOutput> {
  return {
    name: 'compute_value_score',
    description: 'Given a seller name and its bid price, returns a deterministic 0-100 value score (price weighed against track record). Call once per bid before deciding.',
    async execute(input) {
      const rep = reputation.find((r) => r.seller === input.by)
      const repScore = rep?.score ?? NEUTRAL_REP_SCORE
      const withinBudget = input.priceSol <= budgetSol
      const priceScore = withinBudget ? 100 - Math.min(1, input.priceSol / budgetSol) * 100 : 0
      const valueScore = Math.round(0.6 * priceScore + 0.4 * repScore)
      return { by: input.by, priceSol: input.priceSol, valueScore, repScore, withinBudget }
    },
  }
}

export interface SubmitAwardInput {
  by: string
  reason: string
}

/** Forced final tool - the loop terminates only when the model calls this. */
export const submitAwardTool: Tool<SubmitAwardInput, SubmitAwardInput> = {
  name: 'submit_award',
  description: 'Submit the final award decision: {by, reason}. Ends the loop.',
  async execute(input) {
    return input
  },
}
