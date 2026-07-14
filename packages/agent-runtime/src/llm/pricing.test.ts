import { describe, it, expect, afterEach } from 'vitest'
import { estimateLlmCostSol } from './pricing.js'

describe('estimateLlmCostSol - derived from real per-token pricing, not a typed-in constant', () => {
  afterEach(() => {
    delete process.env.SOL_USD_RATE
  })

  it('a heavier token budget costs more than a lighter one on the same model', () => {
    const light = estimateLlmCostSol('anthropic', 'claude-haiku-4-5-20251001', 180)
    const heavy = estimateLlmCostSol('anthropic', 'claude-haiku-4-5-20251001', 700)
    expect(heavy).toBeGreaterThan(light)
    expect(heavy / light).toBeCloseTo(700 / 180, 5)
  })

  it('falls back to the provider default price for an unlisted model', () => {
    const known = estimateLlmCostSol('openai', 'gpt-4o-mini', 300)
    const unknown = estimateLlmCostSol('openai', 'some-future-model', 300)
    expect(unknown).toBe(known) // both models share openai's default per-token price
  })

  it('is always positive for a positive token budget', () => {
    expect(estimateLlmCostSol('venice', 'llama-3.3-70b', 180)).toBeGreaterThan(0)
  })

  it('has a groq entry (the free-tier fallback provider) too', () => {
    expect(estimateLlmCostSol('groq', 'llama-3.3-70b-versatile', 180)).toBeGreaterThan(0)
  })

  it('respects SOL_USD_RATE overrides', () => {
    const base = estimateLlmCostSol('anthropic', 'claude-haiku-4-5-20251001', 180)
    // doubling the SOL/USD rate halves the estimated SOL cost for the same USD cost
    process.env.SOL_USD_RATE = '50'
    const doubled = estimateLlmCostSol('anthropic', 'claude-haiku-4-5-20251001', 180)
    expect(doubled).toBeCloseTo(base / 2, 10)
  })
})
