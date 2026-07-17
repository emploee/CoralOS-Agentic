/**
 * Adapter registry — the seller picks its harness with `HARNESS=<name>` (default in-process, the
 * always-works baseline; demos must never depend on an external harness booting).
 *
 *   in-process    wraps the seller's deliverService fork point, in this process
 *   claude-code   headless Claude Code in an isolated workdir (+ optional Coral MCP injection)
 *   cli           any other harness: HARNESS_CMD is the argv, JSON array or whitespace-split
 *                 (e.g. Hermes: HARNESS=cli HARNESS_CMD='hermes {prompt}' HARNESS_NAME=hermes)
 */
import type { HarnessAdapter } from '../types.js'
import { inProcessAdapter, type DeliverFn } from './in-process.js'
import { claudeCodeAdapter } from './claude-code.js'
import { cliHarnessAdapter } from './subprocess.js'

export const KNOWN_HARNESSES = ['in-process', 'claude-code', 'cli'] as const

function parseCommand(raw: string): string[] {
  if (raw.trim().startsWith('[')) return JSON.parse(raw) as string[]
  return raw.split(/\s+/).filter(Boolean)
}

export function adapterFromEnv(deliver: DeliverFn, env: NodeJS.ProcessEnv = process.env): HarnessAdapter {
  const harness = (env.HARNESS ?? 'in-process').toLowerCase()
  switch (harness) {
    case 'in-process':
      return inProcessAdapter(deliver)
    case 'claude-code':
      return claudeCodeAdapter(env)
    case 'cli': {
      if (!env.HARNESS_CMD) throw new Error('HARNESS=cli needs HARNESS_CMD (argv as JSON array or a space-split string)')
      return cliHarnessAdapter({
        name: env.HARNESS_NAME ?? 'cli',
        command: parseCommand(env.HARNESS_CMD),
        timeoutMs: Number(env.HARNESS_TIMEOUT_MS ?? 300_000),
      })
    }
    default:
      throw new Error(`unknown HARNESS "${harness}" (known: ${KNOWN_HARNESSES.join(', ')})`)
  }
}
