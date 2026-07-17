/**
 * foldRounds — turn a CoralOS session transcript into typed market Round objects.
 *
 * Pure and network-free, so it's fully unit-testable. Reuses the SAME parsers the agents use
 * (`@pay/agent-runtime`) — the market wire protocol has one source of truth.
 */
import {
  verb, messageRound, parseWant, parseBid, parseAward, parseVerified,
  parsePaymentRequired, parsePaymentProof, parsePaymentConfirmed, parseSettled, parseRefunded,
  type ProofReceipt, type PaymentRailKind, type PaymentCurrency, type ScoreOutcome,
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

export type RoundStatus = 'bidding' | 'awarded' | 'paid' | 'delivered' | 'settled' | 'refunded'

export interface Round {
  round: number
  want?: { service: string; arg: string; budgetSol: number }
  bids: RoundBid[]
  /** Sellers that were in the market but didn't bid (self-selected out) — needs the seller roster. */
  declined: string[]
  award?: { to: string; reason?: string }
  /** The x402 payment the buyer owes the seller for this round — the primary settlement leg,
   *  distinct from any upstream procurement legs the seller makes (see `proofReceipts`). */
  payment?: { reference: string; seller: string; amountSol: number; buyer?: string }
  /** The seller's on-chain confirmation of the primary payment above. */
  paid?: { sig: string }
  delivered?: { raw: string; data?: unknown }
  /** The independent verifier's verdict — informational (feeds reputation); the payment already
   *  settled by the time this arrives, so a fail verdict can no longer block or reclaim it. */
  verification?: { verdict: 'pass' | 'fail'; by: string; reason?: string }
  /** Payment-rail receipts for upstream procurement legs inside the round (a different reference
   *  than the primary `payment` above — e.g. the seller buying context before delivering). */
  proofReceipts: ProofReceipt[]
  settled?: { sig?: string }
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
      round = { round: r, bids: [], declined: [], proofReceipts: [], status: 'bidding' }
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

    const verified = parseVerified(text)
    if (verified) {
      get(verified.round).verification = {
        verdict: verified.verdict, by: verified.by, ...(verified.reason ? { reason: verified.reason } : {}),
      }
      continue
    }

    // PAYMENT_REQUIRED/PROOF/CONFIRMED carry both the round's PRIMARY settlement (the buyer paying
    // the seller for the award, one reference per round, requested immediately after AWARD) and any
    // upstream procurement legs the seller makes with a different reference (e.g. PROCURE_RAIL=x402
    // buying context before delivering). The first PAYMENT_REQUIRED seen for a round is always the
    // primary leg; anything else (a different reference) is a procurement leg, folded into proofReceipts.
    const paymentRequired = parsePaymentRequired(text)
    if (paymentRequired) {
      const round = get(paymentRequired.round)
      // The primary settlement is always rail=x402 (seller-agent's AWARD reply) - a procurement leg
      // on another rail (or a second x402 leg, once the primary is already recorded) is never it.
      if (!round.payment && paymentRequired.rail === 'x402') {
        round.payment = {
          reference: paymentRequired.reference,
          seller: paymentRequired.seller ?? '',
          amountSol: Number(paymentRequired.amount),
        }
        continue
      }
      const leg = getLeg(paymentRequired.round, paymentRequired.rail, paymentRequired.reference)
      leg.amount = paymentRequired.amount
      leg.currency = paymentRequired.currency
      leg.provider = paymentRequired.seller
      continue
    }

    const paymentProof = parsePaymentProof(text)
    if (paymentProof) {
      const round = get(paymentProof.round)
      if (round.payment?.reference === paymentProof.reference) {
        if (paymentProof.buyer) round.payment.buyer = paymentProof.buyer
        continue
      }
      const leg = getLeg(paymentProof.round, paymentProof.rail, paymentProof.reference)
      leg.proof = paymentProof.proof
      leg.txSignature = paymentProof.txSignature
      upsertReceipt(round, leg)
      continue
    }

    const paymentConfirmed = parsePaymentConfirmed(text)
    if (paymentConfirmed) {
      const round = get(paymentConfirmed.round)
      if (round.payment?.reference === paymentConfirmed.reference) {
        if (paymentConfirmed.paid && paymentConfirmed.txSignature) {
          round.paid = { sig: paymentConfirmed.txSignature }
          if (round.status === 'bidding' || round.status === 'awarded') round.status = 'paid'
        }
        continue
      }
      const leg = getLeg(paymentConfirmed.round, paymentConfirmed.rail, paymentConfirmed.reference)
      leg.paid = paymentConfirmed.paid
      if (paymentConfirmed.amount) leg.amount = paymentConfirmed.amount
      if (paymentConfirmed.currency) leg.currency = paymentConfirmed.currency
      if (paymentConfirmed.txSignature) leg.txSignature = paymentConfirmed.txSignature
      leg.issuedAt = m.timestamp ?? leg.issuedAt ?? '1970-01-01T00:00:00.000Z'
      upsertReceipt(round, leg)
      continue
    }

    const settled = parseSettled(text)
    if (settled) {
      const round = get(settled.round)
      round.settled = { ...(settled.txSignature ? { sig: settled.txSignature } : {}) }
      round.status = 'settled'
      continue
    }

    const refunded = parseRefunded(text)
    if (refunded) {
      const round = get(refunded.round)
      round.refunded = true
      round.status = 'refunded'
      continue
    }

    const v = verb(text)
    const r = messageRound(text)
    if (v === 'DELIVERED' && r != null) {
      const round = get(r)
      const raw = text.replace(/^DELIVERED\s+round=\d+\s*/i, '').trim()
      round.delivered = { raw, data: tryJson(raw) }
      if (round.status !== 'settled') round.status = 'delivered'
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
