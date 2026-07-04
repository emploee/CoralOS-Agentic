/**
 * Run ledger types — the durable record of one paid market round.
 *
 * The moment money moves, "what did the agent actually do?" must have a clickable answer. A
 * RunRecord is that answer: the WANT, every bid, the award reasoning, the escrow terms + deposit,
 * the delivered artifact (content-hashed, same sha256 convention the txodds proxy binds into the
 * escrow `reference`), and every Solana signature with an Explorer link. `transcript.jsonl` beside
 * it keeps the raw Coral messages, so a finished round can be replayed with coral-server down.
 */
import { createHash } from 'node:crypto'

export interface TranscriptEntry {
  sender: string
  text: string
}

export interface TxEntry {
  /** What the signature settles: 'deposit' | 'release' | 'refund' (open for future kinds). */
  kind: string
  sig: string
  explorer: string
}

export interface RunRecord {
  /** `<session>/round-<n>` — globally unique across a coral-server's sessions. */
  runId: string
  session: string
  round: number
  /** Mirrors the feed's RoundStatus: bidding | awarded | deposited | delivered | settled | refunded. */
  status: string
  want?: { service: string; arg: string; budgetSol: number }
  bids: { by: string; priceSol: number; note?: string }[]
  /** Sellers in the market that self-selected out of this round. */
  declined?: string[]
  award?: { to: string; reason?: string }
  escrow?: {
    reference: string
    seller: string
    amountSol: number
    deadlineSecs: number
    deposit?: { sig: string; buyer: string }
  }
  delivery?: { raw: string; data?: unknown; sha256: string }
  /** Verifier verdict (Phase 3) — absent until a verifier agent gates the release. */
  verification?: unknown
  txs: TxEntry[]
  updatedAt: string
}

export function runId(session: string, round: number): string {
  return `${session}/round-${round}`
}

/** Hex sha256 — the delivery/content hash convention shared with the escrow `reference` binding. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** Solana Explorer link for a signature (devnet by default — the kit never runs mainnet). */
export function explorerTx(sig: string, cluster = 'devnet'): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`
}
