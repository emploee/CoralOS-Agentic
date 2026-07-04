/**
 * Track-record input for award decisions. The feed server derives per-seller reputation from the
 * run ledger (/api/reputation); the buyer folds it into the best-value prompt so history — not
 * just price — shapes who wins. Feed down -> undefined -> awards work exactly as before.
 */
import { formatReputation, type SellerReputation } from '@pay/agent-runtime'

export async function fetchReputationLines(url: string, doFetch: typeof fetch = fetch): Promise<string | undefined> {
  try {
    const res = await doFetch(url)
    if (!res.ok) return undefined
    const body = (await res.json()) as { reputation?: SellerReputation[] } | null
    if (!body?.reputation?.length) return undefined
    return formatReputation(body.reputation)
  } catch {
    return undefined
  }
}
