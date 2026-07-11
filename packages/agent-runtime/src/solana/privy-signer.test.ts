import { describe, it, expect, vi, afterEach } from 'vitest'
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js'
import { privySigner, privySignerFromEnv } from './privy-signer.js'

/** The shape `privySigner` actually builds its `RequestInit` as — narrows past `HeadersInit`/`BodyInit`'s wider unions for assertions. */
interface PrivyRequestInit {
  method: string
  headers: Record<string, string>
  body: string
}
function reqInit(init: RequestInit | undefined): PrivyRequestInit {
  return init as unknown as PrivyRequestInit
}

function dummyTransaction(): Transaction {
  const feePayer = Keypair.generate().publicKey
  const tx = new Transaction()
  tx.add(SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: Keypair.generate().publicKey, lamports: 1 }))
  tx.feePayer = feePayer
  tx.recentBlockhash = Keypair.generate().publicKey.toBase58()
  return tx
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('privySigner — request shape (mocked fetch, no live Privy account)', () => {
  it('address() calls the wallet RPC endpoint with Basic auth and the app-id header', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ address: 'Fg6PaFpo...' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const signer = privySigner({ appId: 'app_1', appSecret: 'secret_1', walletId: 'wallet_1' })
    const address = await signer.address()

    expect(address).toBe('Fg6PaFpo...')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    const sent = reqInit(init)
    expect(url).toBe('https://api.privy.io/v1/wallets/wallet_1/rpc')
    expect(sent.method).toBe('POST')
    expect(sent.headers['privy-app-id']).toBe('app_1')
    expect(sent.headers['Authorization']).toBe(`Basic ${Buffer.from('app_1:secret_1').toString('base64')}`)
    expect(JSON.parse(sent.body).method).toBe('get_wallet')
  })

  it('signTransaction() posts the serialized transaction and returns the signed one', async () => {
    const tx = dummyTransaction()
    const signedBase64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ signed_transaction: signedBase64 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const signer = privySigner({ appId: 'app_1', appSecret: 'secret_1', walletId: 'wallet_1' })
    const signed = await signer.signTransaction(tx)

    expect(signed.feePayer?.equals(tx.feePayer!)).toBe(true)
    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(reqInit(init).body)
    expect(body.method).toBe('sign_transaction')
    expect(body.params.encoding).toBe('base64')
  })

  it('surfaces a clear error on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    const signer = privySigner({ appId: 'app_1', appSecret: 'secret_1', walletId: 'wallet_1' })
    await expect(signer.address()).rejects.toThrow(/Privy get_wallet failed: HTTP 401/)
  })

  it('respects a custom baseUrl override', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ address: 'x' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const signer = privySigner({ appId: 'a', appSecret: 's', walletId: 'w', baseUrl: 'https://proxy.internal' })
    await signer.address()
    expect(fetchMock.mock.calls[0][0]).toBe('https://proxy.internal/v1/wallets/w/rpc')
  })
})

describe('privySignerFromEnv', () => {
  it('throws naming the missing var when config is incomplete', () => {
    expect(() => privySignerFromEnv({})).toThrow(/PRIVY_APP_ID/)
    expect(() => privySignerFromEnv({ PRIVY_APP_ID: 'a' })).toThrow(/PRIVY_APP_SECRET/)
    expect(() => privySignerFromEnv({ PRIVY_APP_ID: 'a', PRIVY_APP_SECRET: 's' })).toThrow(/PRIVY_WALLET_ID/)
  })

  it('builds a signer from complete env', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ address: 'y' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const signer = privySignerFromEnv({ PRIVY_APP_ID: 'a', PRIVY_APP_SECRET: 's', PRIVY_WALLET_ID: 'w' })
    expect(await signer.address()).toBe('y')
  })
})
