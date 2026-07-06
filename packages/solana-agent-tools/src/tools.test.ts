import { PublicKey } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'
import {
  SOL_MINT,
  TOKEN_PROGRAM_ID,
  createReadOnlyWallet,
  createSolanaAgentTools,
} from './tools.js'

const owner = '11111111111111111111111111111111'
const tokenAccount = 'So11111111111111111111111111111111111111112'
const pythId = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'

function response(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

describe('solana-agent-tools', () => {
  it('reads wallet and token balances through an injected read-only connection', async () => {
    const tools = createSolanaAgentTools({
      connection: {
        async getBalance(pubkey) {
          expect(pubkey.toBase58()).toBe(owner)
          return 2_500_000_000
        },
        async getParsedTokenAccountsByOwner(pubkey, filter) {
          expect(pubkey.toBase58()).toBe(owner)
          expect(filter.programId.toBase58()).toBe(TOKEN_PROGRAM_ID.toBase58())
          return {
            value: [{
              pubkey: new PublicKey(tokenAccount),
              account: {
                data: {
                  parsed: {
                    info: {
                      mint: SOL_MINT,
                      owner,
                      tokenAmount: {
                        amount: '42',
                        decimals: 9,
                        uiAmount: 0.000000042,
                        uiAmountString: '0.000000042',
                      },
                    },
                  },
                },
              },
            }],
          }
        },
      },
    })

    await expect(tools.readWalletBalance(owner)).resolves.toMatchObject({ sol: 2.5, lamports: 2_500_000_000 })
    await expect(tools.readTokenBalances(owner)).resolves.toEqual([{
      account: tokenAccount,
      mint: SOL_MINT,
      owner,
      amount: '42',
      decimals: 9,
      uiAmount: 0.000000042,
      uiAmountString: '0.000000042',
    }])
  })

  it('fetches Jupiter and Pyth prices through injected fetch', async () => {
    const seen: string[] = []
    const tools = createSolanaAgentTools({
      fetch: (async (url: URL | RequestInfo) => {
        const href = String(url)
        seen.push(href)
        if (href.includes('price/v3')) {
          return response({ [SOL_MINT]: { usdPrice: 123.45, decimals: 9, blockId: 9 } })
        }
        return response({
          parsed: [{
            id: pythId,
            price: { price: '12345000000', conf: '1000000', expo: -8, publish_time: 1710000000 },
          }],
        })
      }) as typeof fetch,
    })

    await expect(tools.fetchTokenPrice('SOL')).resolves.toMatchObject({
      id: SOL_MINT,
      usdPrice: 123.45,
      provider: 'jupiter',
    })
    await expect(tools.fetchPythPrice(pythId)).resolves.toMatchObject({
      id: pythId,
      price: 123.45,
      confidence: 0.01,
      provider: 'pyth-hermes',
    })
    expect(seen.some((u) => u.includes('ids='))).toBe(true)
    expect(seen.some((u) => u.includes('ids%5B%5D='))).toBe(true)
  })

  it('dry-runs transfer intents through the repo policy gate without executable authority', async () => {
    const tools = createSolanaAgentTools()
    const intent = await tools.simulateTransferIntent({
      service: 'risk.policy',
      buyer: owner,
      recipient: owner,
      amountSol: 0.002,
      policy: {
        maxSolPerRound: 0.001,
        allowedServices: ['txline.edge'],
        expectedPayout: owner,
      },
    })
    expect(intent.executable).toBe(false)
    expect(intent.policyDecision.ok).toBe(false)
    expect(intent.policyDecision.violations.join('\n')).toContain('spend-cap-round')
    expect(intent.policyDecision.violations.join('\n')).toContain('service-allowlist')
    expect(intent.reason).toContain('blocked by policy')
  })

  it('provides a wallet object that refuses signing', async () => {
    const wallet = createReadOnlyWallet(owner)
    expect(wallet.publicKey.toBase58()).toBe(owner)
    await expect(wallet.signMessage(new Uint8Array([1]))).rejects.toThrow(/read-only wallet/)
  })
})
