/**
 * LLM bidding - the seller's brain in the marketplace (moved here from coral-agents/seller-agent so
 * every harness adapter shares the same code-enforced economics).
 *
 * On a WANT, the seller asks the LLM whether to bid and at what price, given its persona and cost
 * floor. The model PROPOSES; this code ENFORCES the economics, mirroring llm_buyer.ts:
 *   - never bid on a service it doesn't carry
 *   - never below its cost floor, never above the buyer's budget
 *   - if the floor exceeds the budget, sit the round out
 * A prompt injection inside a WANT therefore can't make the seller bid at a loss.
 */
import { complete, llmRuntimeInfo, parseJsonReply, type LlmUse, type Want, type CompleteOpts } from '@pay/agent-runtime'
import type { SellerConfig, BidDecision } from './types.js'

/** Build a seller's market config from its env (set per persona in coral-agent.toml). */
export function sellerConfigFromEnv(name: string, env: NodeJS.ProcessEnv = process.env): SellerConfig {
  return {
    name,
    services: (env.SERVICES ?? 'txline').split(',').map((s) => s.trim()).filter(Boolean),
    floorSol: Number(env.FLOOR_SOL ?? '0.0003'),
    persona: env.PERSONA ?? 'a TxODDS specialist selling verified fair-line reads',
  }
}

type Llm = (opts: CompleteOpts) => Promise<string>
const QUOTE_GUARDRAIL = 'service allowlist plus floor/budget price clamp'

function quoteLlm(want: Want, cfg: SellerConfig, status: LlmUse['status'], reason: string): LlmUse {
  const info = status === 'skipped' ? undefined : llmRuntimeInfo({ maxTokens: 120 })
  return {
    round: want.round,
    agent: cfg.name,
    purpose: 'seller_quote',
    status,
    ...(info ? { provider: info.provider, model: info.model } : {}),
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
    `the buyer's budget caps the price. Reply ONLY with JSON: {"bid": boolean, "price": number, ` +
    `"note": string}. Keep note under 8 words.`
  const user = `service=${want.service} arg=${want.arg} budget=${want.budgetSol} floor=${cfg.floorSol}`

  let proposed: number | undefined
  let note = ''
  let llmUse: LlmUse | undefined
  try {
    const parsed = parseJsonReply<{ bid?: boolean; price?: number; note?: string }>(
      await llm({ system, user, maxTokens: 120 }),
    )
    if (parsed) {
      if (parsed.bid === false) {
        return {
          bid: false,
          priceSol: 0,
          note: (parsed.note ?? 'declined').slice(0, 60),
          llm: quoteLlm(want, cfg, 'used', 'model declined to bid'),
        }
      }
      proposed = typeof parsed.price === 'number' ? parsed.price : undefined
      note = (parsed.note ?? '').slice(0, 60)
      llmUse = quoteLlm(want, cfg, 'used', 'model proposed bid terms')
    } else {
      llmUse = quoteLlm(want, cfg, 'fallback', 'model returned unparseable JSON')
    }
  } catch (e) {
    llmUse = quoteLlm(want, cfg, 'fallback', `LLM unavailable: ${errReason(e)}`)
    // LLM unavailable -> deterministic fallback below (bid at floor).
  }

  // Enforce the economics: clamp the price into [floor, budget].
  const priceSol = Math.min(want.budgetSol, Math.max(cfg.floorSol, proposed ?? cfg.floorSol))
  return { bid: true, priceSol, note: note || 'available', ...(llmUse ? { llm: llmUse } : {}) }
}
