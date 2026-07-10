/**
 * signal-agent — turns live odds movement into paid research WANTs, as a Coral-native participant.
 *
 * Replaces hand-running `examples/txodds/research/watcher.ts` as a bare, unbounded HTTP script:
 * this is the same poll-and-diff logic, but run as a `coral-agents/*` citizen (its own README,
 * Dockerfile, `coral-agent.toml`, tests) that connects to CoralOS so it shows up in the session
 * roster and Coral Console bus, and whose poll loop is bounded by `packages/agent-runtime`'s
 * agent-safety framework (`BudgetGuard` + `StepCounter`) instead of running forever unsupervised.
 *
 * It still serves the exact `/next` `/queue` `/api/health` HTTP contract the watcher did, so
 * `examples/marketplace/research.ts`'s `WANT_FEED_URL` buyer wiring needs no changes — run this in
 * place of `npm run research:watch` (see this package's README for both run modes).
 *
 *   GET /next        -> 200 { service, arg, budgetSol?, note }  |  204 when quiet
 *   GET /queue       -> { queue, updatedAt }                    (debug/dashboard)
 *   GET /api/health  -> { ok, queued, toolCalls, steps }
 *
 * Env: PROXY_BASE (default http://localhost:8801), POLL_MS (default 15000), MOVE_PCT (default 5),
 *      RESEARCH_BUDGET_SOL (optional per-event budget), PORT (default 4600),
 *      SIGNAL_MAX_TOOL_CALLS / SIGNAL_MAX_DURATION_SECS (optional BudgetGuard overrides).
 */
import http from 'node:http'
import {
  startCoralAgent,
  BudgetGuard, StepCounter, BudgetExceededError, StepCapExceededError,
  type BudgetLimits,
} from '@pay/agent-runtime'
import { detectSignals, type BoardFixture, type BoardSnapshot, type SignalEvent } from './detect.js'

const NAME = process.env.AGENT_NAME ?? 'signal-agent'
const PROXY = process.env.PROXY_BASE ?? 'http://localhost:8801'
const POLL_MS = Number(process.env.POLL_MS ?? 15_000)
const MOVE_PCT = Number(process.env.MOVE_PCT ?? 5)
const BUDGET_SOL = process.env.RESEARCH_BUDGET_SOL ? Number(process.env.RESEARCH_BUDGET_SOL) : undefined
const PORT = Number(process.env.PORT ?? 4600)
const MAX_QUEUE = 20

const limits: BudgetLimits = {
  maxToolCalls: Number(process.env.SIGNAL_MAX_TOOL_CALLS ?? 2000),
  maxSpendLamports: Number.MAX_SAFE_INTEGER, // this agent never moves funds — no spend cap applies
  maxDurationSecs: Number(process.env.SIGNAL_MAX_DURATION_SECS ?? 6 * 3600),
}
const budget = new BudgetGuard(limits)
const steps = new StepCounter(limits.maxToolCalls)

let snapshot: BoardSnapshot = {}
const queue: SignalEvent[] = []

async function poll(onEvent?: (e: SignalEvent) => void): Promise<void> {
  budget.recordToolCall() // the board fetch is this agent's one "tool call" per cycle
  const res = await fetch(`${PROXY}/api/board`)
  if (!res.ok) throw new Error(`board ${res.status}`)
  const body = (await res.json()) as { fixtures?: BoardFixture[] } | BoardFixture[]
  const board = Array.isArray(body) ? body : (body.fixtures ?? [])
  const result = detectSignals(snapshot, board, MOVE_PCT)
  snapshot = result.snapshot
  for (const e of result.events) {
    if (queue.length >= MAX_QUEUE) queue.shift() // stale events age out, newest research wins
    queue.push(e)
    console.error(`[${NAME}] queued ${e.kind}: ${e.note}`)
    onEvent?.(e)
  }
}

/** Bound + quote-neutralize free text from the TxODDS-derived board (team names, etc.) before it goes on the wire, matching protocol.ts's `reason="..."` convention. */
const wireSafe = (text: string): string => text.replace(/"/g, "'").slice(0, 180)

const json = (res: http.ServerResponse, status: number, body?: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
  res.end(body === undefined ? undefined : JSON.stringify(body))
}

http
  .createServer((req, res) => {
    const path = new URL(req.url ?? '/', `http://localhost:${PORT}`).pathname
    if (path === '/api/health') return json(res, 200, { ok: true, queued: queue.length, toolCalls: budget.currentToolCalls, steps: steps.current })
    if (path === '/queue') return json(res, 200, { queue, updatedAt: new Date().toISOString() })
    if (path === '/next') {
      const event = queue.shift()
      if (!event) return json(res, 204)
      return json(res, 200, { service: 'txline', arg: event.arg, ...(BUDGET_SOL ? { budgetSol: BUDGET_SOL } : {}), note: event.note })
    }
    json(res, 404, { error: 'not found', routes: ['/next', '/queue', '/api/health'] })
  })
  .listen(PORT, () => console.error(`[${NAME}] http://localhost:${PORT}/next  (board=${PROXY}, every ${POLL_MS}ms, move>=${MOVE_PCT}pp)`))

await startCoralAgent({ agentName: NAME }, async (ctx) => {
  // A pure observer, not a request/reply participant — it still joins the session so it shows up
  // in the roster and Coral Console, and so its detections are visible on the bus alongside every
  // other agent's messages, not just in its own HTTP queue.
  const threadId = await ctx.createThread('signal-log', [NAME])
  await ctx.send(`${NAME}: watching ${PROXY} every ${POLL_MS}ms (move>=${MOVE_PCT}pp)`, threadId)
  console.error(`[${NAME}] connected; posting detections to thread ${threadId}`)

  while (true) {
    try {
      budget.check()
      steps.tick()
    } catch (e) {
      if (e instanceof BudgetExceededError || e instanceof StepCapExceededError) {
        console.error(`[${NAME}] safety gate tripped (${e.message}) — shutting down`)
        break
      }
      throw e
    }

    try {
      await poll((event) => {
        // note= is board-derived (team names come from the TxODDS API), so it's bounded and
        // quote-neutralized before going on the wire — never trusted as anything but display text.
        void ctx.send(`SIGNAL kind=${event.kind} fixtureId=${event.fixtureId}${event.movePct != null ? ` movePct=${event.movePct}` : ''} note="${wireSafe(event.note)}"`, threadId)
      })
    } catch (err) {
      console.error(`[${NAME}] poll failed: ${(err as Error).message}`)
    }

    await new Promise((r) => setTimeout(r, POLL_MS))
  }
})
