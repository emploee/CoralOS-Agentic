/**
 * TxODDS CoralOS round launcher.
 *
 * Creates a real CoralOS session with one buyer, one TxODDS seller, and an independent verifier.
 * Buyer/seller run as Dockerized agents (real signing keys - see the agent() helper below for why);
 * the verifier runs via CoralOS's executable runtime, a coral-server child process, no container.
 * CoralOS injects CORAL_CONNECTION_URL either way, and the agents coordinate over MCP thread messages
 * before devnet escrow release.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build } from 'esbuild'

const execFileAsync = promisify(execFile)
const REPO_ROOT = fileURLToPath(new URL('../../../.', import.meta.url))

const NS = 'default'
const SELLER = 'seller-agent'
const VERIFIER = 'verifier-agent'
const ROUND_SERVICES = ['txline'] as const

type RoundService = typeof ROUND_SERVICES[number]

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
/**
 * `runtime: 'docker'` (default) launches the agent as a container coral-server spawns via the
 * mounted Docker socket - required for buyer/seller, which hold real devnet signing keys and get
 * real process isolation from it. `runtime: 'executable'` has coral-server exec the agent directly
 * (see docker/coral-server.Dockerfile for the Node.js layer that makes this possible) - used only
 * for verifier-agent, which holds no keys, so there's no isolation tradeoff to weigh. See CORAL.md's
 * "Agent Runtimes" section.
 */
const agent = (name: string, options: Record<string, unknown>, idName = name, runtime: 'docker' | 'executable' = 'docker') => ({
  id: { name: idName, version: '0.1.0', registrySourceId: { type: 'local' } },
  name,
  provider: { type: 'local', runtime },
  options,
})

// verifier-agent runs via runtime: 'executable' (a coral-server child process, not a container) - no
// image, so nothing here for stopPreviousRound() to clean up.
const AGENT_IMAGES = ['buyer-agent:0.1.0', 'seller-agent:0.1.0']

/**
 * Stop any previous round's agent containers before starting a new one. Nothing else ever cleans
 * these up, so repeated rounds (e.g. clicking "Start Round" in the web UI a few times) pile up
 * dozens of containers, all long-polling the one coral-server - which saturates it and is what
 * actually makes a *new* round hang with no bids, not just a resource leak. Best-effort: a Docker
 * hiccup here should never block starting the round.
 *
 * Mirrored (not imported - this package can't cleanly import untyped JS from scripts/, a separate
 * npm workspace) by scripts/stop-agents.js, which offers the same cleanup as a standalone command
 * (`npm run agents:stop`) and from scripts/txodds-agentic.js's shutdown handler, for clearing a clean
 * slate without starting a round.
 */
async function stopPreviousRound(): Promise<void> {
  for (const image of AGENT_IMAGES) {
    try {
      const { stdout } = await execFileAsync('docker', ['ps', '-q', '--filter', `ancestor=${image}`])
      const ids = stdout.split('\n').map((s) => s.trim()).filter(Boolean)
      if (ids.length) await execFileAsync('docker', ['rm', '-f', ...ids])
    } catch (e) {
      console.error(`[coral round] container cleanup skipped for ${image}: ${(e as Error).message}`)
    }
  }
}

/**
 * verifier-agent runs via runtime: 'executable' - coral-server execs `node dist/index.js` directly
 * from the mounted coral-agents/verifier-agent/ (read-only, source tree only - no node_modules, and
 * this repo's npm workspace links are ABSOLUTE host paths, e.g.
 * `node_modules/@pay/agent-runtime -> /c/Users/.../packages/agent-runtime`, which don't resolve to
 * anything inside the container regardless of what else gets mounted). So plain `tsc` output (bare
 * `import '@pay/agent-runtime'` specifiers) can't run there - confirmed live: it fails immediately
 * with ERR_MODULE_NOT_FOUND. esbuild bundles @pay/agent-runtime and its own third-party deps
 * (@modelcontextprotocol/sdk, @solana/web3.js, ...) straight into one self-contained dist/index.js,
 * so nothing needs runtime module resolution at all. Re-bundles every time (cheap, ~0.2s) rather than
 * risking a stale non-bundled dist/ left over from `npm run build -w verifier-agent` (tsc) elsewhere.
 *
 * The banner is load-bearing, not decoration: @solana/web3.js's bundled CJS code calls
 * `require('buffer')` internally, and esbuild's ESM output has no `require` global to satisfy that -
 * confirmed live, it throws "Dynamic require of 'buffer' is not supported" without this. CJS output
 * isn't an option either (also confirmed live): src/index.ts uses top-level `await`, which CJS can't
 * express at all. The banner gives the bundle a real `require`, via Node's own `createRequire`.
 *
 * Uses esbuild's JS API directly (not the CLI via execFile/shell) - the banner string has to survive
 * shell quoting on every platform this kit runs on, and it didn't: cmd.exe on Windows split the
 * banner's semicolon as a command separator and fed esbuild multiple bogus "input files". The JS API
 * takes the banner as a real JS string, no shell involved.
 */
async function ensureVerifierBuilt(): Promise<void> {
  console.error('[coral round] bundling verifier-agent for the executable runtime ...')
  await build({
    entryPoints: [join(REPO_ROOT, 'coral-agents', 'verifier-agent', 'src', 'index.ts')],
    outfile: join(REPO_ROOT, 'coral-agents', 'verifier-agent', 'dist', 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    external: ['node:*'],
    banner: { js: "import { createRequire as __topLevelCreateRequire } from 'node:module'; const require = __topLevelCreateRequire(import.meta.url);" },
    logLevel: 'error',
  })
}

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

function roundArg(fixtureId: string, requested?: string): string {
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

  await stopPreviousRound()
  await ensureVerifierBuilt()

  const llm: Record<string, unknown> = {}
  if (env.VENICE_API_KEY) llm.VENICE_API_KEY = str(env.VENICE_API_KEY)
  if (env.GROQ_API_KEY) llm.GROQ_API_KEY = str(env.GROQ_API_KEY)
  if (env.OPENAI_API_KEY) llm.OPENAI_API_KEY = str(env.OPENAI_API_KEY)
  if (env.ANTHROPIC_API_KEY) llm.ANTHROPIC_API_KEY = str(env.ANTHROPIC_API_KEY)
  if (env.LLM_PROVIDER) llm.LLM_PROVIDER = str(env.LLM_PROVIDER)
  if (env.LLM_MODEL) llm.LLM_MODEL = str(env.LLM_MODEL)
  if (env.TRACE) llm.TRACE = str(env.TRACE)

  const fixtureId = await liveFixtureId(proxy, options.fixtureId)
  const service = roundService(options.service)
  const arg = roundArg(fixtureId, options.arg)

  // The feed's /api/reputation - always running as part of `npm run dev` (see scripts/txodds.js) - so
  // the seller can price against real clearing data and the buyer can weigh its real track record
  // instead of both features sitting dormant behind an opt-in env var no one sets. Fails open on any
  // fetch/parse error (bid-gate.ts, quote.ts, buyer-agent's reputation.ts), so an unreachable feed
  // degrades to the pre-existing behavior rather than blocking a round.
  const reputationUrl = env.REPUTATION_URL ?? 'http://host.docker.internal:4000/api/reputation'

  const seller = agent(SELLER, {
    SELLER_WALLET: str(wallet),
    SOLANA_RPC_URL: str(rpc),
    ...(env.FLOOR_SOL ? { FLOOR_SOL: f64(Number(env.FLOOR_SOL)) } : {}),
    // txline's numeric-arg 'edge' action calls the LLM at maxTokens=260 - lets the floor for that
    // service be derived from real LLM cost (see cost.ts's deriveFloorSol) instead of FLOOR_SOL alone.
    LLM_DELIVERY_TOKENS: str(JSON.stringify({ txline: 260 })),
    REPUTATION_URL: str(reputationUrl),
    SETTLEMENT_MODE: str('arbiter'),
    TXLINE_API_KEY: str(env.TXLINE_API_KEY),
    ...(env.TXLINE_BASE_URL ? { TXLINE_BASE_URL: str(env.TXLINE_BASE_URL) } : {}),
    // Optional upstream procurement (PROCURE_RAIL=x402) — the seller pays a real x402 leg for
    // upstream context before delivering. Needs its own funded spend key, distinct from SELLER_WALLET.
    ...(env.PROCURE_RAIL ? { PROCURE_RAIL: str(env.PROCURE_RAIL) } : {}),
    ...(env.PROCURE_X402_URL ? { PROCURE_X402_URL: str(env.PROCURE_X402_URL) } : {}),
    ...(env.SELLER_KEYPAIR_B58 ? { SELLER_KEYPAIR_B58: str(env.SELLER_KEYPAIR_B58) } : {}),
    // A skeptical second-opinion loop reviews the proposed bid before it's posted — off by default,
    // doubles the LLM calls per bid decision (see API.md).
    ...(env.BID_REVIEW_ENABLED ? { BID_REVIEW_ENABLED: str(env.BID_REVIEW_ENABLED) } : {}),
    ...llm,
  })
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
    MARKET_SELLERS: str(SELLER),
    VERIFIER_AGENT: str(VERIFIER),
    REPUTATION_URL: str(reputationUrl),
    // A fresh coral-server can take longer than the buyer's 5s built-in default to deliver the first
    // wait_for_mention round-trip across several newly-bootstrapping agent sessions - give round 1 a
    // wider window so a cold start doesn't miss bids outright (retries are fast now regardless, via
    // buyer-agent's RETRY_INTERVAL_MS, but a first-try win beats a retry).
    BID_WINDOW_MS: f64(Number(env.BID_WINDOW_MS ?? '20000')),
    CYCLE_INTERVAL_MS: f64(Number(env.CYCLE_INTERVAL_MS ?? '3600000')),
    // Event mode: when set, the buyer pulls its next WANT from this feed instead of rotating
    // BUYER_ARGS — see coral-agents/buyer-agent/src/feed/wantFeed.ts. Optional and additive; the
    // default demo doesn't set this.
    ...(env.WANT_FEED_URL ? { WANT_FEED_URL: str(env.WANT_FEED_URL) } : {}),
    ...llm,
  })
  const verifier = agent(VERIFIER, { AGENT_NAME: str(VERIFIER), ...llm }, VERIFIER, 'executable')

  const res = await fetch(`${base}/api/v1/local/session`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      agentGraphRequest: { agents: [buyer, seller, verifier] },
      namespaceProvider: { type: 'create_if_not_exists', namespaceRequest: { name: NS } },
      execution: { mode: 'immediate' },
    }),
  })
  if (!res.ok) throw new Error(`session create failed: ${res.status} ${await res.text()}`)
  const { sessionId } = (await res.json()) as { sessionId: string }

  const result = { sessionId, fixtureId, service, arg, agents: ['buyer-agent', SELLER, VERIFIER] }
  if (options.log) logRound(result)
  return result
}

function logRound(result: TxOddsRoundResult): void {
  console.log(`\nCoralOS round ${result.sessionId} - ${result.agents.join(' + ')}, fixture ${result.fixtureId}.`)
  console.log(`The buyer broadcasts WANT(${result.service} ${result.arg}); the seller bids, delivers; verifier-agent gates release.\n`)
  console.log('Watch it in the browser:')
  console.log('  npm run dev   (from the repo root)')
  console.log(`  then open http://localhost:3020/?agentSession=${result.sessionId}\n`)
  console.log('Or tail the logs:')
  console.log('  docker logs -f $(docker ps -qf ancestor=buyer-agent:0.1.0  | head -1)   # WANT -> AWARD -> DEPOSITED -> VERIFY -> ARBITER_RELEASED')
  console.log('  docker logs -f $(docker ps -qf ancestor=seller-agent:0.1.0 | head -1)   # BID -> ESCROW_REQUIRED -> DELIVERED')
  console.log('  docker logs -f $(docker ps -qf ancestor=verifier-agent:0.1.0 | head -1) # VERIFY -> VERIFIED\n')
}

/** `--service=freelance --arg="a brief" --fixtureId=123` - the same options createTxOddsRound
 *  already accepts programmatically (and what the web UI's /api/agentic/start passes through),
 *  just parsed from argv for `npm run coral -- --service=...` on the command line. */
function parseArgv(argv: string[]): TxOddsRoundOptions {
  const opts: TxOddsRoundOptions = { log: true }
  for (const raw of argv) {
    const m = raw.match(/^--(service|arg|fixtureId)=([\s\S]*)$/)
    if (m) (opts as Record<string, string>)[m[1]] = m[2]
  }
  return opts
}

async function main(): Promise<void> {
  await createTxOddsRound(parseArgv(process.argv.slice(2)))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`[coral round] ${e}`); process.exitCode = 1 })
}
