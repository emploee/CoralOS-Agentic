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
    expect(d.llm).toMatchObject({ status: 'used', reason: 'model declined to bid' })
  })

  it('falls back to a floor bid when the LLM errors', async () => {
    const d = await decideBid(want, cfg, async () => { throw new Error('llm down') })
    expect(d).toMatchObject({ bid: true, priceSol: 0.0004 })
    expect(d.llm).toMatchObject({ status: 'fallback', reason: 'LLM unavailable: llm down' })
  })

  it('falls back to a floor bid when the loop exhausts its rounds without deciding', async () => {
    const d = await decideBid(want, cfg, async () => JSON.stringify({ tool: 'clamp_price', input: { proposedPriceSol: 0.0006 } }))
    expect(d).toMatchObject({ bid: true, priceSol: 0.0004 })
    expect(d.llm).toMatchObject({ status: 'fallback', reason: 'model exhausted rounds without deciding' })
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
