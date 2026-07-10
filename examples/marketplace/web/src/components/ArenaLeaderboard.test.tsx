import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ArenaLeaderboard } from './ArenaLeaderboard'
import type { SellerReputation } from '../types'

afterEach(cleanup)

const reputation: SellerReputation[] = [
  { seller: 'seller-premium', awarded: 10, delivered: 10, settled: 9, verifiedPass: 9, verifiedFail: 1, refunded: 0, score: 84 },
  { seller: 'seller-cheap', awarded: 12, delivered: 8, settled: 6, verifiedPass: 6, verifiedFail: 2, refunded: 2, score: 38 },
]

describe('ArenaLeaderboard', () => {
  it('renders nothing when there is no reputation data yet', () => {
    render(<ArenaLeaderboard reputation={[]} />)
    expect(screen.queryByTestId('arena-leaderboard')).toBeNull()
  })

  it('ranks sellers in the order the ledger-derived score already sorted them', () => {
    render(<ArenaLeaderboard reputation={reputation} />)
    const rows = screen.getAllByTestId('arena-row')
    expect(rows).toHaveLength(2)
    expect(rows[0].getAttribute('data-seller')).toBe('seller-premium')
    expect(rows[0].textContent).toContain('1')
    expect(rows[1].getAttribute('data-seller')).toBe('seller-cheap')
    expect(rows[1].textContent).toContain('2')
  })

  it('shows the delivered/settled/verify-fail/refunded breakdown, not just the score', () => {
    render(<ArenaLeaderboard reputation={reputation} />)
    const rows = screen.getAllByTestId('arena-row')
    expect(rows[0].textContent).toContain('10 won')
    expect(rows[0].textContent).toContain('9 settled')
    expect(rows[1].textContent).toContain('2 verify-fail')
    expect(rows[1].textContent).toContain('2 refunded')
  })
})
