/**
 * Agent safety gate — bounded resource usage, independent of policy's fund-movement rules.
 *
 * `policy.enforce()` (../policy/policy.ts) decides whether ONE deposit/release is allowed. This
 * module bounds an agent PROCESS across its whole session: how many tool calls, how much lamport
 * spend, how long it may run, and how many consecutive loop iterations before it must stop. Call
 * `budget.check()` at the top of every loop iteration and `steps.tick()` once per iteration;
 * call `budget.recordToolCall()` / `recordSpend()` after each side effect. Construct the guard once
 * at process startup with limits the agent itself can never raise — never let a tool or the model
 * mutate the limit fields.
 */

export type BudgetResource = 'toolCalls' | 'spendLamports' | 'durationSecs'

export class BudgetExceededError extends Error {
  constructor(
    public readonly resource: BudgetResource,
    public readonly limit: number,
    public readonly current: number,
  ) {
    super(`budget exceeded for ${resource}: limit=${limit} current=${current}`)
    this.name = 'BudgetExceededError'
  }
}

export interface BudgetLimits {
  maxToolCalls: number
  maxSpendLamports: number
  maxDurationSecs: number
}

/** Conservative defaults for a hackathon/devnet agent. */
export const DEFAULT_DEVNET_BUDGET: BudgetLimits = {
  maxToolCalls: 200,
  maxSpendLamports: 1_000_000,
  maxDurationSecs: 3600,
}

export class BudgetGuard {
  private toolCalls = 0
  private spendLamports = 0
  private readonly startedAt: number
  private readonly limits: BudgetLimits

  constructor(limits: BudgetLimits = DEFAULT_DEVNET_BUDGET) {
    this.limits = limits
    this.startedAt = Date.now()
  }

  recordToolCall(): void {
    this.toolCalls += 1
  }

  recordSpend(lamports: number): void {
    this.spendLamports += lamports
  }

  /** Throws {@link BudgetExceededError} if any limit is breached. */
  check(): void {
    if (this.toolCalls >= this.limits.maxToolCalls) {
      throw new BudgetExceededError('toolCalls', this.limits.maxToolCalls, this.toolCalls)
    }
    if (this.spendLamports >= this.limits.maxSpendLamports) {
      throw new BudgetExceededError('spendLamports', this.limits.maxSpendLamports, this.spendLamports)
    }
    const elapsedSecs = (Date.now() - this.startedAt) / 1000
    if (elapsedSecs >= this.limits.maxDurationSecs) {
      throw new BudgetExceededError('durationSecs', this.limits.maxDurationSecs, Math.floor(elapsedSecs))
    }
  }

  get currentToolCalls(): number {
    return this.toolCalls
  }

  get currentSpendLamports(): number {
    return this.spendLamports
  }
}

export class StepCapExceededError extends Error {
  constructor(
    public readonly limit: number,
    public readonly current: number,
  ) {
    super(`step cap exceeded: limit=${limit} current=${current}`)
    this.name = 'StepCapExceededError'
  }
}

/** Hard cap on consecutive loop iterations, independent of {@link BudgetGuard}'s tool-call count. */
export class StepCounter {
  private steps = 0
  constructor(private readonly maxSteps: number) {}

  /** Increment and throw {@link StepCapExceededError} if the cap is hit. */
  tick(): void {
    this.steps += 1
    if (this.steps > this.maxSteps) throw new StepCapExceededError(this.maxSteps, this.steps)
  }

  get current(): number {
    return this.steps
  }
}

const MAX_UNTRUSTED_BYTES = 32_768 // 32 KiB

/**
 * Wrap text from an untrusted source (a tool result, another agent's message, a fetched page) in
 * delimiters, so a prompt built from it gives the model a structural hint that this content is
 * data, not an instruction. Not a complete prompt-injection defence — a minimum structural one.
 * Truncates to {@link MAX_UNTRUSTED_BYTES} so a runaway response can't fill the context window.
 */
export function wrapUntrusted(sourceLabel: string, content: string): string {
  const truncated = content.length > MAX_UNTRUSTED_BYTES ? content.slice(0, MAX_UNTRUSTED_BYTES) : content
  return `<untrusted_source label="${sourceLabel}">\n${truncated}\n</untrusted_source>`
}
