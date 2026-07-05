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

export interface PayShRailOptions {
  catalogBaseUrl?: string
  providerAllowlist?: string[]
}

export function payShRail(opts: PayShRailOptions = {}): PaymentRail {
  return {
    kind: 'pay-sh',
    async quote(input: PaymentQuoteInput): Promise<PaymentQuote> {
      const provider = providerName(input.metadata)
      if (provider && opts.providerAllowlist?.length && !opts.providerAllowlist.includes(provider)) {
        throw new Error(`Pay.sh provider not allowed: ${provider}`)
      }
      return {
        rail: 'pay-sh',
        service: input.service,
        amount: money(input.amount),
        currency: input.currency ?? 'USDC',
        buyer: input.buyer,
        ...(input.seller ? { seller: input.seller } : {}),
        metadata: input.metadata,
      }
    },
    async requestPayment(order: MarketOrder): Promise<PaymentRequest> {
      const provider = providerName(order.metadata)
      if (provider && opts.providerAllowlist?.length && !opts.providerAllowlist.includes(provider)) {
        throw new Error(`Pay.sh provider not allowed: ${provider}`)
      }
      return {
        id: requestId('pay-sh', order.id),
        rail: 'pay-sh',
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        buyer: order.buyer,
        seller: order.seller,
        url: order.metadata?.url ? String(order.metadata.url) : opts.catalogBaseUrl,
        metadata: order.metadata,
      }
    },
    async verifyPayment(request: PaymentRequest): Promise<PaymentVerification> {
      const receipt = String(request.metadata?.payShReceipt ?? request.metadata?.proof ?? '')
      return {
        paid: receipt.length > 0,
        rail: 'pay-sh',
        proof: receipt || undefined,
        amount: request.amount,
        currency: request.currency,
        payer: request.buyer,
        recipient: request.seller,
        reason: receipt ? undefined : 'missing Pay.sh receipt',
        metadata: request.metadata,
      }
    },
  }
}

function providerName(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.provider === 'string' ? metadata.provider : undefined
}
