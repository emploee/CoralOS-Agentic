import { describe, it, expect } from 'vitest'
import { reviewBid } from './bid-review.js'
import type { SellerConfig } from './types.js'
import type { Want } from '@pay/agent-runtime'

const cfg: SellerConfig = { name: 'seller-x', services: ['helius-risk'], floorSol: 0.0004, persona: 'test' }
const want: Want = { round: 1, service: 'helius-risk', arg: '7jw', budgetSol: 0.001 }
const proposed = { bid: true, priceSol: 0.0006, note: 'fair price' }

const verdict = (approve: boolean, concern?: string) =>
  JSON.stringify({ tool: 'submit_review_verdict', input: { approve, ...(concern ? { concern } : {}) } })

describe('reviewBid', () => {
  it('approves when the reviewer approves', async () => {
    const v = await reviewBid(want, proposed, cfg, async () => verdict(true))
    expect(v).toEqual({ approve: true })
  })

  it('flags a concern when the reviewer vetoes', async () => {
    const v = await reviewBid(want, proposed, cfg, async () => verdict(false, 'too aggressive'))
    expect(v).toEqual({ approve: false, concern: 'too aggressive' })
  })

  it('fails open when the LLM errors', async () => {
    const v = await reviewBid(want, proposed, cfg, async () => { throw new Error('down') })
    expect(v).toEqual({ approve: true })
  })

  it('fails open when the loop exhausts its rounds', async () => {
    const v = await reviewBid(want, proposed, cfg, async () => JSON.stringify({ tool: 'not_a_real_tool', input: {} }))
    expect(v).toEqual({ approve: true })
  })
})
