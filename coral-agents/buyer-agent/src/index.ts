/**
 * Buyer agent - the marketplace buyer. Broadcasts a WANT into a shared CoralOS thread, collects
 * competing LLM bids, picks the best value, and settles through the escrow contract:
 *
 *   WANT -> (collect BIDs for a window) -> AWARD winner -> wait ESCROW_REQUIRED ->
 *   deposit() into escrow -> DEPOSITED -> wait DELIVERED -> release() to the seller
 *
 * Selection uses the LLM (best value), with a deterministic cheapest fallback so a slow/missing model
 * never hangs the round. Settlement is escrow-only - funds are conditional on delivery.
 *
 * Env: BUYER_KEYPAIR_B58 (signs), BUYER_MAX_SOL (budget), BUYER_SERVICE/BUYER_ARG (the WANT),
 *      MARKET_SELLERS (csv of seller names), BID_WINDOW_MS, SOLANA_RPC_URL,
 *      VENICE_API_KEY|ANTHROPIC_API_KEY|OPENAI_API_KEY (+ LLM_PROVIDER), TRACE=1.
 *
 * The deposit/release calls settle against the escrow program deployed to devnet; they need a funded
 * devnet wallet + live RPC, so they run in a live market session rather than in `npm test`/CI.
 */
import {
  startCoralAgent, complete, parseJsonReply, loadKeypairB58,
  formatWant, parseBid, parseEscrowRequired, formatAward, formatDeposited,
  formatVerify, parseVerified, sha256Hex, enforce, policyFromEnv,
  selectBids, pickCheapest, verb, messageRound,
  type Bid, type EscrowTerms, type CoralAgentContext,
} from '@pay/agent-runtime'
import { PublicKey } from '@solana/web3.js'
import { makeProgram, deposit, release, escrowPda } from './escrow.js'
import {
  ARBITER_PROGRAM_ID, ensureArbiterConfig, ensureArbiterFunded, makeArbiter,
  openArbitrated, arbitrateRelease, arbitratedEscrowPda,
} from './arbiter.js'
import { fetchNextWant } from './wantFeed.js'
import { fetchReputationLines } from './reputation.js'

const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
const BUDGET = Number(process.env.BUYER_MAX_SOL ?? '0.001')
const SERVICE = process.env.BUYER_SERVICE ?? 'txline'
// Rotate through several args so each round trades a *different* thing (BUYER_ARGS=csv of fixture ids,
// else the single BUYER_ARG). This is what stops the market looking like the same round on a loop.
const ARGS = (process.env.BUYER_ARGS || process.env.BUYER_ARG || 'SOL-USDC').split(',').map((s) => s.trim()).filter(Boolean)
const ARG = ARGS[0]
const BID_WINDOW_MS = Number(process.env.BID_WINDOW_MS ?? '5000')
const CYCLE_MS = Number(process.env.CYCLE_INTERVAL_MS ?? '30000')
const SELLERS = (process.env.MARKET_SELLERS ?? 'seller-worldcup,seller-fast,seller-premium')
  .split(',').map((s) => s.trim()).filter(Boolean)
// F3: the payout wallet the buyer expects (personas share one in the demo). If set, the buyer refuses
// to deposit to an ESCROW_REQUIRED whose seller= pubkey differs - binding the award to the payout.
const EXPECTED_SELLER_WALLET = process.env.SELLER_WALLET ?? ''
const SETTLEMENT_MODE = (process.env.SETTLEMENT_MODE ?? 'arbiter').toLowerCase()
// Independent delivery verification (coral-agents/verifier-agent): when set, the buyer hands each
// delivery to this agent and releases ONLY on a VERIFIED pass - no verdict means funds stay in
// escrow, refundable after the deadline.
const VERIFIER = process.env.VERIFIER_AGENT ?? ''
const VERIFY_WINDOW_MS = Number(process.env.VERIFY_WINDOW_MS ?? '20000')
// Event mode (the research market): poll this feed for the next job instead of rotating BUYER_ARGS.
const WANT_FEED = process.env.WANT_FEED_URL ?? ''
// Track record from the run ledger (the feed's /api/reputation): history shapes who wins awards.
const REPUTATION_URL = process.env.REPUTATION_URL ?? ''
const trace = process.env.TRACE === '1'

// The fund-moving choke point (POLICY_* env): spend caps, service allowlist, payout binding,
// post-award price binding, rate limit, verifier gate. Every deposit/release passes through it.
const policy = policyFromEnv(process.env, {
  budgetSol: BUDGET,
  service: SERVICE,
  ...(EXPECTED_SELLER_WALLET ? { expectedPayout: EXPECTED_SELLER_WALLET } : {}),
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const expl = (kind: 'tx' | 'address', id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`

/** Best-value selection via LLM; deterministic cheapest fallback. Returns the winner + its reasoning. */
async function pickWinner(pool: Bid[], repLines?: string): Promise<{ winner: Bid; reason?: string }> {
  if (pool.length === 1) return { winner: pool[0] }
  try {
    const system =
      'You are a buyer choosing the best-value bid for a Solana data service. Weigh price against ' +
      'each seller\'s track record when one is given - a cheap seller that fails verification or ' +
      'no-shows is not a bargain. Reply ONLY with JSON {"by": "<seller name>", "reason": "<short>"}.'
    const user =
      `service=${SERVICE} arg=${ARG} budget=${BUDGET}\nbids:\n` +
      pool.map((b) => `- ${b.by}: ${b.priceSol} SOL${b.note ? ` (${b.note})` : ''}`).join('\n') +
      (repLines ? `\ntrack record (derived from the run ledger):\n${repLines}` : '')
    const parsed = parseJsonReply<{ by?: string; reason?: string }>(await complete({ system, user, maxTokens: 100 }))
    const chosen = pool.find((b) => b.by === parsed?.by)
    if (chosen) {
      console.error(`[buyer] picked ${chosen.by} (${chosen.priceSol} SOL): ${parsed?.reason ?? ''}`)
      return { winner: chosen, reason: parsed?.reason }
    }
  } catch {
    /* fall through to deterministic choice */
  }
  return { winner: pickCheapest(pool)!, reason: 'cheapest available' }
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

await startCoralAgent({ agentName: process.env.AGENT_NAME ?? 'buyer-agent' }, async (ctx) => {
  const buyer = loadKeypairB58('BUYER_KEYPAIR_B58')
  const arbiter = SETTLEMENT_MODE === 'arbiter' ? loadKeypairB58('ARBITER_KEYPAIR_B58') : null
  console.error(`[buyer] market buyer - wallet=${buyer.publicKey.toBase58()} budget=${BUDGET} sellers=[${SELLERS.join(',')}]`)

  const participants = [...SELLERS, ...(VERIFIER ? [VERIFIER] : [])]
  for (const s of participants) {
    try { await ctx.waitForAgent(s, 8000) } catch { /* agent may already be present */ }
  }
  const thread = await ctx.createThread('market', participants)
  const program = await makeProgram(buyer, RPC)
  if (arbiter) {
    await ensureArbiterConfig(buyer, arbiter.publicKey, RPC)
    await ensureArbiterFunded(buyer, arbiter.publicKey, RPC)
  }
  let round = 0
  let spentSol = 0
  let lastDepositAt: number | undefined

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
      if (pool.length === 0) { console.error(`[buyer] round ${round}: NO_SELLERS`); await sleep(CYCLE_MS); continue }

      // -- award the best value (price × track record) -------------------------
      const repLines = REPUTATION_URL ? await fetchReputationLines(REPUTATION_URL) : undefined
      const { winner, reason } = await pickWinner(pool, repLines)
      await ctx.send(formatAward(round, winner.by, reason), thread, [winner.by])

      // -- settle through escrow: deposit -> DEPOSITED -> wait DELIVERED -> release
      const terms = await waitFor<EscrowTerms>(ctx, round, parseEscrowRequired, 15_000)
      if (!terms) { console.error(`[buyer] round ${round}: no escrow terms from ${winner.by}`); await sleep(CYCLE_MS); continue }
      // One choke point for everything that must be true before funds move (subsumes payoutMatches).
      const depositDecision = enforce({
        kind: 'deposit', round, service, amountSol: terms.amountSol, payout: terms.seller,
        awardedPriceSol: winner.priceSol, spentSol, ...(lastDepositAt != null ? { lastDepositAt } : {}), now: Date.now(),
      }, policy)
      if (!depositDecision.ok) {
        console.error(`[buyer] round ${round}: POLICY refused deposit - ${depositDecision.violations.join('; ')}`)
        await sleep(CYCLE_MS); continue
      }

      const reference = new PublicKey(terms.reference)
      const seller = new PublicKey(terms.seller)
      const requestedSettlement = terms.settlement ?? (SETTLEMENT_MODE === 'direct' ? 'direct' : 'arbiter')
      let depositSig: string
      let vault: PublicKey | undefined
      if (requestedSettlement === 'arbiter') {
        if (!arbiter) throw new Error('ARBITER_KEYPAIR_B58 is required for SETTLEMENT_MODE=arbiter')
        const opened = await openArbitrated(makeArbiter(buyer, RPC), buyer, seller, reference, terms.amountSol, terms.deadlineSecs)
        depositSig = opened.sig
        vault = opened.vault
      } else {
        depositSig = await deposit(program, buyer, seller, reference, terms.amountSol, terms.deadlineSecs)
      }
      spentSol += terms.amountSol
      lastDepositAt = Date.now()
      console.error(`[buyer] round ${round}: DEPOSITED ${terms.amountSol} SOL -> ${winner.by} (session spend ${spentSol.toFixed(6)} SOL)`)
      if (trace) {
        if (requestedSettlement === 'arbiter' && vault) {
          console.error(`[buyer]   arbiter: ${expl('address', ARBITER_PROGRAM_ID.toBase58())}`)
          console.error(`[buyer]   vault PDA: ${expl('address', vault.toBase58())}`)
          console.error(`[buyer]   escrow PDA: ${expl('address', arbitratedEscrowPda(vault, reference).toBase58())}`)
          console.error(`[buyer]   open tx: ${expl('tx', depositSig)}`)
        } else {
          console.error(`[buyer]   escrow PDA: ${expl('address', escrowPda(buyer.publicKey, reference).toBase58())}`)
          console.error(`[buyer]   deposit tx: ${expl('tx', depositSig)}`)
        }
      }
      await ctx.send(
        formatDeposited({
          round,
          reference: terms.reference,
          buyer: buyer.publicKey.toBase58(),
          sig: depositSig,
          settlement: requestedSettlement,
          ...(vault && arbiter ? { vault: vault.toBase58(), arbiter: arbiter.publicKey.toBase58() } : {}),
        }),
        thread, [winner.by],
      )

      const delivered = await waitFor(ctx, round, (t) => {
        const r = messageRound(t)
        if (verb(t) !== 'DELIVERED' || r == null) return null
        return { round: r, payload: t.replace(/^DELIVERED\s+round=\d+\s*/i, '').trim() }
      }, 30_000)

      if (delivered) {
        let verified: 'pass' | 'fail' | undefined
        if (VERIFIER) {
          // Hand the exact artifact (content-hashed) to the independent verifier.
          const sha = sha256Hex(delivered.payload)
          await ctx.send(formatVerify({ round, service, arg, sha, payload: delivered.payload }), thread, [VERIFIER])
          const verdict = await waitFor(ctx, round, parseVerified, VERIFY_WINDOW_MS)
          verified = verdict?.verdict
          if (verdict) console.error(`[buyer] round ${round}: verifier ${verdict.by} says ${verdict.verdict}${verdict.reason ? ` (${verdict.reason})` : ''}`)
        }
        // Same choke point on the way out: release only passes policy (verifier gate when configured).
        const releaseDecision = enforce({ kind: 'release', round, ...(verified ? { verified } : {}) }, policy)
        if (!releaseDecision.ok) {
          console.error(
            `[buyer] round ${round}: POLICY refused release - ${releaseDecision.violations.join('; ')}` +
            ' - funds stay in escrow, refundable after the deadline',
          )
          await sleep(CYCLE_MS)
          continue
        }
        const releaseSig = requestedSettlement === 'arbiter' && arbiter
          ? await arbitrateRelease(makeArbiter(arbiter, RPC), arbiter, seller, reference)
          : await release(program, buyer, seller, reference)
        const releaseVerb = requestedSettlement === 'arbiter' ? 'ARBITER_RELEASED' : 'RELEASED'
        console.error(`[buyer] round ${round}: ${releaseVerb} to ${winner.by} - ${expl('tx', releaseSig)}`)
        await ctx.send(`${releaseVerb} round=${round} sig=${releaseSig} settlement=${requestedSettlement}`, thread, [winner.by])
      } else {
        console.error(`[buyer] round ${round}: no delivery - funds stay in escrow, refundable after the deadline`)
      }
    } catch (e) {
      console.error(`[buyer] round error: ${e}`)
    }
    await sleep(CYCLE_MS)
  }
})
