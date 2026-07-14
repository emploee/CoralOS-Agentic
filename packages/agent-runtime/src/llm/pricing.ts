/**
 * Rough LLM cost-per-token pricing, so a seller's price floor for an LLM-backed service can be
 * DERIVED from what the call actually costs, not typed in as an arbitrary constant per persona.
 * Figures are approximate public per-output-token list prices (USD per 1M tokens) - good enough to
 * make a heavier LLM call price higher than a lighter one, or a cache-hit service price near zero;
 * not billing-accurate, and never used for anything but this proportional floor surcharge.
 */
import type { LlmProvider } from './complete.js'

const USD_PER_MILLION_OUTPUT_TOKENS: Record<LlmProvider, Record<string, number> & { default: number }> = {
  anthropic: { default: 5, 'claude-haiku-4-5-20251001': 5 },
  openai: { default: 0.6, 'gpt-4o-mini': 0.6 },
  venice: { default: 0.7, 'llama-3.3-70b': 0.7 },
  // Groq's free tier is what a devnet kit actually runs on (see LLM.md) - this is their published
  // pay-as-you-go rate, used only so a heavier Groq-backed call still derives a proportionally
  // higher floor than a lighter one; nobody using the free tier is actually billed this.
  groq: { default: 0.79, 'llama-3.3-70b-versatile': 0.79 },
}

/**
 * A devnet-illustrative USD->SOL rate, not a live price feed - this kit never moves real value (see
 * CLAUDE.md), so the constant only needs to make a derived surcharge visible against the kit's
 * existing 0.0003-0.001 SOL floor range, not track SOL's actual market price. Override via env.
 */
const DEFAULT_SOL_USD_RATE = 25

function solUsdRate(): number {
  const rate = Number(process.env.SOL_USD_RATE)
  return Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_SOL_USD_RATE
}

/** Estimated SOL cost of one LLM call at `maxTokens`, from the provider/model's real per-token price. */
export function estimateLlmCostSol(provider: LlmProvider, model: string, maxTokens: number): number {
  const table = USD_PER_MILLION_OUTPUT_TOKENS[provider]
  const usdPerMillion = table[model] ?? table.default
  const usd = (maxTokens / 1_000_000) * usdPerMillion
  return usd / solUsdRate()
}
