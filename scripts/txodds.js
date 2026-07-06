#!/usr/bin/env node
// One-command TxODDS: local proxy tutorial + static UI + CoralOS feed reader.
//
//   node scripts/txodds.js        (= npm run dev)
//
// Processes:
//   - proxy (:8801)      TxODDS data, local settlement, and /api/agentic/* facade
//   - feed  (:4000)      CoralOS session reader + run ledger for live agent mode
//   - web   (:3020)      no-build React tutorial/dashboard

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const txDir = join(root, 'examples', 'txodds')
const feedDir = join(root, 'examples', 'marketplace', 'feed')
const runtimeDir = join(root, 'packages', 'agent-runtime')
const agenticRunsDir = join(txDir, 'data', 'agentic-runs')
const feedPort = process.env.TXODDS_FEED_PORT ?? '4000'
const feedUrl = process.env.TXODDS_FEED_URL ?? `http://localhost:${feedPort}`
const url = 'http://localhost:3020'

const npm = (cwd, args) => spawnSync('npm', args, { cwd, shell: true, stdio: 'inherit' })

// Fail fast on an unsupported Node (the kit targets Node 20+).
const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 20) {
  console.error(`[txodds] Node ${process.version} detected - this kit needs Node 20+. Install it from nodejs.org, then re-run.`)
  process.exit(1)
}

function ensureDeps(dir, label) {
  if (!existsSync(join(dir, 'node_modules'))) {
    console.log(`[txodds] installing deps in ${label} ...`)
    npm(dir, ['install', '--no-audit', '--no-fund'])
  }
}

function ensureRuntime() {
  ensureDeps(runtimeDir, 'packages/agent-runtime')
  if (!existsSync(join(runtimeDir, 'dist'))) {
    console.log('[txodds] building @pay/agent-runtime ...')
    npm(runtimeDir, ['run', 'build'])
  }
}

ensureRuntime()
ensureDeps(txDir, 'examples/txodds')
ensureDeps(feedDir, 'examples/marketplace/feed')

const proxyEnv = { ...process.env, TXODDS_FEED_URL: feedUrl }
const feedEnv = {
  ...process.env,
  PORT: feedPort,
  RUNS_DIR: agenticRunsDir,
  MARKET_SELLERS: 'seller-worldcup,seller-fast,seller-premium,seller-risk-policy,seller-fan-card',
}

const proxy = spawn('npm', ['run', 'proxy'], { cwd: txDir, shell: true, stdio: 'inherit', env: proxyEnv })
const feed = spawn('npm', ['start'], { cwd: feedDir, shell: true, stdio: 'inherit', env: feedEnv })
const web = spawn('npm', ['run', 'web'], { cwd: txDir, shell: true, stdio: 'inherit' })

setTimeout(() => {
  const [cmd, args] =
    platform() === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : platform() === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]]
  spawn(cmd, args, { shell: true, stdio: 'ignore' })
  console.log(`\n[txodds] opened ${url}`)
  console.log('[txodds] local proxy tutorial: http://localhost:8801')
  console.log(`[txodds] live CoralOS agent feed: ${feedUrl} (devnet, requires docker compose up -d coral + built agents)\n`)
}, 4000)

const stop = () => {
  proxy.kill()
  feed.kill()
  web.kill()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
