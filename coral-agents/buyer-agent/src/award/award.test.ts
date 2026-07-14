import { describe, it, expect } from 'vitest'
import type { Bid, Want } from '@pay/agent-runtime'
import { pickWinner } from './award.js'

const want: Want = { round: 1, service: 'txline', arg: '123', budgetSol: 0.001 }
const pool: Bid[] = [
  { round: 1, priceSol: 0.0005, by: 'seller-a' },
  { round: 1, priceSol: 0.0007, by: 'seller-b' },
]

const scripted = (...replies: string[]) => {
  let call = 0
  return async () => replies[call++]
}
const submitAward = (by: string, reason: string) => JSON.stringify({ tool: 'submit_award', input: { by, reason } })
const respond = (status: number, body?: unknown) =>
  (async () => ({ status, ok: status >= 200 && status < 300, json: async () => body })) as unknown as typeof fetch

describe('pickWinner', () => {
  it('skips the model for a single bid', async () => {
    const d = await pickWinner(want, [pool[0]], 'buyer-x')
    expect(d.winner).toBe(pool[0])
    expect(d.llm).toMatchObject({ status: 'skipped' })
  })

  it('honours the model award via the tool loop', async () => {
    const d = await pickWinner(want, pool, 'buyer-x', undefined, scripted(submitAward('seller-b', 'better track record')))
    expect(d.winner.by).toBe('seller-b')
    expect(d.reason).toBe('better track record')
    expect(d.llm).toMatchObject({ status: 'used' })
  })

  it('falls back to cheapest when the LLM errors', async () => {
    const d = await pickWinner(want, pool, 'buyer-x', undefined, async () => { throw new Error('llm down') })
    expect(d.winner.by).toBe('seller-a')
    expect(d.llm).toMatchObject({ status: 'fallback', reason: 'LLM unavailable: llm down' })
  })

  it('falls back to cheapest when the loop exhausts its rounds', async () => {
    const d = await pickWinner(
      want, pool, 'buyer-x', undefined,
      async () => JSON.stringify({ tool: 'fetch_seller_reputation', input: {} }),
    )
    expect(d.winner.by).toBe('seller-a')
    expect(d.llm).toMatchObject({ status: 'fallback', reason: 'ran out of tool-loop steps before deciding — fell back to the cheapest bid' })
  })

  it('falls back to cheapest when the model picks a seller outside the pool', async () => {
    const d = await pickWinner(want, pool, 'buyer-x', undefined, scripted(submitAward('seller-ghost', 'made up')))
    expect(d.winner.by).toBe('seller-a')
    expect(d.llm).toMatchObject({ status: 'fallback', reason: 'model returned a seller outside the bid pool' })
  })

  it('fetches reputation once and folds it into compute_value_score', async () => {
    const replies = [
      JSON.stringify({ tool: 'fetch_seller_reputation', input: {} }),
      JSON.stringify({ tool: 'compute_value_score', input: { by: 'seller-a', priceSol: 0.0005 } }),
      submitAward('seller-a', 'best value'),
    ]
    let call = 0
    const d = await pickWinner(
      want, pool, 'buyer-x', 'http://x/api/reputation',
      async () => replies[call++],
      respond(200, { reputation: [{ seller: 'seller-a', awarded: 3, delivered: 3, settled: 3, verifiedPass: 3, verifiedFail: 0, refunded: 0, score: 90 }] }),
    )
    expect(d.winner.by).toBe('seller-a')
    expect(d.reason).toBe('best value')
  })
})
