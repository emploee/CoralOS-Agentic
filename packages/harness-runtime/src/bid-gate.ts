/**
 * Whether to bid at all - a strategic gate the seller runs before decideBid's pricing loop, on top
 * of (not instead of) its capability/floor guards. Lives in harness-runtime, not seller-agent,
 * because every HarnessAdapter.quote() implementation (node-llm, claude-code, cli) already funnels
 * through decideBid() - putting the gate here means it protects every harness automatically, the
 * same reason bid pricing itself lives here (see quote.ts's docblock).
 *
 * Fails open (bid: true) on any LLM/fetch failure, or when no reputation source is configured at
 * all - a gate that's unavailable should never be the reason a healthy seller sits out a round, same
 * philosophy as bid-review.ts's reviewer.
 */
import { complete, runToolLoop, BudgetGuard, StepCounter, type Want, type CompleteOpts, type SellerReputation, type Tool } from '@pay/agent-runtime'
import type { SellerConfig } from './types.js'

type Llm = (opts: CompleteOpts) => Promise<string>

export interface BidGateDecision {
  bid: boolean
  reason: string
}

interface FetchOwnReputationOutput {
  found: boolean
  awarded?: number
  delivered?: number
  verifiedPass?: number
  verifiedFail?: number
  score?: number
}

function fetchOwnReputationTool(cfg: SellerConfig, doFetch: typeof fetch): Tool<Record<string, never>, FetchOwnReputationOutput> {
  return {
    name: 'fetch_own_reputation',
    description: "Fetch this seller's own track record from the run ledger (wins, deliveries, verification history).",
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

interface SubmitBidGateInput {
  bid: boolean
  reason: string
}

const submitBidGateTool: Tool<SubmitBidGateInput, SubmitBidGateInput> = {
  name: 'submit_bid_gate',
  description: 'Submit the bid-gate decision: {bid, reason}. Ends the loop.',
  async execute(input) {
    return input
  },
}

/** Decide whether to bid at all, strategically. `llm` is injectable so tests run without the network. */
export async function decideBidGate(
  want: Want, cfg: SellerConfig, llm: Llm = complete, doFetch: typeof fetch = fetch,
): Promise<BidGateDecision> {
  if (!cfg.reputationUrl) return { bid: true, reason: 'no reputation source configured' }

  const system =
    `You are ${cfg.name}, deciding whether to bid on a request at all - not the price yet, just ` +
    `whether it's worth pursuing given your own track record. Call fetch_own_reputation, then ` +
    `submit_bid_gate with {"bid": boolean, "reason": string}. Only decline for a real reason (a poor ` +
    `record, an overloaded queue); when in doubt, bid. Keep reason under 8 words.`
  const initialPrompt = `service=${want.service} arg=${want.arg} budget=${want.budgetSol}`

  try {
    const outcome = await runToolLoop(
      {
        agentId: cfg.name,
        system,
        initialPrompt,
        tools: [fetchOwnReputationTool(cfg, doFetch), submitBidGateTool],
        finalToolName: 'submit_bid_gate',
        maxRounds: 3,
        // No lamports move during a bid-gate decision — see the matching note in quote.ts's decideBid.
        budget: new BudgetGuard({ maxToolCalls: 4, maxSpendLamports: Number.MAX_SAFE_INTEGER, maxDurationSecs: 20 }),
        steps: new StepCounter(3),
        maxTokens: 100,
      },
      llm,
    )
    const finalInput = outcome.finalInput as SubmitBidGateInput | undefined
    if (!finalInput) return { bid: true, reason: 'gate loop exhausted rounds; bidding by default' }
    return { bid: finalInput.bid, reason: finalInput.reason }
  } catch {
    return { bid: true, reason: 'bid-gate unavailable; bidding by default' }
  }
}
