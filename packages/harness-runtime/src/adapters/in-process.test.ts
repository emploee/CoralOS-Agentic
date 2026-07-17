import { describe, it, expect } from 'vitest'
import { sha256Hex } from '@pay/agent-runtime'
import { inProcessAdapter } from './in-process.js'
import { adapterFromEnv } from './registry.js'
import type { HarnessEvent, Order } from '../types.js'

const order: Order = { round: 1, service: 'txline', arg: '12345', priceSol: 0.0005 }

describe('in-process adapter', () => {
  it('delivers the service payload with a bound content hash', async () => {
    const adapter = inProcessAdapter(async (req) => JSON.stringify({ echo: req }))
    const d = await adapter.run(order)
    expect(d.payload).toBe('{"echo":"txline 12345"}')
    expect(d.sha256).toBe(sha256Hex(d.payload))
  })

  it('accepts a { payload } delivery result', async () => {
    const adapter = inProcessAdapter(async () => ({ payload: '{"ok":true}' }))
    const d = await adapter.run(order)
    expect(d.payload).toBe('{"ok":true}')
    expect(d.sha256).toBe(sha256Hex(d.payload))
  })

  it('streams start → delivered events', async () => {
    const events: HarnessEvent[] = []
    const adapter = inProcessAdapter(async () => 'ok')
    await adapter.run(order, (e) => events.push(e))
    expect(events.map((e) => e.kind)).toEqual(['start', 'delivered'])
    expect(events[0].text).toBe('txline 12345')
  })

  it('emits an error event and rethrows when the service fails', async () => {
    const events: HarnessEvent[] = []
    const adapter = inProcessAdapter(async () => { throw new Error('feed down') })
    await expect(adapter.run(order, (e) => events.push(e))).rejects.toThrow('feed down')
    expect(events.at(-1)).toMatchObject({ kind: 'error', text: 'feed down' })
  })
})

describe('adapterFromEnv', () => {
  it('defaults to in-process', () => {
    expect(adapterFromEnv(async () => 'x', {}).name).toBe('in-process')
  })

  it('rejects an unknown harness by name', () => {
    expect(() => adapterFromEnv(async () => 'x', { HARNESS: 'skynet' })).toThrow(/unknown HARNESS/)
  })
})
