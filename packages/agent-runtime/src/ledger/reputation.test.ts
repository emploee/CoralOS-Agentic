import { describe, it, expect } from 'vitest'
import { reputation, formatReputation } from './reputation.js'
import type { RunRecord } from './run.js'

const run = (over: Partial<RunRecord>): RunRecord => ({
  runId: 's/round-1', session: 's', round: 1, status: 'settled', bids: [], txs: [],
  updatedAt: '2026-07-04T00:00:00.000Z', ...over,
})

const settled = (round: number, seller: string): RunRecord => run({
  runId: `s/round-${round}`, round,
  award: { to: seller },
  delivery: { raw: '{}', sha256: 'x' },
  verification: { verdict: 'pass', by: 'verifier-agent' },
  txs: [
    { kind: 'deposit', sig: 'd', explorer: 'e' },
    { kind: 'release', sig: 'r', explorer: 'e' },
  ],
})

describe('reputation - derived from the run ledger, not asserted', () => {
  it('scores a clean seller at 100', () => {
    const [r] = reputation([settled(1, 'seller-good'), settled(2, 'seller-good')])
    expect(r).toMatchObject({ seller: 'seller-good', awarded: 2, delivered: 2, settled: 2, verifiedPass: 2, score: 100 })
  })

  it('a no-show (awarded, never delivered, refunded) scores near zero', () => {
    const noShow = run({ award: { to: 'seller-ghost' }, status: 'refunded' })
    const [r] = reputation([noShow])
    expect(r).toMatchObject({ seller: 'seller-ghost', awarded: 1, delivered: 0, settled: 0, refunded: 1 })
    expect(r.score).toBeLessThanOrEqual(10) // only the (vacuous) cleanliness term survives
  })

  it('a verify-fail drags the score down but delivery still counts', () => {
    const failed = run({
      round: 3, runId: 's/round-3',
      award: { to: 'seller-shady' },
      delivery: { raw: '{}', sha256: 'x' },
      verification: { verdict: 'fail', by: 'verifier-agent', reason: 'hash mismatch' },
      status: 'delivered',
    })
    const [r] = reputation([failed])
    expect(r).toMatchObject({ verifiedFail: 1, settled: 0 })
    expect(r.score).toBe(30) // 0.3 delivery, no settle, cleanliness zeroed
  })

  it('ranks sellers by score and skips unawarded rounds', () => {
    const biddingOnly = run({ round: 9, runId: 's/round-9', status: 'bidding' })
    const reps = reputation([settled(1, 'seller-good'), run({ award: { to: 'seller-ghost' }, status: 'refunded' }), biddingOnly])
    expect(reps.map((r) => r.seller)).toEqual(['seller-good', 'seller-ghost'])
  })

  it('formats prompt lines with the failure counts visible', () => {
    const text = formatReputation(reputation([
      settled(1, 'seller-good'),
      run({ round: 2, runId: 's/round-2', award: { to: 'seller-ghost' }, status: 'refunded' }),
    ]))
    expect(text).toContain('seller-good: score 100 (1 won, 1 settled)')
    expect(text).toContain('refunded')
  })
})
