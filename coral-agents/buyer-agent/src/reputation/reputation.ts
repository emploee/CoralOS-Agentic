/**
 * Track-record input for award and verify-gate decisions. The feed server derives per-seller
 * reputation from the run ledger (/api/reputation); agents fold it into their decisions so history
 * — not just price — shapes who wins and how much scrutiny a delivery gets. Feed down -> undefined
 * -> decisions fall back to their pre-reputation behavior.
 */
import { formatReputation, type SellerReputation } from '@pay/agent-runtime'

/** Raw per-seller reputation records, for decisions that need to compute over the numbers. */
export async function fetchReputation(url: string, doFetch: typeof fetch = fetch): Promise<SellerReputation[] | undefined> {
  try {
    const res = await doFetch(url)
    if (!res.ok) return undefined
    const body = (await res.json()) as { reputation?: SellerReputation[] } | null
    if (!body?.reputation?.length) return undefined
    return body.reputation
  } catch {
    return undefined
  }
}

/** Formatted prompt lines, for decisions that just want reputation as prose context. */
export async function fetchReputationLines(url: string, doFetch: typeof fetch = fetch): Promise<string | undefined> {
  const reputation = await fetchReputation(url, doFetch)
  return reputation ? formatReputation(reputation) : undefined
}
