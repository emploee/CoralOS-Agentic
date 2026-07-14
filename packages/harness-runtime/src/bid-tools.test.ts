import { describe, it, expect } from 'vitest'
import type { Want } from '@pay/agent-runtime'
import { clampPriceTool, fetchClearingPricesTool, fetchOwnReputationTool } from './bid-tools.js'
import type { SellerConfig } from './types.js'

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

describe('fetchClearingPricesTool', () => {
  const want: Want = { round: 1, service: 'txline', arg: '123', budgetSol: 0.001 }
  const cfg: SellerConfig = { name: 'seller-x', services: ['txline'], floorSol: 0.0003, persona: 'test', reputationUrl: 'http://x/api/reputation' }
  const respond = (status: number, body?: unknown) =>
    (async () => ({ status, ok: status >= 200 && status < 300, json: async () => body })) as unknown as typeof fetch

  it('returns clearing stats for the matching service', async () => {
    const tool = fetchClearingPricesTool(want, cfg, respond(200, {
      clearingPrices: [{ service: 'txline', n: 3, medianPriceSol: 0.0006, minPriceSol: 0.0005, maxPriceSol: 0.0009, recentPricesSol: [0.0006, 0.0005, 0.0009] }],
    }))
    const out = await tool.execute({})
    expect(out).toMatchObject({ found: true, n: 3, medianPriceSol: 0.0006 })
  })

  it('reports not found when no stats exist for this service', async () => {
    const tool = fetchClearingPricesTool(want, cfg, respond(200, { clearingPrices: [] }))
    expect(await tool.execute({})).toEqual({ found: false })
  })

  it('fails soft (not found) when the fetch errors', async () => {
    const boom = (async () => { throw new Error('down') }) as unknown as typeof fetch
    const tool = fetchClearingPricesTool(want, cfg, boom)
    expect(await tool.execute({})).toEqual({ found: false })
  })

  it('fails soft when the response is not ok', async () => {
    const tool = fetchClearingPricesTool(want, cfg, respond(500))
    expect(await tool.execute({})).toEqual({ found: false })
  })
})

describe('fetchOwnReputationTool', () => {
  const cfg: SellerConfig = { name: 'seller-x', services: ['txline'], floorSol: 0.0003, persona: 'test', reputationUrl: 'http://x/api/reputation' }
  const respond = (status: number, body?: unknown) =>
    (async () => ({ status, ok: status >= 200 && status < 300, json: async () => body })) as unknown as typeof fetch

  it("returns this seller's own track record", async () => {
    const tool = fetchOwnReputationTool(cfg, respond(200, {
      reputation: [{ seller: 'seller-x', awarded: 5, delivered: 4, settled: 4, verifiedPass: 4, verifiedFail: 0, refunded: 1, score: 72 }],
    }))
    const out = await tool.execute({})
    expect(out).toMatchObject({ found: true, awarded: 5, delivered: 4, score: 72 })
  })

  it('reports not found when this seller has no history yet', async () => {
    const tool = fetchOwnReputationTool(cfg, respond(200, { reputation: [] }))
    expect(await tool.execute({})).toEqual({ found: false })
  })

  it('fails soft (not found) when the fetch errors', async () => {
    const boom = (async () => { throw new Error('down') }) as unknown as typeof fetch
    const tool = fetchOwnReputationTool(cfg, boom)
    expect(await tool.execute({})).toEqual({ found: false })
  })

  it('fails soft when the response is not ok', async () => {
    const tool = fetchOwnReputationTool(cfg, respond(500))
    expect(await tool.execute({})).toEqual({ found: false })
  })
})
