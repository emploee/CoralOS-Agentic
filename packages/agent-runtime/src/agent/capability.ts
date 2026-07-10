/**
 * Capability grants — an explicit, auditable token for "this agent process may do X".
 *
 * The reference architecture this ports (a Rust agent-core crate) uses compile-time zero-sized
 * capability tokens so the compiler proves a seller can never call a buyer-only tool. TypeScript
 * has no equivalent static guarantee (no sealed traits, no monomorphization), so this is the
 * honest runtime analogue: a capability is granted once at process startup from config/env — never
 * fabricated from model output or a Coral message — and every capability-gated action takes the
 * grant as an explicit argument. The discipline matches `policy.enforce()` (../policy/policy.ts):
 * one place to see what an agent may do, one place to test hostile cases against. It is a runtime
 * check, not a compile-time proof.
 */

/** What an agent process is allowed to do. Extend this list, don't stringly-type new capabilities. */
export type Capability =
  | 'bid' // may respond to a WANT with a BID
  | 'deliver' // may produce a DELIVERED payload against a funded escrow
  | 'verify' // may issue a VERIFIED verdict
  | 'settle' // may release/refund escrow funds
  | 'detect' // may emit signal/observation records — no funds, no verdicts

export interface CapabilityGrant {
  readonly agentId: string
  readonly capabilities: ReadonlySet<Capability>
  readonly grantedAt: string
}

/** Grant capabilities to an agent at startup. Never call this from inside a message handler. */
export function grantCapabilities(agentId: string, capabilities: Capability[]): CapabilityGrant {
  return { agentId, capabilities: new Set(capabilities), grantedAt: new Date().toISOString() }
}

export function hasCapability(grant: CapabilityGrant | undefined, capability: Capability): boolean {
  return grant?.capabilities.has(capability) ?? false
}

/** Throws if `grant` lacks `capability` — the call-site guard for a capability-gated action. */
export function requireCapability(grant: CapabilityGrant | undefined, capability: Capability): void {
  if (!hasCapability(grant, capability)) {
    throw new Error(`capability denied: ${grant?.agentId ?? 'no grant'} lacks '${capability}'`)
  }
}
