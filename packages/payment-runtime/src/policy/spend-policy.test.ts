import { describe, expect, it } from 'vitest'
import { enforceAllowance } from './spend-policy.js'

describe('enforceAllowance', () => {
  it('allows spending inside budget and allowlists', () => {
    expect(() => enforceAllowance({
      service: 'research-brief',
      provider: 'pay.sh/exa',
      amount: 0.2,
      currency: 'USDC',
    }, {
      maxPerCall: 0.25,
      maxPerDay: 5,
      spentToday: 1,
      allowedProviders: ['pay.sh/exa'],
      allowedServices: ['research-brief'],
      allowedCurrencies: ['USDC'],
    })).not.toThrow()
  })

  it('rejects overspend', () => {
    expect(() => enforceAllowance({
      service: 'research-brief',
      provider: 'pay.sh/exa',
      amount: 0.5,
      currency: 'USDC',
    }, { maxPerCall: 0.25 })).toThrow('Allowance denied')
  })
})
