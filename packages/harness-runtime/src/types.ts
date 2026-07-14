/**
 * The harness adapter contract — one interface so the market doesn't care whether the seller is a
 * prompt, a coding harness, or a research swarm. The seller agent owns the market protocol, the
 * wallet, and the escrow; an adapter only prices work and produces artifacts. Harness processes
 * never hold keys.
 */
import type { LlmUse, Want } from '@pay/agent-runtime'

export interface SellerConfig {
  name: string
  services: string[]
  /** Base business floor - a legitimate per-persona choice for a deterministic (cache-hit) service.
   *  For a service in `llmDeliveryTokens`, the real cost of that LLM call is derived and added on
   *  top of this (see harness-runtime's cost.ts) rather than typed into one flat number. */
  floorSol: number
  persona: string
  /** Pricing posture once clearing-price data is available (reputationUrl set): undercut to win
   *  volume, premium to bank on quality, or balanced (default) to track the recent median. A no-op
   *  without reputationUrl - there is no clearing data to act on. */
  strategy?: 'undercut' | 'premium' | 'balanced'
  /** Services this seller's delivery code actually calls an LLM for, and the max_tokens budget that
   *  call uses - lets the floor for that service be derived from the call's real cost instead of
   *  typed in per persona (see cost.ts's deriveFloorSol). Absent/unlisted services keep floorSol as-is. */
  llmDeliveryTokens?: Record<string, number>
  /** Run a second, independently-prompted adversarial review before posting a proposed bid. */
  reviewEnabled?: boolean
  /** The feed's /api/reputation - when set, decideBid's tool loop (quote.ts) gains fetch_own_reputation
   *  (whether this round is worth bidding at all) and fetch_clearing_prices (what to bid), so pricing
   *  and the go/no-go decision are one reasoning pass instead of two. */
  reputationUrl?: string
}

export interface BidDecision {
  bid: boolean
  priceSol: number
  note: string
  /** Model-selection metadata for the quote decision; never contains prompts or completions. */
  llm?: LlmUse
}

/** An awarded, escrow-funded job the adapter must now execute. */
export interface Order {
  round: number
  service: string
  arg: string
  priceSol: number
  /** Escrow reference this delivery settles against, when the seller has bound one. */
  reference?: string
  /** Isolated working directory for file-producing harnesses (one per order). */
  workdir?: string
}

export interface Delivery {
  /** The payload placed on the DELIVERED message — a JSON string by market convention. */
  payload: string
  /** sha256 hex of `payload` — the same content-hash convention the ledger and escrow bind. */
  sha256: string
  summary?: string
  /** Model-selection metadata for delivery work; never contains prompts or completions. */
  llm?: LlmUse[]
  /** Files the harness produced, relative to `workdir`. */
  artifacts?: string[]
}

/** One step of harness work, streamed into the run ledger's transcript. */
export interface HarnessEvent {
  ts: string
  /** 'start' | 'log' | 'tool' | 'delivered' | 'error' — open for harness-specific kinds. */
  kind: string
  text?: string
  data?: unknown
}

export type OnHarnessEvent = (e: HarnessEvent) => void

export interface HarnessAdapter {
  readonly name: string
  /** Price a WANT (or decline it). Economic guards are enforced in code, not by the model. */
  quote(want: Want, cfg: SellerConfig): Promise<BidDecision>
  /** Execute a funded order, streaming progress events, and return the hash-bound delivery. */
  run(order: Order, onEvent?: OnHarnessEvent): Promise<Delivery>
}

/** The order line a text-in/text-out service function receives ("<service> <arg>"). */
export function orderRequest(order: Order): string {
  return `${order.service} ${order.arg}`.trim()
}
