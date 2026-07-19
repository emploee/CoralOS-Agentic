#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const images = [
  ['buyer-agent:0.1.0', 'coral-agents/buyer-agent/Dockerfile'],
  ['seller-agent:0.1.0', 'coral-agents/seller-agent/Dockerfile'],
  ['verifier-agent:0.1.0', 'coral-agents/verifier-agent/Dockerfile'],
]

const version = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
  encoding: 'utf8', windowsHide: true,
})
if (version.status !== 0) {
  console.error('Docker Desktop is required and must be running before agent images can be built.')
  process.exit(1)
}
console.log(`Docker ${version.stdout.trim()} detected.`)

for (const [tag, dockerfile] of images) {
  console.log(`\n==> Building ${tag}`)
  const result = spawnSync('docker', ['build', '-f', join(root, dockerfile), '-t', tag, root], {
    stdio: 'inherit', windowsHide: true,
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log('\nPatchBond agent images are ready.')
