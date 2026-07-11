/**
 * Privy server-wallet signer — the `WALLET_PROVIDER=privy` half of `resolveSigner` (./signer.ts).
 * Signs through Privy's hosted REST API instead of a local secret key, so an agent process never
 * holds a raw keypair (only an app id/secret that can be revoked centrally).
 *
 * Built against Privy's documented server-wallet RPC shape (POST `/v1/wallets/{id}/rpc`, HTTP Basic
 * Auth via app id/secret, a `privy-app-id` header). This has NOT been exercised against a live Privy
 * account in this repo — there is no Privy sandbox credential available to test with. Treat it as a
 * best-effort adapter to verify against your own Privy app (and re-check their current API reference)
 * before trusting it with funds. `privy-signer.test.ts` only asserts the request shape via a mocked
 * `fetch`, not a live round-trip.
 */
import { Transaction } from '@solana/web3.js'
import type { WalletSigner } from './signer.js'

export interface PrivySignerConfig {
  appId: string
  appSecret: string
  walletId: string
  /** Override for testing or a self-hosted proxy in front of Privy. */
  baseUrl?: string
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (!value) throw new Error(`WALLET_PROVIDER=privy needs ${name}`)
  return value
}

export function privySignerFromEnv(env: NodeJS.ProcessEnv = process.env): WalletSigner {
  return privySigner({
    appId: requireEnv(env, 'PRIVY_APP_ID'),
    appSecret: requireEnv(env, 'PRIVY_APP_SECRET'),
    walletId: requireEnv(env, 'PRIVY_WALLET_ID'),
    baseUrl: env.PRIVY_BASE_URL,
  })
}

export function privySigner(config: PrivySignerConfig): WalletSigner {
  const baseUrl = config.baseUrl ?? 'https://api.privy.io'
  const auth = Buffer.from(`${config.appId}:${config.appSecret}`).toString('base64')

  async function call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${baseUrl}/v1/wallets/${config.walletId}/rpc`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'privy-app-id': config.appId,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ method, params }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Privy ${method} failed: HTTP ${res.status} ${body.slice(0, 200)}`)
    }
    return res.json() as Promise<T>
  }

  return {
    async address() {
      const wallet = await call<{ address: string }>('get_wallet', {})
      return wallet.address
    },
    async signTransaction(tx: Transaction) {
      const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
      const result = await call<{ signed_transaction: string }>('sign_transaction', {
        transaction: serialized,
        encoding: 'base64',
      })
      return Transaction.from(Buffer.from(result.signed_transaction, 'base64'))
    },
  }
}
