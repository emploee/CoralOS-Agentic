/**
 * TxODDS seller agent for the CoralOS market.
 *
 * Flow:
 *   WANT -> BID -> AWARD -> PAYMENT_REQUIRED -> PAYMENT_PROOF -> PAYMENT_CONFIRMED -> DELIVERED
 *
 * Settlement is x402: the buyer signs a transfer and hands it over; the seller submits it, verifies
 * on-chain that it actually paid the right amount to the right address carrying the right reference,
 * and only then delivers. Payment is direct and final - there is no escrow to fund/verify first, and
 * no release step afterward.
 */
import {
  startCoralAgent, verb, parseWant, formatBid, parseAward,
  formatPaymentRequired, parsePaymentProof, formatPaymentConfirmed,
  generateReference, submitSignedTransaction, verifyPayment,
  envSigner, type WalletSigner,
} from '@pay/agent-runtime'
import { adapterFromEnv, sellerConfigFromEnv } from '@pay/harness-runtime'
import { procureUpstream } from '@pay/payment-runtime'
import { deliverServiceResult } from './service.js'

const NAME = process.env.AGENT_NAME ?? 'seller-agent'
const SELLER_WALLET = process.env.SELLER_WALLET ?? ''
// Upstream procurement: PROCURE_RAIL=x402 makes the seller buy an upstream resource for real,
// paid over x402, after it's been paid and before delivering — the seller is a buyer too, in the
// same round it's getting paid in. The PAYMENT_* leg is posted on the market thread (unmentioned:
// bus-visible, buyer-loop-invisible); the feed folds it into the round's proof receipts, so the run
// ledger records what the seller actually paid upstream. Needs its own spend key (SELLER_KEYPAIR_B58,
// distinct from SELLER_WALLET which is just the receive address for the seller's own sale) funded
// with devnet SOL, and network access to PROCURE_X402_URL (default assumes the txodds proxy is
// running on the host — `host.docker.internal` is reachable from Docker Desktop containers).
const PROCURE_RAIL = (process.env.PROCURE_RAIL ?? '').toLowerCase()
const PROCURE_X402_URL = process.env.PROCURE_X402_URL ?? 'http://host.docker.internal:8801/api/edge-x402'
let procureSigner: WalletSigner | undefined
const getProcureSigner = (): WalletSigner => (procureSigner ??= envSigner('SELLER_KEYPAIR_B58'))
const cfg = sellerConfigFromEnv(NAME)
const trace = process.env.TRACE === '1'
// The harness does the work; this agent keeps the wallet, the protocol, and the payment checks.
const adapter = adapterFromEnv(deliverServiceResult)

interface Quote { service: string; arg: string; priceSol: number }
const quoted = new Map<number, Quote>()
const awarded = new Map<string, { round: number } & Quote>()

const expl = (sig: string): string => `https://explorer.solana.com/tx/${sig}?cluster=devnet`

await startCoralAgent({ agentName: NAME }, async (ctx) => {
  console.error(`[${NAME}] ready: services=[${cfg.services.join(',')}] floor=${cfg.floorSol} harness=${adapter.name} wallet=${SELLER_WALLET}`)

  while (true) {
    try {
      const mention = await ctx.waitForMention()
      if (!mention) continue
      const text = mention.text.trim()
      if (trace) console.error(`[${NAME}] <- ${text.slice(0, 140)}`)

      const want = parseWant(text)
      if (want) {
        const decision = await adapter.quote(want, cfg)
        if (decision.bid) {
          quoted.set(want.round, { service: want.service, arg: want.arg, priceSol: decision.priceSol })
          await ctx.reply(mention, formatBid({
            round: want.round,
            priceSol: decision.priceSol,
            by: NAME,
            note: decision.note,
          }))
        } else if (trace) {
          console.error(`[${NAME}] no bid on round ${want.round}: ${decision.note}`)
        }
        continue
      }

      const award = parseAward(text)
      if (award) {
        const quote = quoted.get(award.round)
        if (award.to !== NAME || !quote) continue
        const reference = generateReference()
        awarded.set(reference, { round: award.round, ...quote })
        quoted.delete(award.round)
        await ctx.reply(mention, formatPaymentRequired({
          round: award.round,
          rail: 'x402',
          amount: String(quote.priceSol),
          currency: 'SOL',
          reference,
          seller: SELLER_WALLET,
        }))
        continue
      }

      const proof = parsePaymentProof(text)
      if (proof) {
        const order = awarded.get(proof.reference)
        if (!order) {
          await ctx.reply(mention, `ERROR: unknown reference ${proof.reference}`)
          continue
        }
        try {
          // The buyer signed but never submitted (see buyer-agent/index.ts) - the merchant decides
          // whether/when to broadcast. A submitted tx is never trusted on landing alone: verifyPayment
          // re-checks recipient/amount/reference on-chain before anything is treated as paid.
          const sig = await submitSignedTransaction(proof.proof)
          const paid = await verifyPayment(sig, {
            recipient: SELLER_WALLET,
            amountSol: order.priceSol,
            reference: proof.reference,
          })
          if (!paid) {
            await ctx.reply(mention, formatPaymentConfirmed({ round: order.round, rail: 'x402', reference: proof.reference, paid: false }))
            continue
          }
          awarded.delete(proof.reference)
          if (trace) console.error(`[${NAME}] payment confirmed (${expl(sig)}) -> delivering round ${order.round}`)
          await ctx.reply(mention, formatPaymentConfirmed({
            round: order.round, rail: 'x402', reference: proof.reference, paid: true,
            amount: String(order.priceSol), currency: 'SOL', txSignature: sig,
          }))

          if (PROCURE_RAIL === 'x402' && mention.threadId) {
            // Buy upstream context before doing the work, for real, over x402; a procurement failure
            // never blocks delivery (the harness has its own fallbacks) — it just leaves no receipt.
            try {
              const procurement = await procureUpstream({
                orderId: `${NAME}/round-${order.round}`,
                round: order.round,
                buyer: NAME,
                signer: getProcureSigner(),
                url: PROCURE_X402_URL,
                service: `${order.service}-upstream`,
              })
              for (const msg of procurement.messages) await ctx.send(msg, mention.threadId)
              if (trace) console.error(`[${NAME}] upstream procured via x402: paid=${procurement.receipt.paid} proof=${procurement.receipt.proof.slice(0, 24)}…`)
            } catch (e) {
              console.error(`[${NAME}] upstream procurement failed (delivering anyway): ${(e as Error).message}`)
            }
          }
          const delivery = await adapter.run(
            { round: order.round, service: order.service, arg: order.arg, priceSol: order.priceSol, reference: proof.reference },
            trace ? (e) => console.error(`[${NAME}] harness ${e.kind}${e.text ? `: ${e.text}` : ''}`) : undefined,
          )
          await ctx.reply(mention, `DELIVERED round=${order.round} ${delivery.payload}`)
        } catch (e) {
          await ctx.reply(mention, `ERROR: settlement failed - ${(e as Error).message}`)
        }
        continue
      }

      if (verb(text) === 'SETTLED') {
        if (trace) console.error(`[${NAME}] ${text}`)
      }
    } catch (e) {
      console.error(`[${NAME}] loop error: ${e}`)
    }
  }
})
