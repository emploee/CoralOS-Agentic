/**
 * Protocol round e2e - drives a full WANT -> BID -> AWARD -> PAYMENT_REQUIRED -> PAYMENT_PROOF ->
 * PAYMENT_CONFIRMED -> DELIVERED -> SETTLED conversation through the REAL wire format + selection,
 * against an in-memory thread and a fake x402 settlement ledger. No devnet, no network - so CI
 * covers the settlement *sequence* the agents speak (and the `reference` threading), not just the
 * individual parsers in isolation.
 *
 * Here the sellers bid from a fixture so the focus is the end-to-end protocol composition (the wire
 * format + selection + the `reference` threading), not the bidding economics.
 */
import { describe, it, expect } from 'vitest'
import {
  formatWant, parseWant, formatBid, parseBid, formatAward, parseAward,
  formatPaymentRequired, parsePaymentRequired, formatPaymentProof, parsePaymentProof,
  formatPaymentConfirmed, parsePaymentConfirmed, formatSettled,
  selectBids, pickCheapest, verb,
  type Bid,
} from './protocol.js'

/** A tiny in-memory ledger mirroring x402's externally-visible behaviour: a signed-but-unsubmitted
 *  transfer only lands once the merchant submits it, and only ever pays the reference it was signed
 *  for - there is no separate release step, payment IS settlement. */
class FakeX402Ledger {
  private submitted = new Set<string>() // reference
  private bal = new Map<string, number>()
  submit(seller: string, reference: string, amount: number): string {
    if (this.submitted.has(reference)) throw new Error('reuse') // a reference settles once
    this.submitted.add(reference)
    this.bal.set(seller, (this.bal.get(seller) ?? 0) + amount)
    return `SIG${reference}`
  }
  balance = (addr: string): number => this.bal.get(addr) ?? 0
}

const BUYER = 'BUYERxWa11et'
const SELLERS = {
  'seller-cheap': { wallet: 'CHEAPxWa11et', bid: 0.0002 },
  'seller-premium': { wallet: 'PREMxWa11et', bid: 0.0005 },
}

describe('market round e2e - the full x402 settlement sequence over the real protocol', () => {
  it('runs WANT -> BIDx2 -> AWARD -> PAYMENT_REQUIRED -> PAYMENT_PROOF -> PAYMENT_CONFIRMED -> DELIVERED -> SETTLED', () => {
    const thread: string[] = []
    const ledger = new FakeX402Ledger()
    const round = 1
    const budget = 0.001

    // buyer broadcasts the need
    thread.push(formatWant({ round, service: 'coingecko', arg: 'SOL-USDC', budgetSol: budget }))
    const want = parseWant(thread.at(-1)!)!
    expect(want.service).toBe('coingecko')

    // each seller parses the WANT and bids (from the fixture, clamped to budget)
    for (const [name, s] of Object.entries(SELLERS)) {
      thread.push(formatBid({ round, priceSol: Math.min(s.bid, want.budgetSol), by: name, note: 'available' }))
    }

    // buyer collects the bids, picks the cheapest, and awards
    const bids: Bid[] = thread.map((t) => parseBid(t)).filter((b): b is Bid => !!b && b.round === round)
    expect(bids).toHaveLength(2)
    const winner = pickCheapest(selectBids(bids, round))!
    expect(winner.by).toBe('seller-cheap') // cheapest wins
    thread.push(formatAward(round, winner.by, 'cheapest for a price lookup'))

    // winning seller mints a single-use reference and demands payment
    const award = parseAward(thread.at(-1)!)!
    expect(award.to).toBe('seller-cheap')
    const reference = 'REFsingleUse111'
    const sellerWallet = SELLERS[winner.by as keyof typeof SELLERS].wallet
    thread.push(formatPaymentRequired({ round, rail: 'x402', amount: String(winner.priceSol), currency: 'SOL', reference, seller: sellerWallet }))

    // buyer parses the terms, signs (but does not submit), and hands the proof to the seller
    const terms = parsePaymentRequired(thread.at(-1)!)!
    expect(terms.reference).toBe(reference)
    expect(Number(terms.amount)).toBeLessThanOrEqual(budget) // budget respected
    thread.push(formatPaymentProof({ round, rail: 'x402', reference: terms.reference, proof: 'SIGNEDtxBase64', buyer: BUYER }))

    // seller submits + verifies the proof, then confirms and delivers
    const proof = parsePaymentProof(thread.at(-1)!)!
    expect(proof.reference).toBe(reference) // the reference threads all the way through
    const sig = ledger.submit(sellerWallet, proof.reference, Number(terms.amount))
    thread.push(formatPaymentConfirmed({ round, rail: 'x402', reference: proof.reference, paid: true, txSignature: sig }))
    const confirmed = parsePaymentConfirmed(thread.at(-1)!)!
    expect(confirmed.paid).toBe(true)
    thread.push(`DELIVERED round=${round} {"coin":"solana","usd":150}`)

    // buyer sees delivery and marks the round settled
    expect(verb(thread.at(-1)!)).toBe('DELIVERED')
    thread.push(formatSettled({ round, rail: 'x402', reference, amount: terms.amount, txSignature: sig }))

    // -- invariants over the whole round --
    expect(thread.map((t) => verb(t))).toEqual([
      'WANT', 'BID', 'BID', 'AWARD', 'PAYMENT_REQUIRED', 'PAYMENT_PROOF', 'PAYMENT_CONFIRMED', 'DELIVERED', 'SETTLED',
    ])
    expect(ledger.balance(sellerWallet)).toBeCloseTo(winner.priceSol, 9) // seller paid exactly its bid
    expect(ledger.balance(SELLERS['seller-premium'].wallet)).toBe(0)    // the loser is never paid
  })

  it('a reference cannot settle twice - x402 payment is final, not reusable', () => {
    const ledger = new FakeX402Ledger()
    ledger.submit('CHEAPxWa11et', 'REF3', 0.0002)
    expect(() => ledger.submit('CHEAPxWa11et', 'REF3', 0.0002)).toThrow(/reuse/)
  })

  it('selection ignores bids from other rounds', () => {
    const bids: Bid[] = [
      { round: 1, priceSol: 0.0002, by: 'a' },
      { round: 2, priceSol: 0.0001, by: 'b' }, // cheaper but wrong round
    ]
    expect(pickCheapest(selectBids(bids, 1))!.by).toBe('a')
  })
})
