/**
 * Policy middleware — the single choke point every fund-moving action passes through.
 *
 * Pure decisions over explicit context: the caller states what it is about to do (`PolicyAction`)
 * and under which limits (`Policy`); `enforce` returns every violated rule. No scattered checks —
 * one place to read what an agent may never do, one place to test hostile cases against.
 * (The devnet guard stays in solana/connection.ts — it protects Connection construction itself.)
 *
 * Buyer-side rules:
 *   spend-cap-round     a single deposit may not exceed the per-round cap
 *   spend-cap-session   cumulative session spend may not exceed the session cap
 *   award-price         the escrow amount may not exceed the awarded bid price (no post-award inflation)
 *   service-allowlist   only services on the allowlist may be bought
 *   payout-binding      the escrow's seller wallet must be the expected payout wallet
 *   rate-limit          a minimum interval between deposits
 *   verifier-gate       release requires a VERIFIED pass when a verifier is required
 */

export interface Policy {
  /** Hard cap for one deposit, in SOL. */
  maxSolPerRound?: number
  /** Hard cap for cumulative deposits across the session, in SOL. */
  maxSolPerSession?: number
  /** Services this wallet may buy. Empty/undefined = any. */
  allowedServices?: string[]
  /** The payout wallet deposits must name (base58). Undefined = unbound. */
  expectedPayout?: string
  /** Minimum ms between deposits. */
  minIntervalMs?: number
  /** Release requires a verifier pass. */
  requireVerifier?: boolean
}

export type PolicyAction =
  | {
      kind: 'deposit'
      round: number
      service: string
      amountSol: number
      payout: string
      /** The winning bid's price — the escrow may not ask for more. */
      awardedPriceSol?: number
      /** Cumulative SOL already deposited this session. */
      spentSol?: number
      /** ms timestamp of the previous deposit. */
      lastDepositAt?: number
      now?: number
    }
  | {
      kind: 'release'
      round: number
      /** The verifier's verdict, if one arrived. */
      verified?: 'pass' | 'fail'
    }

export interface PolicyDecision {
  ok: boolean
  /** Every violated rule, as "rule: detail". Empty when ok. */
  violations: string[]
}

export function enforce(action: PolicyAction, policy: Policy): PolicyDecision {
  const violations: string[] = []
  const deny = (rule: string, detail: string) => violations.push(`${rule}: ${detail}`)

  if (action.kind === 'deposit') {
    if (policy.maxSolPerRound != null && action.amountSol > policy.maxSolPerRound) {
      deny('spend-cap-round', `${action.amountSol} SOL > cap ${policy.maxSolPerRound}`)
    }
    if (policy.maxSolPerSession != null && (action.spentSol ?? 0) + action.amountSol > policy.maxSolPerSession) {
      deny('spend-cap-session', `${(action.spentSol ?? 0) + action.amountSol} SOL > session cap ${policy.maxSolPerSession}`)
    }
    if (action.awardedPriceSol != null && action.amountSol > action.awardedPriceSol) {
      deny('award-price', `escrow asks ${action.amountSol} SOL, awarded bid was ${action.awardedPriceSol}`)
    }
    if (policy.allowedServices?.length && !policy.allowedServices.includes(action.service)) {
      deny('service-allowlist', `${action.service} not in [${policy.allowedServices.join(',')}]`)
    }
    if (policy.expectedPayout && action.payout !== policy.expectedPayout) {
      deny('payout-binding', `payout ${action.payout} != expected ${policy.expectedPayout}`)
    }
    if (
      policy.minIntervalMs != null && action.lastDepositAt != null &&
      (action.now ?? Date.now()) - action.lastDepositAt < policy.minIntervalMs
    ) {
      deny('rate-limit', `deposits closer than ${policy.minIntervalMs}ms`)
    }
  }

  if (action.kind === 'release' && policy.requireVerifier && action.verified !== 'pass') {
    deny('verifier-gate', action.verified === 'fail' ? 'verifier failed the delivery' : 'no verifier verdict')
  }

  return { ok: violations.length === 0, violations }
}

/**
 * Build a buyer policy from env (POLICY_*), with the round budget as the default spend cap.
 * Unset, empty, or 0 values mean "use the default" — coral manifests pass 0/"" for unset options.
 */
export function policyFromEnv(env: NodeJS.ProcessEnv, defaults: { budgetSol: number; service: string; expectedPayout?: string }): Policy {
  const num = (raw: string | undefined): number | undefined => {
    const n = Number(raw ?? '')
    return Number.isFinite(n) && n > 0 ? n : undefined
  }
  return {
    maxSolPerRound: num(env.POLICY_MAX_SOL_PER_ROUND) ?? defaults.budgetSol,
    ...(num(env.POLICY_MAX_SOL_PER_SESSION) != null ? { maxSolPerSession: num(env.POLICY_MAX_SOL_PER_SESSION)! } : {}),
    allowedServices: (env.POLICY_SERVICES || defaults.service).split(',').map((s) => s.trim()).filter(Boolean),
    ...(defaults.expectedPayout ? { expectedPayout: defaults.expectedPayout } : {}),
    ...(num(env.POLICY_MIN_INTERVAL_MS) != null ? { minIntervalMs: num(env.POLICY_MIN_INTERVAL_MS)! } : {}),
    requireVerifier: !!env.VERIFIER_AGENT,
  }
}
