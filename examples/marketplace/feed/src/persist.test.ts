import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDir, sha256Hex } from '@pay/agent-runtime'
import { foldRounds, type RawMessage } from './foldRounds.js'
import { persistRounds, replaySession, toRunRecord, roundTranscript } from './persist.js'

const sellers = ['seller-cheap', 'seller-premium', 'seller-lazy']
const session = 'e2e-session'

// The same real-devnet happy path the foldRounds tests use, plus untagged chatter.
const messages: RawMessage[] = [
  { sender: 'buyer-agent', text: 'hello market' }, // no round tag → belongs to no run
  { sender: 'buyer-agent', text: 'WANT round=1 service=coingecko arg=SOL-USDC budget=0.001' },
  { sender: 'seller-premium', text: 'BID round=1 price=0.0005 by=seller-premium note=available' },
  { sender: 'seller-cheap', text: 'BID round=1 price=0.0002 by=seller-cheap note=available' },
  { sender: 'buyer-agent', text: 'AWARD round=1 to=seller-premium reason="verified data worth the premium"' },
  { sender: 'seller-premium', text: 'ESCROW_REQUIRED round=1 reference=DKQy seller=7jwB amount=0.0005 deadline=600' },
  { sender: 'buyer-agent', text: 'DEPOSITED round=1 reference=DKQy buyer=47Dp sig=5syz' },
  { sender: 'seller-premium', text: 'DELIVERED round=1 {"coin":"solana","usd":72.33}' },
  { sender: 'buyer-agent', text: 'RELEASED round=1 sig=3PMa' },
  { sender: 'buyer-agent', text: 'WANT round=2 service=coingecko arg=BTC-USDC budget=0.001' },
  { sender: 'seller-cheap', text: 'BID round=2 price=0.0002 by=seller-cheap' },
]

// A verifier-gated, arbiter-settled round (the CoralOS default settlement mode).
const verifiedRound: RawMessage[] = [
  { sender: 'buyer-agent', text: 'WANT round=7 service=txline arg=999 budget=0.001' },
  { sender: 'seller-premium', text: 'BID round=7 price=0.0005 by=seller-premium' },
  { sender: 'buyer-agent', text: 'AWARD round=7 to=seller-premium' },
  { sender: 'seller-premium', text: 'ESCROW_REQUIRED round=7 reference=Ref7 seller=7jwB amount=0.0005 deadline=600' },
  { sender: 'buyer-agent', text: 'DEPOSITED round=7 reference=Ref7 buyer=47Dp sig=depSig settlement=arbiter' },
  { sender: 'seller-premium', text: 'DELIVERED round=7 {"ok":true}' },
  { sender: 'buyer-agent', text: 'VERIFY round=7 sha=abc service=txline arg=999 payload={"ok":true}' },
  { sender: 'verifier-agent', text: 'VERIFIED round=7 verdict=pass by=verifier-agent reason="hash + structure verified"' },
  { sender: 'buyer-agent', text: 'ARBITER_RELEASED round=7 sig=relSig settlement=arbiter' },
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
    expect(rec.escrow?.deposit).toEqual({ sig: '5syz', buyer: '47Dp' })
    expect(rec.delivery?.sha256).toBe(sha256Hex('{"coin":"solana","usd":72.33}'))
    expect(rec.txs.map((t) => t.kind)).toEqual(['deposit', 'release'])
    expect(rec.txs[1].explorer).toBe('https://explorer.solana.com/tx/3PMa?cluster=devnet')
  })

  it('slices the transcript by round tag, dropping untagged chatter', () => {
    expect(roundTranscript(messages, 1)).toHaveLength(8)
    expect(roundTranscript(messages, 2)).toHaveLength(2)
  })

  it('persists every folded round as a run folder', () => {
    persistRounds(base, session, foldRounds(messages, sellers), messages)
    expect(existsSync(join(runDir(base, session, 1), 'delivery.json'))).toBe(true)
    expect(existsSync(join(runDir(base, session, 2), 'want.json'))).toBe(true)
    const escrow = JSON.parse(readFileSync(join(runDir(base, session, 1), 'escrow.json'), 'utf8'))
    expect(escrow.reference).toBe('DKQy')
  })

  it('replays a persisted session identically to the live fold (coral-server down)', () => {
    const live = foldRounds(messages, sellers)
    persistRounds(base, session, live, messages)
    expect(replaySession(base, session, sellers)).toEqual(live)
  })

  it('replay returns null for a session never persisted', () => {
    expect(replaySession(base, 'nope', sellers)).toBeNull()
  })

  it('folds a verifier-gated arbiter round to settled, and persists verification.json', () => {
    const [r] = foldRounds(verifiedRound, sellers)
    expect(r.status).toBe('settled') // ARBITER_RELEASED counts as settled
    expect(r.release?.sig).toBe('relSig')
    expect(r.verification).toEqual({ verdict: 'pass', by: 'verifier-agent', reason: 'hash + structure verified' })

    persistRounds(base, session, [r], verifiedRound)
    const dir = runDir(base, session, 7)
    expect(JSON.parse(readFileSync(join(dir, 'verification.json'), 'utf8')))
      .toEqual({ verdict: 'pass', by: 'verifier-agent', reason: 'hash + structure verified' })
    expect(replaySession(base, session, sellers)).toEqual([r])
  })
})
