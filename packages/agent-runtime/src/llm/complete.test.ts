import { describe, it, expect, afterEach, vi } from 'vitest'
import { pickProvider, parseJsonReply, complete, effectiveMaxTokens, llmRuntimeInfo, logLlmStartup } from './complete.js'

const env = { ...process.env }
afterEach(() => {
  process.env = { ...env }
})

describe('pickProvider', () => {
  it('explicit LLM_PROVIDER wins', () => {
    process.env.LLM_PROVIDER = 'openai'
    process.env.ANTHROPIC_API_KEY = 'x'
    expect(pickProvider()).toBe('openai')
  })

  it('auto-detects OpenAI when its key is present and no explicit provider', () => {
    delete process.env.LLM_PROVIDER
    process.env.OPENAI_API_KEY = 'x'
    expect(pickProvider()).toBe('openai')
  })

  it('explicit LLM_PROVIDER=venice wins', () => {
    process.env.LLM_PROVIDER = 'venice'
    process.env.ANTHROPIC_API_KEY = 'x'
    expect(pickProvider()).toBe('venice')
  })

  it('auto-detects Venice when only its key is present', () => {
    delete process.env.LLM_PROVIDER
    delete process.env.OPENAI_API_KEY
    process.env.VENICE_API_KEY = 'x'
    expect(pickProvider()).toBe('venice')
  })

  it('explicit LLM_PROVIDER=groq wins', () => {
    process.env.LLM_PROVIDER = 'groq'
    process.env.ANTHROPIC_API_KEY = 'x'
    expect(pickProvider()).toBe('groq')
  })

  it('auto-detects Groq when only its key is present', () => {
    delete process.env.LLM_PROVIDER
    delete process.env.OPENAI_API_KEY
    delete process.env.VENICE_API_KEY
    process.env.GROQ_API_KEY = 'x'
    expect(pickProvider()).toBe('groq')
  })

  it('defaults to anthropic', () => {
    delete process.env.LLM_PROVIDER
    delete process.env.OPENAI_API_KEY
    delete process.env.VENICE_API_KEY
    delete process.env.GROQ_API_KEY
    expect(pickProvider()).toBe('anthropic')
  })
})

describe('llmRuntimeInfo key presence', () => {
  it('reports keyPresent=true and the right keyEnvVar when the resolved provider has a key', () => {
    process.env.LLM_PROVIDER = 'groq'
    process.env.GROQ_API_KEY = 'x'
    const info = llmRuntimeInfo()
    expect(info.provider).toBe('groq')
    expect(info.keyEnvVar).toBe('GROQ_API_KEY')
    expect(info.keyPresent).toBe(true)
  })

  it('reports keyPresent=false when LLM_PROVIDER is forced but the matching key is missing - the exact ' +
    'misconfiguration that silently falls back to deterministic behavior instead of the intended provider', () => {
    process.env.LLM_PROVIDER = 'groq'
    delete process.env.GROQ_API_KEY
    process.env.ANTHROPIC_API_KEY = 'x' // a different provider's key being present must not mask this
    const info = llmRuntimeInfo()
    expect(info.provider).toBe('groq')
    expect(info.keyEnvVar).toBe('GROQ_API_KEY')
    expect(info.keyPresent).toBe(false)
  })
})

describe('logLlmStartup', () => {
  it('logs a warning naming the missing key when the resolved provider has none', () => {
    process.env.LLM_PROVIDER = 'groq'
    delete process.env.GROQ_API_KEY
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logLlmStartup('seller-worldcup')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('seller-worldcup'))
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('WARNING'))
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('GROQ_API_KEY'))
    spy.mockRestore()
  })

  it('logs cleanly with no warning when the key is present', () => {
    process.env.LLM_PROVIDER = 'groq'
    process.env.GROQ_API_KEY = 'x'
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logLlmStartup('seller-worldcup')
    expect(spy.mock.calls[0][0]).not.toContain('WARNING')
    spy.mockRestore()
  })
})

describe('complete model resolution', () => {
  it('an empty LLM_MODEL (coral manifests default unset options to "") falls back to the provider default', async () => {
    delete process.env.LLM_PROVIDER
    delete process.env.OPENAI_API_KEY
    delete process.env.VENICE_API_KEY
    delete process.env.GROQ_API_KEY
    process.env.ANTHROPIC_API_KEY = 'k'
    process.env.LLM_MODEL = '' // what a container gets from an unset manifest option
    let sentModel = ''
    const realFetch = global.fetch
    global.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      sentModel = JSON.parse(init?.body ?? '{}').model
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'ok' }] }) }
    }) as unknown as typeof fetch
    try {
      await complete({ system: 's', user: 'u' })
    } finally {
      global.fetch = realFetch
    }
    expect(sentModel).toBe('claude-haiku-4-5-20251001') // not "" (which Anthropic 400s)
  })

  it('raises too-small Venice Kimi budgets so reasoning models can emit content', async () => {
    process.env.LLM_PROVIDER = 'venice'
    process.env.VENICE_API_KEY = 'k'
    process.env.LLM_MODEL = 'kimi-k2-7-code'
    let sentMaxTokens = 0
    const realFetch = global.fetch
    global.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      sentMaxTokens = JSON.parse(init?.body ?? '{}').max_tokens
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) }
    }) as unknown as typeof fetch
    try {
      await complete({ system: 's', user: 'u', maxTokens: 120 })
    } finally {
      global.fetch = realFetch
    }
    expect(sentMaxTokens).toBe(1024)
  })

  it('leaves non-Kimi token budgets alone', () => {
    expect(effectiveMaxTokens('venice', 'llama-3.3-70b', 120)).toBe(120)
    expect(effectiveMaxTokens('openai', 'kimi-k2-7-code', 120)).toBe(120)
  })

  it('Groq calls its OpenAI-compatible endpoint with the configured model', async () => {
    delete process.env.LLM_PROVIDER
    delete process.env.OPENAI_API_KEY
    delete process.env.VENICE_API_KEY
    process.env.GROQ_API_KEY = 'k'
    process.env.LLM_MODEL = ''
    let calledUrl = ''
    let sentModel = ''
    const realFetch = global.fetch
    global.fetch = vi.fn(async (url: unknown, init?: { body?: string }) => {
      calledUrl = String(url)
      sentModel = JSON.parse(init?.body ?? '{}').model
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }
    }) as unknown as typeof fetch
    try {
      await complete({ system: 's', user: 'u' })
    } finally {
      global.fetch = realFetch
    }
    expect(calledUrl).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(sentModel).toBe('llama-3.3-70b-versatile')
  })

  it('Groq throws a clear error when GROQ_API_KEY is missing', async () => {
    process.env.LLM_PROVIDER = 'groq'
    delete process.env.GROQ_API_KEY
    await expect(complete({ system: 's', user: 'u' })).rejects.toThrow('GROQ_API_KEY not set')
  })
})

describe('parseJsonReply', () => {
  it('parses a bare JSON object', () => {
    expect(parseJsonReply('{"bid":true,"price":0.0003}')).toEqual({ bid: true, price: 0.0003 })
  })

  it('parses JSON inside a ```json fence with prose around it', () => {
    const reply = 'Sure!\n```json\n{"bid":false,"reason":"too cheap"}\n```\nhope that helps'
    expect(parseJsonReply(reply)).toEqual({ bid: false, reason: 'too cheap' })
  })

  it('returns null when there is no JSON', () => {
    expect(parseJsonReply('no json here')).toBeNull()
  })
})
