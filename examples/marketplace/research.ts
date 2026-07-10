/**
 * Research market starter — live odds events trigger paid specialist research.
 *
 * One session graph: an EVENT-DRIVEN buyer (WANT_FEED_URL → the watcher), specialist research
 * sellers competing on the same verified TxLINE read (movement analyst vs quant modeller vs the
 * World Cup generalist), and the independent verifier gating release. No event → no WANT → no spend.
 *
 *   odds move on the live board → watcher queues a job → buyer posts WANT txline <fixtureId>
 *   → specialist BIDs (different personas, floors) → AWARD → escrow → DELIVERED (verified read)
 *   → VERIFY → VERIFIED pass → ARBITER_RELEASED
 *
 * Run order (three terminals or backgrounds):
 *   1. cd examples/txodds && npm run proxy                     # the live board on :8801
 *   2. cd coral-agents/signal-agent && npm start                # the event detector on :4600
 *      (or: cd examples/txodds && npm run watch — the legacy bare-HTTP watcher, same contract)
 *   3. docker compose up -d coral && cd examples/marketplace && npm run research
 *
 * A deep-research tier (e.g. xpriment626/delve) joins as a persona with
 * HARNESS=cli HARNESS_CMD='delve {prompt}' — see packages/harness-runtime.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.CORAL_SERVER_URL ?? 'http://localhost:5555'
const TOKEN = process.env.CORAL_TOKEN ?? 'dev'
const NS = 'default'
const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
// The buyer runs in Docker; the watcher runs on the host.
const WANT_FEED = process.env.WANT_FEED_URL ?? 'http://host.docker.internal:4600/next'

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
  const txlineKey = env.TXLINE_API_KEY
  if (!txlineKey) {
    throw new Error('TXLINE_API_KEY missing — the research market sells verified TxODDS reads. Mint one with `npm run mint` in examples/txodds.')
  }
  const rpc = env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
  const trace = env.TRACE ?? ''

  const llmOpts: Record<string, unknown> = {}
  if (env.VENICE_API_KEY) llmOpts.VENICE_API_KEY = str(env.VENICE_API_KEY)
  if (env.OPENAI_API_KEY) llmOpts.OPENAI_API_KEY = str(env.OPENAI_API_KEY)
  if (env.ANTHROPIC_API_KEY) llmOpts.ANTHROPIC_API_KEY = str(env.ANTHROPIC_API_KEY)
  if (env.LLM_PROVIDER) llmOpts.LLM_PROVIDER = str(env.LLM_PROVIDER)
  if (env.LLM_MODEL) llmOpts.LLM_MODEL = str(env.LLM_MODEL)
  if (trace) llmOpts.TRACE = str(trace)

  const specialist = (name: string) =>
    agent(name, {
      SELLER_WALLET: str(wallet), SOLANA_RPC_URL: str(rpc), AGENT_NAME: str(name),
      SERVICES: str('txline'), TXLINE_API_KEY: str(txlineKey),
      ...(env.TXLINE_BASE_URL ? { TXLINE_BASE_URL: str(env.TXLINE_BASE_URL) } : {}),
      ...llmOpts,
    })

  const sellers = ['seller-moves', 'seller-stats', 'seller-worldcup']

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
            BUYER_SERVICE: str('txline'),
            // Event mode: the watcher queues jobs from live odds moves; quiet board → no WANT.
            WANT_FEED_URL: str(WANT_FEED),
            MARKET_SELLERS: str(sellers.join(',')),
            VERIFIER_AGENT: str('verifier-agent'),
            ...llmOpts,
          }),
          ...sellers.map(specialist),
          agent('verifier-agent', { AGENT_NAME: str('verifier-agent'), ...llmOpts }),
        ],
      },
      namespaceProvider: { type: 'create_if_not_exists', namespaceRequest: { name: NS } },
      execution: { mode: 'immediate' },
    }),
  })
  if (!sres.ok) throw new Error(`session create failed: ${sres.status} ${await sres.text()}`)
  const { sessionId } = await sres.json() as { sessionId: string }

  console.log(`\n✅ Research market session ${sessionId} — event-driven buyer + ${sellers.join(', ')} + verifier-agent.`)
  console.log(`   want feed: ${WANT_FEED}  (run \`npm run watch\` + the txodds proxy)`)
  console.log('   An odds move queues a job; specialists bid; the winner\'s verified read settles via escrow.\n')
  console.log('   Watch it:')
  console.log('     curl http://localhost:4600/queue    # what the watcher has seen')
  console.log('     docker logs -f buyer-agent          # event → WANT → AWARD → verified → released')
  console.log('     docker logs -f seller-moves         # specialist bidding\n')
}

main().catch((e) => { console.error(`[research] ${e}`); process.exitCode = 1 })
