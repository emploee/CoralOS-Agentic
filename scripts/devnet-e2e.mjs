#!/usr/bin/env node
/**
 * Live devnet smoke path.
 *
 * Uses real devnet wallets, CoralOS/Docker, and TxODDS credentials. Settlement is direct x402.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadEnv() {
  const env = { ...process.env }
  const envPath = join(root, '.env')
  if (!existsSync(envPath)) return env
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? root,
    env: opts.env ?? process.env,
    shell: true,
    stdio: opts.stdio ?? 'inherit',
  })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed`)
  return r
}

function canRun(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, shell: true, stdio: 'ignore' })
  return r.status === 0
}

const env = loadEnv()
const required = ['WALLET', 'BUYER_KEYPAIR_B58', 'TXLINE_API_KEY']
const missing = required.filter((k) => !env[k])
if (missing.length) {
  console.error(`[devnet-e2e] missing ${missing.join(', ')}. Run npm run setup, fund the devnet wallets, and mint TxLINE access first.`)
  process.exit(1)
}

const rpc = env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
if (!/devnet/i.test(rpc) && env.ALLOW_MAINNET !== '1') {
  console.error(`[devnet-e2e] SOLANA_RPC_URL must be devnet for this starter smoke: ${rpc}`)
  process.exit(1)
}

try {
  console.log('[devnet-e2e] building workspace packages and agents')
  run('npm', ['run', 'build'])

  if (env.BUILD_AGENT_IMAGES !== '0') {
    if (!canRun('docker', ['info'])) {
      throw new Error('Docker is not running; start Docker or set BUILD_AGENT_IMAGES=0 if images already exist.')
    }
    if (canRun('bash', ['--version'])) {
      console.log('[devnet-e2e] building Coral agent Docker images')
      run('bash', ['build-agents.sh'])
    } else {
      console.warn('[devnet-e2e] bash not found; skipping build-agents.sh. Existing Docker images must be present.')
    }
  }

  console.log('[devnet-e2e] verifying Coral Console')
  run('node', ['scripts/coral-console-e2e.mjs', '--start'], { env })

  console.log('[devnet-e2e] launching live CoralOS devnet round')
  run('npm', ['run', 'demo:coral'], { env })
} catch (e) {
  console.error(`[devnet-e2e] FAIL ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
}
