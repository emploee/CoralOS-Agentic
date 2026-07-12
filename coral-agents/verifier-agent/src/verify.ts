/**
 * Delivery verification - the verifier's brain, pure and network-optional so it's fully testable.
 *
 * Deterministic checks decide first (they cannot be prompt-injected):
 *   1. content hash — the payload must hash to the sha the buyer received (payment binds to THIS artifact)
 *   2. structure    — the payload must be JSON and not a top-level error report
 * Only then does the (optional) LLM acceptance judge get a say; if it is unavailable, the
 * deterministic checks stand. Mirrors the decideBid pattern: the model proposes, code enforces.
 */
import {
  sha256Hex, complete, llmRuntimeInfo, runToolLoop, BudgetGuard, StepCounter,
  type LlmUse, type VerifyRequest, type Verdict, type CompleteOpts,
} from '@pay/agent-runtime'
import { inspectPayloadStructureTool, submitVerdictTool, assessScrutiny, type SubmitVerdictInput } from './verify-tools.js'

type Llm = (opts: CompleteOpts) => Promise<string>
export type VerdictWithLlm = Verdict & { llm: LlmUse }

function verifierLlm(
  req: VerifyRequest,
  name: string,
  status: LlmUse['status'],
  reason: string,
  includeModel = true,
  audit: Pick<LlmUse, 'inputHash' | 'outputHash'> = {},
): LlmUse {
  const info = includeModel ? llmRuntimeInfo({ maxTokens: 120 }) : undefined
  return {
    round: req.round,
    agent: name,
    purpose: 'verifier_judgment',
    status,
    ...(info ? { provider: info.provider, model: info.model } : {}),
    usedFor: 'verifier_judgment',
    affectedFunds: false,
    ...audit,
    reason,
    guardrail: 'content hash and JSON structure checks run before model judgment',
    createdAt: new Date().toISOString(),
  }
}

function withLlm(verdict: Verdict, llm: LlmUse): VerdictWithLlm {
  return { ...verdict, llm }
}

const errReason = (e: unknown): string => String((e as Error).message ?? e).slice(0, 120)

export async function checkDelivery(req: VerifyRequest, name: string, llm: Llm = complete): Promise<VerdictWithLlm> {
  const base = { round: req.round, by: name, sha: sha256Hex(req.payload) }

  if (base.sha !== req.sha) {
    return withLlm(
      { ...base, verdict: 'fail', reason: 'content hash mismatch' },
      verifierLlm(req, name, 'skipped', 'content hash mismatch; model not consulted', false),
    )
  }

  let data: unknown
  try {
    data = JSON.parse(req.payload)
  } catch {
    return withLlm(
      { ...base, verdict: 'fail', reason: 'payload is not JSON' },
      verifierLlm(req, name, 'skipped', 'payload is not JSON; model not consulted', false),
    )
  }
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    const err = String((data as Record<string, unknown>).error).slice(0, 40)
    return withLlm(
      { ...base, verdict: 'fail', reason: `payload reports error: ${err}` },
      verifierLlm(req, name, 'skipped', 'payload reported an error; model not consulted', false),
    )
  }
  const structured = data && typeof data === 'object' ? data as Record<string, unknown> : undefined
  if (
    req.service === 'txline' &&
    structured?.service === 'txline-edge' &&
    String(structured.fixtureId ?? '') === req.arg
  ) {
    return withLlm(
      { ...base, verdict: 'pass', reason: 'hash + txline fixture verified' },
      verifierLlm(req, name, 'skipped', 'txline fixture matched deterministic verifier', false),
    )
  }

  const scrutiny = assessScrutiny(req)
  const maxRounds = scrutiny === 'high' ? 4 : 2

  try {
    const system =
      'You are an impartial delivery verifier for a paid agent marketplace. Given an order and the ' +
      'delivered payload, judge whether the payload plausibly fulfils the order. Call ' +
      'inspect_payload_structure to confirm your own read of the payload' +
      (scrutiny === 'high' ? " - this payload doesn't match a known delivery shape, so inspect it before deciding" : '') +
      ', then call submit_verdict with {"pass": boolean, "reason": string}. Keep reason under 10 words.'
    const initialPrompt = `order: service=${req.service} arg=${req.arg}\ndelivered payload: ${req.payload.slice(0, 1500)}`
    const inputHash = sha256Hex(`${system}\n${initialPrompt}`)

    const outcome = await runToolLoop(
      {
        agentId: name,
        system,
        initialPrompt,
        tools: [inspectPayloadStructureTool(req.payload), submitVerdictTool],
        finalToolName: 'submit_verdict',
        maxRounds,
        // No lamports move during a verdict — see the matching note in quote.ts's decideBid.
        budget: new BudgetGuard({ maxToolCalls: maxRounds * 2, maxSpendLamports: Number.MAX_SAFE_INTEGER, maxDurationSecs: 30 }),
        steps: new StepCounter(maxRounds),
        maxTokens: 150,
      },
      llm,
    )
    const finalInput = outcome.finalInput as SubmitVerdictInput | undefined
    const outputHash = finalInput ? sha256Hex(JSON.stringify(finalInput)) : undefined

    if (finalInput?.pass === false) {
      return withLlm(
        { ...base, verdict: 'fail', reason: (finalInput.reason ?? 'judged unacceptable').slice(0, 60) },
        verifierLlm(req, name, 'used', 'model rejected structurally valid payload', true, { inputHash, outputHash }),
      )
    }
    if (finalInput?.pass === true) {
      return withLlm(
        { ...base, verdict: 'pass', reason: (finalInput.reason ?? 'checks passed').slice(0, 60) },
        verifierLlm(req, name, 'used', 'model accepted structurally valid payload', true, { inputHash, outputHash }),
      )
    }
  } catch (e) {
    // judge unavailable -> the deterministic checks above decide
    return withLlm(
      { ...base, verdict: 'pass', reason: 'hash + structure verified' },
      verifierLlm(req, name, 'fallback', `LLM unavailable: ${errReason(e)}`),
    )
  }
  return withLlm(
    { ...base, verdict: 'pass', reason: 'hash + structure verified' },
    verifierLlm(req, name, 'fallback', 'model exhausted rounds without deciding'),
  )
}
