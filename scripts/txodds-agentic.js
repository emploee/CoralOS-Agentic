#!/usr/bin/env node
// One-command agentic TxODDS round: everything `npm run dev` starts, plus coral-server, plus an
// actual running CoralOS round - collapsing the 3 manual steps CORAL.md used to document
// (docker compose up -d coral / bash build-agents.sh / npm run demo:coral) into one command.
//
//   node scripts/txodds-agentic.js        (= npm run dev:agentic)
//
// Reuses existing pieces rather than reimplementing them: startCoreServices() from txodds.js,
// build-agents.sh for missing Docker images, coral-console-e2e.mjs to bring up coral-server, and
// `npm run demo:coral` (examples/txodds/coral/round.ts's createTxOddsRound()) to create the round.

import { spawn, spawnSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { platform } from 'node:os'
import { startCoreServices, stopCoreServices, root } from './txodds.js'
import { stopAgentContainers } from './stop-agents.js'

const execFileAsync = promisify(execFile)

const DOCKER_AGENT_IMAGES = ['buyer-agent:0.1.0', 'seller-agent:0.1.0']

async function dockerImageExists(image) {
  try {
    await execFileAsync('docker', ['image', 'inspect', image])
    return true
  } catch {
    return false
  }
}

async function ensureAgentImagesBuilt() {
  const missing = []
  for (const image of DOCKER_AGENT_IMAGES) {
    if (!(await dockerImageExists(image))) missing.push(image)
  }
  if (!missing.length) return
  console.log(`[txodds-agentic] building agent images (missing: ${missing.join(', ')}) ...`)
  const result = spawnSync('bash', ['build-agents.sh'], { cwd: root, shell: true, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`build-agents.sh failed (exit ${result.status})`)
}

function bringUpCoralServer() {
  console.log('[txodds-agentic] starting coral-server ...')
  const result = spawnSync('node', ['scripts/coral-console-e2e.mjs', '--start', '--allow-skip'], { cwd: root, shell: true, stdio: 'inherit' })
  if (result.status !== 0) {
    console.error('[txodds-agentic] coral-server did not come up cleanly; attempting the round anyway')
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const SESSION_ID_RE = /CoralOS round ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/

/**
 * Runs `npm run demo:coral` once, echoing its output live (same as a plain terminal run) while also
 * capturing it to pull the session id out of round.ts's own logRound() line. Needed because
 * web/app.js's auto-discovery (latestSessionFromRuns via /api/agentic/runs) only finds a session
 * AFTER something has polled /api/feed?session=<id> at least once - that poll is what writes the
 * round into the local run ledger in the first place, so for a session nobody has ever opened,
 * there's nothing for auto-discovery to find yet. Opening the explicit ?agentSession= URL below
 * both shows the right round immediately and triggers that first poll.
 */
function runDemoCoralOnce() {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', 'demo:coral'], { cwd: root, shell: true })
    let out = ''
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      out += chunk
    })
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    child.on('exit', (code) => resolve({ ok: code === 0, sessionId: out.match(SESSION_ID_RE)?.[1] }))
  })
}

/** A fresh coral-server can take a moment past the console probe before it accepts session creates. */
async function createRoundWithRetry(attempts = 5, delayMs = 3000) {
  for (let i = 1; i <= attempts; i++) {
    console.log(`[txodds-agentic] creating a round (attempt ${i}/${attempts}) ...`)
    const { ok, sessionId } = await runDemoCoralOnce()
    if (ok) return sessionId
    if (i < attempts) await sleep(delayMs)
  }
  return undefined
}

async function main() {
  const services = await startCoreServices({ openBrowser: false })

  await ensureAgentImagesBuilt()
  bringUpCoralServer()
  const sessionId = await createRoundWithRetry()

  if (sessionId) {
    const sessionUrl = `${services.webUrl}/?agentSession=${sessionId}`
    if (process.env.TXODDS_OPEN !== '0') {
      const [cmd, args] =
        platform() === 'win32' ? ['cmd', ['/c', 'start', '', sessionUrl]]
        : platform() === 'darwin' ? ['open', [sessionUrl]]
        : ['xdg-open', [sessionUrl]]
      spawn(cmd, args, { shell: true, stdio: 'ignore' })
    }
    console.log(`\n[txodds-agentic] round created - watch it live at ${sessionUrl}`)
  } else {
    console.error(`\n[txodds-agentic] round creation failed, or its session id couldn't be parsed from the log above - core services are still up at ${services.webUrl}; check coral-server logs (docker compose logs coral) and retry with: npm run demo:coral`)
  }

  // Also clears the round's agent containers (not just the proxy/feed/web node processes) -
  // without this, Ctrl+C left them running until the next round's stopPreviousRound() happened to
  // clean them up (examples/txodds/coral/round.ts), which is exactly the kind of orphaned-container
  // confusion this is here to prevent.
  const stop = async () => {
    stopCoreServices(services)
    await stopAgentContainers()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

main()
