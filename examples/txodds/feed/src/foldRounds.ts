/**
 * foldRounds — turn a CoralOS session transcript into typed market Round objects.
 *
 * Pure and network-free, so it's fully unit-testable. Reuses the SAME parsers the agents use
 * (`@pay/agent-runtime`) — the market wire protocol has one source of truth.
 */
import {
  verb, messageRound, parseWant, parseBid, parseAward, parseEscrowRequired, parseDeposited, parseVerified,
  parsePaymentRequired, parsePaymentProof, parsePaymentConfirmed, parseLlmUsed,
  type ProofReceipt, type PaymentRailKind, type PaymentCurrency, type LlmUse, type ScoreOutcome,
} from '@pay/agent-runtime'

export interface RawMessage {
  sender: string
  text: string
  timestamp?: string
}

export interface RoundBid {
  by: string
  priceSol: number
  note?: string
}

export type RoundStatus = 'bidding' | 'awarded' | 'deposited' | 'delivered' | 'settled' | 'refunded'

export interface Round {
  round: number
  want?: { service: string; arg: string; budgetSol: number }
  bids: RoundBid[]
  /** Sellers that were in the market but didn't bid (self-selected out) — needs the seller roster. */
  declined: string[]
  award?: { to: string; reason?: string }
  escrow?: { reference: string; seller: string; amountSol: number; deadlineSecs: number }
  deposit?: { sig: string; buyer: string }
  delivered?: { raw: string; data?: unknown }
  /** The independent verifier's verdict (release is gated on it when a verifier is in session). */
  verification?: { verdict: 'pass' | 'fail'; by: string; reason?: string }
  /** Payment-rail receipts for upstream procurement legs inside the round. */
  proofReceipts: ProofReceipt[]
  /** LLM provider/model/status metadata emitted by agents. */
  llm: LlmUse[]
  release?: { sig: string }
  refunded?: boolean
  status: RoundStatus
  /**
   * Whether the delivered prediction/signal was right — never present here from folding alone (no
   * Coral message carries it), only merged in from the run ledger after a grading pass. See
   * persist.ts's `mergeOutcomes`.
   */
  outcome?: ScoreOutcome
}

interface PaymentLeg {
  rail: PaymentRailKind
  reference: string
  amount?: string
  currency?: PaymentCurrency
  provider?: string
  proof?: string
  txSignature?: string
  paid?: boolean
  issuedAt?: string
}

const tryJson = (s: string): unknown => {
  try { return JSON.parse(s) } catch { return undefined }
}

/** Optional `reason="…"` carried on an AWARD (the buyer's best-value justification). */
const awardReason = (text: string): string | undefined => text.match(/reason="([^"]*)"/)?.[1]

/**
 * Fold raw transcript messages into rounds (ascending). Pass the seller roster to compute which
 * sellers declined a round (self-selection) once its bidding has closed.
 */
export function foldRounds(messages: RawMessage[], sellers: string[] = []): Round[] {
  const byRound = new Map<number, Round>()
  const get = (r: number): Round => {
    let round = byRound.get(r)
    if (!round) {
      round = { round: r, bids: [], declined: [], proofReceipts: [], llm: [], status: 'bidding' }
      byRound.set(r, round)
    }
    return round
  }

  const legs = new Map<string, PaymentLeg>()
  const legKey = (round: number, rail: PaymentRailKind, reference: string): string => `${round}:${rail}:${reference}`
  const getLeg = (round: number, rail: PaymentRailKind, reference: string): PaymentLeg => {
    const key = legKey(round, rail, reference)
    let leg = legs.get(key)
    if (!leg) {
      leg = { rail, reference }
      legs.set(key, leg)
    }
    return leg
  }
  const upsertReceipt = (round: Round, leg: PaymentLeg): void => {
    if (leg.paid === undefined) return
    const receipt: ProofReceipt = {
      rail: leg.rail,
      ...(leg.provider ? { provider: leg.provider } : {}),
      ...(round.want?.service ? { service: `${round.want.service}-upstream` } : {}),
      reference: leg.reference,
      proof: leg.proof ?? leg.txSignature ?? '',
      amount: leg.amount ?? '',
      currency: leg.currency ?? 'SOL',
      paid: leg.paid,
      ...(leg.proof?.startsWith(`${leg.rail}-demo:`) ? { simulated: true } : {}),
      issuedAt: leg.issuedAt ?? '1970-01-01T00:00:00.000Z',
    }
    const i = round.proofReceipts.findIndex((r) => r.rail === receipt.rail && r.reference === receipt.reference)
    if (i >= 0) round.proofReceipts[i] = receipt
    else round.proofReceipts.push(receipt)
  }

  for (const m of messages) {
    const text = m.text.trim()

    const want = parseWant(text)
    if (want) { get(want.round).want = { service: want.service, arg: want.arg, budgetSol: want.budgetSol }; continue }

    const bid = parseBid(text)
    if (bid) {
      const r = get(bid.round)
      if (!r.bids.some((b) => b.by === bid.by)) r.bids.push({ by: bid.by, priceSol: bid.priceSol, note: bid.note })
      continue
    }

    const award = parseAward(text)
    if (award) { const r = get(award.round); r.award = { to: award.to, reason: awardReason(text) }; if (r.status === 'bidding') r.status = 'awarded'; continue }

    const esc = parseEscrowRequired(text)
    if (esc) { get(esc.round).escrow = { reference: esc.reference, seller: esc.seller, amountSol: esc.amountSol, deadlineSecs: esc.deadlineSecs }; continue }

    const dep = parseDeposited(text)
    if (dep) { const r = get(dep.round); r.deposit = { sig: dep.sig, buyer: dep.buyer }; if (r.status !== 'settled') r.status = 'deposited'; continue }

    const verified = parseVerified(text)
    if (verified) {
      get(verified.round).verification = {
        verdict: verified.verdict, by: verified.by, ...(verified.reason ? { reason: verified.reason } : {}),
      }
      continue
    }

    const llmUsed = parseLlmUsed(text)
    if (llmUsed) {
      get(llmUsed.round).llm.push(llmUsed)
      continue
    }

    const paymentRequired = parsePaymentRequired(text)
    if (paymentRequired) {
      const leg = getLeg(paymentRequired.round, paymentRequired.rail, paymentRequired.reference)
      leg.amount = paymentRequired.amount
      leg.currency = paymentRequired.currency
      leg.provider = paymentRequired.seller
      continue
    }

    const paymentProof = parsePaymentProof(text)
    if (paymentProof) {
      const round = get(paymentProof.round)
      const leg = getLeg(paymentProof.round, paymentProof.rail, paymentProof.reference)
      leg.proof = paymentProof.proof
      leg.txSignature = paymentProof.txSignature
      upsertReceipt(round, leg)
      continue
    }

    const paymentConfirmed = parsePaymentConfirmed(text)
    if (paymentConfirmed) {
      const round = get(paymentConfirmed.round)
      const leg = getLeg(paymentConfirmed.round, paymentConfirmed.rail, paymentConfirmed.reference)
      leg.paid = paymentConfirmed.paid
      if (paymentConfirmed.amount) leg.amount = paymentConfirmed.amount
      if (paymentConfirmed.currency) leg.currency = paymentConfirmed.currency
      if (paymentConfirmed.txSignature) leg.txSignature = paymentConfirmed.txSignature
      leg.issuedAt = m.timestamp ?? leg.issuedAt ?? '1970-01-01T00:00:00.000Z'
      upsertReceipt(round, leg)
      continue
    }

    const v = verb(text)
    const r = messageRound(text)
    if (v === 'DELIVERED' && r != null) {
      const round = get(r)
      const raw = text.replace(/^DELIVERED\s+round=\d+\s*/i, '').trim()
      round.delivered = { raw, data: tryJson(raw) }
      if (round.status !== 'settled') round.status = 'delivered'
    } else if ((v === 'RELEASED' || v === 'ARBITER_RELEASED') && r != null) {
      // the buyer emits ARBITER_RELEASED in arbiter mode (the default) — same settled state
      const round = get(r)
      const sig = text.match(/sig=(\S+)/)?.[1]
      if (sig) round.release = { sig }
      round.status = 'settled'
    } else if (v === 'REFUNDED' && r != null) {
      const round = get(r)
      round.refunded = true
      round.status = 'refunded'
    }
  }

  const rounds = [...byRound.values()].sort((a, b) => a.round - b.round)
  // Sellers who were in the roster but didn't bid on a round whose bidding has closed.
  for (const round of rounds) {
    if (round.status === 'bidding') continue
    round.declined = sellers.filter((s) => !round.bids.some((b) => b.by === s))
  }
  return rounds
}
