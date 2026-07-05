import { escrowRail } from './escrow.js'
import type { PaymentRail } from '../types.js'

export interface SplUsdcRailOptions {
  mint?: string
  arbiter?: string
}

export function splUsdcRail(opts: SplUsdcRailOptions = {}): PaymentRail {
  const escrow = escrowRail({ arbiter: opts.arbiter })
  return {
    ...escrow,
    kind: 'spl-usdc',
    async quote(input) {
      return { ...(await escrow.quote({ ...input, currency: input.currency ?? 'USDC' })), rail: 'spl-usdc' }
    },
    async requestPayment(order) {
      if (order.currency !== 'USDC') throw new Error('SPL-USDC rail expects USDC orders')
      return {
        ...(await escrow.requestPayment(order)),
        rail: 'spl-usdc',
        metadata: { ...order.metadata, mint: opts.mint, tokenProgram: 'spl-token' },
      }
    },
    async verifyPayment(request) {
      return { ...(await escrow.verifyPayment(request)), rail: 'spl-usdc' }
    },
    async release(order) {
      return { ...(await escrow.release!(order)), rail: 'spl-usdc' }
    },
    async refund(order) {
      return { ...(await escrow.refund!(order)), rail: 'spl-usdc' }
    },
  }
}
