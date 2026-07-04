import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deliverService } from './service.js'

describe('deliverService txline-only routing', () => {
  const realFetch = global.fetch

  beforeEach(() => {
    process.env.TXLINE_API_KEY = 'token'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.VENICE_API_KEY
    delete process.env.LLM_PROVIDER
  })

  afterEach(() => {
    global.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('rejects legacy generic services', async () => {
    const out = JSON.parse(await deliverService('coingecko eth'))
    expect(out).toEqual({ error: 'unsupported service', service: 'coingecko', supported: ['txline', 'freelance'] })
  })

  it('freelance without an LLM key returns an honest error payload (verifier fails it, no release)', async () => {
    const out = JSON.parse(await deliverService('freelance landing-page-hero-copy'))
    expect(out.service).toBe('freelance')
    expect(out.brief).toBe('landing-page-hero-copy')
    expect(out.error).toContain('llm unavailable')
  })

  it('freelance with a (mocked) LLM delivers the deliverable JSON', async () => {
    process.env.LLM_PROVIDER = 'openai'
    process.env.OPENAI_API_KEY = 'k'
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"deliverable":"Ship faster with agents","notes":"hero copy"}' } }],
      }),
    })) as unknown as typeof fetch

    const out = JSON.parse(await deliverService('freelance landing-page-hero-copy'))
    expect(out).toMatchObject({
      service: 'freelance',
      result: { deliverable: 'Ship faster with agents', notes: 'hero copy' },
    })
  })

  it('returns fixtures from TxLINE', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/guest/start')) return { ok: true, json: async () => ({ token: 'jwt' }) }
      return { ok: true, json: async () => ([{ FixtureId: 1 }, { FixtureId: 2 }]) }
    }) as unknown as typeof fetch

    const out = JSON.parse(await deliverService('txline fixtures'))
    expect(out).toMatchObject({ service: 'txline-fixtures', count: 2 })
  })

  it('produces a deterministic edge when no live LLM key is configured', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/guest/start')) return { ok: true, json: async () => ({ token: 'jwt' }) }
      if (url.includes('/api/odds/snapshot/123')) {
        return {
          ok: true,
          json: async () => ([{
            SuperOddsType: '1X2',
            PriceNames: ['part1', 'x', 'part2'],
            Pct: ['62', '22', '16'],
          }]),
        }
      }
      return {
        ok: true,
        json: async () => ([{
          FixtureId: 123,
          Participant1: 'A',
          Participant2: 'B',
          Competition: 'World Cup',
        }]),
      }
    }) as unknown as typeof fetch

    const out = JSON.parse(await deliverService('txline edge 123'))
    expect(out.analysis.call).toContain('A')
    expect(out.analysis.note).toContain('deterministic fallback')
  })
})
