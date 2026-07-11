import { describe, expect, it } from 'vitest'
import { x402Challenge, settleX402, type X402Accept, type X402PaymentPayload } from './x402-server.js'
import type { MarketOrder, PaymentRequest } from '../types.js'

const order = (over: Partial<MarketOrder> = {}): MarketOrder => ({
  id: 'order-1',
  service: 'edge-read',
  buyer: 'buyer-1',
  seller: 'seller-1',
  amount: '0.02',
  currency: 'USDC',
  ...over,
})

const request: PaymentRequest = {
  id: 'req-1', rail: 'x402', orderId: 'order-1', amount: '0.02', currency: 'USDC', buyer: 'buyer-1',
  headers: { 'X-PAYMENT-NETWORK': 'solana' },
}

describe('x402Challenge', () => {
  it('mints a 402 body with a fresh, single-use reference', () => {
    const a = x402Challenge(order(), request, '/api/edge?fixtureId=1')
    const b = x402Challenge(order(), request, '/api/edge?fixtureId=1')
    expect(a.status).toBe(402)
    expect(a.body.accepts[0]).toMatchObject({ payTo: 'seller-1', amount: '0.02', asset: 'USDC', resource: '/api/edge?fixtureId=1' })
    expect(a.body.accepts[0].reference).not.toBe(b.body.accepts[0].reference)
  })

  it('carries the mint when the resource is priced in an SPL token', () => {
    const c = x402Challenge(order(), request, '/api/edge', { mint: 'MintAddr' })
    expect(c.body.accepts[0].mint).toBe('MintAddr')
  })

  it('throws without a recipient — never challenges for a payment with nowhere to land', () => {
    expect(() => x402Challenge(order({ seller: undefined }), request, '/api/edge')).toThrow(/recipient/)
  })
})

describe('settleX402 — fails closed before touching the network', () => {
  const accept: X402Accept = { network: 'solana', asset: 'USDC', amount: '0.02', payTo: 'seller-1', resource: '/api/edge', reference: 'RefKey1' }

  it('rejects a header that is not valid base64 JSON', async () => {
    const result = await settleX402('not-base64-json', accept)
    expect(result.settled).toBe(false)
    expect(result.reason).toContain('valid base64')
  })

  it('rejects a payload missing the expected fields', async () => {
    const bad = Buffer.from(JSON.stringify({ scheme: 'exact' })).toString('base64')
    const result = await settleX402(bad, accept)
    expect(result.settled).toBe(false)
  })

  it('rejects a payload whose reference does not match the challenge', async () => {
    const payload: X402PaymentPayload = { scheme: 'exact', network: 'solana', payload: { transaction: 'deadbeef', reference: 'SomeOtherRef' } }
    const header = Buffer.from(JSON.stringify(payload)).toString('base64')
    const result = await settleX402(header, accept)
    expect(result.settled).toBe(false)
    expect(result.reason).toContain('reference does not match')
  })
})
