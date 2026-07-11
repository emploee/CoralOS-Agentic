/**
 * LLM bidding - the seller's brain in the marketplace (moved here from coral-agents/seller-agent so
 * every harness adapter shares the same code-enforced economics).
 *
 * On a WANT, the seller runs a bounded tool-calling loop (`runToolLoop`) to decide whether to bid
 * and at what price, given its persona and cost floor. The model PROPOSES through tools; this code
 * ENFORCES the economics regardless of what the loop reports, mirroring llm_buyer.ts:
 *   - never bid on a service it doesn't carry
 *   - never below its cost floor, never above the buyer's budget
 *   - if the floor exceeds the budget, sit the round out
 * A prompt injection inside a WANT therefore can't make the seller bid at a loss. When
 * `cfg.reviewEnabled` is set, a second, independently-prompted loop (`reviewBid`) can veto a
 * proposed bid before it's posted - see bid-review.ts.
 */
import {
  complete, llmRuntimeInfo, sha256Hex, runToolLoop, BudgetGuard, StepCounter, grantCapabilities,
  type LlmUse, type Want, type CompleteOpts,
} from '@pay/agent-runtime'
import type { SellerConfig, BidDecision } from './types.js'
import { clampPriceTool, submitBidDecisionTool, type SubmitBidInput } from './bid-tools.js'
import { reviewBid } from './bid-review.js'

/** Build a seller's market config from its env (set per persona in coral-agent.toml). */
export function sellerConfigFromEnv(name: string, env: NodeJS.ProcessEnv = process.env): SellerConfig {
  return {
    name,
    services: (env.SERVICES ?? 'txline').split(',').map((s) => s.trim()).filter(Boolean),
    floorSol: Number(env.FLOOR_SOL ?? '0.0003'),
    persona: env.PERSONA ?? 'a TxODDS specialist selling verified fair-line reads',
    reviewEnabled: (env.BID_REVIEW_ENABLED ?? '0') === '1',
  }
}

type Llm = (opts: CompleteOpts) => Promise<string>
const QUOTE_GUARDRAIL = 'service allowlist plus floor/budget price clamp via a bounded tool loop'

function quoteLlm(
  want: Want,
  cfg: SellerConfig,
  status: LlmUse['status'],
  reason: string,
  audit: Pick<LlmUse, 'inputHash' | 'outputHash'> = {},
): LlmUse {
  const info = status === 'skipped' ? undefined : llmRuntimeInfo({ maxTokens: 120 })
  return {
    round: want.round,
    agent: cfg.name,
    purpose: 'seller_quote',
    status,
    ...(info ? { provider: info.provider, model: info.model } : {}),
    usedFor: 'seller_quote',
    affectedFunds: false,
    ...audit,
    reason,
    guardrail: QUOTE_GUARDRAIL,
    createdAt: new Date().toISOString(),
  }
}

const errReason = (e: unknown): string => String((e as Error).message ?? e).slice(0, 120)

/** Decide whether/how to bid. `llm` is injectable so tests run without the network. */
export async function decideBid(want: Want, cfg: SellerConfig, llm: Llm = complete): Promise<BidDecision> {
  // Hard guards first - no LLM call needed to refuse impossible jobs.
  if (!cfg.services.includes(want.service)) {
    return { bid: false, priceSol: 0, note: 'not in inventory', llm: quoteLlm(want, cfg, 'skipped', 'service not in seller inventory') }
  }
  if (cfg.floorSol > want.budgetSol) {
    return { bid: false, priceSol: 0, note: 'budget below floor', llm: quoteLlm(want, cfg, 'skipped', 'budget below seller floor') }
  }

  const system =
    `You are ${cfg.name}, ${cfg.persona}. You sell Solana data services. Decide whether to bid on a ` +
    `request and at what price in SOL. Your cost floor is ${cfg.floorSol} SOL - never propose below it; ` +
    `the buyer's budget caps the price. Call clamp_price with your proposed price before submitting, ` +
    `then call submit_bid_decision with {"bid": boolean, "priceSol": number, "note": string}. If you ` +
    `decline, call submit_bid_decision with {"bid": false, "priceSol": 0, "note": string}. Keep note ` +
    `under 8 words.`
  const initialPrompt = `service=${want.service} arg=${want.arg} budget=${want.budgetSol} floor=${cfg.floorSol}`
  const inputHash = sha256Hex(`${system}\n${initialPrompt}`)

  let finalInput: SubmitBidInput | undefined
  let outputHash: string | undefined
  let llmUse: LlmUse | undefined
  try {
    const outcome = await runToolLoop(
      {
        agentId: cfg.name,
        system,
        initialPrompt,
        tools: [clampPriceTool(cfg.floorSol, want.budgetSol), submitBidDecisionTool],
        finalToolName: 'submit_bid_decision',
        maxRounds: 4,
        // No lamports move during a bid decision — only escrow deposit does — so the spend cap
        // is never meant to bind here; a literal 0 would make BudgetGuard.check() throw on the
        // very first round (0 >= 0), so it's left effectively unlimited.
        budget: new BudgetGuard({ maxToolCalls: 8, maxSpendLamports: Number.MAX_SAFE_INTEGER, maxDurationSecs: 30 }),
        steps: new StepCounter(4),
        grant: grantCapabilities(cfg.name, ['bid']),
        maxTokens: 150,
      },
      llm,
    )
    finalInput = outcome.finalInput as SubmitBidInput | undefined
    if (finalInput) outputHash = sha256Hex(JSON.stringify(finalInput))

    if (!finalInput) {
      llmUse = quoteLlm(want, cfg, 'fallback', 'model exhausted rounds without deciding', { inputHash })
    } else if (finalInput.bid === false) {
      return {
        bid: false,
        priceSol: 0,
        note: (finalInput.note ?? 'declined').slice(0, 60),
        llm: quoteLlm(want, cfg, 'used', 'model declined to bid', { inputHash, outputHash }),
      }
    } else {
      llmUse = quoteLlm(want, cfg, 'used', 'model proposed bid terms via tool loop', { inputHash, outputHash })
    }
  } catch (e) {
    llmUse = quoteLlm(want, cfg, 'fallback', `LLM unavailable: ${errReason(e)}`, { inputHash })
    // LLM unavailable -> deterministic fallback below (bid at floor).
  }

  // Enforce the economics regardless of what the loop reported: clamp the price into [floor, budget].
  const priceSol = Math.min(want.budgetSol, Math.max(cfg.floorSol, finalInput?.priceSol ?? cfg.floorSol))
  const note = finalInput?.note?.slice(0, 60) || 'available'

  if (cfg.reviewEnabled) {
    const review = await reviewBid(want, { bid: true, priceSol, note }, cfg, llm)
    if (!review.approve) {
      return {
        bid: false,
        priceSol: 0,
        note: `reviewer flagged: ${(review.concern ?? 'unspecified').slice(0, 40)}`,
        llm: quoteLlm(want, cfg, 'used', 'reviewer vetoed proposed bid', { inputHash, outputHash }),
      }
    }
  }

  return { bid: true, priceSol, note, ...(llmUse ? { llm: llmUse } : {}) }
}
