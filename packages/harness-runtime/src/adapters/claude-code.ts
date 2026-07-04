/**
 * claude-code — sell Claude Code's work in the market. Runs `claude -p` headless in the order's
 * isolated workdir, with the Xinxing config-injection pattern: when the seller passes the session's
 * Coral MCP URL (CORAL_CONNECTION_URL), the workdir gets an `.mcp.json` trusting that server plus
 * local settings enabling it, so the harness itself can use Coral tools mid-order.
 *
 * `claude -p --output-format json` wraps the answer in {"result": ...} — parseOutput unwraps it.
 * The prompt arrives on stdin (no argv quoting hazards on Windows).
 */
import { cliHarnessAdapter } from './subprocess.js'
import type { HarnessAdapter } from '../types.js'

/** Unwrap `claude -p --output-format json`'s {"result": ...} envelope (raw stdout if absent). */
export function parseClaudeJson(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as { result?: unknown }
    if (typeof parsed.result === 'string') return parsed.result.trim()
    if (parsed.result !== undefined) return JSON.stringify(parsed.result)
  } catch {
    // not the JSON envelope — fall through to raw stdout
  }
  return stdout.trim()
}

/** The injected workdir config: an .mcp.json trusting the session's Coral MCP URL, when given. */
export function claudeConfigFiles(env: NodeJS.ProcessEnv): Record<string, string> {
  const coralUrl = env.CORAL_CONNECTION_URL
  if (!coralUrl) return {}
  return {
    '.mcp.json': JSON.stringify({ mcpServers: { coral: { type: 'http', url: coralUrl } } }, null, 2),
    '.claude/settings.local.json': JSON.stringify({ enableAllProjectMcpServers: true }, null, 2),
  }
}

export function claudeCodeAdapter(env: NodeJS.ProcessEnv = process.env): HarnessAdapter {
  const bin = env.CLAUDE_CODE_BIN ?? 'claude'
  return cliHarnessAdapter({
    name: 'claude-code',
    command: [bin, '-p', '--output-format', 'json', '--max-turns', env.CLAUDE_CODE_MAX_TURNS ?? '6'],
    timeoutMs: Number(env.HARNESS_TIMEOUT_MS ?? 300_000),
    configFiles: ({ env }) => claudeConfigFiles(env),
    parseOutput: parseClaudeJson,
  })
}
