import type { Round } from '../types'

/**
 * The independent verifier's verdict on a delivery — the release gate, made visible.
 * A fail means the buyer refused to release: funds stay in escrow, refundable after the deadline.
 */
export function VerificationBadge({ verification }: { verification: NonNullable<Round['verification']> }) {
  const pass = verification.verdict === 'pass'
  return (
    <span
      className={`verify ${pass ? 'verify-pass' : 'verify-fail'}`}
      data-testid="verification"
      data-verdict={verification.verdict}
      title={verification.reason ?? ''}
    >
      {pass ? '✓ verified' : '✗ verify failed'}
      <span className="verify-by">by {verification.by}</span>
      {!pass && <span className="verify-note">— release refused, funds refundable</span>}
    </span>
  )
}
