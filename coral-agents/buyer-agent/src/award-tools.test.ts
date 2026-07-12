import { describe, it, expect } from 'vitest'
import type { SellerReputation } from '@pay/agent-runtime'
import { fetchSellerReputationTool, computeValueScoreTool, submitAwardTool } from './award-tools.js'

const reps: SellerReputation[] = [
  { seller: 'seller-good', awarded: 5, delivered: 5, settled: 5, verifiedPass: 5, verifiedFail: 0, refunded: 0, score: 95 },
]

describe('fetchSellerReputationTool', () => {
  it('returns the closed-over reputation array', async () => {
    const tool = fetchSellerReputationTool(reps)
    expect(await tool.execute({})).toEqual({ available: true, reputation: reps })
  })

  it('reports unavailable for an empty array', async () => {
    const tool = fetchSellerReputationTool([])
    expect(await tool.execute({})).toEqual({ available: false, reputation: [] })
  })
})

describe('computeValueScoreTool', () => {
  it('weighs price and reputation for a known seller', async () => {
    const tool = computeValueScoreTool(0.001, reps)
    const out = await tool.execute({ by: 'seller-good', priceSol: 0.0005 })
    // priceScore = 100 - min(1, 0.5)*100 = 50; valueScore = round(0.6*50 + 0.4*95) = 68
    expect(out).toEqual({ by: 'seller-good', priceSol: 0.0005, valueScore: 68, repScore: 95, withinBudget: true })
  })

  it('defaults an unknown seller to a neutral 50 reputation score, never zero', async () => {
    const tool = computeValueScoreTool(0.001, reps)
    const out = await tool.execute({ by: 'seller-new', priceSol: 0.0005 })
    expect(out.repScore).toBe(50)
  })

  it('scores an over-budget price as zero on the price component', async () => {
    const tool = computeValueScoreTool(0.001, reps)
    const out = await tool.execute({ by: 'seller-good', priceSol: 0.002 })
    expect(out.withinBudget).toBe(false)
    expect(out.valueScore).toBe(38) // round(0.6*0 + 0.4*95)
  })
})

describe('submitAwardTool', () => {
  it('echoes the submitted input', async () => {
    expect(await submitAwardTool.execute({ by: 'seller-good', reason: 'best value' }))
      .toEqual({ by: 'seller-good', reason: 'best value' })
  })
})
