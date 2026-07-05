/**
 * persist — the feed's bridge into the run ledger (`@pay/agent-runtime` `ledger/`).
 *
 * Every poll of a live session also lands each folded round in `RUNS_DIR` as a durable run folder
 * (want/bids/award/escrow/delivery/txs + transcript.jsonl). The transcript is the source of truth:
 * `replaySession` re-folds the persisted messages through the SAME `foldRounds` the live path uses,
 * so a finished market round renders identically with coral-server down.
 *
 * Messages without a `round=` tag (agent chatter) belong to no round and are not persisted.
 */
import {
  writeRun, readRun, listSessionRuns, runId, sha256Hex, explorerTx, messageRound,
  type RunRecord, type TranscriptEntry,
} from '@pay/agent-runtime'
import { foldRounds, type Round, type RawMessage } from './foldRounds.js'
import type { BusThread } from './coralState.js'

/** Map one folded Round onto the ledger's RunRecord (content-hashing the delivery). */
export function toRunRecord(session: string, r: Round): RunRecord {
  return {
    runId: runId(session, r.round),
    session,
    round: r.round,
    status: r.status,
    ...(r.want ? { want: r.want } : {}),
    bids: r.bids,
    ...(r.declined.length ? { declined: r.declined } : {}),
    ...(r.award ? { award: r.award } : {}),
    ...(r.escrow ? { escrow: { ...r.escrow, ...(r.deposit ? { deposit: r.deposit } : {}) } } : {}),
    ...(r.delivered
      ? {
          delivery: {
            raw: r.delivered.raw,
            ...(r.delivered.data !== undefined ? { data: r.delivered.data } : {}),
            sha256: sha256Hex(r.delivered.raw),
          },
        }
      : {}),
    ...(r.verification ? { verification: r.verification } : {}),
    txs: [
      ...(r.deposit ? [{ kind: 'deposit', sig: r.deposit.sig, explorer: explorerTx(r.deposit.sig) }] : []),
      ...(r.release ? [{ kind: 'release', sig: r.release.sig, explorer: explorerTx(r.release.sig) }] : []),
    ],
    updatedAt: new Date().toISOString(),
  }
}

/** The round's slice of the raw transcript — every message carrying its `round=` tag. */
export function roundTranscript(messages: RawMessage[], round: number): TranscriptEntry[] {
  return messages.filter((m) => messageRound(m.text) === round)
}

/** Land every folded round in the ledger. Throws on fs failure — the caller decides how loud. */
export function persistRounds(baseDir: string, session: string, rounds: Round[], messages: RawMessage[]): void {
  for (const r of rounds) writeRun(baseDir, toRunRecord(session, r), roundTranscript(messages, r.round))
}

/** Replay a session purely from disk, or null if it was never persisted. */
export function replaySession(baseDir: string, session: string, sellers: string[]): Round[] | null {
  const runs = listSessionRuns(baseDir, session)
  if (!runs.length) return null
  const messages = runs.flatMap((run) => readRun(baseDir, session, run.round)?.transcript ?? [])
  return foldRounds(messages, sellers)
}

/**
 * Rebuild the bus view from persisted transcripts (coral down): group entries by their threadId.
 * Entries persisted before the bus context existed land in a single "ledger" pseudo-thread.
 * Participants are inferred (senders + mentioned agents).
 */
export function replayThreads(baseDir: string, session: string): BusThread[] | null {
  const runs = listSessionRuns(baseDir, session)
  if (!runs.length) return null
  const entries = runs.flatMap((run) => readRun(baseDir, session, run.round)?.transcript ?? [])
  const byThread = new Map<string, BusThread>()
  for (const e of entries) {
    const id = e.threadId ?? 'ledger'
    let thread = byThread.get(id)
    if (!thread) {
      thread = { id, participants: [], messages: [] }
      byThread.set(id, thread)
    }
    thread.messages.push(e)
    for (const name of [e.sender, ...(e.mentions ?? [])]) {
      if (!thread.participants.includes(name)) thread.participants.push(name)
    }
  }
  return [...byThread.values()]
}
