/**
 * Freelancer market starter — heterogeneous harnesses compete for paid work.
 *
 * One session graph: a buyer posting a freelance brief, a baseline LLM seller (seller-scribe),
 * optionally a Claude Code harness seller (seller-claude, CLAUDE_SELLER=1), and an independent
 * verifier the buyer gates release on. The winner works, delivers a hash-bound artifact, the
 * verifier checks it, and only a VERIFIED pass releases the escrow (arbiter settlement).
 *
 *   WANT → BIDs (different harnesses, different prices) → AWARD → escrow → work → DELIVERED
 *        → VERIFY → VERIFIED pass → ARBITER_RELEASED   (fail/timeout → funds stay refundable)
 *
 *   CORAL_SERVER_URL  default http://localhost:5555
 *   CORAL_TOKEN       default dev   (must be in coral.toml [auth] keys)
 *   FREELANCE_BRIEFS  csv of hyphenated briefs rotated per round (no spaces — the WANT arg is one token)
 *   CLAUDE_SELLER=1   add seller-claude (build its image first: Dockerfile.claude; needs ANTHROPIC_API_KEY)
 *
 * Run from the host after `docker compose up coral`:  npm install && npm start
 * Watch it: the marketplace feed + web visualizer work unchanged (same wire protocol) —
 *   cd ../marketplace/feed && SESSION=<id> MARKET_SELLERS=seller-scribe,seller-claude npm start
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.CORAL_SERVER_URL ?? 'http://localhost:5555'
const TOKEN = process.env.CORAL_TOKEN ?? 'dev'
const NS = 'default'
const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

// ── Load repo-root .env (2 levels up: freelancer → examples → root) ──
function loadEnv(): Record<string, string> {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* no .env — rely on process.env */ }
  return env
}

// ── Typed coral option values ──
const str = (value: string) => ({ type: 'string', value })
const f64 = (value: number) => ({ type: 'f64', value })

const agent = (name: string, options: Record<string, unknown>) => ({
  id: { name, version: '0.1.0', registrySourceId: { type: 'local' } },
  name,
  provider: { type: 'local', runtime: 'docker' },
  options,
})

async function main() {
  const env = loadEnv()
  const wallet = env.WALLET
  const keypair = env.BUYER_KEYPAIR_B58
  if (!wallet || !keypair) {
    throw new Error('WALLET and BUYER_KEYPAIR_B58 must be set in .env — run `node scripts/setup.js`')
  }
  const rpc = env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
  const trace = env.TRACE ?? ''

  // LLM provider — the kit uses Venice AI; flip the whole market with LLM_PROVIDER in .env (see LLM.md).
  const llmOpts: Record<string, unknown> = {}
  if (env.VENICE_API_KEY) llmOpts.VENICE_API_KEY = str(env.VENICE_API_KEY)
  if (env.OPENAI_API_KEY) llmOpts.OPENAI_API_KEY = str(env.OPENAI_API_KEY)
  if (env.ANTHROPIC_API_KEY) llmOpts.ANTHROPIC_API_KEY = str(env.ANTHROPIC_API_KEY)
  if (env.LLM_PROVIDER) llmOpts.LLM_PROVIDER = str(env.LLM_PROVIDER)
  if (env.LLM_MODEL) llmOpts.LLM_MODEL = str(env.LLM_MODEL)
  if (trace) llmOpts.TRACE = str(trace)

  // The lineup: the baseline LLM worker always; the Claude Code harness seller when its image exists.
  const sellers = ['seller-scribe']
  const claudeWanted = env.CLAUDE_SELLER === '1'
  const claudeReady = claudeWanted && !!env.ANTHROPIC_API_KEY
  if (claudeWanted && !claudeReady) {
    console.warn('[freelancer] CLAUDE_SELLER=1 but ANTHROPIC_API_KEY missing — headless `claude -p` needs it. Skipping seller-claude.')
  }
  if (claudeReady) sellers.push('seller-claude')

  // Hyphenated briefs — the WANT arg is a single token on the wire.
  const briefs = env.FREELANCE_BRIEFS ?? 'landing-page-hero-copy,pricing-table-microcopy,launch-tweet-thread'

  const sellerAgents = [
    agent('seller-scribe', {
      SELLER_WALLET: str(wallet), SOLANA_RPC_URL: str(rpc), AGENT_NAME: str('seller-scribe'),
      SERVICES: str('freelance'), ...llmOpts,
    }),
    ...(claudeReady
      ? [agent('seller-claude', {
          SELLER_WALLET: str(wallet), SOLANA_RPC_URL: str(rpc), AGENT_NAME: str('seller-claude'),
          SERVICES: str('freelance'), ANTHROPIC_API_KEY: str(env.ANTHROPIC_API_KEY),
          ...(trace ? { TRACE: str(trace) } : {}),
        })]
      : []),
  ]

  const sres = await fetch(`${BASE}/api/v1/local/session`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({
      agentGraphRequest: {
        agents: [
          agent('buyer-agent', {
            BUYER_KEYPAIR_B58: str(keypair),
            // Arbiter settlement (the default) needs the neutral 3rd signer's key.
            ...(env.ARBITER_KEYPAIR_B58 ? { ARBITER_KEYPAIR_B58: str(env.ARBITER_KEYPAIR_B58) } : {}),
            AGENT_NAME: str('buyer-agent'),
            SOLANA_RPC_URL: str(rpc),
            SELLER_WALLET: str(wallet),
            BUYER_MAX_SOL: f64(Number(env.BUYER_MAX_SOL ?? '0.001')),
            BUYER_SERVICE: str('freelance'),
            BUYER_ARGS: str(briefs),
            MARKET_SELLERS: str(sellers.join(',')),
            // Release is gated on the independent verifier's VERIFIED pass.
            VERIFIER_AGENT: str('verifier-agent'),
            ...llmOpts,
          }),
          ...sellerAgents,
          agent('verifier-agent', { AGENT_NAME: str('verifier-agent'), ...llmOpts }),
        ],
      },
      namespaceProvider: { type: 'create_if_not_exists', namespaceRequest: { name: NS } },
      execution: { mode: 'immediate' },
    }),
  })
  if (!sres.ok) throw new Error(`session create failed: ${sres.status} ${await sres.text()}`)
  const { sessionId } = await sres.json() as { sessionId: string }

  console.log(`\n✅ Freelancer market session ${sessionId} — buyer + ${sellers.join(', ')} + verifier-agent.`)
  console.log(`   receive wallet: ${wallet}`)
  console.log('   The buyer posts a freelance brief; harnesses bid; the winner works; the verifier gates release.\n')
  console.log('   Watch the market:')
  console.log('     docker logs -f buyer-agent       # WANT → AWARD → DEPOSITED → verified → ARBITER_RELEASED')
  console.log('     docker logs -f seller-scribe     # BID → ESCROW_REQUIRED → DELIVERED')
  console.log('     docker logs -f verifier-agent    # VERIFY in → VERIFIED verdict out')
  console.log(`   Run ledger: every round lands in examples/marketplace/runs/ via the feed server.\n`)
}

main().catch((e) => { console.error(`[freelancer] ${e}`); process.exitCode = 1 })
