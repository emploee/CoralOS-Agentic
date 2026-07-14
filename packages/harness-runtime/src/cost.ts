/**
 * A seller's price floor, derived from what a service actually costs to deliver - not one typed-in
 * number shared across every service the seller carries. A deterministic (cache-hit) service keeps
 * the persona's base `floorSol`; a service listed in `SellerConfig.llmDeliveryTokens` adds the real
 * estimated cost of the LLM call the delivery code will actually make, so a heavier service prices
 * structurally higher than a cheap one - the same way it costs the seller more to deliver it. Shared
 * by quote.ts (the enforced floor) and bid-review.ts (the reviewer's notion of "at or below cost"),
 * so both agree on what "cost" means for a given WANT.
 */
import { llmRuntimeInfo, estimateLlmCostSol, type Want } from '@pay/agent-runtime'
import type { SellerConfig } from './types.js'

export function deriveFloorSol(want: Want, cfg: SellerConfig): number {
  const tokens = cfg.llmDeliveryTokens?.[want.service]
  if (!tokens) return cfg.floorSol
  const info = llmRuntimeInfo({ maxTokens: tokens })
  return cfg.floorSol + estimateLlmCostSol(info.provider, info.model, info.maxTokens)
}
