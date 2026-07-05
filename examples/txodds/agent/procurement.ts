import { createHash } from 'node:crypto'
import {
  type PaymentRequest,
  type PaymentVerification,
} from '../../../packages/payment-runtime/src/types.js'
import { PaymentRailRouter } from '../../../packages/payment-runtime/src/rail-router.js'
import { payShRail } from '../../../packages/payment-runtime/src/rails/pay-sh.js'
import {
  formatPaymentConfirmed,
  formatPaymentProof,
  formatPaymentRequired,
} from '../../../packages/agent-runtime/src/market/protocol.js'

export interface PayShProcurement {
  provider: string
  service: string
  request: PaymentRequest
  verification: PaymentVerification
  messages: string[]
}

export interface PayShProcurementInput {
  orderId: string
  round: number
  fixtureId: string
  buyer: string
  seller: string
  amount: string
  currency?: 'USDC'
  provider?: string
}

export async function procureTxOddsContext(input: PayShProcurementInput): Promise<PayShProcurement> {
  const provider = input.provider ?? 'pay.sh/txodds-context'
  const router = new PaymentRailRouter([
    payShRail({ providerAllowlist: [provider], catalogBaseUrl: 'https://pay.sh/api' }),
  ])
  const order = {
    id: input.orderId,
    round: input.round,
    service: 'txline-edge-upstream',
    buyer: input.buyer,
    seller: input.seller,
    amount: input.amount,
    currency: input.currency ?? 'USDC',
    rail: 'pay-sh' as const,
    metadata: {
      provider,
      fixtureId: input.fixtureId,
      url: `https://pay.sh/api/quicknode/rpc?fixtureId=${encodeURIComponent(input.fixtureId)}`,
    },
  }
  const request = await router.requestPayment(order)
  const receipt = receiptFor({ orderId: input.orderId, fixtureId: input.fixtureId, provider, amount: input.amount })
  const verification = await router.verifyPayment({
    ...request,
    metadata: { ...request.metadata, payShReceipt: receipt },
  })
  const reference = request.reference ?? request.orderId
  return {
    provider,
    service: order.service,
    request,
    verification,
    messages: [
      formatPaymentRequired({
        round: input.round,
        rail: 'pay-sh',
        amount: request.amount,
        currency: request.currency,
        reference,
        seller: input.seller,
        ...(request.url ? { url: request.url } : {}),
      }),
      formatPaymentProof({
        round: input.round,
        rail: 'pay-sh',
        reference,
        proof: receipt,
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

function receiptFor(input: { orderId: string; fixtureId: string; provider: string; amount: string }): string {
  return `pay-sh-demo:${createHash('sha256')
    .update(`${input.orderId}:${input.fixtureId}:${input.provider}:${input.amount}`)
    .digest('hex')}`
}
