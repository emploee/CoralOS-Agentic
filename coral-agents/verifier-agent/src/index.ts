/**
 * Verifier agent - the independent 3rd party in the market's settlement.
 *
 * The buyer hands it the delivered payload (VERIFY, with the content hash it received); the verifier
 * re-checks hash + structure (+ an optional LLM acceptance judge) and replies VERIFIED pass|fail.
 * The buyer gates escrow release on that verdict - the arbiter program's neutral-3rd-signer role,
 * surfaced into the market conversation. Holds no keys, moves no funds.
 */
import { startCoralAgent, parseVerify, formatVerified } from '@pay/agent-runtime'
import { checkDelivery } from './verify.js'

const NAME = process.env.AGENT_NAME ?? 'verifier-agent'

await startCoralAgent({ agentName: NAME }, async (ctx) => {
  console.error(`[${NAME}] independent delivery verifier ready`)
  while (true) {
    try {
      const mention = await ctx.waitForMention()
      if (!mention) continue
      const req = parseVerify(mention.text.trim())
      if (!req) continue
      const verdict = await checkDelivery(req, NAME)
      console.error(`[${NAME}] round ${req.round}: ${verdict.verdict}${verdict.reason ? ` (${verdict.reason})` : ''}`)
      await ctx.reply(mention, formatVerified(verdict))
    } catch (e) {
      console.error(`[${NAME}] loop error: ${e}`)
    }
  }
})
