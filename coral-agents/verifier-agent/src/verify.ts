/**
 * Delivery verification - the verifier's brain, pure and fully testable.
 *
 * Deterministic checks, in order:
 *   1. content hash — the payload must hash to the sha the buyer received (payment binds to THIS artifact)
 *   2. structure    — the payload must be JSON and not a top-level error report
 * A payload that passes both is accepted - the verifier can only check what it actually received,
 * not judge intent behind it.
 */
import { sha256Hex, type VerifyRequest, type Verdict } from '@pay/agent-runtime'

export async function checkDelivery(req: VerifyRequest, name: string): Promise<Verdict> {
  const base = { round: req.round, by: name, sha: sha256Hex(req.payload) }

  if (base.sha !== req.sha) {
    return { ...base, verdict: 'fail', reason: 'content hash mismatch' }
  }

  let data: unknown
  try {
    data = JSON.parse(req.payload)
  } catch {
    return { ...base, verdict: 'fail', reason: 'payload is not JSON' }
  }
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    const err = String((data as Record<string, unknown>).error).slice(0, 40)
    return { ...base, verdict: 'fail', reason: `payload reports error: ${err}` }
  }

  return { ...base, verdict: 'pass', reason: 'hash + structure verified' }
}
