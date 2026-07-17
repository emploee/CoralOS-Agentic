import { describe, it, expect } from 'vitest'
import { enforce, policyFromEnv, type Policy } from './policy.js'

const policy: Policy = {
  maxSolPerRound: 0.001,
  maxSolPerSession: 0.003,
  allowedServices: ['txline'],
  expectedPayout: 'GoodWallet',
  minIntervalMs: 1000,
}

const payment = (over: Record<string, unknown> = {}) => ({
  kind: 'payment' as const,
  round: 1, service: 'txline', amountSol: 0.0005, payout: 'GoodWallet',
  awardedPriceSol: 0.0005, spentSol: 0, ...over,
})

describe('enforce - hostile sellers hit the wall', () => {
  it('passes a clean payment', () => {
    expect(enforce(payment(), policy)).toEqual({ ok: true, violations: [] })
  })

  it('refuses a wrong payout wallet', () => {
    const d = enforce(payment({ payout: 'EvilWallet' }), policy)
    expect(d.ok).toBe(false)
    expect(d.violations[0]).toContain('payout-binding')
  })

  it('refuses post-award price inflation (payment asks more than the winning bid)', () => {
    const d = enforce(payment({ amountSol: 0.0009, awardedPriceSol: 0.0005 }), policy)
    expect(d.ok).toBe(false)
    expect(d.violations[0]).toContain('award-price')
  })

  it('refuses a payment over the round cap', () => {
    const d = enforce(payment({ amountSol: 0.002, awardedPriceSol: 0.002 }), policy)
    expect(d.violations.join()).toContain('spend-cap-round')
  })

  it('refuses when the session cap would be breached', () => {
    const d = enforce(payment({ spentSol: 0.0028 }), policy)
    expect(d.violations.join()).toContain('spend-cap-session')
  })

  it('refuses a service off the allowlist', () => {
    const d = enforce(payment({ service: 'freelance' }), policy)
    expect(d.violations.join()).toContain('service-allowlist')
  })

  it('rate-limits back-to-back payments', () => {
    const d = enforce(payment({ lastPaymentAt: 5000, now: 5400 }), policy)
    expect(d.violations.join()).toContain('rate-limit')
  })

  it('collects ALL violations, not just the first', () => {
    const d = enforce(payment({ payout: 'EvilWallet', service: 'freelance', amountSol: 0.01, awardedPriceSol: 0.0005 }), policy)
    expect(d.violations.length).toBeGreaterThanOrEqual(3)
  })
})

describe('policyFromEnv', () => {
  it('defaults the round cap to the budget and the allowlist to the service', () => {
    const p = policyFromEnv({}, { budgetSol: 0.001, service: 'txline', expectedPayout: 'W' })
    expect(p).toMatchObject({ maxSolPerRound: 0.001, allowedServices: ['txline'], expectedPayout: 'W' })
  })

  it('treats 0/"" env values (coral manifest defaults for unset options) as unset', () => {
    const p = policyFromEnv(
      { POLICY_MAX_SOL_PER_ROUND: '0', POLICY_MAX_SOL_PER_SESSION: '0', POLICY_SERVICES: '', POLICY_MIN_INTERVAL_MS: '0' },
      { budgetSol: 0.001, service: 'txline' },
    )
    expect(p.maxSolPerRound).toBe(0.001) // falls back to the budget, not a 0 cap that refuses everything
    expect(p.maxSolPerSession).toBeUndefined()
    expect(p.allowedServices).toEqual(['txline'])
    expect(p.minIntervalMs).toBeUndefined()
  })

  it('reads POLICY_* overrides', () => {
    const p = policyFromEnv(
      { POLICY_MAX_SOL_PER_ROUND: '0.0007', POLICY_MAX_SOL_PER_SESSION: '0.002', POLICY_SERVICES: 'txline,freelance' },
      { budgetSol: 0.001, service: 'txline' },
    )
    expect(p).toMatchObject({
      maxSolPerRound: 0.0007, maxSolPerSession: 0.002,
      allowedServices: ['txline', 'freelance'],
    })
  })
})
