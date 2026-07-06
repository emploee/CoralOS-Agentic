import { useState } from 'react'
import type { ProofReceipt, RunRecord } from '../types'
import { VerificationBadge } from './VerificationBadge'

/**
 * The run ledger — "what did the agent actually do for the money?" as a page. Every persisted
 * round across sessions, expandable into the full trail: want → bids → award reasoning → escrow +
 * deposit → sha256-bound delivery → verifier verdict → Explorer-linked txs.
 */

const short = (s: string | undefined, n = 10) => s ? `${s.slice(0, n)}...` : ''

function ReceiptFact({ receipt }: { receipt: ProofReceipt }) {
  return (
    <span className={`run-receipt ${receipt.paid ? 'run-receipt-paid' : 'run-receipt-unpaid'}`} data-testid="run-proof-receipt">
      <strong>{receipt.rail}</strong>
      {receipt.provider && <span>{receipt.provider}</span>}
      <span>{receipt.amount} {receipt.currency}</span>
      <code title={receipt.proof}>{short(receipt.proof)}</code>
      {receipt.simulated && <em>simulated</em>}
    </span>
  )
}

function RunDetail({ run }: { run: RunRecord }) {
  return (
    <div className="run-detail" data-testid="run-detail">
      {run.want && (
        <div className="run-fact"><span className="run-k">want</span>
          <strong>{run.want.service}</strong> {run.want.arg} <span className="run-dim">budget {run.want.budgetSol} SOL</span>
        </div>
      )}
      {run.bids.length > 0 && (
        <div className="run-fact"><span className="run-k">bids</span>
          {run.bids.map((b) => <span key={b.by} className="run-bid">{b.by} @ {b.priceSol}</span>)}
        </div>
      )}
      {run.award && (
        <div className="run-fact"><span className="run-k">award</span>
          <strong>{run.award.to}</strong>{run.award.reason && <em> — “{run.award.reason}”</em>}
        </div>
      )}
      {run.escrow && (
        <div className="run-fact"><span className="run-k">escrow</span>
          {run.escrow.amountSol} SOL · ref <code>{run.escrow.reference.slice(0, 8)}…</code> · deadline {run.escrow.deadlineSecs}s
        </div>
      )}
      {run.delivery && (
        <div className="run-fact"><span className="run-k">delivery</span>
          <code className="run-sha" title={run.delivery.sha256}>sha256 {run.delivery.sha256.slice(0, 12)}…</code>
          <pre className="delivered">{run.delivery.raw.slice(0, 400)}{run.delivery.raw.length > 400 ? '…' : ''}</pre>
        </div>
      )}
      {run.verification && (
        <div className="run-fact"><span className="run-k">verdict</span>
          <VerificationBadge verification={run.verification} />
        </div>
      )}
      {run.proofReceipts && run.proofReceipts.length > 0 && (
        <div className="run-fact"><span className="run-k">receipt</span>
          {run.proofReceipts.map((receipt) => (
            <ReceiptFact key={`${receipt.rail}:${receipt.reference ?? receipt.proof}`} receipt={receipt} />
          ))}
        </div>
      )}
      {run.txs.length > 0 && (
        <div className="run-fact"><span className="run-k">on-chain</span>
          {run.txs.map((t) => (
            <a key={t.sig} className="settle" href={t.explorer} target="_blank" rel="noreferrer" data-testid="run-tx">
              {t.kind} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

export function RunsView({ runs }: { runs: RunRecord[] }) {
  const [open, setOpen] = useState<string>()
  if (runs.length === 0) {
    return <p className="empty" data-testid="runs-empty">No persisted runs yet — every settled or refused round lands in <code>runs/</code> once the feed sees it.</p>
  }
  const newestFirst = [...runs].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
  return (
    <div className="runs" data-testid="runs">
      {newestFirst.map((run) => (
        <article key={run.runId} className="run" data-testid="run" data-run-id={run.runId}>
          <button className="run-head" onClick={() => setOpen(open === run.runId ? undefined : run.runId)}>
            <span className="run-id">{run.session.slice(0, 8)} / round {run.round}</span>
            {run.award && <span className="run-winner">{run.award.to}</span>}
            {run.verification && <span className={`run-verdict run-verdict-${run.verification.verdict}`}>{run.verification.verdict}</span>}
            <span className={`pill pill-${run.status}`}>{run.status}</span>
          </button>
          {open === run.runId && <RunDetail run={run} />}
        </article>
      ))}
    </div>
  )
}
