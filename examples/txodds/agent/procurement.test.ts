import { describe, expect, it } from 'vitest'
import { procureTxOddsContext } from './procurement.js'

describe('procureTxOddsContext', () => {
  it('creates a Pay.sh request, verifies a receipt, and emits market payment messages', async () => {
    const result = await procureTxOddsContext({
      orderId: 'txodds-pay-sh-1',
      round: 7,
      fixtureId: '9001',
      buyer: 'seller-agent',
      seller: 'pay.sh/txodds-context',
      amount: '0.03',
    })
    expect(result.request.rail).toBe('pay-sh')
    expect(result.verification.paid).toBe(true)
    expect(result.verification.proof).toMatch(/^pay-sh-demo:/)
    // the formal run-ledger artifact: honest about being scaffold-issued
    expect(result.receipt).toMatchObject({
      rail: 'pay-sh',
      provider: 'pay.sh/txodds-context',
      service: 'txline-edge-upstream',
      paid: true,
      simulated: true,
    })
    expect(result.receipt.proof).toMatch(/^pay-sh-demo:/)
    expect(result.messages[0]).toContain('PAYMENT_REQUIRED round=7 rail=pay-sh')
    expect(result.messages[1]).toContain('PAYMENT_PROOF round=7 rail=pay-sh')
    expect(result.messages[2]).toContain('PAYMENT_CONFIRMED round=7 rail=pay-sh')
  })
})
