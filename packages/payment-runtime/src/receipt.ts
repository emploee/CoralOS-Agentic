import type { ProofReceipt } from '@pay/agent-runtime'
import type { PaymentVerification } from './types.js'

export interface ProofReceiptOptions {
  provider?: string
  service?: string
  /** Mark the receipt as scaffold-issued (the proof shape is real, the money movement is not). */
  simulated?: boolean
  issuedAt?: string
}

/**
 * Fold a rail's verification into the run ledger's formal proof-receipt artifact. The receipt is
 * what survives the session: `run.json` carries it under `proofReceipts` and the store writes it
 * as `proof_receipts.json` beside the delivery.
 */
export function toProofReceipt(verification: PaymentVerification, opts: ProofReceiptOptions = {}): ProofReceipt {
  return {
    rail: verification.rail,
    ...(opts.provider ? { provider: opts.provider } : {}),
    ...(opts.service ? { service: opts.service } : {}),
    ...(verification.reference ? { reference: verification.reference } : {}),
    proof: verification.proof ?? verification.txSignature ?? '',
    amount: verification.amount,
    currency: verification.currency,
    paid: verification.paid,
    ...(opts.simulated ? { simulated: true } : {}),
    issuedAt: opts.issuedAt ?? new Date().toISOString(),
    ...(verification.reason ? { reason: verification.reason } : {}),
  }
}
