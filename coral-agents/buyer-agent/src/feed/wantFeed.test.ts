import { describe, it, expect } from 'vitest'
import { fetchNextWant } from './wantFeed.js'

const respond = (status: number, body?: unknown) =>
  (async () => ({ status, ok: status >= 200 && status < 300, json: async () => body })) as unknown as typeof fetch

describe('fetchNextWant - event-driven WANTs', () => {
  it('returns the queued job', async () => {
    const next = await fetchNextWant('http://x/next', respond(200, { service: 'txline', arg: '18175397', note: 'odds moved 7%' }))
    expect(next).toEqual({ service: 'txline', arg: '18175397', note: 'odds moved 7%' })
  })

  it('returns null on an empty queue (204)', async () => {
    expect(await fetchNextWant('http://x/next', respond(204))).toBeNull()
  })

  it('returns null on a malformed job (no arg)', async () => {
    expect(await fetchNextWant('http://x/next', respond(200, { service: 'txline' }))).toBeNull()
    expect(await fetchNextWant('http://x/next', respond(200, { arg: '   ' }))).toBeNull()
  })

  it('returns null when the feed is down (never crashes the loop)', async () => {
    const boom = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    expect(await fetchNextWant('http://x/next', boom)).toBeNull()
  })
})
