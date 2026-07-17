/**
 * Market protocol - the wire format for the open marketplace, as pure (network-free) functions so it
 * can be fully unit-tested. Agents format/parse these strings and route them over CoralOS threads
 * (https://docs.coralos.ai/concepts/threads); settlement happens via x402 - the buyer pays the seller
 * directly and finally, before delivery. Every message carries a `round` to correlate the many
 * messages flowing through one shared thread — Coral moves opaque strings, so this `round` tag (not
 * Coral) is what pairs a reply to its request.
 *
 *   WANT   round=<n> service=<name> arg=<token> budget=<sol>     buyer  -> market, @sellers
 *   BID    round=<n> price=<sol> by=<seller> [note=<free text>]  seller -> market (self-selects)
 *   AWARD  round=<n> to=<seller>                                 buyer  -> market, @winner
 *   PAYMENT_REQUIRED round=<n> rail=x402 amount=<sol> currency=SOL reference=<R> seller=<addr>  seller -> buyer
 *   PAYMENT_PROOF     round=<n> rail=x402 reference=<R> proof=<base64-signed-tx> buyer=<addr>     buyer  -> seller
 *   PAYMENT_CONFIRMED round=<n> rail=x402 reference=<R> paid=true [sig=<sig>]                     seller -> buyer
 *   VERIFY   round=<n> sha=<hash> service=<name> arg=<token> payload=<raw>  buyer -> verifier
 *   VERIFIED round=<n> verdict=pass|fail by=<verifier> [sha=<hash>] [reason="..."]  verifier -> buyer
 *   (then DELIVERED / SETTLED reuse the round tag)
 */

export interface Want {
  round: number
  service: string
  arg: string
  budgetSol: number
}

export interface Bid {
  round: number
  priceSol: number
  by: string
  note?: string
}

export type PaymentRailKind =
  | 'solana-pay'
  | 'escrow'
  | 'x402'
  | 'pay-sh'
  | 'spl-usdc'
  | 'allowance'
  | 'embedded-wallet'
  | 'payout'

export type PaymentCurrency = 'SOL' | 'USDC' | 'PYUSD' | 'USDG'

export interface PaymentRequired {
  round: number
  rail: PaymentRailKind
  amount: string
  currency: PaymentCurrency
  reference: string
  seller?: string
  url?: string
  deadlineSecs?: number
}

export interface PaymentProof {
  round: number
  rail: PaymentRailKind
  reference: string
  proof: string
  buyer?: string
  txSignature?: string
}

export interface PaymentConfirmed {
  round: number
  rail: PaymentRailKind
  reference: string
  paid: boolean
  amount?: string
  currency?: PaymentCurrency
  txSignature?: string
}

export interface SettlementMessage {
  round: number
  rail: PaymentRailKind
  reference: string
  amount?: string
  currency?: PaymentCurrency
  txSignature?: string
  reason?: string
}

const num = (text: string, key: string): number | undefined => {
  const m = text.match(new RegExp(`${key}=([\\d.]+)`))
  return m ? Number(m[1]) : undefined
}
const tok = (text: string, key: string): string | undefined =>
  text.match(new RegExp(`${key}=(\\S+)`))?.[1]

const paymentRail = (value: string | undefined): PaymentRailKind | undefined =>
  value === 'solana-pay' ||
  value === 'escrow' ||
  value === 'x402' ||
  value === 'pay-sh' ||
  value === 'spl-usdc' ||
  value === 'allowance' ||
  value === 'embedded-wallet' ||
  value === 'payout'
    ? value
    : undefined

const paymentCurrency = (value: string | undefined): PaymentCurrency | undefined =>
  value === 'SOL' || value === 'USDC' || value === 'PYUSD' || value === 'USDG' ? value : undefined

/** The leading verb of a market message (`WANT`, `BID`, ...), or '' if none. */
export function verb(text: string): string {
  return text.trim().split(/\s+/)[0]?.toUpperCase() ?? ''
}

/** Extract the `round` tag for correlation, or undefined. */
export function messageRound(text: string): number | undefined {
  return num(text, 'round')
}

// -- WANT ----------------------------------------------------------------------
export function formatWant(w: Want): string {
  return `WANT round=${w.round} service=${w.service} arg=${w.arg} budget=${w.budgetSol}`
}
export function parseWant(text: string): Want | null {
  if (verb(text) !== 'WANT') return null
  const round = num(text, 'round')
  const service = tok(text, 'service')
  const arg = tok(text, 'arg')
  const budgetSol = num(text, 'budget')
  if (round == null || !service || arg == null || budgetSol == null) return null
  return { round, service, arg, budgetSol }
}

// -- BID -----------------------------------------------------------------------
export function formatBid(b: Bid): string {
  const base = `BID round=${b.round} price=${b.priceSol} by=${b.by}`
  return b.note ? `${base} note=${b.note}` : base
}
export function parseBid(text: string): Bid | null {
  if (verb(text) !== 'BID') return null
  const round = num(text, 'round')
  const priceSol = num(text, 'price')
  const by = tok(text, 'by')
  if (round == null || priceSol == null || !by) return null
  const note = text.match(/note=(.+)$/)?.[1]?.trim()
  return { round, priceSol, by, ...(note ? { note } : {}) }
}

// -- AWARD ---------------------------------------------------------------------
export function formatAward(round: number, to: string, reason?: string): string {
  const base = `AWARD round=${round} to=${to}`
  // The buyer's best-value justification, surfaced into the transcript (quotes neutralized so it
  // doesn't break parsing). The visualizer reads it via reason="...".
  return reason ? `${base} reason="${reason.replace(/"/g, "'")}"` : base
}
export function parseAward(text: string): { round: number; to: string; reason?: string } | null {
  if (verb(text) !== 'AWARD') return null
  const round = num(text, 'round')
  const to = tok(text, 'to')
  if (round == null || !to) return null
  const reason = text.match(/reason="([^"]*)"/)?.[1] // the quoted justification formatAward emits
  return { round, to, ...(reason ? { reason } : {}) }
}

// -- generic payment messages -----------------------------------------------------
export function formatPaymentRequired(p: PaymentRequired): string {
  const parts = [
    `PAYMENT_REQUIRED round=${p.round}`,
    `rail=${p.rail}`,
    `amount=${p.amount}`,
    `currency=${p.currency}`,
    `reference=${p.reference}`,
  ]
  if (p.seller) parts.push(`seller=${p.seller}`)
  if (p.url) parts.push(`url=${p.url}`)
  if (p.deadlineSecs != null) parts.push(`deadline=${p.deadlineSecs}`)
  return parts.join(' ')
}

export function parsePaymentRequired(text: string): PaymentRequired | null {
  if (verb(text) !== 'PAYMENT_REQUIRED') return null
  const round = num(text, 'round')
  const rail = paymentRail(tok(text, 'rail'))
  const amount = tok(text, 'amount')
  const currency = paymentCurrency(tok(text, 'currency'))
  const reference = tok(text, 'reference')
  if (round == null || !rail || !amount || !currency || !reference) return null
  const seller = tok(text, 'seller')
  const url = tok(text, 'url')
  const deadlineSecs = num(text, 'deadline')
  return { round, rail, amount, currency, reference, ...(seller ? { seller } : {}), ...(url ? { url } : {}), ...(deadlineSecs != null ? { deadlineSecs } : {}) }
}

export function formatPaymentProof(p: PaymentProof): string {
  const parts = [`PAYMENT_PROOF round=${p.round}`, `rail=${p.rail}`, `reference=${p.reference}`, `proof=${p.proof}`]
  if (p.buyer) parts.push(`buyer=${p.buyer}`)
  if (p.txSignature) parts.push(`sig=${p.txSignature}`)
  return parts.join(' ')
}

export function parsePaymentProof(text: string): PaymentProof | null {
  if (verb(text) !== 'PAYMENT_PROOF') return null
  const round = num(text, 'round')
  const rail = paymentRail(tok(text, 'rail'))
  const reference = tok(text, 'reference')
  const proof = tok(text, 'proof')
  if (round == null || !rail || !reference || !proof) return null
  const buyer = tok(text, 'buyer')
  const txSignature = tok(text, 'sig')
  return { round, rail, reference, proof, ...(buyer ? { buyer } : {}), ...(txSignature ? { txSignature } : {}) }
}

export function formatPaymentConfirmed(p: PaymentConfirmed): string {
  const parts = [`PAYMENT_CONFIRMED round=${p.round}`, `rail=${p.rail}`, `reference=${p.reference}`, `paid=${p.paid ? 'true' : 'false'}`]
  if (p.amount) parts.push(`amount=${p.amount}`)
  if (p.currency) parts.push(`currency=${p.currency}`)
  if (p.txSignature) parts.push(`sig=${p.txSignature}`)
  return parts.join(' ')
}

export function parsePaymentConfirmed(text: string): PaymentConfirmed | null {
  if (verb(text) !== 'PAYMENT_CONFIRMED') return null
  const round = num(text, 'round')
  const rail = paymentRail(tok(text, 'rail'))
  const reference = tok(text, 'reference')
  const paidToken = tok(text, 'paid')
  if (round == null || !rail || !reference || (paidToken !== 'true' && paidToken !== 'false')) return null
  const amount = tok(text, 'amount')
  const currency = paymentCurrency(tok(text, 'currency'))
  const txSignature = tok(text, 'sig')
  return { round, rail, reference, paid: paidToken === 'true', ...(amount ? { amount } : {}), ...(currency ? { currency } : {}), ...(txSignature ? { txSignature } : {}) }
}

export function formatSettled(s: SettlementMessage): string {
  return formatSettlement('SETTLED', s)
}

export function parseSettled(text: string): SettlementMessage | null {
  return parseSettlement('SETTLED', text)
}

export function formatRefunded(s: SettlementMessage): string {
  return formatSettlement('REFUNDED', s)
}

export function parseRefunded(text: string): SettlementMessage | null {
  return parseSettlement('REFUNDED', text)
}

function formatSettlement(kind: 'SETTLED' | 'REFUNDED', s: SettlementMessage): string {
  const parts = [`${kind} round=${s.round}`, `rail=${s.rail}`, `reference=${s.reference}`]
  if (s.amount) parts.push(`amount=${s.amount}`)
  if (s.currency) parts.push(`currency=${s.currency}`)
  if (s.txSignature) parts.push(`sig=${s.txSignature}`)
  if (s.reason) parts.push(`reason="${s.reason.replace(/"/g, "'")}"`)
  return parts.join(' ')
}

function parseSettlement(kind: 'SETTLED' | 'REFUNDED', text: string): SettlementMessage | null {
  if (verb(text) !== kind) return null
  const round = num(text, 'round')
  const rail = paymentRail(tok(text, 'rail'))
  const reference = tok(text, 'reference')
  if (round == null || !rail || !reference) return null
  const amount = tok(text, 'amount')
  const currency = paymentCurrency(tok(text, 'currency'))
  const txSignature = tok(text, 'sig')
  const reason = text.match(/reason="([^"]*)"/)?.[1]
  return { round, rail, reference, ...(amount ? { amount } : {}), ...(currency ? { currency } : {}), ...(txSignature ? { txSignature } : {}), ...(reason ? { reason } : {}) }
}

// -- VERIFY / VERIFIED -------------------------------------------------------------
// The verifier round-trip: the buyer hands the delivered payload (with its content hash) to an
// independent verifier agent; release is gated on the verdict. This is the arbiter's 3rd-signer
// role surfaced into the market protocol.

export interface VerifyRequest {
  round: number
  service: string
  arg: string
  /** sha256 hex of `payload` as the buyer received it — the verifier recomputes and compares. */
  sha: string
  /** The raw DELIVERED payload (last field on the wire; may contain spaces). */
  payload: string
}

export interface Verdict {
  round: number
  verdict: 'pass' | 'fail'
  by: string
  sha?: string
  reason?: string
}

export function formatVerify(v: VerifyRequest): string {
  return `VERIFY round=${v.round} sha=${v.sha} service=${v.service} arg=${v.arg} payload=${v.payload}`
}
export function parseVerify(text: string): VerifyRequest | null {
  if (verb(text) !== 'VERIFY') return null
  const round = num(text, 'round')
  const sha = tok(text, 'sha')
  const service = tok(text, 'service')
  const arg = tok(text, 'arg')
  const payload = text.match(/payload=([\s\S]+)$/)?.[1]?.trim()
  if (round == null || !sha || !service || arg == null || !payload) return null
  return { round, service, arg, sha, payload }
}

export function formatVerified(v: Verdict): string {
  const parts = [`VERIFIED round=${v.round}`, `verdict=${v.verdict}`, `by=${v.by}`]
  if (v.sha) parts.push(`sha=${v.sha}`)
  if (v.reason) parts.push(`reason="${v.reason.replace(/"/g, "'")}"`)
  return parts.join(' ')
}
export function parseVerified(text: string): Verdict | null {
  if (verb(text) !== 'VERIFIED') return null
  const round = num(text, 'round')
  const verdict = tok(text, 'verdict')
  const by = tok(text, 'by')
  if (round == null || !by || (verdict !== 'pass' && verdict !== 'fail')) return null
  const sha = tok(text, 'sha')
  const reason = text.match(/reason="([^"]*)"/)?.[1]
  return { round, verdict, by, ...(sha ? { sha } : {}), ...(reason ? { reason } : {}) }
}

// -- selection -------------------------------------------------------------------
/** Keep only bids for `round`, deduped by seller (last bid wins). */
export function selectBids(bids: Bid[], round: number): Bid[] {
  const bySeller = new Map<string, Bid>()
  for (const b of bids) if (b.round === round) bySeller.set(b.by, b)
  return [...bySeller.values()]
}

/** The cheapest bid (does not mutate input); undefined if none. Ties -> first seen. */
export function pickCheapest(bids: Bid[]): Bid | undefined {
  return [...bids].sort((a, b) => a.priceSol - b.priceSol)[0]
}
