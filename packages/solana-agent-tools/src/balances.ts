import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from './constants.js'
import { resolveConnection } from './connection.js'
import type { SolanaAgentToolOptions, TokenBalance, WalletBalance } from './types.js'

interface ParsedTokenAmount {
  mint?: string
  owner?: string
  amount?: string
  decimals?: number
  uiAmount?: number | null
  uiAmountString?: string
}

function tokenAmountInfo(parsed: unknown): ParsedTokenAmount | null {
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

/** Read a wallet's SOL balance through the repo's guarded devnet connection. */
export async function readWalletBalance(
  address: string,
  opts: SolanaAgentToolOptions = {},
): Promise<WalletBalance> {
  const pubkey = new PublicKey(address)
  const lamports = await resolveConnection(opts).getBalance(pubkey)
  return {
    address: pubkey.toBase58(),
    lamports,
    sol: lamports / LAMPORTS_PER_SOL,
    cluster: 'devnet',
  }
}

/** Read parsed SPL token balances for an owner without touching signing or transfer APIs. */
export async function readTokenBalances(
  owner: string,
  opts: SolanaAgentToolOptions = {},
): Promise<TokenBalance[]> {
  const ownerKey = new PublicKey(owner)
  const accounts = await resolveConnection(opts).getParsedTokenAccountsByOwner(ownerKey, {
    programId: TOKEN_PROGRAM_ID,
  })
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
}
