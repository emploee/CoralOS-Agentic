/**
 * TxODDS feed server — the backend for the web UI's live "agentic mode" panel.
 *
 * Reads a CoralOS session's transcript (extended state, behind the dev token), folds it into typed
 * market rounds with `foldRounds`, and serves CORS-enabled JSON for `examples/txodds/server/proxy.ts`'s
 * `/api/agentic/*` facade to forward. The browser never touches coral directly — this keeps the token
 * server-side and avoids CORS.
 *
 *   GET /api/health                  → { ok: true }
 *   GET /api/feed?session=<sid>      → { session, rounds, updatedAt, source }   (session defaults to $SESSION)
 *   GET /api/runs                    → { runs, updatedAt }   — the persisted run ledger
 *   GET /api/reputation              → { reputation, clearingPrices, updatedAt }   — per-seller track
 *                                       record plus what each service has actually cleared for,
 *                                       recently — sellers weigh both when pricing (see
 *                                       packages/harness-runtime's bid-gate.ts and quote.ts)
 *   GET /api/threads?session=<sid>   → { session, threads, agents, source }   — the Coral bus view
 *   GET /api/session?session=<sid>   → { session, agents, source }            — roster + presence
 *
 * Every live poll also lands each round in the run ledger (RUNS_DIR, default ../runs): a folder per
 * round with want/bids/award/escrow/delivery/txs JSON + transcript.jsonl. If coral becomes
 * unreachable, /api/feed replays the session from those folders (source: 'ledger') — a finished
 * round stays inspectable with coral-server down.
 *
 * Set FEED_FIXTURE=<path-to-recorded-extended-state.json> to serve a recorded transcript instead of
 * hitting coral — useful for exercising the REAL fold/parse path with no devnet.
 *
 * Env: CORAL_SERVER_URL (default http://localhost:5555), CORAL_TOKEN (default dev),
 *      SESSION, MARKET_SELLERS (csv for the declined column), FEED_FIXTURE, RUNS_DIR, PORT (default 4000).
 */
import express from 'express'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { listRuns, reputation, clearingPrices } from '@pay/agent-runtime'
import { foldRounds } from './foldRounds.js'
import { collectMessages, collectThreads, collectAgents } from './coralState.js'
import { persistRounds, replaySession, replayThreads, mergeOutcomes } from './persist.js'

const TXODDS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..') // examples/txodds

const BASE = process.env.CORAL_SERVER_URL ?? 'http://localhost:5555'
const TOKEN = process.env.CORAL_TOKEN ?? 'dev'
const NS = 'default'
const PORT = Number(process.env.PORT ?? 4000)
const DEFAULT_SESSION = process.env.SESSION ?? ''
const FIXTURE = process.env.FEED_FIXTURE
const SELLERS = (process.env.MARKET_SELLERS ?? 'seller-agent')
  .split(',').map((s) => s.trim()).filter(Boolean)
const RUNS_DIR = process.env.RUNS_DIR ?? join(TXODDS_DIR, 'runs')

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
    // outcome (a post-hoc grade) never appears in Coral thread messages, so foldRounds can't
    // produce it — merge it in from whatever persistRounds above just wrote/preserved.
    mergeOutcomes(RUNS_DIR, session, rounds)
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

/** Per-seller track record plus per-service clearing prices, both derived from the run ledger - the
 *  buyer weighs the former at award time, sellers weigh the latter when pricing a bid. */
app.get('/api/reputation', (_req, res) => {
  try {
    const runs = listRuns(RUNS_DIR)
    res.json({ reputation: reputation(runs), clearingPrices: clearingPrices(runs), updatedAt: new Date().toISOString() })
  } catch (e) {
    res.status(500).json({ error: `reputation failed: ${(e as Error).message}` })
  }
})

/** The Coral bus view: threads with participants, mentions, timestamps (+ the agent roster). */
app.get('/api/threads', async (req, res) => {
  const session = FIXTURE ? 'fixture' : ((req.query.session as string) || DEFAULT_SESSION)
  if (!FIXTURE && !session) return res.status(400).json({ error: 'no session — pass ?session=<id> or set SESSION' })
  try {
    const state = await readState(session)
    res.json({ session, threads: collectThreads(state), agents: collectAgents(state), source: 'live', updatedAt: new Date().toISOString() })
  } catch (e) {
    // Coral unreachable → rebuild threads from the persisted transcripts.
    const threads = replayThreads(RUNS_DIR, session)
    if (threads) return res.json({ session, threads, agents: [], source: 'ledger', updatedAt: new Date().toISOString() })
    res.status(502).json({ error: `threads failed: ${(e as Error).message}` })
  }
})

/** Roster + presence — who is in the session and whether coral says they're running. */
app.get('/api/session', async (req, res) => {
  const session = FIXTURE ? 'fixture' : ((req.query.session as string) || DEFAULT_SESSION)
  if (!FIXTURE && !session) return res.status(400).json({ error: 'no session — pass ?session=<id> or set SESSION' })
  try {
    res.json({ session, agents: collectAgents(await readState(session)), source: 'live', updatedAt: new Date().toISOString() })
  } catch (e) {
    res.status(502).json({ error: `session failed: ${(e as Error).message}` })
  }
})

app.listen(PORT, () => console.error(`[feed] http://localhost:${PORT}/api/feed  (${FIXTURE ? `fixture=${FIXTURE}` : `coral=${BASE}`})`))
