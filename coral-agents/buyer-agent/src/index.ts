/**
 * Buyer agent - the marketplace buyer. Broadcasts a WANT into a shared CoralOS thread, collects
 * competing bids, picks the best value, and settles directly through x402:
 *
 *   WANT -> (collect BIDs for a window) -> AWARD winner -> wait PAYMENT_REQUIRED ->
 *   sign + send PAYMENT_PROOF -> wait PAYMENT_CONFIRMED -> wait DELIVERED -> SETTLED
 *
 * Selection is deterministic (price weighed against track record). Settlement is x402: the buyer
 * signs and hands the seller a transfer that pays it directly and finally, before delivery - there
 * is no escrow, so a seller that takes payment and never delivers keeps it. Reputation
 * (ledger/reputation.ts) is the only defense against that, not a refund path. See PAY.md for the
 * trade-off this accepts against the kit's former escrow-based settlement.
 *
 * Env: BUYER_KEYPAIR_B58 (signs), BUYER_MAX_SOL (budget), BUYER_SERVICE/BUYER_ARG (the WANT),
 *      MARKET_SELLERS (csv of seller names), BID_WINDOW_MS, CYCLE_INTERVAL_MS, RETRY_INTERVAL_MS,
 *      SOLANA_RPC_URL, TRACE=1.
 *
 * The payment calls settle on devnet; they need a funded devnet wallet + live RPC, so they run in a
 * live market session rather than in `npm test`/CI.
 */
import {
  startCoralAgent, loadKeypairB58, keypairSigner, signTransferTransaction,
  formatWant, parseBid, parsePaymentRequired, formatAward,
  formatPaymentProof, parsePaymentConfirmed, formatSettled,
  formatVerify, parseVerified, sha256Hex, enforce, policyFromEnv,
  selectBids, verb, messageRound,
  type Bid, type PaymentRequired, type CoralAgentContext,
} from '@pay/agent-runtime'
import { fetchNextWant } from './feed/wantFeed.js'
import { pickWinner } from './award/award.js'
import { decideVerifyEscalation } from './verify/verify-gate.js'

const NAME = process.env.AGENT_NAME ?? 'buyer-agent'
const BUDGET = Number(process.env.BUYER_MAX_SOL ?? '0.001')
const SERVICE = process.env.BUYER_SERVICE ?? 'txline'
// Rotate through several args so each round trades a *different* thing (BUYER_ARGS=csv of fixture ids,
// else the single BUYER_ARG). This is what stops the market looking like the same round on a loop.
const ARGS = (process.env.BUYER_ARGS || process.env.BUYER_ARG || 'SOL-USDC').split(',').map((s) => s.trim()).filter(Boolean)
const BID_WINDOW_MS = Number(process.env.BID_WINDOW_MS ?? '5000')
const CYCLE_MS = Number(process.env.CYCLE_INTERVAL_MS ?? '30000')
// Distinct from CYCLE_MS: CYCLE_MS is the steady-state cadence between rounds (round.ts sets it as
// high as 1h for a production-like demo). A round that got no bids or no payment terms in its window
// is usually a transient coordination miss (e.g. coral-server still warming up its first sessions),
// not "nothing to do until next cycle" - so it retries on this much shorter clock instead of
// inheriting CYCLE_MS and going quiet for the full cycle.
const RETRY_MS = Number(process.env.RETRY_INTERVAL_MS ?? '15000')
const SELLERS = (process.env.MARKET_SELLERS ?? 'seller-agent')
  .split(',').map((s) => s.trim()).filter(Boolean)
// The payout wallet the buyer expects (personas share one in the demo). If set, the buyer refuses
// to pay a PAYMENT_REQUIRED whose seller= pubkey differs - binding the award to the payout.
const EXPECTED_SELLER_WALLET = process.env.SELLER_WALLET ?? ''
// Independent delivery verification (coral-agents/verifier-agent): informational only now - the
// payment already settled before delivery, so a fail verdict feeds reputation, it can't reclaim funds.
const VERIFIER = process.env.VERIFIER_AGENT ?? ''
const VERIFY_WINDOW_MS = Number(process.env.VERIFY_WINDOW_MS ?? '20000')
const VERIFY_GATE_ENABLED = (process.env.VERIFY_GATE_ENABLED ?? '0') === '1'
// Event mode (the research market): poll this feed for the next job instead of rotating BUYER_ARGS.
const WANT_FEED = process.env.WANT_FEED_URL ?? ''
// Track record from the run ledger (the feed's /api/reputation): history shapes who wins awards.
const REPUTATION_URL = process.env.REPUTATION_URL ?? ''
const trace = process.env.TRACE === '1'

// The fund-moving choke point (POLICY_* env): spend caps, service allowlist, payout binding,
// post-award price binding, rate limit. Every payment passes through it BEFORE it's signed.
const policy = policyFromEnv(process.env, {
  budgetSol: BUDGET,
  service: SERVICE,
  ...(EXPECTED_SELLER_WALLET ? { expectedPayout: EXPECTED_SELLER_WALLET } : {}),
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const expl = (kind: 'tx' | 'address', id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`

/** Wait (bounded) for a message matching `round` that `parse` accepts. */
async function waitFor<T>(
  ctx: CoralAgentContext,
  round: number,
  parse: (text: string) => (T & { round: number }) | null,
  maxMs: number,
): Promise<T | null> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const m = await ctx.waitForMention(Math.max(500, deadline - Date.now()))
    if (!m) continue
    const parsed = parse(m.text)
    if (parsed && parsed.round === round) return parsed
  }
  return null
}

await startCoralAgent({ agentName: NAME }, async (ctx) => {
  const buyer = loadKeypairB58('BUYER_KEYPAIR_B58')
  const signer = keypairSigner(buyer)
  console.error(`[buyer] market buyer - wallet=${buyer.publicKey.toBase58()} budget=${BUDGET} sellers=[${SELLERS.join(',')}]`)

  const participants = [...SELLERS, ...(VERIFIER ? [VERIFIER] : [])]
  for (const s of participants) {
    try { await ctx.waitForAgent(s, 8000) } catch { /* agent may already be present */ }
  }
  const thread = await ctx.createThread('market', participants)
  let round = 0
  let spentSol = 0
  let lastPaymentAt: number | undefined

  while (true) {
    try {
      let service = SERVICE
      let arg = ARGS[round % ARGS.length] // rotate fixtures so consecutive rounds differ
      let budget = BUDGET
      if (WANT_FEED) {
        // Event mode: no event, no WANT, no spend.
        const next = await fetchNextWant(WANT_FEED)
        if (!next) {
          if (trace) console.error('[buyer] want feed quiet - sitting this cycle out')
          await sleep(CYCLE_MS)
          continue
        }
        service = next.service ?? SERVICE
        arg = next.arg
        budget = Math.min(BUDGET, next.budgetSol ?? BUDGET)
        if (next.note) console.error(`[buyer] event: ${next.note}`)
      }
      round++
      if (trace) console.error(`[buyer] round ${round}: WANT ${service} ${arg} budget=${budget}`)
      await ctx.send(formatWant({ round, service, arg, budgetSol: budget }), thread, SELLERS)

      // -- collect competing bids during the window --------------------------
      const bids: Bid[] = []
      const deadline = Date.now() + BID_WINDOW_MS
      while (Date.now() < deadline) {
        const m = await ctx.waitForMention(Math.max(500, deadline - Date.now()))
        if (!m) continue
        const b = parseBid(m.text)
        if (b && b.round === round) bids.push(b)
      }
      const pool = selectBids(bids, round)
      if (pool.length === 0) { console.error(`[buyer] round ${round}: NO_SELLERS`); await sleep(RETRY_MS); continue }

      // -- award the best value (price × track record) -------------------------
      const { winner, reason } = await pickWinner(
        { round, service, arg, budgetSol: budget }, pool, NAME, REPUTATION_URL || undefined,
      )
      await ctx.send(formatAward(round, winner.by, reason), thread, [winner.by])

      // -- pay directly via x402: sign a transfer, hand it to the seller to submit -----------
      const terms = await waitFor<PaymentRequired>(ctx, round, parsePaymentRequired, 15_000)
      if (!terms?.seller) { console.error(`[buyer] round ${round}: no payment terms from ${winner.by}`); await sleep(RETRY_MS); continue }
      const amountSol = Number(terms.amount)
      // One choke point for everything that must be true before funds move - runs BEFORE signing,
      // since x402 settles immediately: there's no later release step left to gate.
      const paymentDecision = enforce({
        kind: 'payment', round, service, amountSol, payout: terms.seller,
        awardedPriceSol: winner.priceSol, spentSol, ...(lastPaymentAt != null ? { lastPaymentAt } : {}), now: Date.now(),
      }, policy)
      if (!paymentDecision.ok) {
        console.error(`[buyer] round ${round}: POLICY refused payment - ${paymentDecision.violations.join('; ')}`)
        await sleep(CYCLE_MS); continue
      }

      // Signed, not submitted - the seller (merchant) submits it, mirroring the same x402
      // client/server split examples/txodds/server/proxy.ts's /api/edge-x402 uses.
      const proof = await signTransferTransaction(signer, terms.seller, amountSol, {
        reference: terms.reference,
        memo: `x402:round-${round}`.slice(0, 100),
      })
      spentSol += amountSol
      lastPaymentAt = Date.now()
      console.error(`[buyer] round ${round}: PAYMENT_PROOF ${amountSol} SOL -> ${winner.by} (session spend ${spentSol.toFixed(6)} SOL)`)
      await ctx.send(
        formatPaymentProof({ round, rail: 'x402', reference: terms.reference, proof, buyer: buyer.publicKey.toBase58() }),
        thread, [winner.by],
      )

      const confirmed = await waitFor(ctx, round, parsePaymentConfirmed, 20_000)
      if (!confirmed?.paid) {
        console.error(`[buyer] round ${round}: seller never confirmed payment - x402 has no refund path`)
        await sleep(CYCLE_MS); continue
      }
      if (trace && confirmed.txSignature) console.error(`[buyer]   payment tx: ${expl('tx', confirmed.txSignature)}`)

      const delivered = await waitFor(ctx, round, (t) => {
        const r = messageRound(t)
        if (verb(t) !== 'DELIVERED' || r == null) return null
        return { round: r, payload: t.replace(/^DELIVERED\s+round=\d+\s*/i, '').trim() }
      }, 30_000)

      if (delivered) {
        // Verification is informational now (feeds reputation) - the payment already settled, so
        // a fail verdict can no longer block or reclaim it.
        const gate = await decideVerifyEscalation(!!VERIFIER, VERIFY_GATE_ENABLED, winner.by, REPUTATION_URL || undefined)
        if (trace) console.error(`[buyer] round ${round}: verify-gate ${gate.escalate ? 'escalating' : 'skipping'} - ${gate.reason}`)
        if (gate.escalate) {
          const sha = sha256Hex(delivered.payload)
          await ctx.send(formatVerify({ round, service, arg, sha, payload: delivered.payload }), thread, [VERIFIER])
          const verdict = await waitFor(ctx, round, parseVerified, VERIFY_WINDOW_MS)
          if (verdict) console.error(`[buyer] round ${round}: verifier ${verdict.by} says ${verdict.verdict}${verdict.reason ? ` (${verdict.reason})` : ''}`)
        }
        await ctx.send(
          formatSettled({
            round, rail: 'x402', reference: terms.reference, amount: terms.amount,
            ...(confirmed.txSignature ? { txSignature: confirmed.txSignature } : {}),
          }),
          thread, [winner.by],
        )
        console.error(`[buyer] round ${round}: SETTLED`)
      } else {
        console.error(`[buyer] round ${round}: no delivery - payment was already sent, x402 has no refund path`)
      }
    } catch (e) {
      console.error(`[buyer] round error: ${e}`)
    }
    await sleep(CYCLE_MS)
  }
})
