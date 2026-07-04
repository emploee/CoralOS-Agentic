/**
 * Generic CLI harness adapter — the bridge that lets any external agent harness sell work in the
 * market (the tutorial_orchestrate_agent_harnesses pattern: inject config, launch the harness,
 * relay the result).
 *
 * Per order it: creates an isolated workdir, writes the harness's config files into it (e.g. an
 * `.mcp.json` trusting the session's Coral MCP URL), launches the CLI with the order prompt, streams
 * stderr lines as harness events, and hash-binds stdout as the delivery. The harness only ever sees
 * the workdir and the prompt — never a wallet key; the seller agent keeps custody and the protocol.
 *
 * Prompt passing: if the argv contains a "{prompt}" placeholder it is substituted; otherwise the
 * prompt is piped to stdin (the safe default on Windows, where .cmd shims force shell spawning).
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { sha256Hex } from '@pay/agent-runtime'
import { decideBid } from '../quote.js'
import { orderRequest, type Delivery, type HarnessAdapter, type OnHarnessEvent, type Order } from '../types.js'

export interface CliHarnessSpec {
  name: string
  /** argv; a "{prompt}" element is replaced with the order prompt, else the prompt goes to stdin. */
  command: string[]
  /** Files to write into the workdir before launch (relative path → content). */
  configFiles?: (ctx: { workdir: string; env: NodeJS.ProcessEnv }) => Record<string, string>
  /** Build the order prompt (default: a paid-order preamble around "<service> <arg>"). */
  prompt?: (order: Order) => string
  /** Extract the deliverable from stdout (default: trimmed stdout). */
  parseOutput?: (stdout: string) => string
  timeoutMs?: number
  env?: NodeJS.ProcessEnv
}

const DEFAULT_TIMEOUT_MS = 300_000

/** Kill the whole process tree — with shell:true on Windows, kill() would only hit cmd.exe. */
function killTree(child: ReturnType<typeof spawn>): void {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'])
  } else {
    child.kill('SIGKILL')
  }
}

const defaultPrompt = (order: Order): string =>
  `You are fulfilling a PAID market order (round ${order.round}). Request: "${orderRequest(order)}". ` +
  `Produce ONLY the deliverable as a single JSON object on stdout - no prose around it.`

/** Quote an argv element for a Windows shell spawn (cmd.exe mangles bare spaces/quotes). */
const winQuote = (a: string): string => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)

export function cliHarnessAdapter(spec: CliHarnessSpec): HarnessAdapter {
  return {
    name: spec.name,
    quote: (want, cfg) => decideBid(want, cfg),
    async run(order, onEvent): Promise<Delivery> {
      const emit = (kind: string, text?: string) =>
        onEvent?.({ ts: new Date().toISOString(), kind, ...(text ? { text: text.slice(0, 500) } : {}) })

      const workdir = order.workdir ?? mkdtempSync(join(tmpdir(), `${spec.name}-order-`))
      mkdirSync(workdir, { recursive: true })
      const env = { ...process.env, ...spec.env }
      for (const [rel, content] of Object.entries(spec.configFiles?.({ workdir, env }) ?? {})) {
        const abs = join(workdir, rel)
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, content, 'utf8')
      }

      const prompt = (spec.prompt ?? defaultPrompt)(order)
      const viaArgv = spec.command.some((a) => a.includes('{prompt}'))
      let argv = spec.command.map((a) => a.replaceAll('{prompt}', prompt))
      const shell = process.platform === 'win32' // .cmd shims can't be spawned directly since Node 18.20
      if (shell) argv = argv.map(winQuote)

      emit('start', `${spec.name}: ${orderRequest(order)} (workdir ${workdir})`)
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(argv[0], argv.slice(1), { cwd: workdir, env, shell })
        let out = ''
        let errTail = ''
        const timer = setTimeout(() => {
          killTree(child)
          reject(new Error(`${spec.name} timed out after ${spec.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`))
        }, spec.timeoutMs ?? DEFAULT_TIMEOUT_MS)
        child.stdout.on('data', (d: Buffer) => { out += d.toString() })
        child.stderr.on('data', (d: Buffer) => {
          const text = d.toString()
          errTail = (errTail + text).slice(-2000)
          for (const line of text.split('\n')) if (line.trim()) emit('log', line.trim())
        })
        child.on('error', (e) => { clearTimeout(timer); reject(e) })
        child.on('close', (code) => {
          clearTimeout(timer)
          if (code === 0) resolve(out)
          else reject(new Error(`${spec.name} exited ${code}: ${errTail.slice(-300)}`))
        })
        if (!viaArgv) child.stdin.write(prompt)
        child.stdin.end()
      }).catch((e) => {
        emit('error', (e as Error).message)
        throw e
      })

      const payload = (spec.parseOutput ?? ((s: string) => s.trim()))(stdout)
      if (!payload) {
        emit('error', 'harness produced no output')
        throw new Error(`${spec.name} produced no output`)
      }
      emit('delivered', `${payload.length} bytes`)
      return { payload, sha256: sha256Hex(payload), artifacts: [], summary: `${spec.name} run in ${workdir}` }
    },
  }
}
