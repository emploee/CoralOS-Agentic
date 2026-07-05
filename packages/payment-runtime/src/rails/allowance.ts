import type { MarketOrder, PaymentRail } from '../types.js'
import { enforceAllowance, type AllowancePolicy } from '../policy/spend-policy.js'

export interface AllowanceRailOptions {
  policy: AllowancePolicy
  inner: PaymentRail
}

export function allowanceRail(opts: AllowanceRailOptions): PaymentRail {
  return {
    ...opts.inner,
    kind: 'allowance',
    async quote(input) {
      enforceAllowance({ service: input.service, amount: input.amount ?? 0, currency: input.currency ?? 'USDC', provider: provider(input.metadata) }, opts.policy)
      return { ...(await opts.inner.quote(input)), rail: 'allowance' }
    },
    async requestPayment(order: MarketOrder) {
      enforceAllowance({ service: order.service, amount: Number(order.amount), currency: order.currency, provider: provider(order.metadata) }, opts.policy)
      return { ...(await opts.inner.requestPayment(order)), rail: 'allowance', metadata: { ...order.metadata, innerRail: opts.inner.kind } }
    },
    async verifyPayment(request) {
      return { ...(await opts.inner.verifyPayment(request)), rail: 'allowance' }
    },
    async release(order) {
      if (!opts.inner.release) throw new Error(`Inner rail cannot release funds: ${opts.inner.kind}`)
      return { ...(await opts.inner.release(order)), rail: 'allowance' }
    },
    async refund(order) {
      if (!opts.inner.refund) throw new Error(`Inner rail cannot refund funds: ${opts.inner.kind}`)
      return { ...(await opts.inner.refund(order)), rail: 'allowance' }
    },
  }
}

function provider(metadata: Record<string, unknown> | undefined): string | undefined {
  return typeof metadata?.provider === 'string' ? metadata.provider : undefined
}
