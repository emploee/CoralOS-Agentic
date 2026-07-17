/**
 * Research-market watcher - turns live odds movement into paid WANTs.
 *
 * Polls the oracle proxy's /api/board (run `npm run proxy` first), diffs snapshots with
 * detectEvents, and queues one WANT per event. buyer-agent (in WANT_FEED_URL event mode — see
 * coral-agents/buyer-agent/src/feed/wantFeed.ts) pops the queue one job per cycle:
 *
 *   GET /next        -> 200 { service, arg, budgetSol?, note }  |  204 when quiet
 *   GET /queue       -> { queue, updatedAt }                    (debug/dashboard)
 *   GET /api/health  -> { ok, queued }
 *
 * `/api/board`'s fixtures carry `.odds` as an ARRAY of markets (1X2, over/under, ...) — detectEvents
 * expects a SINGLE `{PriceNames, Pct}` object. Feeding the array straight through (as this file used
 * to) means `.odds.Pct` is always `undefined` and no move is ever detected — `select1x2Market`
 * (`../agent/market.ts`) extracts the one priced 1X2 market per fixture before diffing, fixing that.
 *
 * Env: PROXY_BASE (default http://localhost:8801), POLL_MS (default 60000 - the track brief's own
 *      "every 60 seconds" cadence), MOVE_PCT (default 5), RESEARCH_BUDGET_SOL (optional per-event
 *      budget, capped by the buyer), PORT (default 4600).
 */
import http from 'node:http'
import { detectEvents, type BoardFixture, type BoardSnapshot, type MarketEvent } from './detect.js'
import { select1x2Market } from '../agent/market.js'

const PROXY = process.env.PROXY_BASE ?? 'http://localhost:8801'
const POLL_MS = Number(process.env.POLL_MS ?? 60_000)
const MOVE_PCT = Number(process.env.MOVE_PCT ?? 5)
const BUDGET = process.env.RESEARCH_BUDGET_SOL ? Number(process.env.RESEARCH_BUDGET_SOL) : undefined
const PORT = Number(process.env.PORT ?? 4600)
const MAX_QUEUE = 20

interface RawBoardFixture {
  FixtureId: number
  Participant1?: string
  Participant2?: string
  odds?: unknown
}

let snapshot: BoardSnapshot = {}
const queue: MarketEvent[] = []

/** Builds detect.ts's BoardFixture[] from the proxy's raw board, extracting the 1X2 market per fixture. */
function toBoardFixtures(raw: RawBoardFixture[]): BoardFixture[] {
  return raw.map((f) => {
    const market = select1x2Market(f.odds)
    return {
      fixtureId: f.FixtureId,
      home: f.Participant1,
      away: f.Participant2,
      odds: market ? { PriceNames: market.PriceNames as string[] | undefined, Pct: market.Pct as Array<string | number> | undefined } : null,
    }
  })
}

async function poll(): Promise<void> {
  try {
    const res = await fetch(`${PROXY}/api/board`)
    if (!res.ok) throw new Error(`board ${res.status}`)
    const body = (await res.json()) as { fixtures?: RawBoardFixture[] } | RawBoardFixture[]
    const raw = Array.isArray(body) ? body : (body.fixtures ?? [])
    const board = toBoardFixtures(raw)
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

const json = (res: http.ServerResponse, status: number, body?: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  res.end(body === undefined ? undefined : JSON.stringify(body))
}

http
  .createServer((req, res) => {
    const path = new URL(req.url ?? '/', `http://localhost:${PORT}`).pathname
    if (path === '/api/health') return json(res, 200, { ok: true, queued: queue.length })
    if (path === '/queue') return json(res, 200, { queue, updatedAt: new Date().toISOString() })
    if (path === '/next') {
      const event = queue.shift()
      if (!event) return json(res, 204)
      return json(res, 200, {
        // Only odds-move events are worth a paid sharp-movement analysis; new-fixture events just
        // seed the snapshot, they aren't a signal — see coral-agents/seller-agent's sharp-movement
        // service, which analyzes the *current* market rather than re-detecting the move itself.
        service: event.kind === 'odds-move' ? 'sharp-movement' : 'txline',
        arg: event.arg,
        ...(BUDGET ? { budgetSol: BUDGET } : {}),
        note: event.note,
      })
    }
    json(res, 404, { error: 'not found', routes: ['/next', '/queue', '/api/health'] })
  })
  .listen(PORT, () => console.error(`[watcher] http://localhost:${PORT}/next  (board=${PROXY}, every ${POLL_MS}ms, move>=${MOVE_PCT}pp)`))

setInterval(poll, POLL_MS)
void poll()
