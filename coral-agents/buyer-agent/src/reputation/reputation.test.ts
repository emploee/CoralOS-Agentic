import { describe, it, expect } from 'vitest'
import { fetchReputationLines } from './reputation.js'

const respond = (status: number, body?: unknown) =>
  (async () => ({ status, ok: status >= 200 && status < 300, json: async () => body })) as unknown as typeof fetch

describe('fetchReputationLines', () => {
  it('formats the feed reputation into prompt lines', async () => {
    const lines = await fetchReputationLines('http://x/api/reputation', respond(200, {
      reputation: [
        { seller: 'seller-good', awarded: 3, delivered: 3, settled: 3, verifiedPass: 3, verifiedFail: 0, refunded: 0, score: 100 },
        { seller: 'seller-ghost', awarded: 2, delivered: 0, settled: 0, verifiedPass: 0, verifiedFail: 0, refunded: 2, score: 10 },
      ],
    }))
    expect(lines).toContain('seller-good: score 100 (3 won, 3 settled)')
    expect(lines).toContain('seller-ghost: score 10')
  })

  it('returns undefined on an empty ledger, a bad status, or a dead feed', async () => {
    expect(await fetchReputationLines('http://x', respond(200, { reputation: [] }))).toBeUndefined()
    expect(await fetchReputationLines('http://x', respond(500))).toBeUndefined()
    const boom = (async () => { throw new Error('down') }) as unknown as typeof fetch
    expect(await fetchReputationLines('http://x', boom)).toBeUndefined()
  })
})
