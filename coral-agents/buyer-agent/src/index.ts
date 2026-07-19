/**
 * Buyer agent - the marketplace buyer. Broadcasts a WANT into a shared CoralOS thread, collects
 * competing bids, picks the best value, and settles through either PatchBond escrow or legacy x402.
 * In PatchBond sessions, a policy-limited signer sidecar owns the key and the buyer receives only its
 * non-secret URL:
 *
 *   WANT -> BIDs -> AWARD -> DEPOSITED -> DELIVERED -> VERIFIED -> RELEASED / REFUNDED
 *
 * Legacy x402 sessions still require BUYER_KEYPAIR_B58 locally and settle before delivery. The
 * PatchBond escrow path deposits after award and releases only after an independent PASS verdict.
 *
 * Env: SIGNER_URL (preferred PatchBond signer), BUYER_KEYPAIR_B58 (legacy local fallback),
 *      BUYER_MAX_SOL, BUYER_SERVICE/BUYER_ARG, MARKET_SELLERS, BID_WINDOW_MS,
 *      CYCLE_INTERVAL_MS, RETRY_INTERVAL_MS, SOLANA_RPC_URL, TRACE=1.
 */
import {
  startCoralAgent, loadKeypairB58, keypairSigner, signTransferTransaction,
  formatWant, parseBid, parsePaymentRequired, formatAward,
  formatPaymentProof, parsePaymentConfirmed, formatSettled, formatRefunded,
  formatVerify, parseVerified, sha256Hex, enforce, policyFromEnv,
  selectBids, verb, messageRound,
  type Bid, type PaymentRequired, type CoralAgentContext,
} from '@pay/agent-runtime'
import { depositEscrow, devnetExplorerTx, refundEscrow, releaseEscrow } from '@patchbond/core'
import { Connection, PublicKey } from '@solana/web3.js'
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
const SETTLEMENT_RAIL = (process.env.SETTLEMENT_RAIL ?? 'x402').toLowerCase()
const RPC_URL = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
const SIGNER_URL = (process.env.SIGNER_URL ?? '').replace(/\/$/, '')
const connection = new Connection(RPC_URL, 'confirmed')
const trace = process.env.TRACE === '1'

// The fund-moving choke point (POLICY_* env): spend caps, service allowlist, payout binding,
// post-award price binding, rate limit. Every payment passes through it BEFORE it's signed.
const policy = policyFromEnv(process.env, {
  budgetSol: BUDGET,
  service: SERVICE,
  ...(EXPECTED_SELLER_WALLET ? { expectedPayout: EXPECTED_SELLER_WALLET } : {}),
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type SignerHealth = { ok: boolean; network: string; buyer: string; maxSol: number }
type SignerTransaction = { signature: string; buyer: string }

async function signerRequest<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  if (!SIGNER_URL) throw new Error('SIGNER_URL is not configured')
  const response = await fetch(`${SIGNER_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : undefined,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` })) as Record<string, unknown>
  if (!response.ok) throw new Error(`policy signer rejected ${path}: ${String(payload.error ?? response.status)}`)
  return payload as T
}

async function signerTransaction(path: '/deposit' | '/release' | '/refund', body: Record<string, unknown>): Promise<string> {
  const result = await signerRequest<SignerTransaction>(path, body)
  if (typeof result.signature !== 'string' || !result.signature) throw new Error(`policy signer returned no signature for ${path}`)
  return result.signature
}

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
  const buyer = SIGNER_URL ? undefined : loadKeypairB58('BUYER_KEYPAIR_B58')
  const signer = buyer ? keypairSigner(buyer) : undefined
  let buyerPublicKey: string
  if (SIGNER_URL) {
    const health = await signerRequest<SignerHealth>('/health')
    if (!health.ok || health.network !== 'devnet') throw new Error('policy signer is not healthy on devnet')
    buyerPublicKey = new PublicKey(health.buyer).toBase58()
    if (!Number.isFinite(health.maxSol) || health.maxSol <= 0) throw new Error('policy signer reported an invalid spend cap')
  } else {
    buyerPublicKey = buyer!.publicKey.toBase58()
  }
  if (SETTLEMENT_RAIL !== 'escrow' && !signer) {
    throw new Error('x402 settlement requires a local BUYER_KEYPAIR_B58; SIGNER_URL supports escrow only')
  }
  console.error(`[buyer] market buyer - wallet=${buyerPublicKey} budget=${BUDGET} sellers=[${SELLERS.join(',')}]`)

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

      // -- collect one bid per known seller in parallel ---------------------
      // CoralOS may deliver simultaneous mentions through a single replay cursor. Dedicated
      // waitForAgent calls prevent one seller's fast response from hiding another seller's BID.
      const bidResults = await Promise.all(SELLERS.map(async (seller) => {
        const sellerDeadline = Date.now() + BID_WINDOW_MS
        while (Date.now() < sellerDeadline) {
          const message = await ctx.waitForAgent(seller, Math.max(500, sellerDeadline - Date.now()))
          if (!message) continue
          const bid = parseBid(message.text)
          if (bid && bid.round === round && bid.by === seller) return bid
        }
        return null
      }))
      const bids: Bid[] = bidResults.filter((bid): bid is Bid => bid !== null)
      const pool = selectBids(bids, round)
      if (pool.length === 0) { console.error(`[buyer] round ${round}: NO_SELLERS`); await sleep(RETRY_MS); continue }

      // -- award the best value (price × track record) -------------------------
      const { winner, reason } = await pickWinner(
        { round, service, arg, budgetSol: budget }, pool, NAME, REPUTATION_URL || undefined,
      )
      await ctx.send(formatAward(round, winner.by, reason), thread, [winner.by])

      // -- fund the awarded order: PatchBond uses real devnet escrow; legacy rounds may use x402 --
      const terms = await waitFor<PaymentRequired>(ctx, round, parsePaymentRequired, 15_000)
      if (!terms?.seller) { console.error(`[buyer] round ${round}: no payment terms from ${winner.by}`); await sleep(RETRY_MS); continue }
      const useEscrow = SETTLEMENT_RAIL === 'escrow'
      if (useEscrow && terms.rail !== 'escrow') throw new Error(`seller offered ${terms.rail}; escrow required`)
      if (useEscrow && !VERIFIER) throw new Error('escrow settlement requires VERIFIER_AGENT')
      const amountSol = Number(terms.amount)
      const paymentDecision = enforce({
        kind: 'payment', round, service, amountSol, payout: terms.seller,
        awardedPriceSol: winner.priceSol, spentSol, ...(lastPaymentAt != null ? { lastPaymentAt } : {}), now: Date.now(),
      }, policy)
      if (!paymentDecision.ok) {
        console.error(`[buyer] round ${round}: POLICY refused payment - ${paymentDecision.violations.join('; ')}`)
        await sleep(CYCLE_MS); continue
      }

      const fundedAt = Date.now()
      let paymentProof: string
      let fundingSignature: string | undefined
      if (useEscrow) {
        fundingSignature = SIGNER_URL
          ? await signerTransaction('/deposit', {
              seller: terms.seller,
              reference: terms.reference,
              amountSol,
              deadlineSeconds: terms.deadlineSecs ?? 90,
            })
          : await depositEscrow({
              connection,
              buyer: buyer!,
              seller: new PublicKey(terms.seller),
              reference: new PublicKey(terms.reference),
              amountSol,
              deadlineSeconds: terms.deadlineSecs ?? 90,
            })
        paymentProof = fundingSignature
        console.error(`[buyer] round ${round}: DEPOSITED ${amountSol} SOL (${devnetExplorerTx(fundingSignature)})`)
      } else {
        if (!signer) throw new Error('x402 settlement cannot use the remote policy signer')
        paymentProof = await signTransferTransaction(signer, terms.seller, amountSol, {
          reference: terms.reference,
          memo: `x402:round-${round}`.slice(0, 100),
        })
      }
      spentSol += amountSol
      lastPaymentAt = Date.now()
      await ctx.send(
        formatPaymentProof({
          round, rail: useEscrow ? 'escrow' : 'x402', reference: terms.reference,
          proof: paymentProof, buyer: buyerPublicKey,
          ...(fundingSignature ? { txSignature: fundingSignature } : {}),
        }),
        thread, [winner.by],
      )

      const confirmed = await waitFor(ctx, round, parsePaymentConfirmed, 20_000)
      if (!confirmed?.paid) {
        console.error(`[buyer] round ${round}: seller did not confirm ${useEscrow ? 'funded escrow' : 'payment'}`)
        await sleep(CYCLE_MS); continue
      }

      const delivered = await waitFor(ctx, round, (t) => {
        const r = messageRound(t)
        if (verb(t) !== 'DELIVERED' || r == null) return null
        return { round: r, payload: t.replace(/^DELIVERED\s+round=\d+\s*/i, '').trim() }
      }, 30_000)

      let verified = false
      if (delivered) {
        const gate = useEscrow
          ? { escalate: true, reason: 'escrow release requires independent verification' }
          : await decideVerifyEscalation(!!VERIFIER, VERIFY_GATE_ENABLED, winner.by, REPUTATION_URL || undefined)
        if (trace) console.error(`[buyer] round ${round}: verify-gate ${gate.escalate ? 'escalating' : 'skipping'} - ${gate.reason}`)
        if (gate.escalate) {
          const sha = sha256Hex(delivered.payload)
          await ctx.send(formatVerify({ round, service, arg, sha, payload: delivered.payload }), thread, [VERIFIER])
          const verdict = await waitFor(ctx, round, parseVerified, VERIFY_WINDOW_MS)
          verified = verdict?.verdict === 'pass' && (!verdict.sha || verdict.sha === sha)
          if (verdict) console.error(`[buyer] round ${round}: VERIFIED ${verdict.verdict}${verdict.reason ? ` (${verdict.reason})` : ''}`)
        } else {
          verified = true
        }
      }

      if (useEscrow) {
        if (delivered && verified) {
          const releaseSignature = SIGNER_URL
            ? await signerTransaction('/release', { seller: terms.seller, reference: terms.reference })
            : await releaseEscrow({
                connection, buyer: buyer!, seller: new PublicKey(terms.seller), reference: new PublicKey(terms.reference),
              })
          await ctx.send(formatSettled({
            round, rail: 'escrow', reference: terms.reference, amount: terms.amount,
            currency: 'SOL', txSignature: releaseSignature,
          }), thread, [winner.by])
          console.error(`[buyer] round ${round}: RELEASED (${devnetExplorerTx(releaseSignature)})`)
        } else {
          const refundableAt = fundedAt + (terms.deadlineSecs ?? 90) * 1000 + 2_000
          await sleep(Math.max(0, refundableAt - Date.now()))
          const refundSignature = SIGNER_URL
            ? await signerTransaction('/refund', { reference: terms.reference })
            : await refundEscrow({ connection, buyer: buyer!, reference: new PublicKey(terms.reference) })
          await ctx.send(formatRefunded({
            round, rail: 'escrow', reference: terms.reference, amount: terms.amount,
            currency: 'SOL', txSignature: refundSignature, reason: delivered ? 'verification failed' : 'delivery timeout',
          }), thread, [winner.by])
          console.error(`[buyer] round ${round}: REFUNDED (${devnetExplorerTx(refundSignature)})`)
        }
      } else if (delivered) {
        await ctx.send(formatSettled({
          round, rail: 'x402', reference: terms.reference, amount: terms.amount,
          ...(confirmed.txSignature ? { txSignature: confirmed.txSignature } : {}),
        }), thread, [winner.by])
        console.error(`[buyer] round ${round}: SETTLED`)
      } else {
        console.error(`[buyer] round ${round}: no delivery - x402 has no refund path`)
      }
    } catch (e) {
      console.error(`[buyer] round error: ${e}`)
    }
    await sleep(CYCLE_MS)
  }
})
