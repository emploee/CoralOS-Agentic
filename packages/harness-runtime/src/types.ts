/**
 * The harness adapter contract — one interface so the market doesn't care whether the seller is a
 * prompt, a coding harness, or a research swarm. The seller agent owns the market protocol, the
 * wallet, and the escrow; an adapter only prices work and produces artifacts. Harness processes
 * never hold keys.
 */
import type { Want } from '@pay/agent-runtime'

export interface SellerConfig {
  name: string
  services: string[]
  floorSol: number
  persona: string
}

export interface BidDecision {
  bid: boolean
  priceSol: number
  note: string
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
