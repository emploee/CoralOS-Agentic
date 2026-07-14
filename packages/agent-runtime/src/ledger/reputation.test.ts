import { describe, it, expect } from 'vitest'
import { reputation, formatReputation, clearingPrices, formatClearingPrices } from './reputation.js'
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

const awarded = (round: number, seller: string, service: string, priceSol: number, updatedAt: string): RunRecord => run({
  runId: `s/round-${round}`, round,
  want: { service, arg: 'x', budgetSol: priceSol * 2 },
  bids: [{ by: seller, priceSol }],
  award: { to: seller },
  updatedAt,
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

describe('clearingPrices - what a service has actually awarded for, not a range to guess in', () => {
  it('computes per-service median/min/max from awarded bids', () => {
    const [txline] = clearingPrices([
      awarded(1, 'seller-a', 'txline', 0.0005, '2026-07-01T00:00:00.000Z'),
      awarded(2, 'seller-b', 'txline', 0.0007, '2026-07-02T00:00:00.000Z'),
      awarded(3, 'seller-a', 'txline', 0.0009, '2026-07-03T00:00:00.000Z'),
    ])
    expect(txline).toMatchObject({ service: 'txline', n: 3, medianPriceSol: 0.0007, minPriceSol: 0.0005, maxPriceSol: 0.0009 })
  })

  it('orders recentPricesSol most-recent-first by updatedAt', () => {
    const [txline] = clearingPrices([
      awarded(1, 'seller-a', 'txline', 0.0005, '2026-07-01T00:00:00.000Z'),
      awarded(2, 'seller-b', 'txline', 0.0007, '2026-07-03T00:00:00.000Z'),
      awarded(3, 'seller-a', 'txline', 0.0009, '2026-07-02T00:00:00.000Z'),
    ])
    expect(txline.recentPricesSol).toEqual([0.0007, 0.0009, 0.0005])
  })

  it('keeps services separate and skips rounds with no award or no matching bid', () => {
    const prices = clearingPrices([
      awarded(1, 'seller-a', 'txline', 0.0005, '2026-07-01T00:00:00.000Z'),
      awarded(2, 'seller-b', 'sharp-movement', 0.0004, '2026-07-02T00:00:00.000Z'),
      run({ round: 3, runId: 's/round-3', want: { service: 'txline', arg: 'x', budgetSol: 0.001 }, status: 'bidding' }),
      run({ round: 4, runId: 's/round-4', want: { service: 'txline', arg: 'x', budgetSol: 0.001 }, award: { to: 'seller-c' }, bids: [{ by: 'seller-d', priceSol: 0.0006 }] }),
    ])
    expect(prices.map((p) => p.service).sort()).toEqual(['sharp-movement', 'txline'])
    expect(prices.find((p) => p.service === 'txline')?.n).toBe(1)
  })

  it('formats a compact line per service', () => {
    const text = formatClearingPrices(clearingPrices([
      awarded(1, 'seller-a', 'txline', 0.0005, '2026-07-01T00:00:00.000Z'),
      awarded(2, 'seller-b', 'txline', 0.0009, '2026-07-02T00:00:00.000Z'),
    ]))
    expect(text).toBe('txline: median 0.0007 SOL (2 awarded, range 0.0005-0.0009)')
  })
})
