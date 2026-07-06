/**
 * TxODDS seller agent for the CoralOS market.
 *
 * Flow:
 *   WANT -> BID -> AWARD -> ESCROW_REQUIRED -> DEPOSITED -> DELIVERED
 *
 * Settlement is arbiter-gated by default. The buyer opens escrow through the arbiter wrapper, then the
 * seller verifies the funded escrow using the vault PDA before delivering the TxODDS read.
 */
import { createHash } from 'node:crypto'
import type { Program } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import {
  startCoralAgent, verb, parseWant, formatBid, parseAward, formatEscrowRequired, parseDeposited,
  formatLlmUsed,
} from '@pay/agent-runtime'
import { adapterFromEnv, sellerConfigFromEnv } from '@pay/harness-runtime'
import { procureUpstream } from '@pay/payment-runtime'
import { makeProgram, isFunded } from './escrow.js'
import { deliverServiceResult } from './service.js'

const NAME = process.env.AGENT_NAME ?? 'seller-agent'
const SELLER_WALLET = process.env.SELLER_WALLET ?? ''
const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
const ESCROW_DEADLINE_SECS = Number(process.env.ESCROW_DEADLINE_SECS ?? '600')
const SETTLEMENT_MODE = (process.env.SETTLEMENT_MODE ?? 'arbiter').toLowerCase() === 'direct' ? 'direct' : 'arbiter'
// Upstream procurement (Phase 10): PROCURE_RAIL=pay-sh makes the seller buy upstream context
// through the payment-runtime rail after escrow funds and before delivering. The PAYMENT_* leg is
// posted on the market thread (unmentioned: bus-visible, buyer-loop-invisible); the feed folds it
// into the round's proof receipts, so the run ledger records what the seller paid upstream.
const PROCURE_RAIL = (process.env.PROCURE_RAIL ?? '').toLowerCase()
const PROCURE_PROVIDER = process.env.PROCURE_PROVIDER ?? 'pay.sh/txodds-context'
const PROCURE_AMOUNT = process.env.PROCURE_AMOUNT ?? '0.03' // USDC
const cfg = sellerConfigFromEnv(NAME)
const trace = process.env.TRACE === '1'
// The harness does the work; this agent keeps the wallet, the protocol, and the escrow checks.
const adapter = adapterFromEnv(deliverServiceResult)

interface Quote { service: string; arg: string; priceSol: number }
const quoted = new Map<number, Quote>()
const awarded = new Map<string, { round: number } & Quote>()

let program: Program | null = null
const escrowProgram = async (): Promise<Program> => (program ??= await makeProgram(RPC))

function boundReference(order: Quote & { round: number }): string {
  const preimage = `txodds-coral:${order.round}:${order.service}:${order.arg}:${SELLER_WALLET}:${order.priceSol}`
  return new PublicKey(createHash('sha256').update(preimage).digest()).toBase58()
}

await startCoralAgent({ agentName: NAME }, async (ctx) => {
  console.error(`[${NAME}] ready: services=[${cfg.services.join(',')}] floor=${cfg.floorSol} settlement=${SETTLEMENT_MODE} harness=${adapter.name} wallet=${SELLER_WALLET}`)

  while (true) {
    try {
      const mention = await ctx.waitForMention()
      if (!mention) continue
      const text = mention.text.trim()
      if (trace) console.error(`[${NAME}] <- ${text.slice(0, 140)}`)

      const want = parseWant(text)
      if (want) {
        const decision = await adapter.quote(want, cfg)
        if (decision.llm && mention.threadId) await ctx.send(formatLlmUsed(decision.llm), mention.threadId)
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
        const reference = boundReference({ round: award.round, ...quote })
        awarded.set(reference, { round: award.round, ...quote })
        quoted.delete(award.round)
        await ctx.reply(mention, formatEscrowRequired({
          round: award.round,
          reference,
          seller: SELLER_WALLET,
          amountSol: quote.priceSol,
          deadlineSecs: ESCROW_DEADLINE_SECS,
          settlement: SETTLEMENT_MODE,
        }))
        continue
      }

      const deposited = parseDeposited(text)
      if (deposited) {
        const order = awarded.get(deposited.reference)
        if (!order) {
          await ctx.reply(mention, `ERROR: unknown reference ${deposited.reference}`)
          continue
        }
        try {
          const escrowBuyer = deposited.settlement === 'arbiter' && deposited.vault ? deposited.vault : deposited.buyer
          const funded = await isFunded(
            await escrowProgram(),
            new PublicKey(escrowBuyer),
            new PublicKey(SELLER_WALLET),
            new PublicKey(deposited.reference),
            order.priceSol,
          )
          if (!funded) {
            await ctx.reply(mention, `ERROR: escrow not funded for reference=${deposited.reference}`)
            continue
          }
          awarded.delete(deposited.reference)
          if (trace) console.error(`[${NAME}] escrow funded via ${deposited.settlement ?? 'direct'} -> delivering round ${deposited.round}`)
          if (PROCURE_RAIL === 'pay-sh' && mention.threadId) {
            // Buy upstream context before doing the work; a procurement failure never blocks
            // delivery (the harness has its own fallbacks) — it just leaves no receipt.
            try {
              const procurement = await procureUpstream({
                orderId: `${NAME}/round-${deposited.round}`,
                round: deposited.round,
                buyer: NAME,
                provider: PROCURE_PROVIDER,
                service: `${order.service}-upstream`,
                amount: PROCURE_AMOUNT,
              })
              for (const msg of procurement.messages) await ctx.send(msg, mention.threadId)
              if (trace) console.error(`[${NAME}] upstream procured via pay-sh: paid=${procurement.receipt.paid} simulated=${procurement.receipt.simulated === true} proof=${procurement.receipt.proof.slice(0, 24)}…`)
            } catch (e) {
              console.error(`[${NAME}] upstream procurement failed (delivering anyway): ${(e as Error).message}`)
            }
          }
          const delivery = await adapter.run(
            { round: deposited.round, service: order.service, arg: order.arg, priceSol: order.priceSol, reference: deposited.reference },
            trace ? (e) => console.error(`[${NAME}] harness ${e.kind}${e.text ? `: ${e.text}` : ''}`) : undefined,
          )
          if (mention.threadId) {
            for (const llm of delivery.llm ?? []) await ctx.send(formatLlmUsed(llm), mention.threadId)
          }
          await ctx.reply(mention, `DELIVERED round=${deposited.round} ${delivery.payload}`)
        } catch (e) {
          await ctx.reply(mention, `ERROR: settlement failed - ${(e as Error).message}`)
        }
        continue
      }

      if (verb(text) === 'ARBITER_RELEASED' || verb(text) === 'RELEASED') {
        if (trace) console.error(`[${NAME}] ${text}`)
      }
    } catch (e) {
      console.error(`[${NAME}] loop error: ${e}`)
    }
  }
})
