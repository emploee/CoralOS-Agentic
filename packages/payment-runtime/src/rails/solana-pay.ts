import { generatePaymentUrl, verifyPayment as verifySolanaPay } from '@pay/agent-runtime'
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

export interface SolanaPayRailOptions {
  recipient: string
  label?: string
}

export function solanaPayRail(opts: SolanaPayRailOptions): PaymentRail {
  return {
    kind: 'solana-pay',
    async quote(input: PaymentQuoteInput): Promise<PaymentQuote> {
      return {
        rail: 'solana-pay',
        service: input.service,
        amount: money(input.amount),
        currency: input.currency ?? 'SOL',
        buyer: input.buyer,
        ...(input.seller ? { seller: input.seller } : {}),
        metadata: input.metadata,
      }
    },
    async requestPayment(order: MarketOrder): Promise<PaymentRequest> {
      if (order.currency !== 'SOL') throw new Error('Solana Pay rail currently expects SOL orders')
      const payment = generatePaymentUrl({
        recipient: opts.recipient,
        amountSol: Number(order.amount),
        label: opts.label ?? `Agent service: ${order.service}`,
        message: memoForOrder(order),
      })
      return {
        id: requestId('solana-pay', order.id),
        rail: 'solana-pay',
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        buyer: order.buyer,
        seller: order.seller,
        payTo: opts.recipient,
        url: payment.url,
        reference: payment.reference,
        memo: memoForOrder(order),
      }
    },
    async verifyPayment(request: PaymentRequest): Promise<PaymentVerification> {
      const sig = String(request.metadata?.txSignature ?? request.metadata?.sig ?? '')
      if (!sig || !request.payTo || !request.reference) {
        return { paid: false, rail: 'solana-pay', amount: request.amount, currency: request.currency, reason: 'missing signature, recipient, or reference' }
      }
      const paid = await verifySolanaPay(sig, {
        recipient: request.payTo,
        amountSol: Number(request.amount),
        reference: request.reference,
      })
      return {
        paid,
        rail: 'solana-pay',
        proof: request.reference,
        txSignature: sig,
        amount: request.amount,
        currency: request.currency,
        recipient: request.payTo,
        reference: request.reference,
      }
    },
  }
}

function memoForOrder(order: MarketOrder): string {
  const round = order.round == null ? '' : ` round=${order.round}`
  return `order=${order.id}${round} service=${order.service}`.slice(0, 100)
}
