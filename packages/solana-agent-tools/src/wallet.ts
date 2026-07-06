import { PublicKey, type Transaction, type VersionedTransaction } from '@solana/web3.js'
import type { ReadonlyWallet } from './types.js'

function failSigner(): never {
  throw new Error('read-only wallet: signing and sending are intentionally unavailable')
}

/**
 * Create a SAK-compatible wallet facade that exposes only a public key.
 *
 * Every signing method throws. Use this when an agent needs Solana context tools but should never
 * receive custody or transaction-submission authority.
 */
export function createReadOnlyWallet(publicKey: string | PublicKey): ReadonlyWallet {
  const pubkey = typeof publicKey === 'string' ? new PublicKey(publicKey) : publicKey
  return {
    publicKey: pubkey,
    async signTransaction<T extends Transaction | VersionedTransaction>(_transaction: T): Promise<T> {
      return failSigner()
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(_transactions: T[]): Promise<T[]> {
      return failSigner()
    },
    async signAndSendTransaction<T extends Transaction | VersionedTransaction>(
      _transaction: T,
    ): Promise<{ signature: string }> {
      return failSigner()
    },
    async signMessage(_message: Uint8Array): Promise<Uint8Array> {
      return failSigner()
    },
  }
}
