/**
 * LLM bidding - the seller's brain in the marketplace (moved here from coral-agents/seller-agent so
 * every harness adapter shares the same code-enforced economics).
 *
 * On a WANT, the seller runs ONE bounded tool-calling loop (`runToolLoop`) to decide whether to bid
 * and at what price, given its persona, a cost-derived floor (see cost.ts), and - when
 * `cfg.reputationUrl` is set - its own track record and what the service has actually cleared for
 * recently. Whether-to-bid and at-what-price used to be two separate LLM round-trips (a gate loop,
 * then a pricing loop); they're the same seller reasoning sequentially with no adversarial-isolation
 * reason to keep them apart, unlike reviewBid below, so they're one call now - fetch_own_reputation
 * and fetch_clearing_prices are both just tools available in the same loop, and declining is simply
 * submit_bid_decision with {"bid": false}. The model PROPOSES through tools; this code ENFORCES the
 * economics regardless of what the loop reports, mirroring llm_buyer.ts:
 *   - never bid on a service it doesn't carry
 *   - never below its (derived) cost floor, never above the buyer's budget
 *   - if the floor exceeds the budget, sit the round out
 * A prompt injection inside a WANT therefore can't make the seller bid at a loss. When
 * `cfg.reviewEnabled` is set, a second, independently-prompted loop (`reviewBid`) can veto a
 * proposed bid before it's posted - see bid-review.ts. That one DOES stay separate: its whole point
 * is judging the first loop's output with no access to its transcript, which requires isolation.
 */
import {
  complete, llmRuntimeInfo, sha256Hex, runToolLoop, BudgetGuard, StepCounter, grantCapabilities,
  type LlmUse, type Want, type CompleteOpts,
} from '@pay/agent-runtime'
import type { SellerConfig, BidDecision } from './types.js'
import { clampPriceTool, submitBidDecisionTool, fetchClearingPricesTool, fetchOwnReputationTool, type SubmitBidInput } from './bid-tools.js'
import { reviewBid } from './bid-review.js'
import { deriveFloorSol } from './cost.js'

/**
 * Build a seller's market config from its env (set per persona in coral-agent.toml). This package is
 * stream-agnostic core plumbing - every fork's seller calls this unmodified, so its fallbacks must
 * never assume a particular example (TxLINE, or any other stream). An unset SERVICES defaults to no
 * inventory (decideBid declines everything with 'not in inventory' - a loud, safe no-op) rather than
 * a specific example's service name, which would let a misconfigured seller silently claim to sell
 * something its own deliverService() was never told to handle.
 */
export function sellerConfigFromEnv(name: string, env: NodeJS.ProcessEnv = process.env): SellerConfig {
  const strategy = (env.STRATEGY ?? '').toLowerCase()
  const llmDeliveryTokens = parseLlmDeliveryTokens(env.LLM_DELIVERY_TOKENS)
  return {
    name,
    services: (env.SERVICES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    floorSol: Number(env.FLOOR_SOL ?? '0.0003'),
    persona: env.PERSONA ?? 'a specialist selling verified data',
    ...(strategy === 'undercut' || strategy === 'premium' || strategy === 'balanced' ? { strategy } : {}),
    ...(llmDeliveryTokens ? { llmDeliveryTokens } : {}),
    reviewEnabled: (env.BID_REVIEW_ENABLED ?? '0') === '1',
    reputationUrl: env.REPUTATION_URL || undefined,
  }
}

/** `LLM_DELIVERY_TOKENS='{"txline":180}'` - which services this seller's delivery code calls
 *  an LLM for, and the max_tokens budget that call uses. See SellerConfig.llmDeliveryTokens. */
function parseLlmDeliveryTokens(raw?: string): Record<string, number> | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const entries = Object.entries(parsed).filter((e): e is [string, number] => Number.isFinite(e[1]))
    return entries.length ? Object.fromEntries(entries) : undefined
  } catch {
    return undefined
  }
}

const STRATEGY_GUIDANCE: Record<'undercut' | 'premium' | 'balanced', string> = {
  undercut: 'Your strategy is to win volume: price at or just below the recent median clearing price, never above it unless nothing has cleared yet.',
  premium: 'Your strategy is to win on quality over volume: price near the top of the recent range (or near budget) when clearing data supports it.',
  balanced: 'Your strategy is to track the market: price near the recent median clearing price for this service.',
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

/** Decide whether/how to bid. `llm`/`doFetch` are injectable so tests run without the network. */
export async function decideBid(
  want: Want, cfg: SellerConfig, llm: Llm = complete, doFetch: typeof fetch = fetch,
): Promise<BidDecision> {
  // Hard guards first - no LLM call needed to refuse impossible jobs.
  if (!cfg.services.includes(want.service)) {
    return { bid: false, priceSol: 0, note: 'not in inventory', llm: quoteLlm(want, cfg, 'skipped', 'service not in seller inventory') }
  }
  const floorSol = deriveFloorSol(want, cfg)
  if (floorSol > want.budgetSol) {
    return { bid: false, priceSol: 0, note: 'budget below floor', llm: quoteLlm(want, cfg, 'skipped', 'budget below seller floor') }
  }

  // Reputation-aware tools (own track record, market clearing prices) are only offered when
  // cfg.reputationUrl is configured - otherwise the loop is exactly what it was before either existed.
  const reputationAware = Boolean(cfg.reputationUrl)
  const system =
    `You are ${cfg.name}, ${cfg.persona}. You sell Solana data services. Decide whether to bid on a ` +
    `request and at what price in SOL. Your cost floor is ${floorSol} SOL - never propose below it; ` +
    `the buyer's budget caps the price. ` +
    (reputationAware
      ? `Call fetch_own_reputation to see if this round is worth pursuing given your own track record, ` +
        `and fetch_clearing_prices to see what this service has actually cleared for recently - don't ` +
        `guess blind between floor and budget. ${STRATEGY_GUIDANCE[cfg.strategy ?? 'balanced']} `
      : '') +
    `Call clamp_price with your proposed price before submitting, ` +
    `then call submit_bid_decision with {"bid": boolean, "priceSol": number, "note": string}. If you ` +
    `decline (whether on price grounds or your own track record), call submit_bid_decision with ` +
    `{"bid": false, "priceSol": 0, "note": string}. note is a short reason a buyer would find useful ` +
    `(e.g. "priced at recent clearing median" or "cost floor too high for this budget") - never just ` +
    `repeat the service name. Keep it under 14 words.`
  const initialPrompt = `service=${want.service} arg=${want.arg} budget=${want.budgetSol} floor=${floorSol}`
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
        tools: [
          ...(reputationAware ? [fetchOwnReputationTool(cfg, doFetch), fetchClearingPricesTool(want, cfg, doFetch)] : []),
          clampPriceTool(floorSol, want.budgetSol),
          submitBidDecisionTool,
        ],
        finalToolName: 'submit_bid_decision',
        // Headroom for up to 4 tool calls when reputation-aware (fetch_own_reputation,
        // fetch_clearing_prices, clamp_price, submit_bid_decision).
        maxRounds: reputationAware ? 6 : 4,
        // No lamports move during a bid decision — only escrow deposit does — so the spend cap
        // is never meant to bind here; a literal 0 would make BudgetGuard.check() throw on the
        // very first round (0 >= 0), so it's left effectively unlimited.
        budget: new BudgetGuard({ maxToolCalls: 8, maxSpendLamports: Number.MAX_SAFE_INTEGER, maxDurationSecs: 30 }),
        steps: new StepCounter(reputationAware ? 6 : 4),
        grant: grantCapabilities(cfg.name, ['bid']),
        maxTokens: 150,
      },
      llm,
    )
    finalInput = outcome.finalInput as SubmitBidInput | undefined
    if (finalInput) outputHash = sha256Hex(JSON.stringify(finalInput))

    if (!finalInput) {
      llmUse = quoteLlm(want, cfg, 'fallback', 'ran out of tool-loop steps before deciding — bid at cost floor instead', { inputHash })
    } else if (finalInput.bid === false) {
      const note = (finalInput.note ?? 'declined').slice(0, 60)
      return {
        bid: false,
        priceSol: 0,
        note,
        // Thread the model's own reason through, not a generic status string - this is what a
        // viewer actually wants to read in the feed's reasoning strip.
        llm: quoteLlm(want, cfg, 'used', note, { inputHash, outputHash }),
      }
    } else {
      llmUse = quoteLlm(want, cfg, 'used', finalInput.note || 'model proposed bid terms via tool loop', { inputHash, outputHash })
    }
  } catch (e) {
    llmUse = quoteLlm(want, cfg, 'fallback', `LLM unavailable: ${errReason(e)}`, { inputHash })
    // LLM unavailable -> deterministic fallback below (bid at floor).
  }

  // Enforce the economics regardless of what the loop reported: clamp the price into [floor, budget].
  const priceSol = Math.min(want.budgetSol, Math.max(floorSol, finalInput?.priceSol ?? floorSol))
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
