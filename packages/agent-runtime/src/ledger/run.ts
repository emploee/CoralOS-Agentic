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
  /** Bus context, when the source (Coral extended state) provides it. */
  threadId?: string
  mentions?: string[]
  timestamp?: string
}

export interface TxEntry {
  /** What the signature settles: 'deposit' | 'release' | 'refund' (open for future kinds). */
  kind: string
  sig: string
  explorer: string
}

/**
 * A payment-rail proof receipt — the durable "what was paid and how was it proven" of one payment
 * leg (e.g. the seller buying upstream context through a rail before delivering). First-class on
 * purpose: even while a rail is a scaffold, its receipt is a formal artifact (`simulated: true`),
 * so promoting the rail to a live provider changes the flag, not the schema, the ledger, or the UI.
 */
export interface ProofReceipt {
  /** The payment rail that issued it: 'pay-sh' | 'x402' | 'solana-pay' | 'escrow' | … */
  rail: string
  /** Upstream provider identity, when the rail has one (e.g. 'pay.sh/txodds-context'). */
  provider?: string
  /** What was bought (e.g. 'txline-edge-upstream'). */
  service?: string
  /** The order/request reference the proof is bound to. */
  reference?: string
  /** The proof itself: a receipt string, payment reference, or Solana signature. */
  proof: string
  amount: string
  currency: string
  paid: boolean
  /** True while the rail is a scaffold — the proof shape is real, the money movement is not. */
  simulated?: boolean
  issuedAt: string
  /** Why `paid` is false, when it is. */
  reason?: string
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
  /** Payment-rail receipts for this round (e.g. the seller's upstream procurement legs). */
  proofReceipts?: ProofReceipt[]
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
