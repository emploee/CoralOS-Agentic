/**
 * Run ledger store — one folder per paid round, plain JSON on disk.
 *
 *   <baseDir>/<session>/round-<n>/
 *     run.json           the full RunRecord (what readers load)
 *     want.json          …plus one file per facet, for humans auditing a run
 *     bids.json          without tooling. Facet files are only written when
 *     award.json         the facet exists on the record.
 *     escrow.json        (terms + deposit tx)
 *     delivery.json      (raw + parsed + sha256 content hash)
 *     verification.json
 *     txs.json
 *     transcript.jsonl   the round's raw Coral messages, one JSON per line
 *
 * Runs are never deleted; re-persisting a round overwrites its files with the latest fold, so a
 * round's folder always reflects the furthest state it reached (bidding → … → settled).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { RunRecord, TranscriptEntry } from './run.js'

/** Session ids are uuid-ish, but never trust an id used as a path segment. */
const safeSegment = (s: string): string => s.replace(/[^a-zA-Z0-9._-]/g, '_')

export function runDir(baseDir: string, session: string, round: number): string {
  return join(baseDir, safeSegment(session), `round-${round}`)
}

const writeJson = (dir: string, name: string, value: unknown): void =>
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n', 'utf8')

/** Persist one round's record + transcript. Returns the run folder path. */
export function writeRun(baseDir: string, run: RunRecord, transcript: TranscriptEntry[]): string {
  const dir = runDir(baseDir, run.session, run.round)
  mkdirSync(dir, { recursive: true })

  writeJson(dir, 'run.json', run)
  if (run.want) writeJson(dir, 'want.json', run.want)
  if (run.bids.length) writeJson(dir, 'bids.json', run.bids)
  if (run.award) writeJson(dir, 'award.json', run.award)
  if (run.escrow) writeJson(dir, 'escrow.json', run.escrow)
  if (run.delivery) writeJson(dir, 'delivery.json', run.delivery)
  if (run.verification !== undefined) writeJson(dir, 'verification.json', run.verification)
  if (run.txs.length) writeJson(dir, 'txs.json', run.txs)
  writeFileSync(
    join(dir, 'transcript.jsonl'),
    transcript.map((t) => JSON.stringify(t)).join('\n') + (transcript.length ? '\n' : ''),
    'utf8',
  )
  return dir
}

/** Load one round back, or null if it was never persisted. */
export function readRun(
  baseDir: string,
  session: string,
  round: number,
): { run: RunRecord; transcript: TranscriptEntry[] } | null {
  const dir = runDir(baseDir, session, round)
  const runPath = join(dir, 'run.json')
  if (!existsSync(runPath)) return null
  const run = JSON.parse(readFileSync(runPath, 'utf8')) as RunRecord
  const txPath = join(dir, 'transcript.jsonl')
  const transcript = existsSync(txPath)
    ? readFileSync(txPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TranscriptEntry)
    : []
  return { run, transcript }
}

/** All round records for one session, ascending by round. */
export function listSessionRuns(baseDir: string, session: string): RunRecord[] {
  const dir = join(baseDir, safeSegment(session))
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((name) => /^round-(\d+)$/.exec(name)?.[1])
    .filter((n): n is string => n != null)
    .map((n) => readRun(baseDir, session, Number(n))?.run)
    .filter((r): r is RunRecord => r != null)
    .sort((a, b) => a.round - b.round)
}

/** Every persisted run under the ledger, grouped by session (sessions in directory order). */
export function listRuns(baseDir: string): RunRecord[] {
  if (!existsSync(baseDir)) return []
  return readdirSync(baseDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => listSessionRuns(baseDir, e.name))
}
