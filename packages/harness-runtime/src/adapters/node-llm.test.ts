import { describe, it, expect } from 'vitest'
import { sha256Hex } from '@pay/agent-runtime'
import { nodeLlmAdapter } from './node-llm.js'
import { adapterFromEnv } from './registry.js'
import type { HarnessEvent, Order } from '../types.js'

const order: Order = { round: 1, service: 'txline', arg: '12345', priceSol: 0.0005 }

describe('node-llm adapter', () => {
  it('delivers the service payload with a bound content hash', async () => {
    const adapter = nodeLlmAdapter(async (req) => JSON.stringify({ echo: req }))
    const d = await adapter.run(order)
    expect(d.payload).toBe('{"echo":"txline 12345"}')
    expect(d.sha256).toBe(sha256Hex(d.payload))
  })

  it('streams start → delivered events', async () => {
    const events: HarnessEvent[] = []
    const adapter = nodeLlmAdapter(async () => 'ok')
    await adapter.run(order, (e) => events.push(e))
    expect(events.map((e) => e.kind)).toEqual(['start', 'delivered'])
    expect(events[0].text).toBe('txline 12345')
  })

  it('emits an error event and rethrows when the service fails', async () => {
    const events: HarnessEvent[] = []
    const adapter = nodeLlmAdapter(async () => { throw new Error('feed down') })
    await expect(adapter.run(order, (e) => events.push(e))).rejects.toThrow('feed down')
    expect(events.at(-1)).toMatchObject({ kind: 'error', text: 'feed down' })
  })
})

describe('adapterFromEnv', () => {
  it('defaults to node-llm', () => {
    expect(adapterFromEnv(async () => 'x', {}).name).toBe('node-llm')
  })

  it('rejects an unknown harness by name', () => {
    expect(() => adapterFromEnv(async () => 'x', { HARNESS: 'skynet' })).toThrow(/unknown HARNESS/)
  })
})
