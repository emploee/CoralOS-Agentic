/**
 * Research-market watcher - turns live odds movement into paid WANTs.
 *
 * Polls the oracle proxy's /api/board (examples/txodds - run `npm run proxy` there first), diffs
 * snapshots with detectEvents, and queues one WANT per event. The buyer (in WANT_FEED_URL event
 * mode) pops the queue one job per cycle:
 *
 *   GET /next   -> 200 { service, arg, budgetSol?, note }  |  204 when quiet
 *   GET /queue  -> { queue, updatedAt }                    (debug/dashboard)
 *   GET /api/health
 *
 * Env: PROXY_BASE (default http://localhost:8801), POLL_MS (default 15000), MOVE_PCT (default 5),
 *      RESEARCH_BUDGET_SOL (optional per-event budget, capped by the buyer), PORT (default 4600).
 */
import express from 'express'
import { detectEvents, type BoardFixture, type BoardSnapshot, type MarketEvent } from './detect.js'

const PROXY = process.env.PROXY_BASE ?? 'http://localhost:8801'
const POLL_MS = Number(process.env.POLL_MS ?? 15_000)
const MOVE_PCT = Number(process.env.MOVE_PCT ?? 5)
const BUDGET = process.env.RESEARCH_BUDGET_SOL ? Number(process.env.RESEARCH_BUDGET_SOL) : undefined
const PORT = Number(process.env.PORT ?? 4600)
const MAX_QUEUE = 20

let snapshot: BoardSnapshot = {}
const queue: MarketEvent[] = []

async function poll(): Promise<void> {
  try {
    const res = await fetch(`${PROXY}/api/board`)
    if (!res.ok) throw new Error(`board ${res.status}`)
    const body = (await res.json()) as { fixtures?: BoardFixture[] } | BoardFixture[]
    const board = Array.isArray(body) ? body : (body.fixtures ?? [])
    const result = detectEvents(snapshot, board, MOVE_PCT)
    snapshot = result.snapshot
    for (const e of result.events) {
      if (queue.length >= MAX_QUEUE) queue.shift() // stale events age out, newest research wins
      queue.push(e)
      console.error(`[watcher] queued ${e.kind}: ${e.note}`)
    }
  } catch (err) {
    console.error(`[watcher] poll failed: ${(err as Error).message}`)
  }
}

const app = express()
app.use((_req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); next() })

app.get('/api/health', (_req, res) => res.json({ ok: true, queued: queue.length }))

app.get('/queue', (_req, res) => res.json({ queue, updatedAt: new Date().toISOString() }))

app.get('/next', (_req, res) => {
  const event = queue.shift()
  if (!event) return res.status(204).end()
  res.json({
    service: 'txline',
    arg: event.arg,
    ...(BUDGET ? { budgetSol: BUDGET } : {}),
    note: event.note,
  })
})

setInterval(poll, POLL_MS)
void poll()
app.listen(PORT, () => console.error(`[watcher] http://localhost:${PORT}/next  (board=${PROXY}, every ${POLL_MS}ms, move>=${MOVE_PCT}pp)`))
