#!/usr/bin/env node
// Launch any example from a fresh checkout: install the root npm workspace, build any local package
// dist the example imports, then run the requested npm script.
//
//   node scripts/run-example.js <relativeDir> <npmScript>

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const [rel, script] = process.argv.slice(2)
if (!rel || !script) {
  console.error('usage: node scripts/run-example.js <relativeDir> <npmScript>')
  process.exit(1)
}

const dir = join(root, rel)
if (!existsSync(join(dir, 'package.json'))) {
  console.error(`[example] no package.json at ${rel} - is the path right?`)
  process.exit(1)
}

const npm = (cwd, args) => spawnSync('npm', args, { cwd, shell: true, stdio: 'inherit' })

const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
const deps = { ...pkg.dependencies, ...pkg.devDependencies }

const requiredNode = pkg.engines?.node?.match(/>=\s*(\d+)/)?.[1] ?? '20'
if (Number(process.versions.node.split('.')[0]) < Number(requiredNode)) {
  console.error(`[example] Node ${process.version} detected - ${rel} needs Node ${requiredNode}+. Install from nodejs.org, then re-run.`)
  process.exit(1)
}

function ensureWorkspaceInstalled() {
  if (!existsSync(join(root, 'node_modules'))) {
    console.log('[example] installing workspace deps ...')
    npm(root, ['install', '--no-audit', '--no-fund'])
  }
}

function ensureBuiltPackage(name, relPath) {
  const packageDir = join(root, relPath)
  if (!existsSync(join(packageDir, 'dist'))) {
    console.log(`[example] building ${name} (dist) ...`)
    npm(root, ['run', 'build', '-w', name])
  }
}

ensureWorkspaceInstalled()

if (deps['@pay/agent-runtime'] || deps['@pay/solana-agent-tools']) {
  ensureBuiltPackage('@pay/agent-runtime', join('packages', 'agent-runtime'))
}
if (deps['@pay/solana-agent-tools']) {
  ensureBuiltPackage('@pay/solana-agent-tools', join('packages', 'solana-agent-tools'))
}

console.log(`[example] ${rel} -> npm run ${script}\n`)
const child = spawn('npm', ['run', script], { cwd: dir, shell: true, stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
const stop = () => { child.kill(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
