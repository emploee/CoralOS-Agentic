import {
  money,
  requestId,
  type MarketOrder,
  type PaymentQuote,
  type PaymentQuoteInput,
  type PaymentRail,
  type PaymentRequest,
  type PaymentVerification,
  type SettlementResult,
} from '../types.js'

export function payoutRail(): PaymentRail {
  return {
    kind: 'payout',
    async quote(input: PaymentQuoteInput): Promise<PaymentQuote> {
      return {
        rail: 'payout',
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
        id: requestId('payout', order.id),
        rail: 'payout',
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        buyer: order.buyer,
        seller: order.seller,
        payTo: order.seller,
        memo: `payout order=${order.id} service=${order.service}`,
        metadata: order.metadata,
      }
    },
    async verifyPayment(request: PaymentRequest): Promise<PaymentVerification> {
      const proof = String(request.metadata?.payoutProof ?? request.metadata?.txSignature ?? '')
      return {
        paid: proof.length > 0,
        rail: 'payout',
        proof: proof || undefined,
        txSignature: String(request.metadata?.txSignature ?? '') || undefined,
        amount: request.amount,
        currency: request.currency,
        recipient: request.seller,
        reason: proof ? undefined : 'missing payout proof',
      }
    },
    async release(order: MarketOrder): Promise<SettlementResult> {
      const sig = String(order.metadata?.payoutSignature ?? '')
      return { settled: sig.length > 0, rail: 'payout', orderId: order.id, amount: order.amount, currency: order.currency, txSignature: sig || undefined }
    },
  }
}
