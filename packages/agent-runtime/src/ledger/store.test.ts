import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeRun, readRun, listRuns, listSessionRuns, runDir } from './store.js'
import { runId, sha256Hex, explorerTx, type RunRecord, type TranscriptEntry } from './run.js'

const session = 'a1b2c3d4-session'

const settledRun = (): RunRecord => ({
  runId: runId(session, 1),
  session,
  round: 1,
  status: 'settled',
  want: { service: 'coingecko', arg: 'SOL-USDC', budgetSol: 0.001 },
  bids: [
    { by: 'seller-cheap', priceSol: 0.0002, note: 'available' },
    { by: 'seller-premium', priceSol: 0.0005 },
  ],
  declined: ['seller-lazy'],
  award: { to: 'seller-premium', reason: 'verified data worth the premium' },
  escrow: {
    reference: 'DKQy',
    seller: '7jwB',
    amountSol: 0.0005,
    deadlineSecs: 600,
    deposit: { sig: '5syz', buyer: '47Dp' },
  },
  delivery: {
    raw: '{"coin":"solana","usd":72.33}',
    data: { coin: 'solana', usd: 72.33 },
    sha256: sha256Hex('{"coin":"solana","usd":72.33}'),
  },
  txs: [
    { kind: 'deposit', sig: '5syz', explorer: explorerTx('5syz') },
    { kind: 'release', sig: '3PMa', explorer: explorerTx('3PMa') },
  ],
  updatedAt: '2026-07-04T00:00:00.000Z',
})

const transcript: TranscriptEntry[] = [
  { sender: 'buyer-agent', text: 'WANT round=1 service=coingecko arg=SOL-USDC budget=0.001' },
  { sender: 'seller-premium', text: 'DELIVERED round=1 {"coin":"solana","usd":72.33}' },
]

describe('ledger store', () => {
  let base: string
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'ledger-'))
  })

  it('round-trips a settled run with its transcript', () => {
    writeRun(base, settledRun(), transcript)
    const loaded = readRun(base, session, 1)
    expect(loaded?.run).toEqual(settledRun())
    expect(loaded?.transcript).toEqual(transcript)
  })

  it('writes one facet file per present facet, none for absent ones', () => {
    writeRun(base, settledRun(), transcript)
    const dir = runDir(base, session, 1)
    for (const f of ['run.json', 'want.json', 'bids.json', 'award.json', 'escrow.json', 'delivery.json', 'txs.json', 'transcript.jsonl'])
      expect(existsSync(join(dir, f)), f).toBe(true)
    expect(existsSync(join(dir, 'verification.json'))).toBe(false) // no verifier yet
  })

  it('binds the delivery content hash into delivery.json', () => {
    writeRun(base, settledRun(), transcript)
    const delivery = JSON.parse(readFileSync(join(runDir(base, session, 1), 'delivery.json'), 'utf8'))
    expect(delivery.sha256).toBe(sha256Hex(delivery.raw))
  })

  it('re-persisting a round overwrites with the furthest state', () => {
    const early: RunRecord = { ...settledRun(), status: 'bidding', award: undefined, escrow: undefined, delivery: undefined, txs: [] }
    writeRun(base, early, [transcript[0]])
    writeRun(base, settledRun(), transcript)
    expect(readRun(base, session, 1)?.run.status).toBe('settled')
    expect(readRun(base, session, 1)?.transcript).toHaveLength(2)
  })

  it('lists runs per session ascending, and across sessions', () => {
    writeRun(base, settledRun(), transcript)
    writeRun(base, { ...settledRun(), runId: runId(session, 2), round: 2, status: 'bidding' }, [])
    writeRun(base, { ...settledRun(), runId: runId('other', 1), session: 'other' }, [])
    expect(listSessionRuns(base, session).map((r) => r.round)).toEqual([1, 2])
    expect(listRuns(base)).toHaveLength(3)
    expect(listSessionRuns(base, 'never-ran')).toEqual([])
  })

  it('readRun returns null for a round never persisted', () => {
    expect(readRun(base, session, 99)).toBeNull()
  })

  it('sanitizes hostile session ids used as path segments', () => {
    const hostile = '../../etc/passwd'
    const dir = writeRun(base, { ...settledRun(), session: hostile, runId: runId(hostile, 1) }, [])
    expect(dir.startsWith(base)).toBe(true)
    expect(readRun(base, hostile, 1)?.run.session).toBe(hostile)
  })
})
