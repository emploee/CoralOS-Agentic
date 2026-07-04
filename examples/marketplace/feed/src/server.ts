/**
 * Marketplace feed server — the only backend the visualizer needs.
 *
 * Reads a CoralOS session's transcript (extended state, behind the dev token), folds it into typed
 * market rounds with `foldRounds`, and serves CORS-enabled JSON for the React app to poll. The browser
 * never touches coral or Solana — this keeps the token server-side and avoids CORS.
 *
 *   GET /api/health                  → { ok: true }
 *   GET /api/feed?session=<sid>      → { session, rounds, updatedAt, source }   (session defaults to $SESSION)
 *   GET /api/runs                    → { runs, updatedAt }   — the persisted run ledger
 *
 * Every live poll also lands each round in the run ledger (RUNS_DIR, default ../runs): a folder per
 * round with want/bids/award/escrow/delivery/txs JSON + transcript.jsonl. If coral becomes
 * unreachable, /api/feed replays the session from those folders (source: 'ledger') — a finished
 * round stays inspectable with coral-server down.
 *
 * Set FEED_FIXTURE=<path-to-recorded-extended-state.json> to serve a recorded transcript instead of
 * hitting coral — used by the e2e so it exercises the REAL fold/parse path with no devnet.
 *
 * Env: CORAL_SERVER_URL (default http://localhost:5555), CORAL_TOKEN (default dev),
 *      SESSION, MARKET_SELLERS (csv for the declined column), FEED_FIXTURE, RUNS_DIR, PORT (default 4000).
 */
import express from 'express'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { listRuns, reputation } from '@pay/agent-runtime'
import { foldRounds } from './foldRounds.js'
import { collectMessages } from './coralState.js'
import { persistRounds, replaySession } from './persist.js'

const MARKET_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // examples/marketplace

const BASE = process.env.CORAL_SERVER_URL ?? 'http://localhost:5555'
const TOKEN = process.env.CORAL_TOKEN ?? 'dev'
const NS = 'default'
const PORT = Number(process.env.PORT ?? 4000)
const DEFAULT_SESSION = process.env.SESSION ?? ''
const FIXTURE = process.env.FEED_FIXTURE
const SELLERS = (process.env.MARKET_SELLERS ?? 'seller-cheap,seller-premium,seller-lazy')
  .split(',').map((s) => s.trim()).filter(Boolean)
const RUNS_DIR = process.env.RUNS_DIR ?? join(MARKET_DIR, 'runs')

/** Fetch a session's raw extended state — from the FEED_FIXTURE file, else from coral. */
async function readState(session: string): Promise<unknown> {
  if (FIXTURE) return JSON.parse(readFileSync(FIXTURE, 'utf8'))
  const r = await fetch(`${BASE}/api/v1/local/session/${NS}/${session}/extended`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!r.ok) throw new Error(`coral ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

const app = express()
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  next()
})

app.use(express.json())

app.get('/api/health', (_req, res) => res.json({ ok: true }))

/** Operator trigger: launch a market session (runs the marketplace launcher) and return its id. */
app.post('/api/start', (_req, res) => {
  const child = spawn('npm', ['start'], { cwd: MARKET_DIR, shell: true })
  let buf = ''
  let done = false
  const reply = (code: number, body: unknown) => { if (!done) { done = true; res.status(code).json(body) } }
  const onData = (d: Buffer) => {
    buf += d.toString()
    const m = buf.match(/Market session ([a-f0-9-]+)/)
    if (m) reply(200, { session: m[1] })
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('exit', (c) => reply(500, { error: `launcher exited ${c} without a session`, log: buf.slice(-400) }))
  setTimeout(() => reply(504, { error: 'launcher timed out', log: buf.slice(-400) }), 30_000)
})

app.get('/api/feed', async (req, res) => {
  const session = FIXTURE ? 'fixture' : ((req.query.session as string) || DEFAULT_SESSION)
  if (!FIXTURE && !session) return res.status(400).json({ error: 'no session — pass ?session=<id> or set SESSION' })
  try {
    const messages = collectMessages(await readState(session))
    const rounds = foldRounds(messages, SELLERS)
    try {
      persistRounds(RUNS_DIR, session, rounds, messages)
    } catch (err) {
      console.error(`[feed] ledger write failed: ${(err as Error).message}`) // never break the live feed
    }
    res.json({ session, rounds, updatedAt: new Date().toISOString(), source: 'live' })
  } catch (e) {
    // Coral unreachable → replay the run ledger so finished rounds stay inspectable.
    const replayed = replaySession(RUNS_DIR, session, SELLERS)
    if (replayed) return res.json({ session, rounds: replayed, updatedAt: new Date().toISOString(), source: 'ledger' })
    res.status(502).json({ error: `feed failed: ${(e as Error).message}` })
  }
})

/** The run ledger — every persisted round across sessions, for a Runs listing. */
app.get('/api/runs', (_req, res) => {
  try {
    res.json({ runs: listRuns(RUNS_DIR), updatedAt: new Date().toISOString() })
  } catch (e) {
    res.status(500).json({ error: `runs failed: ${(e as Error).message}` })
  }
})

/** Per-seller track record derived from the run ledger (the buyer weighs it at award time). */
app.get('/api/reputation', (_req, res) => {
  try {
    res.json({ reputation: reputation(listRuns(RUNS_DIR)), updatedAt: new Date().toISOString() })
  } catch (e) {
    res.status(500).json({ error: `reputation failed: ${(e as Error).message}` })
  }
})

app.listen(PORT, () => console.error(`[feed] http://localhost:${PORT}/api/feed  (${FIXTURE ? `fixture=${FIXTURE}` : `coral=${BASE}`})`))
