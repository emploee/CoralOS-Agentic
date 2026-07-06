import { describe, it, expect } from 'vitest'
import {
  formatWant, parseWant, formatBid, parseBid, formatAward, parseAward,
  formatEscrowRequired, parseEscrowRequired, formatDeposited, parseDeposited,
  formatPaymentRequired, parsePaymentRequired, formatPaymentProof, parsePaymentProof,
  formatPaymentConfirmed, parsePaymentConfirmed, formatSettled, parseSettled,
  formatRefunded, parseRefunded, formatLlmUsed, parseLlmUsed,
  selectBids, pickCheapest, verb, messageRound,
  type Bid,
} from './protocol.js'

describe('WANT round-trip', () => {
  it('formats and parses', () => {
    const w = { round: 7, service: 'helius-risk', arg: '7jwB', budgetSol: 0.001 }
    expect(parseWant(formatWant(w))).toEqual(w)
  })
  it('rejects a non-WANT', () => {
    expect(parseWant('BID round=7 price=0.0003 by=x')).toBeNull()
  })
})

describe('BID round-trip', () => {
  it('formats and parses with a free-text note', () => {
    const b = { round: 7, priceSol: 0.0006, by: 'seller-premium', note: 'verified, fresh pull' }
    expect(parseBid(formatBid(b))).toEqual(b)
  })
  it('parses without a note', () => {
    expect(parseBid('BID round=3 price=0.0002 by=seller-cheap')).toEqual({
      round: 3, priceSol: 0.0002, by: 'seller-cheap',
    })
  })
})

describe('AWARD + ESCROW_REQUIRED round-trip', () => {
  it('AWARD', () => {
    expect(parseAward(formatAward(9, 'seller-cheap'))).toEqual({ round: 9, to: 'seller-cheap' })
  })
  it('AWARD round-trips the optional reason', () => {
    const msg = formatAward(9, 'seller-cheap', 'best value')
    expect(msg).toContain('reason="best value"')
    expect(parseAward(msg)).toEqual({ round: 9, to: 'seller-cheap', reason: 'best value' })
  })
  it('ESCROW_REQUIRED', () => {
    const t = { round: 9, reference: 'R3f', seller: 'SeLLeRwa11et', amountSol: 0.0006, deadlineSecs: 600, settlement: 'arbiter' as const }
    expect(parseEscrowRequired(formatEscrowRequired(t))).toEqual(t)
  })
  it('DEPOSITED', () => {
    const d = { round: 9, reference: 'R3f', buyer: 'BuYeRwa11et', sig: '5h2abc', settlement: 'arbiter' as const, vault: 'VaU1t', arbiter: 'ArB1t3r' }
    expect(parseDeposited(formatDeposited(d))).toEqual(d)
  })
})

describe('generic payment messages', () => {
  it('PAYMENT_REQUIRED', () => {
    const p = {
      round: 9,
      rail: 'x402' as const,
      amount: '0.05',
      currency: 'USDC' as const,
      reference: 'order-9',
      seller: 'research-agent',
      url: 'https://seller.example/service/txline-edge',
      deadlineSecs: 600,
    }
    expect(parsePaymentRequired(formatPaymentRequired(p))).toEqual(p)
  })

  it('PAYMENT_PROOF and PAYMENT_CONFIRMED', () => {
    const proof = { round: 9, rail: 'pay-sh' as const, reference: 'order-9', proof: 'receipt-1', buyer: 'seller-agent', txSignature: '5sig' }
    expect(parsePaymentProof(formatPaymentProof(proof))).toEqual(proof)

    const confirmed = { round: 9, rail: 'pay-sh' as const, reference: 'order-9', paid: true, amount: '0.03', currency: 'USDC' as const, txSignature: '5sig' }
    expect(parsePaymentConfirmed(formatPaymentConfirmed(confirmed))).toEqual(confirmed)
  })

  it('SETTLED and REFUNDED', () => {
    const settled = { round: 9, rail: 'spl-usdc' as const, reference: 'order-9', amount: '0.20', currency: 'USDC' as const, txSignature: 'settleSig' }
    expect(parseSettled(formatSettled(settled))).toEqual(settled)

    const refunded = { round: 10, rail: 'escrow' as const, reference: 'order-10', reason: 'verifier failed' }
    expect(parseRefunded(formatRefunded(refunded))).toEqual(refunded)
  })
})

describe('LLM_USED', () => {
  it('formats and parses model metadata without prompt or response text', () => {
    const msg = formatLlmUsed({
      round: 9,
      agent: 'buyer-agent',
      purpose: 'buyer_award',
      status: 'used',
      provider: 'openai',
      model: 'gpt-4o-mini',
      reason: 'selected best value',
      guardrail: 'winner must match collected BID set',
      createdAt: '2026-07-06T00:00:00.000Z',
    })
    expect(msg).toContain('LLM_USED round=9')
    expect(parseLlmUsed(msg)).toEqual({
      round: 9,
      agent: 'buyer-agent',
      purpose: 'buyer_award',
      status: 'used',
      provider: 'openai',
      model: 'gpt-4o-mini',
      reason: 'selected best value',
      guardrail: 'winner must match collected BID set',
      createdAt: '2026-07-06T00:00:00.000Z',
    })
  })

  it('rejects unknown statuses', () => {
    expect(parseLlmUsed('LLM_USED round=1 agent=a purpose=p status=maybe')).toBeNull()
  })
})

describe('selection', () => {
  const bids: Bid[] = [
    { round: 7, priceSol: 0.0006, by: 'premium' },
    { round: 7, priceSol: 0.0003, by: 'cheap' },
    { round: 6, priceSol: 0.0001, by: 'cheap' }, // different round - excluded
    { round: 7, priceSol: 0.0002, by: 'cheap' }, // cheap re-bids; last wins
  ]
  it('selectBids filters by round and dedupes by seller (last wins)', () => {
    const r7 = selectBids(bids, 7)
    expect(r7).toHaveLength(2)
    expect(r7.find((b) => b.by === 'cheap')?.priceSol).toBe(0.0002)
  })
  it('pickCheapest picks the lowest price', () => {
    expect(pickCheapest(selectBids(bids, 7))?.by).toBe('cheap')
  })
})

describe('helpers', () => {
  it('verb + messageRound', () => {
    expect(verb('WANT round=7 ...')).toBe('WANT')
    expect(messageRound('BID round=42 price=0.1 by=x')).toBe(42)
  })
})
