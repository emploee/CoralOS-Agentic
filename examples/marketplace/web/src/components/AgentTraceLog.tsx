import type { LlmUse } from '../types'

const STATUS_LABEL: Record<LlmUse['status'], string> = {
  used: 'used', fallback: 'fallback', skipped: 'skipped', error: 'error',
}

const short = (s: string | undefined): string | undefined => (s ? `${s.slice(0, 10)}…` : undefined)

/**
 * The model-selection audit trail for one round — provider/model per agent action, whether it
 * used the LLM or fell back, and the guardrail note explaining why the model's output could not
 * move funds on its own. Mirrors `LLM_USED` market messages (packages/agent-runtime/src/market/
 * protocol.ts): prompts and completions are never recorded, only hashes, so a curious buyer can
 * bind a completion to its inputs without the ledger storing either.
 */
export function AgentTraceLog({ llm }: { llm: LlmUse[] | undefined }) {
  if (!llm || llm.length === 0) return null
  return (
    <div className="trace" data-testid="agent-trace">
      {llm.map((entry, i) => (
        <div key={`${entry.agent}-${entry.purpose}-${i}`} className="trace-row" data-testid="trace-row">
          <span className="trace-agent">{entry.agent}</span>
          <span className={`trace-status trace-status-${entry.status}`} data-testid="trace-status">{STATUS_LABEL[entry.status]}</span>
          {entry.provider && <span className="trace-model">{entry.provider}/{entry.model}</span>}
          <span className="trace-purpose">{entry.usedFor ?? entry.purpose}</span>
          {entry.affectedFunds && (
            <span className="trace-funds" data-testid="trace-funds" title="This LLM output directly moved funds — flag for review">FUNDS</span>
          )}
          {entry.guardrail && <span className="trace-guardrail" title={entry.guardrail}>guarded</span>}
          {(entry.inputHash || entry.outputHash) && (
            <span className="trace-hash" title={`in=${entry.inputHash ?? '—'} out=${entry.outputHash ?? '—'}`}>
              {short(entry.outputHash) ?? short(entry.inputHash)}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
