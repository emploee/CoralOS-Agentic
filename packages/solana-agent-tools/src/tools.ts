import { readTokenBalances, readWalletBalance } from './balances.js'
import { fetchPythPrice, fetchTokenPrice } from './prices.js'
import { simulateTransferIntent } from './intent.js'
import type { ReadonlySolanaAgentTools, SolanaAgentToolOptions } from './types.js'

export * from './constants.js'
export * from './types.js'
export * from './connection.js'
export * from './wallet.js'
export * from './balances.js'
export * from './prices.js'
export * from './intent.js'

/**
 * Compose the allowlisted Solana tools with shared dependency injection.
 *
 * The returned table is intentionally read-only plus dry-run intent simulation. It has no signing,
 * swap, bridge, mint, token-launch, or live-transfer method.
 */
export function createSolanaAgentTools(opts: SolanaAgentToolOptions = {}): ReadonlySolanaAgentTools {
  return {
    readWalletBalance: (address) => readWalletBalance(address, opts),
    readTokenBalances: (owner) => readTokenBalances(owner, opts),
    fetchTokenPrice: (id) => fetchTokenPrice(id, opts),
    fetchPythPrice: (priceFeedId) => fetchPythPrice(priceFeedId, opts),
    simulateTransferIntent,
  }
}
