import { describe, it, expect } from 'vitest'
import type { Want } from '@pay/agent-runtime'
import { decideBidGate } from './bid-gate.js'
import type { SellerConfig } from './types.js'

const want: Want = { round: 1, service: 'txline', arg: '123', budgetSol: 0.001 }
const baseCfg: SellerConfig = { name: 'seller-x', services: ['txline'], floorSol: 0.0003, persona: 'test' }

const respond = (status: number, body?: unknown) =>
  (async () => ({ status, ok: status >= 200 && status < 300, json: async () => body })) as unknown as typeof fetch
const scripted = (...replies: string[]) => {
  let call = 0
  return async () => replies[call++]
}
const submitGate = (bid: boolean, reason: string) => JSON.stringify({ tool: 'submit_bid_gate', input: { bid, reason } })

describe('decideBidGate', () => {
  it('bids without calling llm/fetch when no reputation source is configured', async () => {
    const noCall = async () => { throw new Error('should not call') }
    const noFetch = (async () => { throw new Error('should not fetch') }) as unknown as typeof fetch
    const d = await decideBidGate(want, baseCfg, noCall, noFetch)
    expect(d).toEqual({ bid: true, reason: 'no reputation source configured' })
  })

  it('honours a decline from the tool loop', async () => {
    const cfg: SellerConfig = { ...baseCfg, reputationUrl: 'http://x/api/reputation' }
    const d = await decideBidGate(want, cfg, scripted(submitGate(false, 'queue is full')), respond(200, { reputation: [] }))
    expect(d).toEqual({ bid: false, reason: 'queue is full' })
  })

  it('honours a bid decision from the tool loop', async () => {
    const cfg: SellerConfig = { ...baseCfg, reputationUrl: 'http://x/api/reputation' }
    const d = await decideBidGate(want, cfg, scripted(submitGate(true, 'clean record')), respond(200, { reputation: [] }))
    expect(d).toEqual({ bid: true, reason: 'clean record' })
  })

  it('fails open when the LLM errors', async () => {
    const cfg: SellerConfig = { ...baseCfg, reputationUrl: 'http://x/api/reputation' }
    const d = await decideBidGate(want, cfg, async () => { throw new Error('llm down') })
    expect(d).toEqual({ bid: true, reason: 'bid-gate unavailable; bidding by default' })
  })

  it('fails open when the loop exhausts its rounds without deciding', async () => {
    const cfg: SellerConfig = { ...baseCfg, reputationUrl: 'http://x/api/reputation' }
    const d = await decideBidGate(
      want, cfg,
      async () => JSON.stringify({ tool: 'fetch_own_reputation', input: {} }),
      respond(200, { reputation: [] }),
    )
    expect(d).toEqual({ bid: true, reason: 'gate loop exhausted rounds; bidding by default' })
  })

  it('lets the loop proceed even when fetch_own_reputation itself fails inside a round', async () => {
    const cfg: SellerConfig = { ...baseCfg, reputationUrl: 'http://x/api/reputation' }
    const replies = [
      JSON.stringify({ tool: 'fetch_own_reputation', input: {} }),
      submitGate(true, 'no history yet'),
    ]
    let call = 0
    const boom = (async () => { throw new Error('down') }) as unknown as typeof fetch
    const d = await decideBidGate(want, cfg, async () => replies[call++], boom)
    expect(d).toEqual({ bid: true, reason: 'no history yet' })
  })
})
