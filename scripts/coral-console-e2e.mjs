#!/usr/bin/env node
/**
 * Coral Console E2E probe.
 *
 * The console is built into Coral Server and is expected at /ui/console when the server is running.
 * This script can optionally start the repo's docker-compose `coral` service, then verifies the
 * browser entrypoint returns HTML and records a small proof artifact.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { platform } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const shouldStart = args.has('--start') || process.env.CORAL_CONSOLE_START === '1'
const shouldOpen = args.has('--open') || process.env.CORAL_CONSOLE_OPEN === '1'
const allowSkip = args.has('--allow-skip') || process.env.CORAL_CONSOLE_ALLOW_SKIP === '1'
const json = args.has('--json')
const base = (process.env.CORAL_SERVER_URL ?? 'http://localhost:5555').replace(/\/$/, '')
const consoleUrl = process.env.CORAL_CONSOLE_URL ?? `${base}/ui/console`
const timeoutMs = Number(process.env.CORAL_CONSOLE_TIMEOUT_MS ?? '45000')
const artifactDir = process.env.CORAL_CONSOLE_ARTIFACT_DIR ?? join(root, '.artifacts', 'coral-console')
const artifactPath = join(artifactDir, 'console-e2e.json')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function writeArtifact(result) {
  mkdirSync(artifactDir, { recursive: true })
  writeFileSync(artifactPath, JSON.stringify(result, null, 2) + '\n', 'utf8')
}

function commandWorks(command, args) {
  const r = spawnSync(command, args, { cwd: root, shell: true, stdio: 'ignore' })
  return r.status === 0
}

function startCoral() {
  if (!existsSync(join(root, 'docker-compose.yml'))) {
    throw new Error('docker-compose.yml not found')
  }
  if (!commandWorks('docker', ['version'])) {
    throw new Error('Docker CLI is not available')
  }
  if (!commandWorks('docker', ['compose', 'version'])) {
    throw new Error('Docker Compose v2 is not available')
  }
  const r = spawnSync('docker', ['compose', 'up', '-d', 'coral'], {
    cwd: root,
    shell: true,
    stdio: json ? 'pipe' : 'inherit',
  })
  if (r.status !== 0) {
    const detail = [r.stderr, r.stdout].filter(Boolean).map((b) => b.toString()).join('\n').trim()
    throw new Error(`docker compose up -d coral failed${detail ? `: ${detail.slice(0, 400)}` : ''}`)
  }
}

async function probeConsole() {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(consoleUrl, { redirect: 'follow' })
      const body = await res.text()
      const htmlish = /<html|<!doctype html|<div id=|<script/i.test(body)
      const coralish = /coral|console|assets/i.test(body)
      if (res.ok && htmlish && coralish) {
        return {
          ok: true,
          base,
          consoleUrl,
          status: res.status,
          contentType: res.headers.get('content-type') ?? '',
          checkedAt: new Date().toISOString(),
        }
      }
      last = `HTTP ${res.status}; body did not look like Coral Console HTML`
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
    }
    await sleep(750)
  }
  throw new Error(`Coral Console did not become ready at ${consoleUrl}: ${last}`)
}

function openBrowser(url) {
  const [cmd, browserArgs] =
    platform() === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : platform() === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]]
  spawn(cmd, browserArgs, { shell: true, stdio: 'ignore' })
}

async function main() {
  try {
    if (shouldStart) startCoral()
    const result = await probeConsole()
    writeArtifact(result)
    if (shouldOpen) openBrowser(consoleUrl)
    if (json) console.log(JSON.stringify({ ...result, artifactPath }, null, 2))
    else console.log(`[coral-console] PASS ${consoleUrl} (proof: ${artifactPath})`)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const result = {
      ok: false,
      skipped: allowSkip,
      base,
      consoleUrl,
      error: message,
      checkedAt: new Date().toISOString(),
    }
    writeArtifact(result)
    if (allowSkip) {
      const note = `[coral-console] SKIP ${message} (proof: ${artifactPath})`
      if (json) console.log(JSON.stringify({ ...result, artifactPath }, null, 2))
      else console.warn(note)
      return
    }
    console.error(`[coral-console] FAIL ${message}`)
    process.exit(1)
  }
}

main()
