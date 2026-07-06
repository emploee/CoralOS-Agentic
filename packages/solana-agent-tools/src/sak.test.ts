import { describe, expect, it } from 'vitest'
import { createReadonlySolanaPlugin } from './sak.js'
import { SOL_MINT, type ReadonlySolanaAgentTools } from './tools.js'

const tools: ReadonlySolanaAgentTools = {
  async readWalletBalance(address) {
    return { address, lamports: 1_000_000_000, sol: 1, cluster: 'devnet' }
  },
  async readTokenBalances() {
    return []
  },
  async fetchTokenPrice(id) {
    return { id: id === 'SOL' ? SOL_MINT : id, usdPrice: 100, provider: 'jupiter' }
  },
  async fetchPythPrice(priceFeedId) {
    return {
      id: priceFeedId,
      price: 1,
      rawPrice: '100000000',
      confidence: 0.01,
      exponent: -8,
      publishTime: 1,
      provider: 'pyth-hermes',
    }
  },
  async simulateTransferIntent(input) {
    return {
      kind: 'transfer-intent',
      executable: false,
      cluster: 'devnet',
      service: input.service,
      buyer: input.buyer,
      recipient: input.recipient,
      amountSol: input.amountSol,
      lamports: 1,
      policyDecision: { ok: true, violations: [] },
      reason: 'dry-run only',
      instruction: { programId: '11111111111111111111111111111111', dataBase64: '', keys: [] },
    }
  },
}

describe('createReadonlySolanaPlugin', () => {
  it('exposes only the allowlisted read/simulate methods and SAK-style actions', async () => {
    const plugin = createReadonlySolanaPlugin(tools)
    expect(plugin.name).toBe('pay-readonly-solana-tools')
    expect(Object.keys(plugin.methods).sort()).toEqual([
      'fetchPythPrice',
      'fetchTokenPrice',
      'readTokenBalances',
      'readWalletBalance',
      'simulateTransferIntent',
    ])
    expect(plugin.actions.map((a) => a.name)).toEqual([
      'solana.read_wallet_balance',
      'solana.read_token_balances',
      'solana.fetch_token_price',
      'solana.fetch_pyth_price',
      'solana.simulate_transfer_intent',
    ])
    expect(plugin.actions.some((a) => /swap|bridge|launch|transfer$/i.test(a.name))).toBe(false)
    await expect(plugin.actions[2].handler({}, { id: 'SOL' })).resolves.toMatchObject({ usdPrice: 100 })
  })
})
