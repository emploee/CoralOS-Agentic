import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { deliverService } from './service.js'

describe('deliverService routing', () => {
  const realFetch = global.fetch

  beforeEach(() => {
    process.env.TXLINE_API_KEY = 'token'
  })

  afterEach(() => {
    global.fetch = realFetch
    vi.restoreAllMocks()
  })

  it('rejects unsupported services', async () => {
    const out = JSON.parse(await deliverService('coingecko eth'))
    expect(out).toEqual({
      error: 'unsupported service',
      service: 'coingecko',
      supported: ['txline', 'sharp-movement'],
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

  it('produces a deterministic edge read', async () => {
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
    expect(out.analysis).toEqual({ call: 'Odds favour A (62%)', confidence: 0.62 })
  })

  it('delivers a sharp-movement report with magnitude/confidence/leadingLabel', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/guest/start')) return { ok: true, json: async () => ({ token: 'jwt' }) }
      if (url.includes('/api/odds/snapshot/123')) {
        return {
          ok: true,
          json: async () => ([{
            SuperOddsType: '1X2',
            PriceNames: ['part1', 'x', 'part2'],
            Pct: ['70', '20', '10'], // spread(top two) = 50pp -> extreme, confidence clamps to 1
          }]),
        }
      }
      return { ok: true, json: async () => ([{ FixtureId: 123, Participant1: 'A', Participant2: 'B' }]) }
    }) as unknown as typeof fetch

    const out = JSON.parse(await deliverService('sharp-movement 123'))
    expect(out).toMatchObject({
      service: 'sharp-movement', fixtureId: '123', magnitude: 'extreme', confidence: 1,
      spreadPct: 50, leadingLabel: 'part1',
    })
  })

  it('sharp-movement returns an honest error payload when no priced market exists', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/guest/start')) return { ok: true, json: async () => ({ token: 'jwt' }) }
      if (url.includes('/api/odds/snapshot/')) return { ok: true, json: async () => ([]) }
      return { ok: true, json: async () => ([]) }
    }) as unknown as typeof fetch

    const out = JSON.parse(await deliverService('sharp-movement 999'))
    expect(out).toEqual({ service: 'sharp-movement', fixtureId: '999', error: 'no priced 1X2 market available' })
  })
})
