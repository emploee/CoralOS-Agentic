import { describe, it, expect } from 'vitest'
import type { Bid, Want } from '@pay/agent-runtime'
import { pickWinner } from './award.js'

const want: Want = { round: 1, service: 'txline', arg: '123', budgetSol: 0.001 }
const pool: Bid[] = [
  { round: 1, priceSol: 0.0005, by: 'seller-a' },
  { round: 1, priceSol: 0.0007, by: 'seller-b' },
]

const respond = (status: number, body?: unknown) =>
  (async () => ({ status, ok: status >= 200 && status < 300, json: async () => body })) as unknown as typeof fetch

describe('pickWinner', () => {
  it('skips scoring for a single bid', async () => {
    const d = await pickWinner(want, [pool[0]], 'buyer-x')
    expect(d.winner).toBe(pool[0])
    expect(d.reason).toBe('single bid; no selection needed')
  })

  it('picks the cheaper bid when reputation is unavailable (neutral score for both)', async () => {
    const d = await pickWinner(want, pool, 'buyer-x')
    expect(d.winner.by).toBe('seller-a')
  })

  it('a strong track record can outweigh a higher price', async () => {
    const d = await pickWinner(
      want, pool, 'buyer-x', 'http://x/api/reputation',
      respond(200, {
        reputation: [
          { seller: 'seller-a', awarded: 3, delivered: 3, settled: 3, verifiedPass: 0, verifiedFail: 3, refunded: 0, score: 5 },
          { seller: 'seller-b', awarded: 3, delivered: 3, settled: 3, verifiedPass: 3, verifiedFail: 0, refunded: 0, score: 98 },
        ],
      }),
    )
    expect(d.winner.by).toBe('seller-b')
  })

  it('falls back to the neutral score for a seller with no reputation history', async () => {
    const d = await pickWinner(
      want, pool, 'buyer-x', 'http://x/api/reputation',
      respond(200, { reputation: [] }),
    )
    expect(d.winner.by).toBe('seller-a') // both neutral (50) -> cheaper wins the tie
  })

  it('falls back to the cheaper bid when the reputation fetch fails', async () => {
    const d = await pickWinner(want, pool, 'buyer-x', 'http://x/api/reputation', respond(500))
    expect(d.winner.by).toBe('seller-a')
  })
})
