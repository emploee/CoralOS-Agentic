/**
 * Buyer's per-round decision on whether to actually escalate a delivery to the independent
 * verifier, instead of the static VERIFIER_AGENT on/off used every round today. Deterministic - the
 * inputs (reputation counts) don't need a tool loop's judgment to weigh.
 *
 * IMPORTANT constraint: packages/agent-runtime/src/policy/policy.ts's `requireVerifier` is
 * hardcoded to `!!VERIFIER_AGENT`, with no independent "verifier optional" state. So skipping
 * escalation here does NOT safely bypass the release check - it forfeits this round's settlement
 * (funds sit in escrow, refundable after the deadline, same as a verifier timeout). This gate can
 * only ever narrow (never turn verification on when it's off, see the first branch below) and only
 * skips for sellers with an established, clean record - gated behind VERIFY_GATE_ENABLED (default
 * off) so nobody hits this tradeoff by accident.
 */
import { fetchReputation } from './reputation.js'

export interface VerifyGateDecision {
  escalate: boolean
  reason: string
}

/** Below this many prior deliveries, a seller's record isn't established enough to skip on. */
const MIN_DELIVERIES_FOR_TRUST = 3

export async function decideVerifyEscalation(
  verifierConfigured: boolean,
  gateEnabled: boolean,
  sellerName: string,
  reputationUrl?: string,
  doFetch: typeof fetch = fetch,
): Promise<VerifyGateDecision> {
  if (!verifierConfigured) return { escalate: false, reason: 'no verifier configured' }
  if (!gateEnabled) return { escalate: true, reason: 'verify-gate disabled; verifying every delivery' }

  const reputation = reputationUrl ? await fetchReputation(reputationUrl, doFetch) : undefined
  const rep = reputation?.find((r) => r.seller === sellerName)
  if (!rep || rep.delivered < MIN_DELIVERIES_FOR_TRUST) {
    return { escalate: true, reason: `${sellerName} has fewer than ${MIN_DELIVERIES_FOR_TRUST} prior deliveries` }
  }
  if (rep.verifiedFail > 0) {
    return { escalate: true, reason: `${sellerName} has a prior failed verification` }
  }
  return { escalate: false, reason: `${sellerName} has a clean record over ${rep.delivered} deliveries` }
}
