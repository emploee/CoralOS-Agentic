/**
 * The typed Tool contract agent loops call through, plus the audit-log record every call is
 * written against. Ports the reference architecture's `Tool` trait and `ToolCallRecord` with the
 * compile-time capability generic dropped — TS checks capabilities at the call site via
 * `requireCapability()`/`hasCapability()` (./capability.ts) instead of the type system.
 */
import type { Capability } from './capability.js'

/** A deterministic key for one tool invocation, so a retried call after a timeout is a no-op, not a double-execution. */
export function idempotencyKey(...parts: (string | number)[]): string {
  return parts.join(':')
}

export interface Tool<Input = unknown, Output = unknown> {
  readonly name: string
  readonly description: string
  /** Capability required to call this tool, if any. Checked by the loop runner before execution. */
  readonly capability?: Capability
  execute(input: Input): Promise<Output>
}

export type ToolCallOutcome =
  | { kind: 'pending' }
  | { kind: 'success' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'failed'; errorSummary: string }
  | { kind: 'timedOut' }

/**
 * Written before execution begins and updated once the result is known — a tamper-evident audit
 * trail an agent desk UI can render per-agent, per-round (see `ToolCallAuditLog` in
 * examples/marketplace/web).
 */
export interface ToolCallRecord {
  traceId: string
  agentId: string
  toolName: string
  idempotencyKey: string
  proposedAt: string
  /** Whether the capability check passed before execution. A denied capability means the tool never ran. */
  capabilityGranted: boolean
  outcome: ToolCallOutcome
}
