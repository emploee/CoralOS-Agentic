import {
  money,
  requestId,
  type MarketOrder,
  type PaymentQuote,
  type PaymentQuoteInput,
  type PaymentRail,
  type PaymentRequest,
  type PaymentVerification,
} from '../types.js'

export interface X402ClientRailOptions {
  facilitatorUrl?: string
  network?: 'solana' | string
}

export function x402ClientRail(opts: X402ClientRailOptions = {}): PaymentRail {
  return {
    kind: 'x402',
    async quote(input: PaymentQuoteInput): Promise<PaymentQuote> {
      return {
        rail: 'x402',
        service: input.service,
        amount: money(input.amount),
        currency: input.currency ?? 'USDC',
        buyer: input.buyer,
        ...(input.seller ? { seller: input.seller } : {}),
        metadata: input.metadata,
      }
    },
    async requestPayment(order: MarketOrder): Promise<PaymentRequest> {
      return {
        id: requestId('x402', order.id),
        rail: 'x402',
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        buyer: order.buyer,
        seller: order.seller,
        headers: { 'X-PAYMENT-NETWORK': opts.network ?? 'solana' },
        metadata: { ...order.metadata, facilitatorUrl: opts.facilitatorUrl },
      }
    },
    async verifyPayment(request: PaymentRequest): Promise<PaymentVerification> {
      const proof = String(request.metadata?.paymentProof ?? request.metadata?.proof ?? '')
      return {
        paid: proof.length > 0,
        rail: 'x402',
        proof: proof || undefined,
        amount: request.amount,
        currency: request.currency,
        payer: request.buyer,
        recipient: request.seller,
        reason: proof ? undefined : 'missing x402 payment proof',
        metadata: request.metadata,
      }
    },
  }
}
