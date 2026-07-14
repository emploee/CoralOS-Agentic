#!/usr/bin/env node
// Force-removes any agent containers CoralOS launched (buyer-agent/seller-agent instances - one per
// seller persona plus the buyer). These are NOT docker-compose services: CoralOS creates them
// dynamically per round, through the Docker socket mounted into the coral-server container, with
// per-persona env (AGENT_NAME/PERSONA/FLOOR_SOL/...) baked in at launch time - a static compose
// `services:` entry can't express "N differently-configured containers, created on demand." So
// `docker compose down` never touches them, and otherwise they only get cleaned up at the START of the
// next round (examples/txodds/coral/round.ts's stopPreviousRound(), which this mirrors). Run this any
// time you want a clean slate without starting a round.
//
//   node scripts/stop-agents.js     (= npm run agents:stop)
//
// Also called from scripts/txodds-agentic.js's shutdown handler, so Ctrl+C during `npm run dev:agentic`
// leaves a clean slate instead of orphaning containers until the next round starts.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const AGENT_IMAGES = ['buyer-agent:0.1.0', 'seller-agent:0.1.0']

export async function stopAgentContainers() {
  for (const image of AGENT_IMAGES) {
    try {
      const { stdout } = await execFileAsync('docker', ['ps', '-q', '--filter', `ancestor=${image}`])
      const ids = stdout.split('\n').map((s) => s.trim()).filter(Boolean)
      if (ids.length) {
        await execFileAsync('docker', ['rm', '-f', ...ids])
        console.log(`[stop-agents] removed ${ids.length} ${image} container(s)`)
      }
    } catch (e) {
      console.error(`[stop-agents] cleanup skipped for ${image}: ${e.message}`)
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  stopAgentContainers()
}
