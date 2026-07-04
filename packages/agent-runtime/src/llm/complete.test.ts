import { describe, it, expect, afterEach, vi } from 'vitest'
import { pickProvider, parseJsonReply, complete } from './complete.js'

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

  it('defaults to anthropic', () => {
    delete process.env.LLM_PROVIDER
    delete process.env.OPENAI_API_KEY
    delete process.env.VENICE_API_KEY
    expect(pickProvider()).toBe('anthropic')
  })
})

describe('complete model resolution', () => {
  it('an empty LLM_MODEL (coral manifests default unset options to "") falls back to the provider default', async () => {
    delete process.env.LLM_PROVIDER
    delete process.env.OPENAI_API_KEY
    delete process.env.VENICE_API_KEY
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
