import type {
  MarketOrder,
  PaymentCurrency,
  PaymentQuote,
  PaymentQuoteInput,
  PaymentRail,
  PaymentRailKind,
  PaymentRequest,
  PaymentVerification,
  SettlementResult,
} from './types.js'

export interface RailSelection {
  rail?: PaymentRailKind
  currency?: PaymentCurrency
  requireEscrow?: boolean
}

export class PaymentRailRouter {
  private readonly rails = new Map<PaymentRailKind, PaymentRail>()

  constructor(rails: PaymentRail[] = []) {
    for (const rail of rails) this.register(rail)
  }

  register(rail: PaymentRail): this {
    if (this.rails.has(rail.kind)) throw new Error(`Payment rail already registered: ${rail.kind}`)
    this.rails.set(rail.kind, rail)
    return this
  }

  get(kind: PaymentRailKind): PaymentRail {
    const rail = this.rails.get(kind)
    if (!rail) throw new Error(`Payment rail not registered: ${kind}`)
    return rail
  }

  choose(input: RailSelection): PaymentRail {
    if (input.rail) return this.get(input.rail)
    if (input.requireEscrow) return this.get('escrow')
    if (this.rails.has('solana-pay')) return this.get('solana-pay')
    const first = this.rails.values().next().value as PaymentRail | undefined
    if (!first) throw new Error('No payment rails registered')
    return first
  }

  quote(input: PaymentQuoteInput & RailSelection): Promise<PaymentQuote> {
    return this.choose(input).quote(input)
  }

  requestPayment(order: MarketOrder): Promise<PaymentRequest> {
    return this.choose({ rail: order.rail, currency: order.currency }).requestPayment(order)
  }

  verifyPayment(request: PaymentRequest): Promise<PaymentVerification> {
    return this.get(request.rail).verifyPayment(request)
  }

  release(order: MarketOrder): Promise<SettlementResult> {
    const rail = this.choose({ rail: order.rail, currency: order.currency })
    if (!rail.release) throw new Error(`Payment rail cannot release funds: ${rail.kind}`)
    return rail.release(order)
  }

  refund(order: MarketOrder): Promise<SettlementResult> {
    const rail = this.choose({ rail: order.rail, currency: order.currency })
    if (!rail.refund) throw new Error(`Payment rail cannot refund funds: ${rail.kind}`)
    return rail.refund(order)
  }
}
