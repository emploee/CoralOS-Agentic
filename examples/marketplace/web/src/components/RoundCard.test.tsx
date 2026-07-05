import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { RoundCard } from './RoundCard'
import { settledRound, verifiedRound, refusedRound } from '../../tests/fixtures'

afterEach(cleanup)

describe('RoundCard', () => {
  it('renders the want, both bids, and the declined seller', () => {
    render(<RoundCard round={settledRound} />)
    expect(screen.getByTestId('round').getAttribute('data-round')).toBe('1')
    expect(screen.getAllByTestId('bid')).toHaveLength(2)
    expect(screen.getByTestId('declined').getAttribute('data-seller')).toBe('seller-lazy')
  })

  it('highlights the winning bid with a "won" tag', () => {
    render(<RoundCard round={settledRound} />)
    const winner = screen.getAllByTestId('bid').find((el) => el.getAttribute('data-seller') === 'seller-premium')!
    expect(winner.className).toContain('bid-won')
    expect(within(winner).getByText('won')).toBeTruthy()
  })

  it('shows the LLM award reasoning', () => {
    render(<RoundCard round={settledRound} />)
    expect(screen.getByTestId('reason').textContent).toContain('verified data worth the premium')
  })

  it('links deposit + release to the devnet Explorer with the right sigs', () => {
    render(<RoundCard round={settledRound} />)
    const links = screen.getAllByTestId('settle') as HTMLAnchorElement[]
    expect(links).toHaveLength(2)
    expect(links.some((a) => a.href.includes('3PMa9LBZn7VEMD1qZnmr') && a.href.includes('cluster=devnet'))).toBe(true)
  })

  it('shows the status pill as settled', () => {
    render(<RoundCard round={settledRound} />)
    expect(screen.getByTestId('status').textContent).toBe('settled')
  })

  it('shows a pass verdict from the independent verifier', () => {
    render(<RoundCard round={verifiedRound} />)
    const badge = screen.getByTestId('verification')
    expect(badge.getAttribute('data-verdict')).toBe('pass')
    expect(badge.textContent).toContain('verified')
    expect(badge.textContent).toContain('verifier-agent')
  })

  it('shows a REFUSED release when verification fails (the no-pay path)', () => {
    render(<RoundCard round={refusedRound} />)
    const badge = screen.getByTestId('verification')
    expect(badge.getAttribute('data-verdict')).toBe('fail')
    expect(badge.textContent).toContain('release refused')
    expect(screen.queryAllByTestId('settle')).toHaveLength(1) // deposit only — no release link
  })

  it('labels bids with the harness doing the work', () => {
    render(<RoundCard round={verifiedRound} />)
    const tags = screen.getAllByTestId('harness').map((el) => el.textContent)
    expect(tags).toContain('node-llm')
    expect(tags).toContain('claude-code')
  })

  it('renders no verification badge for pre-verifier rounds', () => {
    render(<RoundCard round={settledRound} />)
    expect(screen.queryByTestId('verification')).toBeNull()
  })
})
