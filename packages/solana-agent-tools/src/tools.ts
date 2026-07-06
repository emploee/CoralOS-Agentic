import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
  type Transaction,
  type VersionedTransaction,
} from '@solana/web3.js'
import {
  DEVNET_RPC,
  enforce,
  solanaConnection,
  type Policy,
  type PolicyDecision,
} from '@pay/agent-runtime'

export const SOL_MINT = 'So11111111111111111111111111111111111111112'
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')

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

export interface SolanaAgentToolOptions {
  rpcUrl?: string
  connection?: ReadonlySolanaConnection
  fetch?: typeof fetch
  jupiterPriceBaseUrl?: string
  jupiterApiKey?: string
  pythHermesBaseUrl?: string
}

export interface WalletBalance {
  address: string
  lamports: number
  sol: number
  cluster: 'devnet'
}

export interface TokenBalance {
  account: string
  mint: string
  owner: string
  amount: string
  decimals: number
  uiAmount: number | null
  uiAmountString: string
}

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

export interface PythPrice {
  id: string
  price: number
  rawPrice: string
  confidence: number
  exponent: number
  publishTime: number
  provider: 'pyth-hermes'
}

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

export interface ReadonlyWallet {
  readonly publicKey: PublicKey
  signTransaction<T extends Transaction | VersionedTransaction>(transaction: T): Promise<T>
  signAllTransactions<T extends Transaction | VersionedTransaction>(transactions: T[]): Promise<T[]>
  signAndSendTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T,
  ): Promise<{ signature: string }>
  signMessage(message: Uint8Array): Promise<Uint8Array>
}

export interface ReadonlySolanaAgentTools {
  readWalletBalance(address: string): Promise<WalletBalance>
  readTokenBalances(owner: string): Promise<TokenBalance[]>
  fetchTokenPrice(id: string): Promise<TokenPrice>
  fetchPythPrice(priceFeedId: string): Promise<PythPrice>
  simulateTransferIntent(input: TransferIntentInput): Promise<TransferIntentSimulation>
}

function conn(opts: SolanaAgentToolOptions): ReadonlySolanaConnection {
  return opts.connection ?? solanaConnection(opts.rpcUrl ?? DEVNET_RPC)
}

function doFetch(opts: SolanaAgentToolOptions): typeof fetch {
  return opts.fetch ?? fetch
}

function aliasMint(id: string): string {
  const token = id.trim()
  if (/^sol$/i.test(token)) return SOL_MINT
  if (/^usdc$/i.test(token)) return USDC_MINT
  return token
}

function tokenAmountInfo(parsed: unknown): {
  mint?: string
  owner?: string
  amount?: string
  decimals?: number
  uiAmount?: number | null
  uiAmountString?: string
} | null {
  if (!parsed || typeof parsed !== 'object') return null
  const info = (parsed as { info?: unknown }).info
  if (!info || typeof info !== 'object') return null
  const tokenAmount = (info as { tokenAmount?: unknown }).tokenAmount
  if (!tokenAmount || typeof tokenAmount !== 'object') return null
  const t = tokenAmount as Record<string, unknown>
  return {
    mint: typeof (info as Record<string, unknown>).mint === 'string'
      ? String((info as Record<string, unknown>).mint)
      : undefined,
    owner: typeof (info as Record<string, unknown>).owner === 'string'
      ? String((info as Record<string, unknown>).owner)
      : undefined,
    amount: typeof t.amount === 'string' ? t.amount : undefined,
    decimals: typeof t.decimals === 'number' ? t.decimals : undefined,
    uiAmount: typeof t.uiAmount === 'number' || t.uiAmount === null ? t.uiAmount : undefined,
    uiAmountString: typeof t.uiAmountString === 'string' ? t.uiAmountString : undefined,
  }
}

function ixShape(ix: TransactionInstruction): TransferIntentSimulation['instruction'] {
  return {
    programId: ix.programId.toBase58(),
    dataBase64: Buffer.from(ix.data).toString('base64'),
    keys: ix.keys.map((k) => ({
      pubkey: k.pubkey.toBase58(),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
  }
}

function failSigner(): never {
  throw new Error('read-only wallet: signing and sending are intentionally unavailable')
}

export function createReadOnlyWallet(publicKey: string | PublicKey): ReadonlyWallet {
  const pubkey = typeof publicKey === 'string' ? new PublicKey(publicKey) : publicKey
  return {
    publicKey: pubkey,
    async signTransaction() { return failSigner() },
    async signAllTransactions() { return failSigner() },
    async signAndSendTransaction() { return failSigner() },
    async signMessage() { return failSigner() },
  }
}

export function createSolanaAgentTools(opts: SolanaAgentToolOptions = {}): ReadonlySolanaAgentTools {
  return {
    async readWalletBalance(address: string): Promise<WalletBalance> {
      const pubkey = new PublicKey(address)
      const lamports = await conn(opts).getBalance(pubkey)
      return {
        address: pubkey.toBase58(),
        lamports,
        sol: lamports / LAMPORTS_PER_SOL,
        cluster: 'devnet',
      }
    },

    async readTokenBalances(owner: string): Promise<TokenBalance[]> {
      const ownerKey = new PublicKey(owner)
      const accounts = await conn(opts).getParsedTokenAccountsByOwner(ownerKey, { programId: TOKEN_PROGRAM_ID })
      return accounts.value.flatMap((entry): TokenBalance[] => {
        const parsed = tokenAmountInfo(entry.account.data.parsed)
        if (!parsed?.mint || !parsed.amount || parsed.decimals == null || parsed.uiAmountString == null) return []
        return [{
          account: entry.pubkey.toBase58(),
          mint: parsed.mint,
          owner: parsed.owner ?? ownerKey.toBase58(),
          amount: parsed.amount,
          decimals: parsed.decimals,
          uiAmount: parsed.uiAmount ?? null,
          uiAmountString: parsed.uiAmountString,
        }]
      })
    },

    async fetchTokenPrice(id: string): Promise<TokenPrice> {
      const mint = aliasMint(id)
      const base = opts.jupiterPriceBaseUrl ?? 'https://api.jup.ag/price/v3'
      const url = new URL(base)
      url.searchParams.set('ids', mint)
      const headers: Record<string, string> = {}
      const apiKey = opts.jupiterApiKey ?? process.env.JUPITER_API_KEY
      if (apiKey) headers['x-api-key'] = apiKey
      const res = await doFetch(opts)(url, { headers })
      if (!res.ok) throw new Error(`Jupiter price ${res.status}: ${(await res.text()).slice(0, 160)}`)
      const body = await res.json() as Record<string, unknown>
      const item = body[mint]
      if (!item || typeof item !== 'object') throw new Error(`Jupiter price missing for ${mint}`)
      const o = item as Record<string, unknown>
      const usdPrice = Number(o.usdPrice)
      if (!Number.isFinite(usdPrice)) throw new Error(`Jupiter price for ${mint} has no numeric usdPrice`)
      return {
        id: mint,
        usdPrice,
        ...(typeof o.decimals === 'number' ? { decimals: o.decimals } : {}),
        ...(typeof o.blockId === 'number' ? { blockId: o.blockId } : {}),
        ...(typeof o.liquidity === 'number' ? { liquidity: o.liquidity } : {}),
        ...(typeof o.priceChange24h === 'number' ? { priceChange24h: o.priceChange24h } : {}),
        ...(typeof o.createdAt === 'string' ? { createdAt: o.createdAt } : {}),
        provider: 'jupiter',
      }
    },

    async fetchPythPrice(priceFeedId: string): Promise<PythPrice> {
      const id = priceFeedId.trim().replace(/^0x/i, '')
      if (!/^[0-9a-fA-F]{64}$/.test(id)) throw new Error('Pyth priceFeedId must be a 32-byte hex string')
      const base = opts.pythHermesBaseUrl ?? 'https://hermes.pyth.network/v2/updates/price/latest'
      const url = new URL(base)
      url.searchParams.append('ids[]', id)
      const res = await doFetch(opts)(url)
      if (!res.ok) throw new Error(`Pyth Hermes ${res.status}: ${(await res.text()).slice(0, 160)}`)
      const body = await res.json() as { parsed?: Array<{ id?: string; price?: Record<string, unknown> }> }
      const parsed = body.parsed?.find((p) => p.id?.replace(/^0x/i, '').toLowerCase() === id.toLowerCase())
      const price = parsed?.price
      if (!price) throw new Error(`Pyth price missing for ${id}`)
      const rawPrice = String(price.price ?? '')
      const exponent = Number(price.expo)
      const confidenceRaw = String(price.conf ?? '')
      const publishTime = Number(price.publish_time)
      const scaled = Number(rawPrice) * 10 ** exponent
      const confidence = Number(confidenceRaw) * 10 ** exponent
      if (!Number.isFinite(scaled) || !Number.isFinite(confidence) || !Number.isFinite(publishTime)) {
        throw new Error(`Pyth price for ${id} is malformed`)
      }
      return {
        id,
        price: scaled,
        rawPrice,
        confidence,
        exponent,
        publishTime,
        provider: 'pyth-hermes',
      }
    },

    async simulateTransferIntent(input: TransferIntentInput): Promise<TransferIntentSimulation> {
      if (input.amountSol <= 0) throw new Error('amountSol must be positive')
      const buyer = new PublicKey(input.buyer)
      const recipient = new PublicKey(input.recipient)
      const lamports = Math.round(input.amountSol * LAMPORTS_PER_SOL)
      const policyDecision = input.policy
        ? enforce({
            kind: 'deposit',
            round: input.round ?? 0,
            service: input.service,
            amountSol: input.amountSol,
            payout: recipient.toBase58(),
            ...(input.awardedPriceSol != null ? { awardedPriceSol: input.awardedPriceSol } : {}),
            ...(input.spentSol != null ? { spentSol: input.spentSol } : {}),
            ...(input.lastDepositAt != null ? { lastDepositAt: input.lastDepositAt } : {}),
            ...(input.now != null ? { now: input.now } : {}),
          }, input.policy)
        : { ok: true, violations: [] }
      const ix = SystemProgram.transfer({
        fromPubkey: buyer,
        toPubkey: recipient,
        lamports,
      })
      if (input.reference) ix.keys.push({ pubkey: new PublicKey(input.reference), isSigner: false, isWritable: false })
      return {
        kind: 'transfer-intent',
        executable: false,
        cluster: 'devnet',
        service: input.service,
        buyer: buyer.toBase58(),
        recipient: recipient.toBase58(),
        amountSol: input.amountSol,
        lamports,
        ...(input.reference ? { reference: input.reference } : {}),
        policyDecision,
        reason: policyDecision.ok
          ? 'dry-run only: no signature requested and no transaction broadcast'
          : `blocked by policy: ${policyDecision.violations.join('; ')}`,
        instruction: ixShape(ix),
      }
    },
  }
}
