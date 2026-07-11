/**
 * Upstream procurement — the seller-side "buy before you deliver" leg, settled for real over x402.
 * One call produces the whole auditable bundle: the resource body the payment bought, the formal
 * ProofReceipt for the run ledger, and the three wire messages (PAYMENT_REQUIRED / PAYMENT_PROOF /
 * PAYMENT_CONFIRMED) to post on the market thread. Used by `coral-agents/seller-agent`
 * (`PROCURE_RAIL=x402`).
 */
import { formatPaymentConfirmed, formatPaymentProof, formatPaymentRequired, type ProofReceipt, type WalletSigner } from '@pay/agent-runtime'
import { payViaX402 } from './rails/x402-client.js'
import type { AllowancePolicy } from './policy/spend-policy.js'
import { toProofReceipt } from './receipt.js'
import type { PaymentCurrency, PaymentRequest, PaymentVerification } from './types.js'

export interface UpstreamProcurementInput {
  orderId: string
  round: number
  /** Who pays — the (seller) agent procuring upstream context. */
  buyer: string
  /** Signs the x402 payment. */
  signer: WalletSigner
  /** The x402-protected resource URL to buy. */
  url: string
  /** Spend policy gating this call — per-call/per-day caps, allowed services/providers. */
  policy?: AllowancePolicy
  service?: string
}

export interface UpstreamProcurement {
  provider: string
  service: string
  request: PaymentRequest
  verification: PaymentVerification
  /** The formal run-ledger artifact for this payment leg. */
  receipt: ProofReceipt
  /** PAYMENT_REQUIRED / PAYMENT_PROOF / PAYMENT_CONFIRMED — post these on the market thread. */
  messages: string[]
  /** The upstream resource body the payment actually bought. */
  body: string
}

export async function procureUpstream(input: UpstreamProcurementInput): Promise<UpstreamProcurement> {
  const service = input.service ?? 'upstream-context'
  const provider = new URL(input.url).origin
  const { response, settlement } = await payViaX402(input.url, {}, { signer: input.signer, policy: input.policy ?? {} })
  const { accept, txSignature } = settlement
  const currency = accept.asset as PaymentCurrency

  const request: PaymentRequest = {
    id: `x402:${input.orderId}`,
    rail: 'x402',
    orderId: input.orderId,
    amount: accept.amount,
    currency,
    buyer: input.buyer,
    seller: accept.payTo,
    payTo: accept.payTo,
    reference: accept.reference,
    url: input.url,
    metadata: { txSignature },
  }
  const verification: PaymentVerification = {
    paid: true,
    rail: 'x402',
    proof: txSignature,
    txSignature,
    amount: accept.amount,
    currency,
    payer: input.buyer,
    recipient: accept.payTo,
    reference: accept.reference,
  }
  const receipt = toProofReceipt(verification, { provider, service })

  return {
    provider,
    service,
    request,
    verification,
    receipt,
    body: await response.text(),
    messages: [
      formatPaymentRequired({ round: input.round, rail: 'x402', amount: accept.amount, currency, reference: accept.reference, seller: provider, url: input.url }),
      formatPaymentProof({ round: input.round, rail: 'x402', reference: accept.reference, proof: txSignature, buyer: input.buyer, txSignature }),
      formatPaymentConfirmed({ round: input.round, rail: 'x402', reference: accept.reference, paid: true, amount: accept.amount, currency, txSignature }),
    ],
  }
}
