import { describe, expect, it, vi, afterEach } from 'vitest'
import { Keypair } from '@solana/web3.js'
import type { X402Accept, X402Challenge } from './x402-server.js'
import type { MarketOrder } from '../types.js'

// verifyPayment does a real RPC call; mock just that export, keep the rest of agent-runtime real
// (signTransferTransaction etc., used internally by buildPaymentPayload, needs no network access).
const { verifyPayment } = vi.hoisted(() => ({ verifyPayment: vi.fn() }))
vi.mock('@pay/agent-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@pay/agent-runtime')>()
  return { ...actual, verifyPayment }
})

const { keypairSigner } = await import('@pay/agent-runtime')
const { x402ClientRail, fetchWithX402, payViaX402, X402PaymentError } = await import('./x402-client.js')

afterEach(() => {
  vi.unstubAllGlobals()
  verifyPayment.mockReset()
})

describe('x402ClientRail (PaymentRail shape)', () => {
  it('quotes in USDC by default', async () => {
    const q = await x402ClientRail().quote({ service: 'edge-read', buyer: 'buyer-1', amount: 0.02 })
    expect(q).toMatchObject({ rail: 'x402', currency: 'USDC' })
  })

  it('requestPayment carries the network header', async () => {
    const order: MarketOrder = { id: 'o1', service: 'edge-read', buyer: 'buyer-1', seller: 'seller-1', amount: '0.02', currency: 'USDC' }
    const req = await x402ClientRail({ network: 'solana' }).requestPayment(order)
    expect(req.headers?.['X-PAYMENT-NETWORK']).toBe('solana')
  })

  it('verifyPayment fails closed with no proof', async () => {
    const v = await x402ClientRail().verifyPayment({ id: 'r1', rail: 'x402', orderId: 'o1', amount: '0.02', currency: 'USDC', buyer: 'buyer-1' })
    expect(v.paid).toBe(false)
  })
})

describe('fetchWithX402', () => {
  it('passes through a non-402 response untouched, without attempting payment', async () => {
    const okResponse = new Response('ok', { status: 200 })
    const fetchMock = vi.fn().mockResolvedValue(okResponse)
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchWithX402('https://example.test/resource', {}, {
      signer: { address: async () => 'signer-pubkey', signTransaction: async (tx) => tx },
      policy: {},
    })

    expect(result.response).toBe(okResponse)
    expect(result.settlement).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1) // no payment attempt — never called a second time
  })

  it('throws X402PaymentError when the 402 challenge carries no acceptable payment option', async () => {
    const challengeBody = JSON.stringify({ status: 402, headers: {}, body: { accepts: [] } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(challengeBody, { status: 402 })))

    await expect(
      fetchWithX402('https://example.test/resource', {}, {
        signer: { address: async () => 'signer-pubkey', signTransaction: async (tx) => tx },
        policy: {},
      }),
    ).rejects.toThrow(X402PaymentError)
  })

  it('returns settlement details (txSignature + accept) after a real paid retry', async () => {
    const signer = keypairSigner(Keypair.generate())
    const payTo = Keypair.generate().publicKey.toBase58()
    const accept: X402Accept = { network: 'solana', asset: 'SOL', amount: '0.001', payTo, resource: '/paid', reference: Keypair.generate().publicKey.toBase58() }
    const challenge: X402Challenge = { status: 402, headers: {}, body: { accepts: [accept] } }
    const txSignature = '5xK9mF3jQWXbT8h2Ndi4LVfVYzc3eeK6dNJj4tKD5vhqRq5aG3JYtJUTBrGxXjmVprJ8x2WgvNHKf9m6cLZmYQe1'
    const settlementHeader = Buffer.from(JSON.stringify({ settled: true, txSignature })).toString('base64')

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(challenge), { status: 402 }))
      .mockResolvedValueOnce(new Response('paid resource body', { status: 200, headers: { 'X-PAYMENT-RESPONSE': settlementHeader } }))
    vi.stubGlobal('fetch', fetchMock)
    verifyPayment.mockResolvedValue(true)

    const result = await fetchWithX402('https://example.test/resource', {}, { signer, policy: {} })

    expect(result.settlement).toEqual({ txSignature, accept })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('payViaX402', () => {
  it('throws if the resource never returned a 402 — nothing was actually procured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('free', { status: 200 })))
    const signer = keypairSigner(Keypair.generate())
    await expect(payViaX402('https://example.test/resource', {}, { signer, policy: {} })).rejects.toThrow(X402PaymentError)
  })

  it('returns the settlement directly (unwrapped) on success', async () => {
    const signer = keypairSigner(Keypair.generate())
    const payTo = Keypair.generate().publicKey.toBase58()
    const accept: X402Accept = { network: 'solana', asset: 'SOL', amount: '0.001', payTo, resource: '/paid', reference: Keypair.generate().publicKey.toBase58() }
    const challenge: X402Challenge = { status: 402, headers: {}, body: { accepts: [accept] } }
    const txSignature = '5xK9mF3jQWXbT8h2Ndi4LVfVYzc3eeK6dNJj4tKD5vhqRq5aG3JYtJUTBrGxXjmVprJ8x2WgvNHKf9m6cLZmYQe1'
    const settlementHeader = Buffer.from(JSON.stringify({ settled: true, txSignature })).toString('base64')

    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(challenge), { status: 402 }))
      .mockResolvedValueOnce(new Response('paid resource body', { status: 200, headers: { 'X-PAYMENT-RESPONSE': settlementHeader } })))
    verifyPayment.mockResolvedValue(true)

    const result = await payViaX402('https://example.test/resource', {}, { signer, policy: {} })
    expect(result.settlement.txSignature).toBe(txSignature)
    expect(await result.response.text()).toBe('paid resource body')
  })
})
