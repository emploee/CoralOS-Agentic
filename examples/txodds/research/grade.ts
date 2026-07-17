/**
 * Grading - was a delivered prediction actually right, once the match finished?
 *
 * Split the same way detect.ts/watcher.ts are: gradeRun() is pure and network-free (fully unit
 * tested against the verified TxLINE scores schema); gradeRuns() is the thin runner that lists the
 * run ledger, fetches scores, and writes grades back. See GRADING.md for the schema research, the
 * one open interpretive question (cumulative vs. per-period goals), and why prediction/correct are
 * only ever populated for sharp-movement deliveries today.
 */
import { listRuns, readRun, writeRun, type RunRecord, type ScoreOutcome } from '@pay/agent-runtime'
import { TxLineClient } from '../agent/txline.js'

interface SoccerScore {
  Goals: number
}

interface SoccerTotalScore {
  H1?: SoccerScore
  HT?: SoccerScore
  H2?: SoccerScore
  ET1?: SoccerScore
  ET2?: SoccerScore
  PE?: SoccerScore
}

interface ScoreEvent {
  fixtureId?: number
  gameState?: string
  seq?: number
  statusSoccerId?: { title?: string }
  scoreSoccer?: { Participant1?: SoccerTotalScore; Participant2?: SoccerTotalScore }
}

const MATCH_ENDED_STATUSES = new Set(['END'])

// Furthest period present wins - see GRADING.md's "Open question" for why this assumes cumulative
// (not per-period) goals.
const PERIOD_ORDER: (keyof SoccerTotalScore)[] = ['PE', 'ET2', 'ET1', 'H2', 'HT', 'H1']

function totalGoals(total: SoccerTotalScore | undefined): number | undefined {
  if (!total) return undefined
  for (const period of PERIOD_ORDER) {
    const score = total[period]
    if (score && Number.isFinite(score.Goals)) return score.Goals
  }
  return undefined
}

/** TxLINE's convention is highest-seq = most recent/authoritative (see GRADING.md). */
function latestEvent(events: ScoreEvent[]): ScoreEvent | undefined {
  return events.reduce<ScoreEvent | undefined>(
    (latest, e) => (latest === undefined || (e.seq ?? -Infinity) > (latest.seq ?? -Infinity) ? e : latest),
    undefined,
  )
}

type Winner = 'home' | 'draw' | 'away'

/** part1/x/part2 -> home/draw/away, the same convention web/app.js's labelOf already uses. */
function labelToWinner(label: string): Winner | undefined {
  if (label === 'part1') return 'home'
  if (label === 'part2') return 'away'
  if (label === 'x' || label === 'draw') return 'draw'
  return undefined
}

/**
 * Only sharp-movement deliveries carry a structured leadingLabel today - see GRADING.md's scope
 * note. Other services still get actual/winner recorded, just no prediction to score against.
 */
function predictedWinner(run: RunRecord): Winner | undefined {
  const data = run.delivery?.data as Record<string, unknown> | undefined
  const leadingLabel = typeof data?.leadingLabel === 'string' ? data.leadingLabel : undefined
  return leadingLabel ? labelToWinner(leadingLabel) : undefined
}

const now = (): string => new Date().toISOString()

/**
 * Grade one run against its fixture's score events. `undefined` when there's nothing to grade yet
 * (no numeric fixture id on the WANT, or no score events at all - the match hasn't started). A
 * `pending` result means events exist but the match hasn't ended, or the shape didn't parse as
 * expected - never fabricates a grade from an ambiguous read.
 */
export function gradeRun(run: RunRecord, events: unknown): ScoreOutcome | undefined {
  const fixtureArg = run.want?.arg
  if (!fixtureArg || !/^\d+$/.test(fixtureArg)) return undefined
  if (!Array.isArray(events) || !events.length) return undefined

  const latest = latestEvent(events as ScoreEvent[])
  if (!latest) return undefined

  if (!MATCH_ENDED_STATUSES.has(latest.statusSoccerId?.title ?? '')) {
    return { status: 'pending', reason: `match not finished (status=${latest.statusSoccerId?.title ?? latest.gameState ?? 'unknown'})`, checkedAt: now() }
  }

  const home = totalGoals(latest.scoreSoccer?.Participant1)
  const away = totalGoals(latest.scoreSoccer?.Participant2)
  if (home === undefined || away === undefined) {
    return { status: 'pending', reason: 'match ended but score shape unrecognized', checkedAt: now(), raw: latest }
  }

  const winner: Winner = home > away ? 'home' : away > home ? 'away' : 'draw'
  const prediction = predictedWinner(run)
  return {
    status: 'graded',
    checkedAt: now(),
    actual: { home, away, winner },
    ...(prediction ? { prediction, correct: prediction === winner } : {}),
    raw: latest,
  }
}

/** A run worth (re)checking: a numeric-fixture WANT with no grade yet, or a stale pending one. */
function needsGrading(run: RunRecord): boolean {
  if (!run.want?.arg || !/^\d+$/.test(run.want.arg)) return false
  return !run.outcome || run.outcome.status === 'pending'
}

/** Just the slice of TxLineClient gradeRuns needs - lets tests pass a stub instead of a real client. */
export type ScoresSource = Pick<TxLineClient, 'scores'>

/**
 * Runner: lists the run ledger, fetches scores for anything ungraded, writes back any grade
 * gradeRun() produces. One TxLINE call per ungraded round per pass - fine at demo scale.
 */
export async function gradeRuns(baseDir: string, client: ScoresSource = new TxLineClient()): Promise<{ checked: number; graded: number }> {
  const candidates = listRuns(baseDir).filter(needsGrading)
  let graded = 0
  for (const run of candidates) {
    try {
      const events = await client.scores(Number(run.want!.arg))
      const outcome = gradeRun(run, events)
      if (!outcome) continue
      const persisted = readRun(baseDir, run.session, run.round)
      if (!persisted) continue
      writeRun(baseDir, { ...persisted.run, outcome }, persisted.transcript)
      if (outcome.status === 'graded') graded++
    } catch (e) {
      console.error(`[grade] ${run.runId} (fixture ${run.want!.arg}): ${(e as Error).message}`)
    }
  }
  return { checked: candidates.length, graded }
}
