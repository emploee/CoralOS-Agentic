import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256Hex } from '@pay/agent-runtime'
import { cliHarnessAdapter } from './subprocess.js'
import { parseClaudeJson, claudeConfigFiles } from './claude-code.js'
import type { HarnessEvent, Order } from '../types.js'

const order: Order = { round: 3, service: 'research', arg: 'solana-fees', priceSol: 0.001 }

// Fixture CLIs written to disk — `node <script>` spawns identically on POSIX and Windows,
// with no shell-quoting hazards in the scripts themselves.
let scripts: string
beforeAll(() => {
  scripts = mkdtempSync(join(tmpdir(), 'harness-fixtures-'))
  writeFileSync(join(scripts, 'echo-stdin.cjs'),
    `const fs = require('fs')\nconst d = fs.readFileSync(0, 'utf8')\nconsole.log(JSON.stringify({ got: d }))\n`)
  writeFileSync(join(scripts, 'argv.cjs'), `console.log(process.argv[2])\n`)
  writeFileSync(join(scripts, 'fail.cjs'), `console.error('boom'); process.exit(3)\n`)
  writeFileSync(join(scripts, 'probe.cjs'),
    `const fs = require('fs')\nconsole.log(fs.readFileSync('.mcp.json', 'utf8'))\n`)
})

describe('cliHarnessAdapter', () => {
  it('pipes the prompt to stdin by default and hash-binds stdout', async () => {
    const adapter = cliHarnessAdapter({
      name: 'echo', command: ['node', join(scripts, 'echo-stdin.cjs')],
      prompt: () => 'do the research',
    })
    const d = await adapter.run(order)
    expect(JSON.parse(d.payload)).toEqual({ got: 'do the research' })
    expect(d.sha256).toBe(sha256Hex(d.payload))
  })

  it('substitutes a {prompt} argv placeholder', async () => {
    const adapter = cliHarnessAdapter({
      name: 'argv', command: ['node', join(scripts, 'argv.cjs'), '{prompt}'],
      prompt: () => 'one-token-prompt',
    })
    const d = await adapter.run(order)
    expect(d.payload).toBe('one-token-prompt')
  })

  it('writes injected config files into the workdir before launch', async () => {
    const workdir = mkdtempSync(join(tmpdir(), 'order-'))
    const adapter = cliHarnessAdapter({
      name: 'probe', command: ['node', join(scripts, 'probe.cjs')],
      configFiles: () => claudeConfigFiles({ CORAL_CONNECTION_URL: 'http://coral:5555/sse/v1/devmode/x' }),
    })
    const d = await adapter.run({ ...order, workdir })
    expect(JSON.parse(d.payload).mcpServers.coral).toEqual({ type: 'http', url: 'http://coral:5555/sse/v1/devmode/x' })
    expect(existsSync(join(workdir, '.claude/settings.local.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(workdir, '.claude/settings.local.json'), 'utf8')).enableAllProjectMcpServers).toBe(true)
  })

  it('streams start → log → delivered events, with stderr as log lines', async () => {
    const events: HarnessEvent[] = []
    const adapter = cliHarnessAdapter({
      name: 'fail', command: ['node', join(scripts, 'fail.cjs')],
    })
    await expect(adapter.run(order, (e) => events.push(e))).rejects.toThrow(/exited 3/)
    expect(events.map((e) => e.kind)).toEqual(['start', 'log', 'error'])
    expect(events[1].text).toBe('boom')
  })

  it('kills a harness that exceeds its timeout', async () => {
    writeFileSync(join(scripts, 'hang.cjs'), `setInterval(() => {}, 1000)\n`)
    const adapter = cliHarnessAdapter({
      name: 'hang', command: ['node', join(scripts, 'hang.cjs')], timeoutMs: 800,
    })
    await expect(adapter.run(order)).rejects.toThrow(/timed out/)
  }, 10_000)
})

describe('claude-code helpers', () => {
  it('unwraps the claude -p JSON envelope', () => {
    expect(parseClaudeJson('{"result": "the answer", "cost_usd": 0.01}')).toBe('the answer')
    expect(parseClaudeJson('{"result": {"a": 1}}')).toBe('{"a":1}')
    expect(parseClaudeJson('plain text out')).toBe('plain text out')
  })

  it('injects no config without a Coral URL', () => {
    expect(claudeConfigFiles({})).toEqual({})
  })
})
