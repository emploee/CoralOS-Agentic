#!/usr/bin/env node
/**
 * Production-readiness e2e gate.
 *
 * Deterministic, no devnet/Docker/LLM required:
 *   1. build the local runtime package the feed imports,
 *   2. start the real marketplace feed server against a temporary Coral extended-state fixture,
 *   3. assert health/feed/threads/runs/proof-receipts over HTTP,
 *   4. smoke the TxODDS Agent Desk static JS + Tauri JSON configs.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { platform, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const feedDir = join(root, 'examples', 'marketplace', 'feed')
const runtimeDir = join(root, 'packages', 'agent-runtime')
const deskDir = join(root, 'examples', 'txodds-agent-desk')
const port = process.env.READINESS_PORT ?? String(4100 + Math.floor(Math.random() * 1000))
const base = `http://localhost:${port}`
const tmp = mkdtempSync(join(tmpdir(), 'pay-readiness-'))
const fixturePath = join(tmp, 'coral-session-with-proof.json')
const runsDir = join(tmp, 'runs')

function run(cwd, cmd, args) {
  const r = spawnSync(cmd, args, { cwd, shell: true, stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}`)
}

function stop(child) {
  if (child.exitCode != null || child.pid == null) return
  if (platform() === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: true, stdio: 'ignore' })
  } else {
    try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function fixture() {
  const threadId = 'readiness-thread'
  const ts = (n) => `2026-07-06T12:00:${String(n).padStart(2, '0')}.000Z`
  const msg = (senderName, text, mentionNames, i) => ({ senderName, text, threadId, mentionNames, timestamp: ts(i) })
  const agents = ['buyer-agent', 'seller-premium', 'verifier-agent'].map((name) => ({
    name,
    status: { type: 'running' },
    registryAgentIdentifier: { name, version: '0.1.0', registrySourceId: { type: 'local' } },
  }))
  const messages = [
    msg('buyer-agent', 'WANT round=42 service=txline arg=edge-9001 budget=0.001', ['seller-premium'], 1),
    msg('seller-premium', 'BID round=42 price=0.0005 by=seller-premium note=readiness-proof', ['buyer-agent'], 2),
    msg('buyer-agent', 'AWARD round=42 to=seller-premium reason="readiness e2e winner"', ['seller-premium'], 3),
    msg('seller-premium', 'ESCROW_REQUIRED round=42 reference=Ref42 seller=7jwB amount=0.0005 deadline=600 settlement=arbiter', ['buyer-agent'], 4),
    msg('buyer-agent', 'DEPOSITED round=42 reference=Ref42 buyer=47Dp sig=dep42 settlement=arbiter vault=Vault42 arbiter=Arb42', ['seller-premium'], 5),
    msg('seller-premium', 'PAYMENT_REQUIRED round=42 rail=pay-sh amount=0.03 currency=USDC reference=pay-42 seller=pay.sh/txodds-context url=https://pay.sh/api/quicknode', [], 6),
    msg('seller-premium', 'PAYMENT_PROOF round=42 rail=pay-sh reference=pay-42 proof=pay-sh-demo:readiness buyer=seller-premium', [], 7),
    msg('seller-premium', 'PAYMENT_CONFIRMED round=42 rail=pay-sh reference=pay-42 paid=true amount=0.03 currency=USDC', [], 8),
    msg('seller-premium', 'DELIVERED round=42 {"service":"txline-edge","fixtureId":"9001","analysis":{"call":"readiness fixture delivered"}}', ['buyer-agent'], 9),
    msg('buyer-agent', 'VERIFY round=42 sha=abc service=txline arg=edge-9001 payload={"ok":true}', ['verifier-agent'], 10),
    msg('verifier-agent', 'VERIFIED round=42 verdict=pass by=verifier-agent reason="readiness hash + structure"', ['buyer-agent'], 11),
    msg('buyer-agent', 'ARBITER_RELEASED round=42 sig=rel42 settlement=arbiter', ['seller-premium'], 12),
  ]
  return {
    base: { id: 'readiness-session', namespace: 'default', status: { type: 'executed' } },
    agents,
    threads: [{ id: threadId, name: 'market', creatorName: 'buyer-agent', participants: agents.map((a) => a.name), messages }],
  }
}

async function waitForHealth(child) {
  const deadline = Date.now() + 30_000
  let last = ''
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`feed server exited early: ${child.exitCode}`)
    try {
      const r = await fetch(`${base}/api/health`)
      if (r.ok) return
      last = `HTTP ${r.status}`
    } catch (e) {
      last = e.message
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`feed server did not become healthy: ${last}`)
}

async function json(path) {
  const r = await fetch(`${base}${path}`)
  const body = await r.text()
  assert(r.ok, `${path} failed: HTTP ${r.status} ${body.slice(0, 200)}`)
  return JSON.parse(body)
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 20) {
    throw new Error(`Node ${process.version} detected; readiness gate requires Node 20+`)
  }
  assert(existsSync(join(root, 'docs', 'PRODUCTION_READINESS.md')), 'docs/PRODUCTION_READINESS.md is missing')

  if (!existsSync(join(runtimeDir, 'node_modules'))) run(runtimeDir, 'npm', ['install', '--no-audit', '--no-fund'])
  run(runtimeDir, 'npm', ['run', 'build'])
  if (!existsSync(join(feedDir, 'node_modules'))) run(feedDir, 'npm', ['install', '--no-audit', '--no-fund'])

  writeFileSync(fixturePath, JSON.stringify(fixture(), null, 2), 'utf8')

  const feed = spawn('npm', ['start'], {
    cwd: feedDir,
    shell: true,
    detached: platform() !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FEED_FIXTURE: fixturePath, RUNS_DIR: runsDir, PORT: port },
  })
  feed.stdout.on('data', (d) => process.stdout.write(`[feed] ${d}`))
  feed.stderr.on('data', (d) => process.stderr.write(`[feed] ${d}`))

  try {
    await waitForHealth(feed)

    const health = await json('/api/health')
    assert(health.ok === true, 'health endpoint did not return ok=true')

    const feedBody = await json('/api/feed?session=fixture')
    const round = feedBody.rounds?.find((r) => r.round === 42)
    assert(round?.status === 'settled', 'readiness round did not settle')
    assert(round?.verification?.verdict === 'pass', 'verifier pass did not fold into the round')
    assert(round?.proofReceipts?.[0]?.rail === 'pay-sh', 'proof receipt did not fold into the round')
    assert(round.proofReceipts[0].simulated === true, 'demo Pay.sh proof receipt was not marked simulated')

    const runs = await json('/api/runs')
    const ledgerRun = runs.runs?.find((r) => r.runId === 'fixture/round-42')
    assert(ledgerRun?.proofReceipts?.[0]?.proof === 'pay-sh-demo:readiness', 'ledger run is missing proof receipt')

    const threads = await json('/api/threads?session=fixture')
    assert(threads.threads?.[0]?.messages?.length >= 12, 'thread replay did not expose the bus transcript')
    assert(threads.agents?.some((a) => a.name === 'verifier-agent'), 'agent roster missing verifier-agent')

    const receiptFile = join(runsDir, 'fixture', 'round-42', 'proof_receipts.json')
    assert(existsSync(receiptFile), 'proof_receipts.json was not written')
    const receipt = JSON.parse(readFileSync(receiptFile, 'utf8'))[0]
    assert(receipt.provider === 'pay.sh/txodds-context', 'proof receipt provider was not preserved')

    run(deskDir, 'node', ['--check', 'ui/app.js'])
    JSON.parse(readFileSync(join(deskDir, 'src-tauri', 'tauri.conf.json'), 'utf8'))
    JSON.parse(readFileSync(join(deskDir, 'src-tauri', 'capabilities', 'default.json'), 'utf8'))

    console.log('[readiness] PASS production-readiness e2e gate')
  } finally {
    stop(feed)
    rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((e) => {
  console.error(`[readiness] FAIL ${e.stack ?? e}`)
  process.exitCode = 1
})
