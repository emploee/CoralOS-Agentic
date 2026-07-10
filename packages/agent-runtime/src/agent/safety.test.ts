import { describe, it, expect } from 'vitest'
import { BudgetGuard, BudgetExceededError, StepCounter, StepCapExceededError, wrapUntrusted } from './safety.js'

describe('BudgetGuard', () => {
  it('passes when under every limit', () => {
    const budget = new BudgetGuard()
    expect(() => budget.check()).not.toThrow()
  })

  it('trips on the tool-call cap', () => {
    const budget = new BudgetGuard({ maxToolCalls: 2, maxSpendLamports: Number.MAX_SAFE_INTEGER, maxDurationSecs: Number.MAX_SAFE_INTEGER })
    budget.recordToolCall()
    budget.recordToolCall()
    expect(() => budget.check()).toThrow(BudgetExceededError)
    try {
      budget.check()
    } catch (e) {
      expect((e as BudgetExceededError).resource).toBe('toolCalls')
    }
  })

  it('trips on the spend cap', () => {
    const budget = new BudgetGuard({ maxToolCalls: Number.MAX_SAFE_INTEGER, maxSpendLamports: 1000, maxDurationSecs: Number.MAX_SAFE_INTEGER })
    budget.recordSpend(1000)
    expect(() => budget.check()).toThrow(/spendLamports/)
  })

  it('tracks cumulative counters', () => {
    const budget = new BudgetGuard()
    budget.recordToolCall()
    budget.recordToolCall()
    budget.recordSpend(500)
    expect(budget.currentToolCalls).toBe(2)
    expect(budget.currentSpendLamports).toBe(500)
  })
})

describe('StepCounter', () => {
  it('allows ticks up to the cap', () => {
    const steps = new StepCounter(3)
    expect(() => steps.tick()).not.toThrow()
    expect(() => steps.tick()).not.toThrow()
    expect(() => steps.tick()).not.toThrow()
  })

  it('fails closed once the cap is exceeded', () => {
    const steps = new StepCounter(2)
    steps.tick()
    steps.tick()
    expect(() => steps.tick()).toThrow(StepCapExceededError)
    expect(steps.current).toBe(3)
  })
})

describe('wrapUntrusted', () => {
  it('adds structural delimiters around the content', () => {
    const wrapped = wrapUntrusted('tool_result', 'hello world')
    expect(wrapped).toContain('<untrusted_source label="tool_result">')
    expect(wrapped).toContain('hello world')
    expect(wrapped).toContain('</untrusted_source>')
  })

  it('truncates content past the 32 KiB safety limit', () => {
    const big = 'x'.repeat(100_000)
    const wrapped = wrapUntrusted('big_doc', big)
    expect(wrapped.length).toBeLessThan(40_000)
  })
})
