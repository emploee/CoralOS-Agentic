import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDir, sha256Hex, readRun, writeRun, type ScoreOutcome } from '@pay/agent-runtime'
import { foldRounds, type RawMessage } from './foldRounds.js'
import { persistRounds, replaySession, replayThreads, toRunRecord, roundTranscript, mergeOutcomes } from './persist.js'

const sellers = ['seller-cheap', 'seller-premium', 'seller-lazy']
const session = 'e2e-session'

// The same real-devnet happy path the foldRounds tests use, plus untagged chatter.
const messages: RawMessage[] = [
  { sender: 'buyer-agent', text: 'hello market' }, // no round tag → belongs to no run
  { sender: 'buyer-agent', text: 'WANT round=1 service=coingecko arg=SOL-USDC budget=0.001' },
  { sender: 'seller-premium', text: 'BID round=1 price=0.0005 by=seller-premium note=available' },
  { sender: 'seller-cheap', text: 'BID round=1 price=0.0002 by=seller-cheap note=available' },
  { sender: 'buyer-agent', text: 'AWARD round=1 to=seller-premium reason="verified data worth the premium"' },
  { sender: 'seller-premium', text: 'PAYMENT_REQUIRED round=1 rail=x402 amount=0.0005 currency=SOL reference=DKQy seller=7jwB' },
  { sender: 'buyer-agent', text: 'PAYMENT_PROOF round=1 rail=x402 reference=DKQy proof=SIGNEDtxBase64 buyer=47Dp' },
  { sender: 'seller-premium', text: 'PAYMENT_CONFIRMED round=1 rail=x402 reference=DKQy paid=true amount=0.0005 currency=SOL sig=5syz' },
  { sender: 'seller-premium', text: 'DELIVERED round=1 {"coin":"solana","usd":72.33}' },
  { sender: 'buyer-agent', text: 'SETTLED round=1 rail=x402 reference=DKQy amount=0.0005 sig=5syz' },
  { sender: 'buyer-agent', text: 'WANT round=2 service=coingecko arg=BTC-USDC budget=0.001' },
  { sender: 'seller-cheap', text: 'BID round=2 price=0.0002 by=seller-cheap' },
]

// A verified x402 round with an upstream procurement leg alongside the primary settlement.
const verifiedRound: RawMessage[] = [
  { sender: 'buyer-agent', text: 'WANT round=7 service=txline arg=999 budget=0.001' },
  { sender: 'seller-premium', text: 'BID round=7 price=0.0005 by=seller-premium' },
  { sender: 'buyer-agent', text: 'AWARD round=7 to=seller-premium' },
  { sender: 'seller-premium', text: 'PAYMENT_REQUIRED round=7 rail=x402 amount=0.0005 currency=SOL reference=Ref7 seller=7jwB' },
  { sender: 'buyer-agent', text: 'PAYMENT_PROOF round=7 rail=x402 reference=Ref7 proof=SIGNEDtxBase64 buyer=47Dp' },
  { sender: 'seller-premium', text: 'PAYMENT_CONFIRMED round=7 rail=x402 reference=Ref7 paid=true amount=0.0005 currency=SOL sig=depSig' },
  { sender: 'seller-premium', text: 'PAYMENT_REQUIRED round=7 rail=pay-sh amount=0.03 currency=USDC reference=pay-7 seller=pay.sh/txodds-context url=https://pay.sh/api/quicknode' },
  { sender: 'seller-premium', text: 'PAYMENT_PROOF round=7 rail=pay-sh reference=pay-7 proof=pay-sh-demo:abc buyer=seller-premium' },
  {
    sender: 'seller-premium',
    text: 'PAYMENT_CONFIRMED round=7 rail=pay-sh reference=pay-7 paid=true amount=0.03 currency=USDC',
    timestamp: '2026-07-06T00:00:00.000Z',
  },
  { sender: 'seller-premium', text: 'DELIVERED round=7 {"ok":true}' },
  { sender: 'buyer-agent', text: 'VERIFY round=7 sha=abc service=txline arg=999 payload={"ok":true}' },
  { sender: 'verifier-agent', text: 'VERIFIED round=7 verdict=pass by=verifier-agent reason="hash + structure verified"' },
  { sender: 'buyer-agent', text: 'SETTLED round=7 rail=x402 reference=Ref7 amount=0.0005 sig=depSig' },
]

describe('persist', () => {
  let base: string
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'feed-ledger-'))
  })

  it('maps a settled round onto a RunRecord with hash-bound delivery and Explorer-linked txs', () => {
    const [r1] = foldRounds(messages, sellers)
    const rec = toRunRecord(session, r1)
    expect(rec.runId).toBe(`${session}/round-1`)
    expect(rec.status).toBe('settled')
    expect(rec.award).toEqual({ to: 'seller-premium', reason: 'verified data worth the premium' })
    expect(rec.payment?.confirmed).toEqual({ sig: '5syz', buyer: '47Dp' })
    expect(rec.delivery?.sha256).toBe(sha256Hex('{"coin":"solana","usd":72.33}'))
    expect(rec.txs.map((t) => t.kind)).toEqual(['payment'])
    expect(rec.txs[0].explorer).toBe('https://explorer.solana.com/tx/5syz?cluster=devnet')
  })

  it('slices the transcript by round tag, dropping untagged chatter', () => {
    expect(roundTranscript(messages, 1)).toHaveLength(9)
    expect(roundTranscript(messages, 2)).toHaveLength(2)
  })

  it('persists every folded round as a run folder', () => {
    persistRounds(base, session, foldRounds(messages, sellers), messages)
    expect(existsSync(join(runDir(base, session, 1), 'delivery.json'))).toBe(true)
    expect(existsSync(join(runDir(base, session, 2), 'want.json'))).toBe(true)
    const payment = JSON.parse(readFileSync(join(runDir(base, session, 1), 'payment.json'), 'utf8'))
    expect(payment.reference).toBe('DKQy')
  })

  it('replays a persisted session identically to the live fold (coral-server down)', () => {
    const live = foldRounds(messages, sellers)
    persistRounds(base, session, live, messages)
    expect(replaySession(base, session, sellers)).toEqual(live)
  })

  it('replay returns null for a session never persisted', () => {
    expect(replaySession(base, 'nope', sellers)).toBeNull()
    expect(replayThreads(base, 'nope')).toBeNull()
  })

  it('rebuilds the bus view from persisted transcripts (threads + inferred participants)', () => {
    const withBus = messages.map((m, i) => ({
      ...m, threadId: 'market-1', mentions: m.sender === 'buyer-agent' ? ['seller-cheap'] : ['buyer-agent'],
      timestamp: `2026-07-04T00:00:${String(i).padStart(2, '0')}.000Z`,
    }))
    persistRounds(base, session, foldRounds(withBus, sellers), withBus)
    const threads = replayThreads(base, session)!
    expect(threads).toHaveLength(1)
    expect(threads[0].id).toBe('market-1')
    expect(threads[0].participants).toEqual(expect.arrayContaining(['buyer-agent', 'seller-cheap', 'seller-premium']))
    expect(threads[0].messages[0].mentions).toBeTruthy()
  })

  it('folds a verified x402 round to settled, and persists verification.json', () => {
    const [r] = foldRounds(verifiedRound, sellers)
    expect(r.status).toBe('settled')
    expect(r.settled?.sig).toBe('depSig')
    expect(r.verification).toEqual({ verdict: 'pass', by: 'verifier-agent', reason: 'hash + structure verified' })
    expect(r.proofReceipts[0]).toMatchObject({
      rail: 'pay-sh',
      provider: 'pay.sh/txodds-context',
      service: 'txline-upstream',
      paid: true,
      simulated: true,
    })

    persistRounds(base, session, [r], verifiedRound)
    const dir = runDir(base, session, 7)
    expect(JSON.parse(readFileSync(join(dir, 'verification.json'), 'utf8')))
      .toEqual({ verdict: 'pass', by: 'verifier-agent', reason: 'hash + structure verified' })
    expect(JSON.parse(readFileSync(join(dir, 'proof_receipts.json'), 'utf8'))[0])
      .toMatchObject({ rail: 'pay-sh', proof: 'pay-sh-demo:abc', amount: '0.03', currency: 'USDC' })
    expect(replaySession(base, session, sellers)).toEqual([r])
  })

  it('mergeOutcomes attaches a persisted grade onto the in-memory rounds', () => {
    const rounds = foldRounds(messages, sellers)
    persistRounds(base, session, rounds, messages)
    const outcome: ScoreOutcome = { status: 'graded', checkedAt: '2026-07-12T00:00:00.000Z', actual: { home: 2, away: 1, winner: 'part1' }, prediction: 'part1', correct: true }
    // Simulate what proxy.ts's gradeRuns() does: write the grade directly onto the ledger record.
    const loaded = readRun(base, session, 1)!
    writeRun(base, { ...loaded.run, outcome }, loaded.transcript)

    const merged = mergeOutcomes(base, session, rounds)
    expect(merged.find((r) => r.round === 1)?.outcome).toEqual(outcome)
    expect(merged.find((r) => r.round === 2)?.outcome).toBeUndefined()
  })

  it('persistRounds preserves a previously-graded outcome across a subsequent live re-fold', () => {
    const rounds = foldRounds(messages, sellers)
    persistRounds(base, session, rounds, messages)
    const outcome: ScoreOutcome = { status: 'graded', checkedAt: '2026-07-12T00:00:00.000Z', actual: { home: 0, away: 0, winner: 'x' }, prediction: 'x', correct: true }
    const loaded = readRun(base, session, 1)!
    writeRun(base, { ...loaded.run, outcome }, loaded.transcript)

    // A fresh live poll re-folds the SAME messages and re-persists — this must not wipe the grade.
    persistRounds(base, session, foldRounds(messages, sellers), messages)
    expect(readRun(base, session, 1)!.run.outcome).toEqual(outcome)
  })
})
