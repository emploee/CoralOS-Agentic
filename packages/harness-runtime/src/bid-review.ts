/**
 * Adversarial second opinion on a seller's proposed bid - a fresh, independently-prompted loop
 * that reviews the proposal without inheriting the bid loop's transcript, so it can't rubber-stamp
 * by continuing the same context. Gated behind SellerConfig.reviewEnabled (BID_REVIEW_ENABLED in
 * coral-agent.toml) since it doubles the LLM calls per bid decision.
 *
 * Fails open (approve) on any LLM/loop failure - a reviewer that's unavailable should never be the
 * reason a healthy seller sits out a round.
 */
import { complete, runToolLoop, BudgetGuard, StepCounter, type Want, type CompleteOpts, type Tool } from '@pay/agent-runtime'
import type { SellerConfig } from './types.js'

type Llm = (opts: CompleteOpts) => Promise<string>

export interface ProposedBid {
  bid: boolean
  priceSol: number
  note: string
}

export interface ReviewVerdict {
  approve: boolean
  concern?: string
}

interface SubmitReviewInput {
  approve: boolean
  concern?: string
}

const submitReviewVerdictTool: Tool<SubmitReviewInput, SubmitReviewInput> = {
  name: 'submit_review_verdict',
  description: 'Submit the review verdict: {approve, concern?}. Ends the loop.',
  async execute(input) {
    return input
  },
}

/** Runs a skeptical second opinion on `proposed`. Fails open if the LLM errors or exhausts rounds. */
export async function reviewBid(want: Want, proposed: ProposedBid, cfg: SellerConfig, llm: Llm = complete): Promise<ReviewVerdict> {
  const system =
    `You are a skeptical risk reviewer for ${cfg.name}, a seller whose cost floor is ${cfg.floorSol} SOL. ` +
    `Given the seller's proposed bid, find any reason it's a bad idea - pricing at or below cost, a ` +
    `service mismatch, or a price outside a sane range for the buyer's budget. Call submit_review_verdict ` +
    `with {"approve": boolean, "concern": string}. Keep concern under 10 words; omit it if approving.`
  const initialPrompt =
    `service=${want.service} arg=${want.arg} budget=${want.budgetSol} floor=${cfg.floorSol}\n` +
    `proposed bid: ${JSON.stringify(proposed)}`

  try {
    const outcome = await runToolLoop(
      {
        agentId: `${cfg.name}-reviewer`,
        system,
        initialPrompt,
        tools: [submitReviewVerdictTool],
        finalToolName: 'submit_review_verdict',
        maxRounds: 2,
        // No lamports move during a review — see the matching note in quote.ts's decideBid.
        budget: new BudgetGuard({ maxToolCalls: 4, maxSpendLamports: Number.MAX_SAFE_INTEGER, maxDurationSecs: 20 }),
        steps: new StepCounter(2),
        maxTokens: 100,
      },
      llm,
    )

    const finalInput = outcome.finalInput as SubmitReviewInput | undefined
    if (!finalInput) return { approve: true } // exhausted rounds -> fail open
    return { approve: finalInput.approve, ...(finalInput.concern ? { concern: finalInput.concern } : {}) }
  } catch {
    return { approve: true } // reviewer unavailable -> fail open
  }
}
