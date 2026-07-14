import { describe, it, expect } from 'vitest'
import { decideBid } from './quote.js'
import type { SellerConfig } from './types.js'
import type { Want } from '@pay/agent-runtime'

const cfg: SellerConfig = { name: 'seller-x', services: ['helius-risk'], floorSol: 0.0004, persona: 'test' }
const want: Want = { round: 1, service: 'helius-risk', arg: '7jw', budgetSol: 0.001 }

/** A scripted sequence of tool-loop replies, one JSON string per LLM round. */
const scripted = (...replies: string[]) => {
  let call = 0
  return async () => replies[call++]
}

const submitBid = (bid: boolean, priceSol: number, note: string) =>
  JSON.stringify({ tool: 'submit_bid_decision', input: { bid, priceSol, note } })

describe('decideBid - code-enforced economics', () => {
  it('refuses a service not in inventory (no LLM call)', async () => {
    const d = await decideBid({ ...want, service: 'jupiter' }, cfg, async () => { throw new Error('should not call') })
    expect(d.bid).toBe(false)
    expect(d.llm).toMatchObject({ status: 'skipped', purpose: 'seller_quote', reason: 'service not in seller inventory' })
  })

  it('sits out when the floor exceeds the budget', async () => {
    const d = await decideBid({ ...want, budgetSol: 0.0001 }, cfg, async () => { throw new Error('should not call') })
    expect(d.bid).toBe(false)
    expect(d.llm).toMatchObject({ status: 'skipped', reason: 'budget below seller floor' })
  })

  it('clamps an under-floor LLM price up to the floor', async () => {
    const d = await decideBid(want, cfg, scripted(submitBid(true, 0.0001, 'cheap')))
    expect(d.priceSol).toBe(0.0004) // floor
    expect(d.llm).toMatchObject({ status: 'used', provider: expect.any(String), model: expect.any(String) })
  })

  it('clamps an over-budget LLM price down to the budget', async () => {
    const d = await decideBid(want, cfg, scripted(submitBid(true, 0.005, 'premium')))
    expect(d.priceSol).toBe(0.001) // budget
  })

  it('honours an LLM decline', async () => {
    const d = await decideBid(want, cfg, scripted(submitBid(false, 0, 'too cheap for me')))
    expect(d.bid).toBe(false)
    expect(d.llm).toMatchObject({ status: 'used', reason: 'too cheap for me' })
  })

  it('falls back to a floor bid when the LLM errors', async () => {
    const d = await decideBid(want, cfg, async () => { throw new Error('llm down') })
    expect(d).toMatchObject({ bid: true, priceSol: 0.0004 })
    expect(d.llm).toMatchObject({ status: 'fallback', reason: 'LLM unavailable: llm down' })
  })

  it('falls back to a floor bid when the loop exhausts its rounds without deciding', async () => {
    const d = await decideBid(want, cfg, async () => JSON.stringify({ tool: 'clamp_price', input: { proposedPriceSol: 0.0006 } }))
    expect(d).toMatchObject({ bid: true, priceSol: 0.0004 })
    expect(d.llm).toMatchObject({ status: 'fallback', reason: 'ran out of tool-loop steps before deciding — bid at cost floor instead' })
  })

  it('calls clamp_price then submits a bid via the tool loop', async () => {
    const replies = [
      JSON.stringify({ tool: 'clamp_price', input: { proposedPriceSol: 0.0006 } }),
      submitBid(true, 0.0006, 'fair price'),
    ]
    let call = 0
    const d = await decideBid(want, cfg, async () => replies[call++])
    expect(d).toMatchObject({ bid: true, priceSol: 0.0006, note: 'fair price' })
  })

  it('a review veto turns an approved bid into a decline when reviewEnabled is set', async () => {
    const reviewCfg: SellerConfig = { ...cfg, reviewEnabled: true }
    const replies = [
      submitBid(true, 0.0006, 'fair price'),
      JSON.stringify({ tool: 'submit_review_verdict', input: { approve: false, concern: 'too aggressive' } }),
    ]
    let call = 0
    const d = await decideBid(want, reviewCfg, async () => replies[call++])
    expect(d.bid).toBe(false)
    expect(d.note).toContain('too aggressive')
  })

  it('an approving review lets the bid through when reviewEnabled is set', async () => {
    const reviewCfg: SellerConfig = { ...cfg, reviewEnabled: true }
    const replies = [
      submitBid(true, 0.0006, 'fair price'),
      JSON.stringify({ tool: 'submit_review_verdict', input: { approve: true } }),
    ]
    let call = 0
    const d = await decideBid(want, reviewCfg, async () => replies[call++])
    expect(d).toMatchObject({ bid: true, priceSol: 0.0006 })
  })
})

describe('decideBid - floor derived from real LLM-delivery cost, not one typed-in number', () => {
  it('surcharges the floor for a service listed in llmDeliveryTokens', async () => {
    const llmCfg: SellerConfig = { ...cfg, llmDeliveryTokens: { 'helius-risk': 700 } }
    const d = await decideBid(want, llmCfg, async () => { throw new Error('llm down') })
    expect(d.bid).toBe(true)
    expect(d.priceSol).toBeGreaterThan(cfg.floorSol) // fallback bids at the derived floor
  })

  it('does not surcharge a service absent from llmDeliveryTokens', async () => {
    const llmCfg: SellerConfig = { ...cfg, llmDeliveryTokens: { 'some-other-service': 700 } }
    const d = await decideBid(want, llmCfg, async () => { throw new Error('llm down') })
    expect(d.priceSol).toBe(cfg.floorSol)
  })

  it('clamps an under-floor LLM price up to the derived floor, not the base floor', async () => {
    const llmCfg: SellerConfig = { ...cfg, llmDeliveryTokens: { 'helius-risk': 700 } }
    const d = await decideBid(want, llmCfg, scripted(submitBid(true, 0.0001, 'cheap')))
    expect(d.priceSol).toBeGreaterThan(cfg.floorSol)
  })
})

describe('decideBid - one merged loop: reputation + clearing-price awareness when reputationUrl is set', () => {
  const reputationUrl = 'http://x/api/reputation'
  const clearingBody = {
    clearingPrices: [{ service: 'helius-risk', n: 4, medianPriceSol: 0.0007, minPriceSol: 0.0005, maxPriceSol: 0.0009, recentPricesSol: [0.0007] }],
  }
  const reputationBody = {
    reputation: [{ seller: 'seller-x', awarded: 10, delivered: 10, settled: 10, verifiedPass: 10, verifiedFail: 0, refunded: 0, score: 100 }],
  }
  const respond = (status: number, body?: unknown) =>
    (async () => ({ status, ok: status >= 200 && status < 300, json: async () => body })) as unknown as typeof fetch

  it('offers both fetch_own_reputation and fetch_clearing_prices in the same loop', async () => {
    const repCfg: SellerConfig = { ...cfg, reputationUrl }
    const seenPrompts: string[] = []
    const replies = [
      JSON.stringify({ tool: 'fetch_own_reputation', input: {} }),
      JSON.stringify({ tool: 'fetch_clearing_prices', input: {} }),
      submitBid(true, 0.0007, 'matched median'),
    ]
    let call = 0
    const llm = async (opts: { system: string }) => {
      seenPrompts.push(opts.system)
      return replies[call++]
    }
    const d = await decideBid(want, repCfg, llm, respond(200, { ...reputationBody, ...clearingBody }))
    expect(d).toMatchObject({ bid: true, priceSol: 0.0007 })
    expect(seenPrompts.some((p) => p.includes('fetch_own_reputation'))).toBe(true)
    expect(seenPrompts.some((p) => p.includes('fetch_clearing_prices'))).toBe(true)
  })

  it('a decline after checking reputation needs no separate gate call - one submit_bid_decision does it', async () => {
    const repCfg: SellerConfig = { ...cfg, reputationUrl }
    const replies = [
      JSON.stringify({ tool: 'fetch_own_reputation', input: {} }),
      submitBid(false, 0, 'poor track record'),
    ]
    let call = 0
    const d = await decideBid(want, repCfg, async () => replies[call++], respond(200, reputationBody))
    expect(d.bid).toBe(false)
    expect(d.note).toBe('poor track record')
  })

  it('omits both reputation tools from the prompt when reputationUrl is unset', async () => {
    const seenPrompts: string[] = []
    const llm = async (opts: { system: string }) => {
      seenPrompts.push(opts.system)
      return submitBid(true, 0.0006, 'fair price')
    }
    await decideBid(want, cfg, llm)
    expect(seenPrompts.some((p) => p.includes('fetch_own_reputation'))).toBe(false)
    expect(seenPrompts.some((p) => p.includes('fetch_clearing_prices'))).toBe(false)
  })

  it('mentions the configured strategy in the prompt when reputationUrl is set', async () => {
    const undercutCfg: SellerConfig = { ...cfg, reputationUrl, strategy: 'undercut' }
    const seenPrompts: string[] = []
    const llm = async (opts: { system: string }) => {
      seenPrompts.push(opts.system)
      return submitBid(true, 0.0005, 'undercut')
    }
    await decideBid(want, undercutCfg, llm, respond(200, clearingBody))
    expect(seenPrompts.some((p) => p.includes('win volume'))).toBe(true)
  })
})
