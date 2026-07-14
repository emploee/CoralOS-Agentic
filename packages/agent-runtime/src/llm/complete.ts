/**
 * LLM pillar — one provider-agnostic `complete()` call.
 *
 * SDK-free (`fetch`-based) so the runtime stays dependency-light. Provider is chosen by env, so the
 * whole market flips to Venice AI with `LLM_PROVIDER=venice` (or OpenAI/Anthropic/Groq) and no code
 * change. Callers ask for a single JSON-shaped
 * answer and enforce their own guards on it — the model proposes, code disposes.
 *
 * To add a provider in code: extend `LlmProvider`, add a `DEFAULT_MODEL` entry, teach `pickProvider()`
 * to detect it, and dispatch to a `complete*()` in `complete()`. Venice and Groq are both
 * OpenAI-compatible, so they just reuse `completeOpenAICompatible()` with a different base URL + key.
 *
 * Groq is the recommended free-tier fallback when a paid/credit-based provider runs dry (e.g. Venice's
 * free credits) — unlike a one-time credit grant, Groq's free tier is a renewing per-day/per-minute
 * rate limit (see LLM.md), so it doesn't run out the same way.
 */
export type LlmProvider = 'anthropic' | 'openai' | 'venice' | 'groq'

/** Explicit `LLM_PROVIDER` wins; else auto-detect by which key is present; else Anthropic. */
export function pickProvider(): LlmProvider {
  const p = process.env.LLM_PROVIDER?.toLowerCase()
  if (p === 'openai' || p === 'anthropic' || p === 'venice' || p === 'groq') return p
  if (process.env.OPENAI_API_KEY) return 'openai'
  if (process.env.VENICE_API_KEY) return 'venice'
  if (process.env.GROQ_API_KEY) return 'groq'
  return 'anthropic'
}

const DEFAULT_MODEL: Record<LlmProvider, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  venice: 'llama-3.3-70b',
  groq: 'llama-3.3-70b-versatile',
}

const KIMI_MIN_COMPLETION_TOKENS = 1024

/**
 * Venice-hosted Kimi code models can spend small budgets on internal reasoning before emitting
 * `message.content`. Keep caller limits for other models, but give Kimi enough room to finish JSON.
 */
export function effectiveMaxTokens(provider: LlmProvider, model: string, requested: number): number {
  return provider === 'venice' && /kimi/i.test(model) && requested < KIMI_MIN_COMPLETION_TOKENS
    ? KIMI_MIN_COMPLETION_TOKENS
    : requested
}

export interface CompleteOpts {
  system: string
  user: string
  /** Override the model; else `LLM_MODEL` env, else a fast per-provider default. */
  model?: string
  maxTokens?: number
}

const KEY_ENV_VAR: Record<LlmProvider, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  venice: 'VENICE_API_KEY',
  groq: 'GROQ_API_KEY',
}

export interface LlmRuntimeInfo {
  provider: LlmProvider
  model: string
  maxTokens: number
  /** The env var complete() will actually read a key from for this provider. */
  keyEnvVar: string
  /** False means any complete() call will throw and the caller's deterministic fallback will run -
   *  worth surfacing loudly (see logLlmStartup below) rather than only showing up per-call. */
  keyPresent: boolean
}

/** The provider/model/max-token selection a call to `complete()` would use, without calling the LLM. */
export function llmRuntimeInfo(opts: Pick<CompleteOpts, 'model' | 'maxTokens'> = {}): LlmRuntimeInfo {
  const provider = pickProvider()
  // `||` not `??`: Coral manifests default unset options to ""; an empty LLM_MODEL must not win.
  const model = opts.model || process.env.LLM_MODEL || DEFAULT_MODEL[provider]
  const requestedMaxTokens = opts.maxTokens ?? 512
  const keyEnvVar = KEY_ENV_VAR[provider]
  return {
    provider,
    model,
    maxTokens: effectiveMaxTokens(provider, model, requestedMaxTokens),
    keyEnvVar,
    keyPresent: Boolean(process.env[keyEnvVar]),
  }
}

/**
 * One line to stdout at agent startup naming the resolved provider/model and, critically, whether its
 * key actually made it into this process's env - printed once, immediately, in `docker logs`, instead
 * of only being discoverable per-call after a round has already run into a silent fallback. Call this
 * from every agent entrypoint (buyer/seller/verifier) right after startup.
 */
export function logLlmStartup(agentName: string): void {
  const info = llmRuntimeInfo()
  const status = info.keyPresent
    ? 'key present'
    : `WARNING: ${info.keyEnvVar} is NOT set in this process - every complete() call will throw and fall back to deterministic behavior`
  console.error(`[${agentName}] LLM: provider=${info.provider} model=${info.model} (${status})`)
}

/**
 * One completion. Returns the model's text. Throws if the provider key is missing or the HTTP call
 * fails. Set `TRACE=1` to log provider/model and the raw response before the caller parses it.
 */
export async function complete(opts: CompleteOpts): Promise<string> {
  const info = llmRuntimeInfo(opts)
  const provider = info.provider
  // `||` not `??`: coral manifests default unset options to "" — an empty LLM_MODEL must not win.
  const model = info.model
  const maxTokens = info.maxTokens
  const trace = process.env.TRACE === '1'
  if (trace) console.error(`[llm] provider=${provider} model=${model} maxTokens=${maxTokens}`)

  const text = provider === 'openai'
    ? await completeOpenAI(opts, model, maxTokens)
    : provider === 'venice'
    ? await completeVenice(opts, model, maxTokens)
    : provider === 'groq'
    ? await completeGroq(opts, model, maxTokens)
    : await completeAnthropic(opts, model, maxTokens)

  if (trace) console.error(`[llm] ← ${text.slice(0, 300)}`)
  return text
}

async function completeAnthropic(opts: CompleteOpts, model: string, maxTokens: number): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY not set (or set LLM_PROVIDER=openai + OPENAI_API_KEY)')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: opts.system,
      messages: [{ role: 'user', content: opts.user }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
  return (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim()
}

async function completeOpenAI(opts: CompleteOpts, model: string, maxTokens: number): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not set')
  return completeOpenAICompatible(opts, model, maxTokens, {
    url: 'https://api.openai.com/v1/chat/completions',
    key,
    label: 'OpenAI',
  })
}

/**
 * Venice AI — OpenAI-compatible, so it reuses the same request shape against Venice's base URL.
 * Get a key at https://venice.ai/settings/api (new accounts can redeem code IMPERIAL50 for free credits).
 */
async function completeVenice(opts: CompleteOpts, model: string, maxTokens: number): Promise<string> {
  const key = process.env.VENICE_API_KEY
  if (!key) throw new Error('VENICE_API_KEY not set (get one at https://venice.ai/settings/api)')
  return completeOpenAICompatible(opts, model, maxTokens, {
    url: 'https://api.venice.ai/api/v1/chat/completions',
    key,
    label: 'Venice',
  })
}

/**
 * Groq — OpenAI-compatible, and free (renewing rate limits, not a spendable credit pool). Get a key
 * at https://console.groq.com/keys. Recommended fallback when Venice's free credits run out.
 */
async function completeGroq(opts: CompleteOpts, model: string, maxTokens: number): Promise<string> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY not set (get a free key at https://console.groq.com/keys)')
  return completeOpenAICompatible(opts, model, maxTokens, {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    key,
    label: 'Groq',
  })
}

/** The OpenAI chat-completions request shape, shared by any OpenAI-compatible provider (OpenAI, Venice, Groq). */
async function completeOpenAICompatible(
  opts: CompleteOpts,
  model: string,
  maxTokens: number,
  endpoint: { url: string; key: string; label: string },
): Promise<string> {
  const res = await fetch(endpoint.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${endpoint.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
    }),
  })
  if (!res.ok) throw new Error(`${endpoint.label} ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return (data.choices?.[0]?.message?.content ?? '').trim()
}

/**
 * Best-effort JSON extraction from a model reply (handles ```json fences and surrounding prose).
 * Returns `null` if nothing parseable is found — callers fall back to a deterministic default.
 */
export function parseJsonReply<T = unknown>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(fenced.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
