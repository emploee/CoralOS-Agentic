import { describe, expect, it } from 'vitest'
import { PaymentRailRouter, escrowRail, payShRail, splUsdcRail } from './index.js'

describe('PaymentRailRouter', () => {
  it('routes stablecoin orders to the USDC rail when no explicit rail is set', async () => {
    const router = new PaymentRailRouter([escrowRail(), splUsdcRail()])
    const request = await router.requestPayment({
      id: 'order-1',
      service: 'research-brief',
      buyer: 'buyer',
      seller: 'seller',
      amount: '0.20',
      currency: 'USDC',
    })
    expect(request.rail).toBe('spl-usdc')
    expect(request.metadata?.tokenProgram).toBe('spl-token')
  })

  it('honors explicit rails', async () => {
    const router = new PaymentRailRouter([escrowRail(), payShRail({ providerAllowlist: ['pay.sh/exa'] })])
    const quote = await router.quote({
      rail: 'pay-sh',
      service: 'upstream-search',
      buyer: 'seller-agent',
      amount: 0.03,
      currency: 'USDC',
      metadata: { provider: 'pay.sh/exa' },
    })
    expect(quote.rail).toBe('pay-sh')
  })

  it('rejects disallowed Pay.sh providers', async () => {
    const router = new PaymentRailRouter([payShRail({ providerAllowlist: ['pay.sh/exa'] })])
    await expect(router.quote({
      rail: 'pay-sh',
      service: 'upstream-search',
      buyer: 'seller-agent',
      amount: 0.03,
      currency: 'USDC',
      metadata: { provider: 'pay.sh/perplexity' },
    })).rejects.toThrow('provider not allowed')
  })
})
