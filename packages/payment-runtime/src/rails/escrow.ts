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

export interface EscrowRailOptions {
  arbiter?: string
  defaultDeadlineSecs?: number
}

export function escrowRail(opts: EscrowRailOptions = {}): PaymentRail {
  return {
    kind: 'escrow',
    async quote(input: PaymentQuoteInput): Promise<PaymentQuote> {
      return {
        rail: 'escrow',
        service: input.service,
        amount: money(input.amount),
        currency: input.currency ?? 'SOL',
        buyer: input.buyer,
        ...(input.seller ? { seller: input.seller } : {}),
        metadata: input.metadata,
      }
    },
    async requestPayment(order: MarketOrder): Promise<PaymentRequest> {
      if (!order.seller) throw new Error('Escrow orders require a seller')
      return {
        id: requestId('escrow', order.id),
        rail: 'escrow',
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        buyer: order.buyer,
        seller: order.seller,
        payTo: order.seller,
        reference: String(order.metadata?.reference ?? order.id),
        memo: `escrow order=${order.id} service=${order.service}`,
        expiresAt: deadline(opts.defaultDeadlineSecs ?? 600),
        metadata: { ...order.metadata, arbiter: opts.arbiter },
      }
    },
    async verifyPayment(request: PaymentRequest): Promise<PaymentVerification> {
      const proof = String(request.metadata?.proof ?? request.metadata?.txSignature ?? request.metadata?.sig ?? '')
      return {
        paid: proof.length > 0,
        rail: 'escrow',
        proof: proof || undefined,
        txSignature: String(request.metadata?.txSignature ?? request.metadata?.sig ?? '') || undefined,
        amount: request.amount,
        currency: request.currency,
        payer: request.buyer,
        recipient: request.seller,
        reference: request.reference,
        reason: proof ? undefined : 'missing escrow proof',
        metadata: request.metadata,
      }
    },
    async release(order: MarketOrder): Promise<SettlementResult> {
      return settle('escrow', order, 'release')
    },
    async refund(order: MarketOrder): Promise<SettlementResult> {
      return settle('escrow', order, 'refund')
    },
  }
}

function deadline(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString()
}

function settle(rail: 'escrow', order: MarketOrder, action: 'release' | 'refund'): SettlementResult {
  const sig = String(order.metadata?.[`${action}Signature`] ?? '')
  return {
    settled: sig.length > 0,
    rail,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    txSignature: sig || undefined,
    reason: sig ? undefined : `${action} signature not supplied`,
  }
}
