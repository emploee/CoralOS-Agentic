/**
 * LLM pillar — one provider-agnostic `complete()` call.
 *
 * SDK-free (`fetch`-based) so the runtime stays dependency-light. Provider is chosen by env, so the
 * whole market flips from Anthropic (dev default) to the sponsored OpenAI key with `LLM_PROVIDER=openai`
 * (or to Venice AI with `LLM_PROVIDER=venice`) and no code change. Callers ask for a single JSON-shaped
 * answer and enforce their own guards on it — the model proposes, code disposes.
 *
 * To add a provider in code: extend `LlmProvider`, add a `DEFAULT_MODEL` entry, teach `pickProvider()`
 * to detect it, and dispatch to a `complete*()` in `complete()`. Venice is OpenAI-compatible, so it just
 * reuses `completeOpenAICompatible()` with a different base URL + key.
 */
export type LlmProvider = 'anthropic' | 'openai' | 'venice'

/** Explicit `LLM_PROVIDER` wins; else auto-detect by which key is present; else Anthropic. */
export function pickProvider(): LlmProvider {
  const p = process.env.LLM_PROVIDER?.toLowerCase()
  if (p === 'openai' || p === 'anthropic' || p === 'venice') return p
  if (process.env.OPENAI_API_KEY) return 'openai'
  if (process.env.VENICE_API_KEY) return 'venice'
  return 'anthropic'
}

const DEFAULT_MODEL: Record<LlmProvider, string> = {
  anthropic: 'claude-haiku-4-5-20251001',
  openai: 'gpt-4o-mini',
  venice: 'llama-3.3-70b',
}

export interface CompleteOpts {
  system: string
  user: string
  /** Override the model; else `LLM_MODEL` env, else a fast per-provider default. */
  model?: string
  maxTokens?: number
}

/**
 * One completion. Returns the model's text. Throws if the provider key is missing or the HTTP call
 * fails. Set `TRACE=1` to log provider/model and the raw response before the caller parses it.
 */
export async function complete(opts: CompleteOpts): Promise<string> {
  const provider = pickProvider()
  // `||` not `??`: coral manifests default unset options to "" — an empty LLM_MODEL must not win.
  const model = opts.model || process.env.LLM_MODEL || DEFAULT_MODEL[provider]
  const maxTokens = opts.maxTokens ?? 512
  const trace = process.env.TRACE === '1'
  if (trace) console.error(`[llm] provider=${provider} model=${model}`)

  const text = provider === 'openai'
    ? await completeOpenAI(opts, model, maxTokens)
    : provider === 'venice'
    ? await completeVenice(opts, model, maxTokens)
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

/** The OpenAI chat-completions request shape, shared by any OpenAI-compatible provider (OpenAI, Venice). */
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
