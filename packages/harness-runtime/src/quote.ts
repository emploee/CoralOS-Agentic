/**
 * Seller bidding — the seller's brain in the marketplace (moved here from coral-agents/seller-agent
 * so every harness adapter shares the same code-enforced economics).
 *
 * On a WANT, the seller decides whether to bid and at what price from its persona-derived cost
 * floor and — when `cfg.reputationUrl` is set — what the service has actually cleared for
 * recently. Deterministic, not model-driven: the economics are the whole decision, so there's
 * nothing left for a judgment call to add.
 *   - never bid on a service it doesn't carry
 *   - never below its cost floor, never above the buyer's budget
 *   - if the floor exceeds the budget, sit the round out
 */
import type { Want, ServiceClearingPrices } from '@pay/agent-runtime'
import type { SellerConfig, BidDecision } from './types.js'
import { deriveFloorSol } from './cost.js'

/** Build a seller's market config from its env (set per persona in coral-agent.toml). This package is
 *  stream-agnostic core plumbing - every fork's seller calls this unmodified, so its fallbacks must
 *  never assume a particular example (TxLINE, or any other stream). An unset SERVICES defaults to no
 *  inventory (decideBid declines everything with 'not in inventory' - a loud, safe no-op) rather than
 *  a specific example's service name, which would let a misconfigured seller silently claim to sell
 *  something its own deliverService() was never told to handle. */
export function sellerConfigFromEnv(name: string, env: NodeJS.ProcessEnv = process.env): SellerConfig {
  const strategy = (env.STRATEGY ?? '').toLowerCase()
  return {
    name,
    services: (env.SERVICES ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    floorSol: Number(env.FLOOR_SOL ?? '0.0003'),
    persona: env.PERSONA ?? 'a specialist selling verified data',
    ...(strategy === 'undercut' || strategy === 'premium' || strategy === 'balanced' ? { strategy } : {}),
    reputationUrl: env.REPUTATION_URL || undefined,
  }
}

/** Pricing target for one clearing-price stat, per strategy. Always clamped into [floor, budget]
 *  by the caller, so a strategy can propose freely without risking an unsafe bid. */
const STRATEGY_TARGET: Record<'undercut' | 'premium' | 'balanced', (c: ServiceClearingPrices) => number> = {
  // Win volume: price at (a touch below) the recent median, never above it.
  undercut: (c) => c.medianPriceSol * 0.97,
  // Win on quality over volume: price near the top of the recent range.
  premium: (c) => c.maxPriceSol,
  // Track the market: price at the recent median.
  balanced: (c) => c.medianPriceSol,
}

async function fetchClearingPrice(
  want: Want, cfg: SellerConfig, doFetch: typeof fetch,
): Promise<ServiceClearingPrices | undefined> {
  try {
    const res = await doFetch(cfg.reputationUrl!)
    if (!res.ok) return undefined
    const body = (await res.json()) as { clearingPrices?: ServiceClearingPrices[] } | null
    return body?.clearingPrices?.find((p) => p.service === want.service)
  } catch {
    return undefined
  }
}

/** Decide whether/how to bid. `doFetch` is injectable so tests run without the network. */
export async function decideBid(
  want: Want, cfg: SellerConfig, doFetch: typeof fetch = fetch,
): Promise<BidDecision> {
  if (!cfg.services.includes(want.service)) {
    return { bid: false, priceSol: 0, note: 'not in inventory' }
  }
  const floorSol = deriveFloorSol(want, cfg)
  if (floorSol > want.budgetSol) {
    return { bid: false, priceSol: 0, note: 'budget below floor' }
  }

  if (cfg.reputationUrl) {
    const clearing = await fetchClearingPrice(want, cfg, doFetch)
    if (clearing) {
      const target = STRATEGY_TARGET[cfg.strategy ?? 'balanced'](clearing)
      const priceSol = Math.min(want.budgetSol, Math.max(floorSol, target))
      return { bid: true, priceSol, note: `priced near recent clearing (${cfg.strategy ?? 'balanced'})` }
    }
  }

  return { bid: true, priceSol: floorSol, note: 'priced at cost floor' }
}
