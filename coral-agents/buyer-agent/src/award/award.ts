/**
 * Buyer award selection - a bounded tool-calling loop for picking the best-value bid (see
 * packages/harness-runtime/src/quote.ts's decideBid for the identical pattern this mirrors).
 * Reputation (when a reputation URL is configured) is fetched once and folded into a deterministic
 * value score via compute_value_score; the model proposes through fetch_seller_reputation /
 * compute_value_score / submit_award, and a deterministic fallback (cheapest bid) covers any
 * failure - a bad model call costs a worse pick, never a stuck round.
 */
import {
  complete, sha256Hex, llmRuntimeInfo, runToolLoop, BudgetGuard, StepCounter, pickCheapest,
  type Bid, type Want, type LlmUse, type CompleteOpts,
} from '@pay/agent-runtime'
import { fetchReputation } from '../reputation/reputation.js'
import { fetchSellerReputationTool, computeValueScoreTool, submitAwardTool, type SubmitAwardInput } from './award-tools.js'

type Llm = (opts: CompleteOpts) => Promise<string>
const selectionGuardrail = 'winner must match collected BID set; fallback is cheapest available bid'

function buyerLlm(
  round: number,
  agent: string,
  status: LlmUse['status'],
  reason: string,
  audit: Pick<LlmUse, 'inputHash' | 'outputHash'> = {},
): LlmUse {
  const info = status === 'skipped' ? undefined : llmRuntimeInfo({ maxTokens: 150 })
  return {
    round,
    agent,
    purpose: 'buyer_award',
    status,
    ...(info ? { provider: info.provider, model: info.model } : {}),
    usedFor: 'buyer_award',
    affectedFunds: false,
    ...audit,
    reason,
    guardrail: selectionGuardrail,
    createdAt: new Date().toISOString(),
  }
}

const errReason = (e: unknown): string => String((e as Error).message ?? e).slice(0, 120)

/** Best-value selection via a bounded tool loop; deterministic cheapest fallback on any failure. */
export async function pickWinner(
  want: Want,
  pool: Bid[],
  buyerName: string,
  reputationUrl?: string,
  llm: Llm = complete,
  doFetch: typeof fetch = fetch,
): Promise<{ winner: Bid; reason?: string; llm: LlmUse }> {
  if (pool.length === 1) {
    return { winner: pool[0], llm: buyerLlm(want.round, buyerName, 'skipped', 'single bid; no model selection needed') }
  }

  const reputation = (reputationUrl && (await fetchReputation(reputationUrl, doFetch))) || []

  const system =
    'You are a buyer choosing the best-value bid for a Solana data service. Call fetch_seller_reputation ' +
    'once to see track records, then compute_value_score for each bid before deciding - a cheap seller ' +
    'that fails verification or no-shows is not a bargain. Call submit_award with {"by": "<seller name>", ' +
    '"reason": "<short>"}.'
  const initialPrompt =
    `service=${want.service} arg=${want.arg} budget=${want.budgetSol}\nbids:\n` +
    pool.map((b) => `- ${b.by}: ${b.priceSol} SOL${b.note ? ` (${b.note})` : ''}`).join('\n')
  const inputHash = sha256Hex(`${system}\n${initialPrompt}`)

  let finalInput: SubmitAwardInput | undefined
  let outputHash: string | undefined
  try {
    const outcome = await runToolLoop(
      {
        agentId: buyerName,
        system,
        initialPrompt,
        tools: [
          fetchSellerReputationTool(reputation),
          computeValueScoreTool(want.budgetSol, reputation),
          submitAwardTool,
        ],
        finalToolName: 'submit_award',
        maxRounds: 5,
        // No lamports move during award selection — only escrow deposit does — so the spend cap is
        // never meant to bind here; see the matching note in quote.ts's decideBid.
        budget: new BudgetGuard({ maxToolCalls: 10, maxSpendLamports: Number.MAX_SAFE_INTEGER, maxDurationSecs: 30 }),
        steps: new StepCounter(5),
        maxTokens: 150,
      },
      llm,
    )
    finalInput = outcome.finalInput as SubmitAwardInput | undefined
    if (finalInput) outputHash = sha256Hex(JSON.stringify(finalInput))
  } catch (e) {
    return {
      winner: pickCheapest(pool)!,
      reason: 'cheapest available',
      llm: buyerLlm(want.round, buyerName, 'fallback', `LLM unavailable: ${errReason(e)}`, { inputHash }),
    }
  }

  if (!finalInput) {
    return {
      winner: pickCheapest(pool)!,
      reason: 'cheapest available',
      llm: buyerLlm(want.round, buyerName, 'fallback', 'ran out of tool-loop steps before deciding — fell back to the cheapest bid', { inputHash }),
    }
  }

  const chosen = pool.find((b) => b.by === finalInput!.by)
  if (!chosen) {
    return {
      winner: pickCheapest(pool)!,
      reason: 'cheapest available',
      llm: buyerLlm(want.round, buyerName, 'fallback', 'model returned a seller outside the bid pool', { inputHash, outputHash }),
    }
  }

  console.error(`[buyer] picked ${chosen.by} (${chosen.priceSol} SOL): ${finalInput.reason ?? ''}`)
  return {
    winner: chosen,
    reason: finalInput.reason,
    llm: buyerLlm(want.round, buyerName, 'used', finalInput.reason ?? 'model selected winner via tool loop', { inputHash, outputHash }),
  }
}
