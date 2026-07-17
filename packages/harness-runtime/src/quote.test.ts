import { describe, it, expect } from 'vitest'
import { decideBid } from './quote.js'
import type { SellerConfig } from './types.js'
import type { Want } from '@pay/agent-runtime'

const cfg: SellerConfig = { name: 'seller-x', services: ['helius-risk'], floorSol: 0.0004, persona: 'test' }
const want: Want = { round: 1, service: 'helius-risk', arg: '7jw', budgetSol: 0.001 }

describe('decideBid - deterministic economics', () => {
  it('refuses a service not in inventory', async () => {
    const d = await decideBid({ ...want, service: 'jupiter' }, cfg)
    expect(d).toMatchObject({ bid: false, priceSol: 0, note: 'not in inventory' })
  })

  it('sits out when the floor exceeds the budget', async () => {
    const d = await decideBid({ ...want, budgetSol: 0.0001 }, cfg)
    expect(d).toMatchObject({ bid: false, priceSol: 0, note: 'budget below floor' })
  })

  it('bids at the cost floor without reputationUrl configured', async () => {
    const d = await decideBid(want, cfg)
    expect(d).toMatchObject({ bid: true, priceSol: 0.0004, note: 'priced at cost floor' })
  })
})

describe('decideBid - clearing-price awareness when reputationUrl is set', () => {
  const reputationUrl = 'http://x/api/reputation'
  const clearingBody = {
    clearingPrices: [{ service: 'helius-risk', n: 4, medianPriceSol: 0.0007, minPriceSol: 0.0005, maxPriceSol: 0.0009, recentPricesSol: [0.0007] }],
  }
  const respond = (status: number, body?: unknown) =>
    (async () => ({ status, ok: status >= 200 && status < 300, json: async () => body })) as unknown as typeof fetch

  it('prices at the recent median (balanced, the default strategy)', async () => {
    const repCfg: SellerConfig = { ...cfg, reputationUrl }
    const d = await decideBid(want, repCfg, respond(200, clearingBody))
    expect(d).toMatchObject({ bid: true, priceSol: 0.0007 })
  })

  it('undercut prices just below the recent median', async () => {
    const repCfg: SellerConfig = { ...cfg, reputationUrl, strategy: 'undercut' }
    const d = await decideBid(want, repCfg, respond(200, clearingBody))
    expect(d.priceSol).toBeCloseTo(0.0007 * 0.97, 6)
  })

  it('premium prices near the top of the recent range', async () => {
    const repCfg: SellerConfig = { ...cfg, reputationUrl, strategy: 'premium' }
    const d = await decideBid(want, repCfg, respond(200, clearingBody))
    expect(d.priceSol).toBe(0.0009)
  })

  it('never clamps a strategy price below the floor or above the budget', async () => {
    const repCfg: SellerConfig = { ...cfg, reputationUrl, strategy: 'premium', floorSol: 0.00095 }
    const d = await decideBid(want, repCfg, respond(200, clearingBody))
    expect(d.priceSol).toBe(0.00095) // floor exceeds the clearing max
  })

  it('falls back to the cost floor when the reputation fetch fails', async () => {
    const repCfg: SellerConfig = { ...cfg, reputationUrl }
    const d = await decideBid(want, repCfg, respond(500))
    expect(d).toMatchObject({ bid: true, priceSol: 0.0004, note: 'priced at cost floor' })
  })

  it('falls back to the cost floor when the service has no clearing data yet', async () => {
    const repCfg: SellerConfig = { ...cfg, reputationUrl }
    const d = await decideBid(want, repCfg, respond(200, { clearingPrices: [] }))
    expect(d).toMatchObject({ bid: true, priceSol: 0.0004 })
  })
})
