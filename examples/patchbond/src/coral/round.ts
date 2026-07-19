import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const SELLERS = ['fast-fix', 'budget-bot', 'reliable-patch'] as const
const VERIFIER = 'patchbond-verifier'

const str = (value: string) => ({ type: 'string', value })
const f64 = (value: number) => ({ type: 'f64', value })
const agent = (name: string, idName: string, options: Record<string, unknown>) => ({
  id: { name: idName, version: '0.1.0', registrySourceId: { type: 'local' } },
  name,
  provider: { type: 'local', runtime: 'docker' },
  options,
})

const SAFE_ENV_KEYS = new Set([
  'WALLET', 'SOLANA_RPC_URL', 'CORAL_SERVER_URL', 'CORAL_TOKEN', 'SIGNER_URL', 'SIGNER_HEALTH_URL',
])

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key]!
  }
  try {
    for (const line of readFileSync(`${REPO_ROOT}.env`, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (match && SAFE_ENV_KEYS.has(match[1]) && env[match[1]] === undefined) {
        env[match[1]] = match[2].replace(/^["']|["']$/g, '')
      }
    }
  } catch { /* validated below */ }
  return env
}

async function stopOldAgents(): Promise<void> {
  for (const image of ['buyer-agent:0.1.0', 'seller-agent:0.1.0', 'verifier-agent:0.1.0']) {
    try {
      const { stdout } = await execFileAsync('docker', ['ps', '-q', '--filter', `ancestor=${image}`])
      const ids = stdout.split('\n').map((value) => value.trim()).filter(Boolean)
      if (ids.length) await execFileAsync('docker', ['rm', '-f', ...ids])
    } catch { /* best-effort cleanup */ }
  }
}

const sellerOptions = (
  wallet: string,
  rpc: string,
  profile: { floor: number; eta: number; reputation: number; success: number; specialization: number },
): Record<string, unknown> => ({
  SELLER_WALLET: str(wallet),
  SOLANA_RPC_URL: str(rpc),
  SERVICES: str('patchbond'),
  SETTLEMENT_RAIL: str('escrow'),
  ESCROW_DEADLINE_SECONDS: f64(90),
  FLOOR_SOL: f64(profile.floor),
  PATCH_ETA_SECONDS: f64(profile.eta),
  PATCH_REPUTATION: f64(profile.reputation),
  PATCH_SUCCESS_RATE: f64(profile.success),
  PATCH_SPECIALIZATION: f64(profile.specialization),
  TRACE: str('1'),
})
export async function createPatchBondRound(): Promise<{ sessionId: string; agents: string[] }> {
  const env = loadEnv()
  const wallet = env.WALLET
  if (!wallet) throw new Error('run npm run setup to generate the seller wallet')
  const rpc = env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
  if (!rpc.toLowerCase().includes('devnet')) throw new Error('PatchBond Coral round is devnet-only')

  const signerUrl = env.SIGNER_URL ?? 'http://host.docker.internal:8899'
  const signerHealthUrl = env.SIGNER_HEALTH_URL ?? 'http://127.0.0.1:8899'
  let signerHealth: { ok?: boolean; network?: string; buyer?: string }
  try {
    const response = await fetch(`${signerHealthUrl.replace(/\/$/, '')}/health`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    signerHealth = await response.json() as typeof signerHealth
  } catch (error) {
    throw new Error(`policy signer is unavailable; run docker compose up -d signer coral (${error instanceof Error ? error.message : String(error)})`)
  }
  if (!signerHealth.ok || signerHealth.network !== 'devnet' || !signerHealth.buyer) {
    throw new Error('policy signer health response is invalid or not devnet')
  }

  await stopOldAgents()
  const sellerProfiles = [
    { name: SELLERS[0], floor: 0.018, eta: 45, reputation: 82, success: 86, specialization: 72 },
    { name: SELLERS[1], floor: 0.005, eta: 150, reputation: 58, success: 61, specialization: 55 },
    { name: SELLERS[2], floor: 0.011, eta: 80, reputation: 96, success: 97, specialization: 98 },
  ]
  const sellers = sellerProfiles.map((profile) => agent(
    profile.name,
    'seller-agent',
    { AGENT_NAME: str(profile.name), ...sellerOptions(wallet, rpc, profile) },
  ))
  const buyer = agent('buyer-agent', 'buyer-agent', {
    AGENT_NAME: str('buyer-agent'),
    SELLER_WALLET: str(wallet),
    SOLANA_RPC_URL: str(rpc),
    BUYER_MAX_SOL: f64(0.02),
    BUYER_SERVICE: str('patchbond'),
    BUYER_ARG: str('discount-calculation-001'),
    MARKET_SELLERS: str(SELLERS.join(',')),
    VERIFIER_AGENT: str(VERIFIER),
    VERIFY_WINDOW_MS: f64(20_000),
    BID_WINDOW_MS: f64(12_000),
    CYCLE_INTERVAL_MS: f64(3_600_000),
    SETTLEMENT_RAIL: str('escrow'),
    SIGNER_URL: str(signerUrl),
    POLICY_MAX_SOL_PER_ROUND: f64(0.02),
    POLICY_MAX_SOL_PER_SESSION: f64(0.02),
    POLICY_SERVICES: str('patchbond'),
    TRACE: str('1'),
  })
  const verifier = agent(VERIFIER, 'verifier-agent', { AGENT_NAME: str(VERIFIER) })

  const base = env.CORAL_SERVER_URL ?? 'http://localhost:5555'
  const response = await fetch(`${base}/api/v1/local/session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.CORAL_TOKEN ?? 'dev'}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agentGraphRequest: { agents: [buyer, ...sellers, verifier] },
      namespaceProvider: { type: 'create_if_not_exists', namespaceRequest: { name: 'patchbond' } },
      execution: { mode: 'immediate' },
    }),
  })
  if (!response.ok) throw new Error(`CoralOS session failed: ${response.status} ${await response.text()}`)
  const { sessionId } = await response.json() as { sessionId: string }
  return { sessionId, agents: ['buyer-agent', ...SELLERS, VERIFIER] }
}

createPatchBondRound()
  .then((result) => {
    console.log(`\nPatchBond CoralOS round: ${result.sessionId}`)
    console.log(`Agents: ${result.agents.join(' -> ')}`)
    console.log(`Watch: http://localhost:5555/ui/console?session=${result.sessionId}\n`)
  })
  .catch((error: unknown) => {
    console.error(`PatchBond CoralOS round failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
