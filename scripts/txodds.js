#!/usr/bin/env node
// One-command TxODDS: local proxy tutorial + static UI + CoralOS feed reader + Coral Console probe.
//
//   node scripts/txodds.js        (= npm run dev)
//
// Processes:
//   - proxy   (:8801)    TxODDS data, local settlement, /api/agentic/* facade
//   - feed    (:4000)    CoralOS session reader + run ledger for live agent mode
//   - web     (:3020)    no-build React tutorial/dashboard
//   - coral   (:5555)    Coral Server + built-in Coral Console when Docker is available
//
// startCoreServices() below is exported so scripts/txodds-agentic.js (npm run dev:agentic) can bring
// up the same three processes and then layer a CoralOS round on top, without duplicating this logic.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

export const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const txDir = join(root, 'examples', 'txodds')
const feedDir = join(root, 'examples', 'txodds', 'feed')
const agenticRunsDir = join(txDir, 'data', 'agentic-runs')

const npm = (cwd, args) => spawnSync('npm', args, { cwd, shell: true, stdio: 'inherit' })

function checkNodeVersion() {
  const nodeMajor = Number(process.versions.node.split('.')[0])
  if (nodeMajor < 20) {
    console.error(`[txodds] Node ${process.version} detected - this kit needs Node 20+. Install it from nodejs.org, then re-run.`)
    process.exit(1)
  }
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

function runConsoleProbe(consoleEnabled, consoleRequired) {
  if (!consoleEnabled) return
  const args = ['scripts/coral-console-e2e.mjs', '--start']
  if (!consoleRequired) args.push('--allow-skip')
  const result = spawnSync('node', args, { cwd: root, shell: true, stdio: 'inherit' })
  if (result.status !== 0 && consoleRequired) process.exit(result.status ?? 1)
}

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

function openBrowserAt(url) {
  const [cmd, args] =
    platform() === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : platform() === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]]
  spawn(cmd, args, { shell: true, stdio: 'ignore' })
}

/**
 * Brings up proxy/feed/web (reusing any already listening on their port) and, by default,
 * opens the browser + logs the usual startup summary after a few seconds. Pass `openBrowser: false`
 * to skip that (e.g. scripts/txodds-agentic.js opens the browser itself once a round actually exists,
 * rather than at core-services startup). Returns the spawned child handles and resolved URLs so a
 * caller can compose further (kill them, or point a follow-up step at the right ports).
 */
export async function startCoreServices({ openBrowser = true } = {}) {
  checkNodeVersion()
  ensureWorkspace()
  ensureBuiltPackages()

  const feedPort = process.env.TXODDS_FEED_PORT ?? '4000'
  const proxyPort = process.env.TXODDS_PROXY_PORT ?? '8801'
  const webPort = process.env.TXODDS_WEB_PORT ?? '3020'
  const feedUrl = process.env.TXODDS_FEED_URL ?? `http://localhost:${feedPort}`
  const webUrl = `http://localhost:${webPort}`
  const coralBase = (process.env.CORAL_SERVER_URL ?? 'http://localhost:5555').replace(/\/$/, '')
  const coralConsoleUrl = process.env.CORAL_CONSOLE_URL ?? `${coralBase}/ui/console`
  const consoleEnabled = process.env.CORAL_CONSOLE !== '0'
  const consoleRequired = process.env.CORAL_CONSOLE_REQUIRED === '1'

  runConsoleProbe(consoleEnabled, consoleRequired)

  const proxyEnv = { ...process.env, TXODDS_FEED_URL: feedUrl, CORAL_CONSOLE_URL: coralConsoleUrl, RUNS_DIR: agenticRunsDir }
  const feedEnv = {
    ...process.env,
    PORT: feedPort,
    RUNS_DIR: agenticRunsDir,
    MARKET_SELLERS: 'seller-agent',
  }

  const proxy = await spawnService('proxy', 'npm', ['run', 'proxy'], { cwd: txDir, shell: true, stdio: 'inherit', env: proxyEnv }, proxyPort)
  const feed = await spawnService('feed', 'npm', ['start'], { cwd: feedDir, shell: true, stdio: 'inherit', env: feedEnv }, feedPort)
  const web = await spawnService('web UI', 'npm', ['run', 'web'], { cwd: txDir, shell: true, stdio: 'inherit' }, webPort)

  const services = { proxy, feed, web, feedUrl, webUrl, coralConsoleUrl }

  setTimeout(() => {
    if (openBrowser) {
      if (process.env.TXODDS_OPEN !== '0') {
        openBrowserAt(webUrl)
        console.log(`\n[txodds] opened ${webUrl}`)
      } else {
        console.log(`\n[txodds] web UI ready at ${webUrl}`)
      }
    }
    console.log('[txodds] local proxy tutorial: http://localhost:8801')
    console.log(`[txodds] live CoralOS agent feed: ${feedUrl}`)
    console.log(`[txodds] Coral Console: ${coralConsoleUrl}`)
    console.log('[txodds] set CORAL_CONSOLE=0 to skip the console probe, or CORAL_CONSOLE_REQUIRED=1 to fail dev when it is unavailable\n')
  }, 4000)

  return services
}

export function stopCoreServices(services) {
  services.proxy?.kill()
  services.feed?.kill()
  services.web?.kill()
}

async function main() {
  const services = await startCoreServices()
  const stop = () => {
    stopCoreServices(services)
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
