import { describe, it, expect, vi } from 'vitest'
import { runToolLoop, toolResult } from './loop.js'
import { BudgetGuard, BudgetExceededError, StepCounter } from './safety.js'
import { grantCapabilities } from './capability.js'
import type { Tool } from './tools.js'

const fetchOdds: Tool<{ id: number }, { odds: number }> = {
  name: 'fetch_odds',
  description: 'Fetch current odds for a fixture.',
  execute: async (input) => ({ odds: input.id === 1 ? 2.1 : 1.9 }),
}

const submitDecision: Tool<{ rationale: string }, { rationale: string }> = {
  name: 'submit_decision',
  description: 'Submit the final decision.',
  execute: async (input) => input,
}

const releaseFunds: Tool<{ amount: number }, { released: boolean }> = {
  name: 'release_funds',
  description: 'Release escrowed funds.',
  capability: 'settle',
  execute: async () => ({ released: true }),
}

function baseCfg(overrides: Partial<Parameters<typeof runToolLoop>[0]> = {}) {
  return {
    agentId: 'test-agent',
    system: 'You are a test agent.',
    initialPrompt: 'Assess fixture 1.',
    tools: [fetchOdds, submitDecision],
    finalToolName: 'submit_decision',
    maxRounds: 5,
    budget: new BudgetGuard(),
    steps: new StepCounter(10),
    ...overrides,
  }
}

describe('runToolLoop', () => {
  it('calls a tool then terminates on the final tool', async () => {
    const replies = [
      JSON.stringify({ tool: 'fetch_odds', input: { id: 1 } }),
      JSON.stringify({ tool: 'submit_decision', input: { rationale: 'odds favour home' } }),
    ]
    let call = 0
    const llm = vi.fn(async () => replies[call++])

    const outcome = await runToolLoop(baseCfg(), llm)

    expect(outcome.finalInput).toEqual({ rationale: 'odds favour home' })
    expect(outcome.toolCalls).toHaveLength(1)
    expect(outcome.toolCalls[0].name).toBe('fetch_odds')
    expect(toolResult(outcome, 'fetch_odds')).toEqual({ odds: 2.1 })
    expect(llm).toHaveBeenCalledTimes(2)
  })

  it('never calls the final tool -> finalInput is undefined after maxRounds', async () => {
    const llm = vi.fn(async () => JSON.stringify({ tool: 'fetch_odds', input: { id: 1 } }))
    const outcome = await runToolLoop(baseCfg({ maxRounds: 3 }), llm)
    expect(outcome.finalInput).toBeUndefined()
    expect(outcome.toolCalls).toHaveLength(3)
    expect(llm).toHaveBeenCalledTimes(3)
  })

  it('nudges and retries on unparseable JSON rather than failing the whole loop', async () => {
    const replies = ['not json at all', JSON.stringify({ tool: 'submit_decision', input: { rationale: 'ok' } })]
    let call = 0
    const llm = vi.fn(async () => replies[call++])
    const outcome = await runToolLoop(baseCfg({ maxRounds: 3 }), llm)
    expect(outcome.finalInput).toEqual({ rationale: 'ok' })
    expect(llm).toHaveBeenCalledTimes(2)
  })

  it('records and continues past an unknown tool name', async () => {
    const replies = [
      JSON.stringify({ tool: 'not_a_real_tool', input: {} }),
      JSON.stringify({ tool: 'submit_decision', input: { rationale: 'done' } }),
    ]
    let call = 0
    const llm = vi.fn(async () => replies[call++])
    const outcome = await runToolLoop(baseCfg({ maxRounds: 3 }), llm)
    expect(outcome.finalInput).toEqual({ rationale: 'done' })
    expect(outcome.records[0]).toMatchObject({ toolName: 'not_a_real_tool', outcome: { kind: 'blocked', reason: 'unknown tool' } })
  })

  it('blocks a capability-gated tool when the grant is missing, and records it', async () => {
    const replies = [
      JSON.stringify({ tool: 'release_funds', input: { amount: 1 } }),
      JSON.stringify({ tool: 'submit_decision', input: { rationale: 'gave up on release' } }),
    ]
    let call = 0
    const llm = vi.fn(async () => replies[call++])
    const outcome = await runToolLoop(baseCfg({ tools: [releaseFunds, submitDecision], maxRounds: 3 }), llm)
    expect(outcome.toolCalls).toHaveLength(0) // release_funds never actually executed
    expect(outcome.records[0]).toMatchObject({ toolName: 'release_funds', capabilityGranted: false, outcome: { kind: 'blocked' } })
  })

  it('allows a capability-gated tool once the matching grant is supplied', async () => {
    const replies = [
      JSON.stringify({ tool: 'release_funds', input: { amount: 1 } }),
      JSON.stringify({ tool: 'submit_decision', input: { rationale: 'released' } }),
    ]
    let call = 0
    const llm = vi.fn(async () => replies[call++])
    const grant = grantCapabilities('arbiter-agent', ['settle'])
    const outcome = await runToolLoop(baseCfg({ tools: [releaseFunds, submitDecision], grant, maxRounds: 3 }), llm)
    expect(outcome.toolCalls[0]).toMatchObject({ name: 'release_funds', output: { released: true } })
  })

  it('records a failed tool execution without throwing the whole loop', async () => {
    const throwingTool: Tool<unknown, unknown> = {
      name: 'flaky',
      description: 'always throws',
      execute: async () => {
        throw new Error('upstream unavailable')
      },
    }
    const replies = [
      JSON.stringify({ tool: 'flaky', input: {} }),
      JSON.stringify({ tool: 'submit_decision', input: { rationale: 'flaky failed, moving on' } }),
    ]
    let call = 0
    const llm = vi.fn(async () => replies[call++])
    const outcome = await runToolLoop(baseCfg({ tools: [throwingTool, submitDecision], maxRounds: 3 }), llm)
    expect(outcome.finalInput).toEqual({ rationale: 'flaky failed, moving on' })
    expect(outcome.records[0]).toMatchObject({ outcome: { kind: 'failed', errorSummary: 'upstream unavailable' } })
  })

  it('propagates BudgetExceededError so the agent process shuts down instead of looping forever', async () => {
    const budget = new BudgetGuard({ maxToolCalls: 1, maxSpendLamports: Number.MAX_SAFE_INTEGER, maxDurationSecs: Number.MAX_SAFE_INTEGER })
    budget.recordToolCall() // already at the cap before the loop even starts
    const llm = vi.fn(async () => JSON.stringify({ tool: 'submit_decision', input: {} }))
    await expect(runToolLoop(baseCfg({ budget }), llm)).rejects.toThrow(BudgetExceededError)
    expect(llm).not.toHaveBeenCalled()
  })
})
