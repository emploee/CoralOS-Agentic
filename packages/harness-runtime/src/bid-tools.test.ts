import { describe, it, expect } from 'vitest'
import { clampPriceTool } from './bid-tools.js'

describe('clampPriceTool', () => {
  it('leaves an in-range price untouched', async () => {
    const tool = clampPriceTool(0.0004, 0.001)
    const out = await tool.execute({ proposedPriceSol: 0.0006 })
    expect(out).toEqual({ clampedPriceSol: 0.0006, wasClamped: false, floorSol: 0.0004, budgetSol: 0.001 })
  })

  it('clamps a below-floor price up', async () => {
    const tool = clampPriceTool(0.0004, 0.001)
    const out = await tool.execute({ proposedPriceSol: 0.0001 })
    expect(out).toMatchObject({ clampedPriceSol: 0.0004, wasClamped: true })
  })

  it('clamps an above-budget price down', async () => {
    const tool = clampPriceTool(0.0004, 0.001)
    const out = await tool.execute({ proposedPriceSol: 0.005 })
    expect(out).toMatchObject({ clampedPriceSol: 0.001, wasClamped: true })
  })
})
