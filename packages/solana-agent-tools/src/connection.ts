import { DEVNET_RPC, solanaConnection } from '@pay/agent-runtime'
import type { ReadonlySolanaConnection, SolanaAgentToolOptions } from './types.js'

/** Resolve the guarded devnet connection unless a test/example injects a read-only connection. */
export function resolveConnection(opts: SolanaAgentToolOptions): ReadonlySolanaConnection {
  return opts.connection ?? solanaConnection(opts.rpcUrl ?? DEVNET_RPC)
}

/** Resolve the fetch implementation, letting tests and examples mock external price providers. */
export function resolveFetch(opts: SolanaAgentToolOptions): typeof fetch {
  return opts.fetch ?? fetch
}
