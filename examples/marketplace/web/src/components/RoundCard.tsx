import type { ProofReceipt, Round } from '../types'
import { StatusPill } from './StatusPill'
import { BidRow, DeclinedRow } from './BidRow'
import { SettlementBadge } from './SettlementBadge'
import { VerificationBadge } from './VerificationBadge'
import { WorldCupPanel } from './WorldCupPanel'

const short = (s: string | undefined) => s ? `${s.slice(0, 8)}...` : ''

function ProofReceiptBadge({ receipt }: { receipt: ProofReceipt }) {
  return (
    <span className={`proof proof-${receipt.paid ? 'paid' : 'unpaid'}`} data-testid="proof-receipt">
      <strong>{receipt.rail}</strong>
      {receipt.provider && <span>{receipt.provider}</span>}
      <span>{receipt.amount} {receipt.currency}</span>
      <code title={receipt.proof}>{short(receipt.proof)}</code>
      {receipt.simulated && <em>sim</em>}
    </span>
  )
}

/** One auction round: the need, the competing bids, the award + reasoning, and on-chain settlement. */
export function RoundCard({ round }: { round: Round }) {
  const winner = round.award?.to
  return (
    <article className="round" data-testid="round" data-round={round.round}>
      <header className="round-head">
        <span className="round-n">#{round.round}</span>
        {round.want && (
          <span className="round-want">
            <strong>{round.want.service}</strong> {round.want.arg}
            <span className="round-budget">budget {round.want.budgetSol} SOL</span>
          </span>
        )}
        <StatusPill status={round.status} />
      </header>

      <div className="bids">
        {round.bids.map((b) => (
          <BidRow key={b.by} bid={b} won={b.by === winner} />
        ))}
        {round.declined.map((s) => (
          <DeclinedRow key={s} seller={s} />
        ))}
      </div>

      {round.award?.reason && (
        <p className="reason" data-testid="reason">
          <em>“{round.award.reason}”</em>
        </p>
      )}

      {round.delivered && (
        (round.delivered.data as { service?: string } | undefined)?.service === 'txline-edge'
          ? <WorldCupPanel edge={round.delivered.data as Parameters<typeof WorldCupPanel>[0]['edge']} />
          : <pre className="delivered" data-testid="delivered">{round.delivered.raw}</pre>
      )}

      <footer className="settle-row">
        {round.deposit && <SettlementBadge label={`deposit ${round.escrow?.amountSol ?? ''} SOL`} sig={round.deposit.sig} />}
        {round.verification && <VerificationBadge verification={round.verification} />}
        {round.proofReceipts?.map((receipt) => (
          <ProofReceiptBadge key={`${receipt.rail}:${receipt.reference ?? receipt.proof}`} receipt={receipt} />
        ))}
        {round.release && <SettlementBadge label="release" sig={round.release.sig} />}
        {round.refunded && <span className="settle settle-refund" data-testid="refund">refunded</span>}
      </footer>
    </article>
  )
}
