/**
 * Bounded, provider-agnostic tool-calling loop — the TS sibling of the reference architecture's
 * `loop_runner.rs`.
 *
 * `llm/complete.ts` is a single-shot system+user -> text call with no native function-calling
 * exposed (by design: it stays a small, dependency-light, three-provider shim). This loop gets
 * multi-turn tool use out of that primitive by asking the model to reply with strict JSON
 * (`{"tool": "<name>", "input": {...}}`) each round instead of relying on a provider's native
 * tool_call format — the same "model proposes structured JSON, code decides" contract every other
 * agent in this repo already uses (market/protocol.ts, verify.ts, service.ts). The trade-off
 * against coral-agents/buyer-agent's Anthropic-native tool loop: no provider-native tool
 * schema/validation, but the same loop runs under any of the three configured providers.
 *
 * The model MUST terminate by calling `finalToolName` — never by prose — so the caller gets a
 * typed final answer instead of scraping free text.
 */
import { complete, parseJsonReply, type CompleteOpts } from '../llm/index.js'
import { hasCapability, type CapabilityGrant } from './capability.js'
import { wrapUntrusted, type BudgetGuard, type StepCounter } from './safety.js'
import type { Tool, ToolCallRecord } from './tools.js'

export interface ToolLoopOutcome {
  /** Every successful tool call the loop made, in order, with its parsed input and result. */
  toolCalls: { name: string; input: unknown; output: unknown }[]
  /** The final tool's input, or undefined if the loop exhausted maxRounds without terminating. */
  finalInput: unknown
  /** The full audit trail, including blocked/failed attempts — one record per tool-call attempt. */
  records: ToolCallRecord[]
}

export interface ToolLoopConfig {
  agentId: string
  system: string
  initialPrompt: string
  tools: Tool[]
  finalToolName: string
  maxRounds: number
  budget: BudgetGuard
  steps: StepCounter
  grant?: CapabilityGrant
  model?: CompleteOpts['model']
  maxTokens?: number
}

type Llm = (opts: CompleteOpts) => Promise<string>

/**
 * The most recent result of the named tool call, or undefined if it was never called. Useful for
 * pulling a deterministic tool's own output out of the trace instead of trusting the model's
 * self-reported summary of it (the same discipline sharp-movement-detector uses: the tool's
 * `is_sharp_move` gates the signal, never the model's narrative).
 */
export function toolResult(outcome: ToolLoopOutcome, name: string): unknown {
  return [...outcome.toolCalls].reverse().find((c) => c.name === name)?.output
}

function loopSystemPrompt(base: string, tools: Tool[], finalToolName: string): string {
  const catalog = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n')
  return `${base}

You have these tools available. Reply with EXACTLY ONE JSON object per turn, nothing else:
  {"tool": "<tool name>", "input": <tool input object>}

Available tools:
${catalog}

You MUST terminate by calling "${finalToolName}" — never answer in plain prose.`
}

export async function runToolLoop(cfg: ToolLoopConfig, llm: Llm = complete): Promise<ToolLoopOutcome> {
  const toolCalls: ToolLoopOutcome['toolCalls'] = []
  const records: ToolCallRecord[] = []
  const system = loopSystemPrompt(cfg.system, cfg.tools, cfg.finalToolName)
  const byName = new Map(cfg.tools.map((t) => [t.name, t]))
  const record = (toolName: string, round: number, proposedAt: string, capabilityGranted: boolean, outcome: ToolCallRecord['outcome']) =>
    records.push({ traceId: cfg.agentId, agentId: cfg.agentId, toolName, idempotencyKey: `${cfg.agentId}:${round}`, proposedAt, capabilityGranted, outcome })

  let transcript = cfg.initialPrompt

  for (let round = 0; round < cfg.maxRounds; round++) {
    cfg.budget.check()
    cfg.steps.tick()

    const text = await llm({ system, user: transcript, model: cfg.model, maxTokens: cfg.maxTokens ?? 400 })
    const parsed = parseJsonReply<{ tool?: string; input?: unknown }>(text)

    if (!parsed?.tool) {
      // Unparseable / no tool call — nudge and give the model another round rather than failing
      // the whole loop on one malformed reply.
      transcript += `\n\n${wrapUntrusted('previous_reply', text)}\nThat reply was not valid tool-call JSON. Reply with {"tool": "...", "input": {...}}.`
      continue
    }

    if (parsed.tool === cfg.finalToolName) {
      return { toolCalls, finalInput: parsed.input, records }
    }

    const proposedAt = new Date().toISOString()
    const tool = byName.get(parsed.tool)
    if (!tool) {
      record(parsed.tool, round, proposedAt, false, { kind: 'blocked', reason: 'unknown tool' })
      transcript += `\n\ntool "${parsed.tool}" does not exist. Available tools: ${cfg.tools.map((t) => t.name).join(', ')}`
      continue
    }

    const capabilityGranted = tool.capability ? hasCapability(cfg.grant, tool.capability) : true
    if (!capabilityGranted) {
      record(tool.name, round, proposedAt, false, { kind: 'blocked', reason: `capability denied: requires '${tool.capability}'` })
      transcript += `\n\ntool "${tool.name}" was blocked: capability denied.`
      continue
    }

    cfg.budget.recordToolCall()
    try {
      const output = await tool.execute(parsed.input)
      toolCalls.push({ name: tool.name, input: parsed.input, output })
      record(tool.name, round, proposedAt, capabilityGranted, { kind: 'success' })
      transcript += `\n\n${wrapUntrusted(`${tool.name}_result`, JSON.stringify(output))}`
    } catch (e) {
      const errorSummary = (e as Error).message.slice(0, 200)
      record(tool.name, round, proposedAt, capabilityGranted, { kind: 'failed', errorSummary })
      transcript += `\n\ntool "${tool.name}" failed: ${errorSummary}`
    }
  }

  return { toolCalls, finalInput: undefined, records }
}
