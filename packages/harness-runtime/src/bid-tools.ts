/**
 * Tools for the seller's bounded bid-decision loop (see quote.ts's decideBid). The model proposes
 * through these tools; decideBid still re-clamps the final price afterward regardless of what the
 * model reports - a tool call here is the audit trail's honesty, not the enforcement itself.
 */
import type { Tool } from '@pay/agent-runtime'

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
