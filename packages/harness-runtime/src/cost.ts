/**
 * A seller's price floor — the persona's base `floorSol`. Kept as its own function (rather than
 * reading `cfg.floorSol` directly at call sites) so pricing logic has one place to derive "cost
 * from" if a future fork wants to price a service structurally higher than another.
 */
import type { Want } from '@pay/agent-runtime'
import type { SellerConfig } from './types.js'

export function deriveFloorSol(_want: Want, cfg: SellerConfig): number {
  return cfg.floorSol
}
