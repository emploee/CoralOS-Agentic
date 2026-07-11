/**
 * TxODDS CoralOS round launcher.
 *
 * Creates a real CoralOS session with one buyer, five TxODDS seller personas, and an independent
 * verifier. CoralOS runs each participant as a Dockerized agent, injects CORAL_CONNECTION_URL, and
 * the agents coordinate over MCP thread messages before devnet escrow release.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const NS = 'default'
const VERIFIER = 'verifier-agent'
const ROUND_SERVICES = ['txline', 'risk-policy', 'fan-card'] as const

type RoundService = typeof ROUND_SERVICES[number]

interface SellerSpec {
  name: string
  services: string
  floorEnv: string
  defaultFloor: string
  persona: string
  idName?: string
}

const SELLERS: SellerSpec[] = [
  {
    name: 'seller-worldcup',
    services: 'txline',
    floorEnv: 'WORLDCUP_FLOOR_SOL',
    defaultFloor: '0.00045',
    persona: 'a World Cup TxODDS specialist with fresh fair-line reads',
  },
  {
    name: 'seller-fast',
    services: 'txline',
    floorEnv: 'FAST_SELLER_FLOOR_SOL',
    defaultFloor: '0.00065',
    persona: 'a fast generalist who can serve TxODDS but is less specialized',
    idName: 'seller-worldcup',
  },
  {
    name: 'seller-premium',
    services: 'txline',
    floorEnv: 'PREMIUM_SELLER_FLOOR_SOL',
    defaultFloor: '0.00085',
    persona: 'a cautious premium analyst who charges more for commentary',
    idName: 'seller-worldcup',
  },
  {
    name: 'seller-risk-policy',
    services: 'txline,risk-policy',
    floorEnv: 'RISK_POLICY_FLOOR_SOL',
    defaultFloor: '0.00055',
    persona: 'a policy guardrail agent that can also inspect TxODDS fair-line jobs',
    idName: 'seller-worldcup',
  },
  {
    name: 'seller-fan-card',
    services: 'txline,fan-card',
    floorEnv: 'FAN_CARD_FLOOR_SOL',
    defaultFloor: '0.00035',
    persona: 'a fan explainer agent that turns verified fair-line context into plain summaries',
    idName: 'seller-worldcup',
  },
]
const SELLER_NAMES = SELLERS.map((s) => s.name)

export interface TxOddsRoundOptions {
  fixtureId?: string
  service?: string
  arg?: string
  log?: boolean
}

export interface TxOddsRoundResult {
  sessionId: string
  fixtureId: string
  service: RoundService
  arg: string
  agents: string[]
}

/** Load the repo-root .env (3 levels up: coral -> txodds -> examples -> root). */
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  try {
    const p = fileURLToPath(new URL('../../../.env', import.meta.url))
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* rely on process.env */ }
  return env
}

const str = (value: string) => ({ type: 'string', value })
const f64 = (value: number) => ({ type: 'f64', value })
const agent = (name: string, options: Record<string, unknown>, idName = name) => ({
  id: { name: idName, version: '0.1.0', registrySourceId: { type: 'local' } },
  name,
  provider: { type: 'local', runtime: 'docker' },
  options,
})

/** A live fixture id with verified odds (from the running proxy), so the seller can deliver. */
async function liveFixtureId(proxy: string, requested?: string): Promise<string> {
  if (requested) return requested
  try {
    const board = (await (await fetch(`${proxy}/api/board`)).json()) as Array<{ FixtureId: number }>
    if (Array.isArray(board) && board.length) return String(board[0].FixtureId)
  } catch { /* proxy not up: fall back to a known fixture id */ }
  return '18175397'
}

function roundService(value?: string): RoundService {
  const requested = (value ?? 'txline').toLowerCase()
  return ROUND_SERVICES.includes(requested as RoundService) ? requested as RoundService : 'txline'
}

function roundArg(service: RoundService, fixtureId: string, requested?: string): string {
  if (requested?.trim()) return requested.trim()
  return fixtureId
}

export async function createTxOddsRound(options: TxOddsRoundOptions = {}): Promise<TxOddsRoundResult> {
  const env = loadEnv()
  const base = env.CORAL_SERVER_URL ?? 'http://localhost:5555'
  const token = env.CORAL_TOKEN ?? 'dev'
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const proxy = env.TXODDS_PROXY ?? 'http://localhost:8801'
  const wallet = env.WALLET
  const keypair = env.BUYER_KEYPAIR_B58
  const arbiter = env.ARBITER_KEYPAIR_B58
  if (!arbiter) throw new Error('ARBITER_KEYPAIR_B58 must be in .env - run `node scripts/setup.js`')
  if (!wallet || !keypair) throw new Error('WALLET + BUYER_KEYPAIR_B58 must be in .env - run `node scripts/setup.js`')
  if (!env.TXLINE_API_KEY) throw new Error('TXLINE_API_KEY missing - run `npm run mint` in examples/txodds')
  const rpc = env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'

  const llm: Record<string, unknown> = {}
  if (env.VENICE_API_KEY) llm.VENICE_API_KEY = str(env.VENICE_API_KEY)
  if (env.OPENAI_API_KEY) llm.OPENAI_API_KEY = str(env.OPENAI_API_KEY)
  if (env.ANTHROPIC_API_KEY) llm.ANTHROPIC_API_KEY = str(env.ANTHROPIC_API_KEY)
  if (env.LLM_PROVIDER) llm.LLM_PROVIDER = str(env.LLM_PROVIDER)
  if (env.LLM_MODEL) llm.LLM_MODEL = str(env.LLM_MODEL)
  if (env.TRACE) llm.TRACE = str(env.TRACE)

  const fixtureId = await liveFixtureId(proxy, options.fixtureId)
  const service = roundService(options.service)
  const arg = roundArg(service, fixtureId, options.arg)

  const sellerOpts = (spec: SellerSpec) => ({
    SELLER_WALLET: str(wallet),
    SOLANA_RPC_URL: str(rpc),
    AGENT_NAME: str(spec.name),
    SERVICES: str(spec.services),
    FLOOR_SOL: f64(Number(env[spec.floorEnv] ?? spec.defaultFloor)),
    PERSONA: str(spec.persona),
    SETTLEMENT_MODE: str('arbiter'),
    TXLINE_API_KEY: str(env.TXLINE_API_KEY),
    ...(env.TXLINE_BASE_URL ? { TXLINE_BASE_URL: str(env.TXLINE_BASE_URL) } : {}),
    // Optional upstream procurement (PROCURE_RAIL=x402) — the seller pays a real x402 leg for
    // upstream context before delivering. Needs its own funded spend key, distinct from SELLER_WALLET.
    ...(env.PROCURE_RAIL ? { PROCURE_RAIL: str(env.PROCURE_RAIL) } : {}),
    ...(env.PROCURE_X402_URL ? { PROCURE_X402_URL: str(env.PROCURE_X402_URL) } : {}),
    ...(env.SELLER_KEYPAIR_B58 ? { SELLER_KEYPAIR_B58: str(env.SELLER_KEYPAIR_B58) } : {}),
    // A skeptical second-opinion loop reviews the proposed bid before it's posted — off by default,
    // doubles the LLM calls per bid decision (see docs/AGENT_DEPTH_PLAN.md).
    ...(env.BID_REVIEW_ENABLED ? { BID_REVIEW_ENABLED: str(env.BID_REVIEW_ENABLED) } : {}),
    ...llm,
  })

  const sellers = SELLERS.map((spec) => agent(spec.name, sellerOpts(spec), spec.idName ?? spec.name))
  const buyer = agent('buyer-agent', {
    BUYER_KEYPAIR_B58: str(keypair),
    AGENT_NAME: str('buyer-agent'),
    SOLANA_RPC_URL: str(rpc),
    ARBITER_KEYPAIR_B58: str(arbiter),
    SETTLEMENT_MODE: str('arbiter'),
    SELLER_WALLET: str(wallet),
    BUYER_MAX_SOL: f64(Number(env.BUYER_MAX_SOL ?? '0.001')),
    BUYER_SERVICE: str(service),
    BUYER_ARG: str(arg),
    MARKET_SELLERS: str(SELLER_NAMES.join(',')),
    VERIFIER_AGENT: str(VERIFIER),
    CYCLE_INTERVAL_MS: f64(Number(env.CYCLE_INTERVAL_MS ?? '3600000')),
    ...llm,
  })
  const verifier = agent(VERIFIER, { AGENT_NAME: str(VERIFIER), ...llm })

  const res = await fetch(`${base}/api/v1/local/session`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      agentGraphRequest: { agents: [buyer, ...sellers, verifier] },
      namespaceProvider: { type: 'create_if_not_exists', namespaceRequest: { name: NS } },
      execution: { mode: 'immediate' },
    }),
  })
  if (!res.ok) throw new Error(`session create failed: ${res.status} ${await res.text()}`)
  const { sessionId } = (await res.json()) as { sessionId: string }

  const result = { sessionId, fixtureId, service, arg, agents: ['buyer-agent', ...SELLER_NAMES, VERIFIER] }
  if (options.log) logRound(result)
  return result
}

function logRound(result: TxOddsRoundResult): void {
  console.log(`\nCoralOS round ${result.sessionId} - ${result.agents.join(' + ')}, fixture ${result.fixtureId}.`)
  console.log(`The buyer broadcasts WANT(${result.service} ${result.arg}); sellers bid; the winner delivers; verifier-agent gates release.\n`)
  console.log('Watch it in the browser:')
  console.log('  npm run dev   (from the repo root)')
  console.log(`  then open http://localhost:3020/?agentSession=${result.sessionId}\n`)
  console.log('Or tail the logs:')
  console.log('  docker logs -f $(docker ps -qf ancestor=buyer-agent:0.1.0  | head -1)   # WANT -> AWARD -> DEPOSITED -> VERIFY -> ARBITER_RELEASED')
  console.log('  docker logs -f $(docker ps -qf ancestor=seller-agent:0.1.0 | head -1)   # BID -> ESCROW_REQUIRED -> DELIVERED')
  console.log('  docker logs -f $(docker ps -qf ancestor=verifier-agent:0.1.0 | head -1) # VERIFY -> VERIFIED\n')
}

async function main(): Promise<void> {
  await createTxOddsRound({ log: true })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`[coral round] ${e}`); process.exitCode = 1 })
}
