import type {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js'
import type { Policy, PolicyDecision } from '@pay/agent-runtime'

/** Minimal read-only Solana connection surface this package needs. */
export interface ReadonlySolanaConnection {
  getBalance(pubkey: PublicKey): Promise<number>
  getParsedTokenAccountsByOwner(
    owner: PublicKey,
    filter: { programId: PublicKey },
  ): Promise<{
    value: Array<{
      pubkey: PublicKey
      account: { data: { parsed?: unknown } }
    }>
  }>
}

/** Dependencies and endpoint overrides for the allowlisted Solana tools. */
export interface SolanaAgentToolOptions {
  rpcUrl?: string
  connection?: ReadonlySolanaConnection
  fetch?: typeof fetch
  jupiterPriceBaseUrl?: string
  jupiterApiKey?: string
  pythHermesBaseUrl?: string
}

/** SOL balance read from the guarded devnet connection. */
export interface WalletBalance {
  address: string
  lamports: number
  sol: number
  cluster: 'devnet'
}

/** Parsed SPL token balance for an owner account. */
export interface TokenBalance {
  account: string
  mint: string
  owner: string
  amount: string
  decimals: number
  uiAmount: number | null
  uiAmountString: string
}

/** Read-only USD token price from Jupiter Price API V3. */
export interface TokenPrice {
  id: string
  usdPrice: number
  decimals?: number
  blockId?: number
  liquidity?: number
  priceChange24h?: number
  createdAt?: string
  provider: 'jupiter'
}

/** Read-only price update decoded from Pyth Hermes. */
export interface PythPrice {
  id: string
  price: number
  rawPrice: string
  confidence: number
  exponent: number
  publishTime: number
  provider: 'pyth-hermes'
}

/** Input for a policy-checked, non-executable SOL transfer intent. */
export interface TransferIntentInput {
  service: string
  buyer: string
  recipient: string
  amountSol: number
  round?: number
  reference?: string
  policy?: Policy
  awardedPriceSol?: number
  spentSol?: number
  lastDepositAt?: number
  now?: number
}

/** Instruction-shaped dry run that cannot be signed or broadcast by this package. */
export interface TransferIntentSimulation {
  kind: 'transfer-intent'
  executable: false
  cluster: 'devnet'
  service: string
  buyer: string
  recipient: string
  amountSol: number
  lamports: number
  reference?: string
  policyDecision: PolicyDecision
  reason: string
  instruction: {
    programId: string
    dataBase64: string
    keys: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>
  }
}

/** Wallet facade for SAK-style agents that need a public key but no signing authority. */
export interface ReadonlyWallet {
  readonly publicKey: PublicKey
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>
  signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]>
  signAndSendTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<{ signature: string }>
  signMessage(message: Uint8Array): Promise<Uint8Array>
}

/** Public tool table exposed to agents and the SAK-compatible plugin. */
export interface ReadonlySolanaAgentTools {
  readWalletBalance(address: string): Promise<WalletBalance>
  readTokenBalances(owner: string): Promise<TokenBalance[]>
  fetchTokenPrice(id: string): Promise<TokenPrice>
  fetchPythPrice(priceFeedId: string): Promise<PythPrice>
  simulateTransferIntent(input: TransferIntentInput): Promise<TransferIntentSimulation>
}
