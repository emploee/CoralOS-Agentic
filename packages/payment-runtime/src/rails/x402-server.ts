import type { MarketOrder, PaymentRequest } from '../types.js'
import { x402ClientRail, type X402ClientRailOptions } from './x402-client.js'

export interface X402Challenge {
  status: 402
  headers: Record<string, string>
  body: {
    accepts: Array<{
      network: string
      asset: string
      amount: string
      payTo?: string
      resource: string
    }>
  }
}

export function x402ServerRail(opts: X402ClientRailOptions = {}) {
  return x402ClientRail(opts)
}

export function x402Challenge(order: MarketOrder, request: PaymentRequest, resource: string): X402Challenge {
  return {
    status: 402,
    headers: { 'Content-Type': 'application/json', 'X-PAYMENT-RAIL': 'x402' },
    body: {
      accepts: [{
        network: String(request.headers?.['X-PAYMENT-NETWORK'] ?? 'solana'),
        asset: order.currency,
        amount: order.amount,
        payTo: order.seller,
        resource,
      }],
    },
  }
}
