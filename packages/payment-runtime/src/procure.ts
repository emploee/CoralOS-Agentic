/**
 * Upstream procurement — the seller-side "buy before you deliver" leg, over a payment rail.
 *
 * One call produces the whole auditable bundle: the rail's PaymentRequest, its verification, the
 * formal ProofReceipt for the run ledger, and the three wire messages
 * (PAYMENT_REQUIRED / PAYMENT_PROOF / PAYMENT_CONFIRMED) to post on the market thread. Used by the
 * txodds Pay.sh demo (`/api/pay-sh-edge`) and by `coral-agents/seller-agent` (`PROCURE_RAIL=pay-sh`)
 * inside the multi-agent market.
 *
 * While the Pay.sh rail is a scaffold, the proof is a deterministic demo receipt and the receipt is
 * marked `simulated: true` — promoting the rail to the live API changes the proof supplier, nothing
 * downstream.
 */
import { createHash } from 'node:crypto'
import {
  formatPaymentConfirmed,
  formatPaymentProof,
  formatPaymentRequired,
  type ProofReceipt,
} from '@pay/agent-runtime'
import { PaymentRailRouter } from './rail-router.js'
import { payShRail } from './rails/pay-sh.js'
import { toProofReceipt } from './receipt.js'
import type { PaymentRequest, PaymentVerification } from './types.js'

export interface UpstreamProcurementInput {
  orderId: string
  round: number
  /** Who pays — the (seller) agent procuring upstream context. */
  buyer: string
  /** The upstream provider identity, e.g. 'pay.sh/txodds-context'. */
  provider: string
  /** What is being bought, e.g. 'txline-edge-upstream'. */
  service?: string
  amount: string
  currency?: 'USDC'
  /** Resource URL carried in the request metadata (and the PAYMENT_REQUIRED message). */
  url?: string
  /** A real proof/receipt when the rail is live; omitted → a deterministic demo receipt (simulated). */
  proof?: string
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
}

export async function procureUpstream(input: UpstreamProcurementInput): Promise<UpstreamProcurement> {
  const service = input.service ?? 'upstream-context'
  const router = new PaymentRailRouter([
    payShRail({ providerAllowlist: [input.provider], catalogBaseUrl: 'https://pay.sh/api' }),
  ])
  const request = await router.requestPayment({
    id: input.orderId,
    round: input.round,
    service,
    buyer: input.buyer,
    seller: input.provider,
    amount: input.amount,
    currency: input.currency ?? 'USDC',
    rail: 'pay-sh',
    metadata: { provider: input.provider, ...(input.url ? { url: input.url } : {}) },
  })
  const simulated = input.proof == null
  const proof = input.proof ?? demoReceipt(input)
  const verification = await router.verifyPayment({
    ...request,
    metadata: { ...request.metadata, payShReceipt: proof },
  })
  const reference = request.reference ?? request.orderId
  const receipt = toProofReceipt(
    { ...verification, reference: verification.reference ?? reference },
    { provider: input.provider, service, simulated },
  )
  return {
    provider: input.provider,
    service,
    request,
    verification,
    receipt,
    messages: [
      formatPaymentRequired({
        round: input.round,
        rail: 'pay-sh',
        amount: request.amount,
        currency: request.currency,
        reference,
        seller: input.provider,
        ...(request.url ? { url: request.url } : {}),
      }),
      formatPaymentProof({
        round: input.round,
        rail: 'pay-sh',
        reference,
        proof,
        buyer: input.buyer,
      }),
      formatPaymentConfirmed({
        round: input.round,
        rail: 'pay-sh',
        reference,
        paid: verification.paid,
        amount: verification.amount,
        currency: verification.currency,
      }),
    ],
  }
}

/** The scaffold rail's stand-in proof: deterministic, self-labelling, never mistakable for a live receipt. */
export function demoReceipt(input: Pick<UpstreamProcurementInput, 'orderId' | 'provider' | 'amount' | 'url'>): string {
  return `pay-sh-demo:${createHash('sha256')
    .update(`${input.orderId}:${input.provider}:${input.amount}:${input.url ?? ''}`)
    .digest('hex')}`
}
