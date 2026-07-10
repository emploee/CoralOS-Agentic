// The feed server's API contract (mirrors marketplace-feed's Round). Kept here so the browser bundle
// never imports the node-side runtime/anchor/web3 code.

export interface RoundBid {
  by: string
  priceSol: number
  note?: string
}

export type RoundStatus = 'bidding' | 'awarded' | 'deposited' | 'delivered' | 'settled' | 'refunded'

export interface Round {
  round: number
  want?: { service: string; arg: string; budgetSol: number }
  bids: RoundBid[]
  declined: string[]
  award?: { to: string; reason?: string }
  escrow?: { reference: string; seller: string; amountSol: number; deadlineSecs: number }
  deposit?: { sig: string; buyer: string }
  delivered?: { raw: string; data?: unknown }
  /** The independent verifier's verdict — release is gated on it when a verifier is in session. */
  verification?: { verdict: 'pass' | 'fail'; by: string; reason?: string }
  proofReceipts?: ProofReceipt[]
  /** Model-selection audit trail for this round (mirrors LLM_USED market messages). Never prompts/completions. */
  llm?: LlmUse[]
  release?: { sig: string }
  refunded?: boolean
  status: RoundStatus
}

// ── LLM audit trail (mirrors LlmUse in packages/agent-runtime/src/market/protocol.ts) ─────────

export type LlmUseStatus = 'used' | 'fallback' | 'skipped' | 'error'

export interface LlmUse {
  round: number
  agent: string
  purpose: string
  status: LlmUseStatus
  provider?: string
  model?: string
  usedFor?: string
  inputHash?: string
  outputHash?: string
  /** Should always be false — models propose, deterministic policy/verifier code controls funds. */
  affectedFunds?: boolean
  reason?: string
  guardrail?: string
  createdAt?: string
}

export interface Feed {
  session: string
  rounds: Round[]
  updatedAt: string
  /** 'live' (coral) or 'ledger' (replayed from the persisted run folders — coral is down). */
  source?: 'live' | 'ledger'
}

// ── The Coral bus view (/api/threads) ──────────────────────────────────────────

export interface BusMessage {
  sender: string
  text: string
  threadId?: string
  mentions?: string[]
  timestamp?: string
}

export interface BusThread {
  id: string
  name?: string
  creator?: string
  participants: string[]
  messages: BusMessage[]
}

export interface SessionAgent {
  name: string
  status?: string
}

export interface Bus {
  session: string
  threads: BusThread[]
  agents: SessionAgent[]
  source?: 'live' | 'ledger'
}

// ── The run ledger (/api/runs) ─────────────────────────────────────────────────

export interface TxEntry {
  kind: string
  sig: string
  explorer: string
}

export interface ProofReceipt {
  rail: string
  provider?: string
  service?: string
  reference?: string
  proof: string
  amount: string
  currency: string
  paid: boolean
  simulated?: boolean
  issuedAt: string
  reason?: string
}

export interface RunRecord {
  runId: string
  session: string
  round: number
  status: string
  want?: { service: string; arg: string; budgetSol: number }
  bids: RoundBid[]
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
  verification?: { verdict: 'pass' | 'fail'; by: string; reason?: string }
  proofReceipts?: ProofReceipt[]
  txs: TxEntry[]
  updatedAt: string
}

// ── Reputation (/api/reputation) ───────────────────────────────────────────────

export interface SellerReputation {
  seller: string
  awarded: number
  delivered: number
  settled: number
  verifiedPass: number
  verifiedFail: number
  refunded: number
  score: number
}

// ── The research watcher's events (/api/events) ────────────────────────────────

export interface WatcherEvent {
  kind: string
  fixtureId: string
  arg: string
  note: string
}

/** Which harness fulfils a seller's orders (personas set it in their coral-agent.toml). */
export const HARNESS_BY_SELLER: Record<string, string> = {
  'seller-claude': 'claude-code',
  'seller-scribe': 'node-llm',
  'seller-worldcup': 'node-llm',
  'seller-moves': 'node-llm',
  'seller-stats': 'node-llm',
  'seller-cheap': 'node-llm',
  'seller-premium': 'node-llm',
}

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`
