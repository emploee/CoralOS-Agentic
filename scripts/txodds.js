#!/usr/bin/env node
// One-command TxODDS: local proxy tutorial + static UI + CoralOS feed reader + Coral Console probe.
//
//   node scripts/txodds.js        (= npm run dev)
//
// Processes:
//   - proxy (:8801)      TxODDS data, local settlement, and /api/agentic/* facade
//   - feed  (:4000)      CoralOS session reader + run ledger for live agent mode
//   - web   (:3020)      no-build React tutorial/dashboard
//   - coral (:5555)      Coral Server + built-in Coral Console when Docker is available

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const txDir = join(root, 'examples', 'txodds')
const feedDir = join(root, 'examples', 'marketplace', 'feed')
const agenticRunsDir = join(txDir, 'data', 'agentic-runs')
const feedPort = process.env.TXODDS_FEED_PORT ?? '4000'
const proxyPort = process.env.TXODDS_PROXY_PORT ?? '8801'
const webPort = process.env.TXODDS_WEB_PORT ?? '3020'
const feedUrl = process.env.TXODDS_FEED_URL ?? `http://localhost:${feedPort}`
const webUrl = `http://localhost:${webPort}`
const coralBase = (process.env.CORAL_SERVER_URL ?? 'http://localhost:5555').replace(/\/$/, '')
const coralConsoleUrl = process.env.CORAL_CONSOLE_URL ?? `${coralBase}/ui/console`
const consoleEnabled = process.env.CORAL_CONSOLE !== '0'
const consoleRequired = process.env.CORAL_CONSOLE_REQUIRED === '1'

const npm = (cwd, args) => spawnSync('npm', args, { cwd, shell: true, stdio: 'inherit' })

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 20) {
  console.error(`[txodds] Node ${process.version} detected - this kit needs Node 20+. Install it from nodejs.org, then re-run.`)
  process.exit(1)
}

function ensureWorkspace() {
  if (!existsSync(join(root, 'node_modules'))) {
    console.log('[txodds] installing workspace deps ...')
    npm(root, ['install', '--no-audit', '--no-fund'])
  }
}

function ensureBuiltPackages() {
  const required = [
    join(root, 'packages', 'agent-runtime', 'dist'),
    join(root, 'packages', 'payment-runtime', 'dist'),
  ]
  if (required.some((dir) => !existsSync(dir))) {
    console.log('[txodds] building workspace runtime packages ...')
    npm(root, ['run', 'build:packages'])
  }
}

function runConsoleProbe() {
  if (!consoleEnabled) return
  const args = ['scripts/coral-console-e2e.mjs', '--start']
  if (!consoleRequired) args.push('--allow-skip')
  const result = spawnSync('node', args, { cwd: root, shell: true, stdio: 'inherit' })
  if (result.status !== 0 && consoleRequired) process.exit(result.status ?? 1)
}

ensureWorkspace()
ensureBuiltPackages()
runConsoleProbe()

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: Number(port) })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.setTimeout(500, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function spawnService(label, command, args, options, port) {
  if (await portIsOpen(port)) {
    console.log(`[txodds] ${label} already running on :${port}; reusing it`)
    return null
  }
  return spawn(command, args, options)
}

const proxyEnv = { ...process.env, TXODDS_FEED_URL: feedUrl, CORAL_CONSOLE_URL: coralConsoleUrl }
const feedEnv = {
  ...process.env,
  PORT: feedPort,
  RUNS_DIR: agenticRunsDir,
  MARKET_SELLERS: 'seller-worldcup,seller-fast,seller-premium,seller-risk-policy,seller-fan-card',
}

const proxy = await spawnService('proxy', 'npm', ['run', 'proxy'], { cwd: txDir, shell: true, stdio: 'inherit', env: proxyEnv }, proxyPort)
const feed = await spawnService('feed', 'npm', ['start'], { cwd: feedDir, shell: true, stdio: 'inherit', env: feedEnv }, feedPort)
const web = await spawnService('web UI', 'npm', ['run', 'web'], { cwd: txDir, shell: true, stdio: 'inherit' }, webPort)

setTimeout(() => {
  if (process.env.TXODDS_OPEN !== '0') {
    const [cmd, args] =
      platform() === 'win32' ? ['cmd', ['/c', 'start', '', webUrl]]
      : platform() === 'darwin' ? ['open', [webUrl]]
      : ['xdg-open', [webUrl]]
    spawn(cmd, args, { shell: true, stdio: 'ignore' })
    console.log(`\n[txodds] opened ${webUrl}`)
  } else {
    console.log(`\n[txodds] web UI ready at ${webUrl}`)
  }
  console.log('[txodds] local proxy tutorial: http://localhost:8801')
  console.log(`[txodds] live CoralOS agent feed: ${feedUrl}`)
  console.log(`[txodds] Coral Console: ${coralConsoleUrl}`)
  console.log('[txodds] set CORAL_CONSOLE=0 to skip the console probe, or CORAL_CONSOLE_REQUIRED=1 to fail dev when it is unavailable\n')
}, 4000)

const stop = () => {
  proxy?.kill()
  feed?.kill()
  web?.kill()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
