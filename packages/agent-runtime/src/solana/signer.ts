/**
 * WalletSigner — a provider-agnostic signing interface.
 *
 * `keypairSigner` wraps a local `Keypair` (the only concrete provider today, and every existing
 * caller of `signTransfer`/`loadKeypairB58` keeps working unchanged). The interface itself doesn't
 * assume a local secret key: a server-signable wallet provider (Privy — see `./privy-signer.ts`,
 * resolved via `resolveSigner`) is a `WalletSigner` implementation registered by env flag, not a
 * rewrite of every caller that signs. Mirrors the adapter-registry pattern in
 * `packages/harness-runtime/src/adapters/registry.ts`.
 *
 * Two send shapes, because x402 needs both halves separately (the client signs, the merchant
 * submits — never the other way, or a client could be tricked into broadcasting before deciding
 * to accept the resource):
 *   `signAndSendTransfer`     sign AND submit AND confirm — what `payout`/`spl-usdc` want.
 *   `signTransferTransaction` sign only, return the serialized tx — what an x402 client wants.
 *   `submitSignedTransaction` submit + confirm a transaction someone else already signed — what
 *                             an x402 merchant/facilitator wants, paired with a post-submit
 *                             `verifyPayment()` call so a submitted tx is never trusted just
 *                             because it landed; it must also prove it paid the right party.
 */
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getMint,
} from '@solana/spl-token'
import nacl from 'tweetnacl'
import { solanaConnection } from './connection.js'
import { loadKeypairB58 } from './pay.js'
import { privySignerFromEnv } from './privy-signer.js'

/** The well-known Solana Memo Program v2 id (same constant `@solana/pay` signs transfers with). */
const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')

export interface WalletSigner {
  /** The signer's public key, base58. */
  address(): Promise<string>
  /** Sign a transaction (already has feePayer + recentBlockhash set) and return it, signed. */
  signTransaction(tx: Transaction): Promise<Transaction>
  /** Sign an arbitrary message. Optional — not every provider/flow needs off-chain signatures. */
  signMessage?(message: Uint8Array): Promise<Uint8Array>
}

/** Wrap a local `Keypair` as a `WalletSigner`. */
export function keypairSigner(keypair: Keypair): WalletSigner {
  return {
    async address() {
      return keypair.publicKey.toBase58()
    },
    async signTransaction(tx: Transaction) {
      tx.partialSign(keypair)
      return tx
    },
    async signMessage(message: Uint8Array) {
      return nacl.sign.detached(message, keypair.secretKey)
    },
  }
}

/** Load a `WalletSigner` from an env var holding a base58 keypair secret (the `loadKeypairB58` shape). */
export function envSigner(envVar: string): WalletSigner {
  return keypairSigner(loadKeypairB58(envVar))
}

export type WalletProviderName = 'local' | 'privy'

/** Which `WalletSigner` provider `resolveSigner` will construct, from `WALLET_PROVIDER` (default `local`). */
export function walletProviderFromEnv(env: NodeJS.ProcessEnv = process.env): WalletProviderName {
  const raw = (env.WALLET_PROVIDER ?? 'local').toLowerCase()
  if (raw === 'local' || raw === 'privy') return raw
  throw new Error(`unknown WALLET_PROVIDER "${raw}" (known: local, privy)`)
}

/**
 * Resolve a `WalletSigner` by provider, mirroring the adapter-registry pattern in
 * `harness-runtime/src/adapters/registry.ts`. `local` (default) loads a keypair from
 * `keypairEnvVar`; `privy` signs through Privy's server-wallet REST API (`PRIVY_APP_ID`/
 * `PRIVY_APP_SECRET`/`PRIVY_WALLET_ID` — see `./privy-signer.ts`) so the process never holds a
 * raw secret key. The caller doesn't need to branch on provider — every `WalletSigner` consumer
 * (`signAndSendTransfer`, a `PaymentRail`, ...) is identical either way.
 *
 * `env` governs provider *selection* (`WALLET_PROVIDER`, and the `PRIVY_*` vars for that provider)
 * — the `local` path's actual secret always comes from real `process.env` via `envSigner`, matching
 * every other keypair-loading function in this codebase. Pass `env` in tests to control which
 * provider gets picked without needing a real Privy config; it can't be used to fake a local secret.
 */
export function resolveSigner(keypairEnvVar: string, env: NodeJS.ProcessEnv = process.env): WalletSigner {
  const provider = walletProviderFromEnv(env)
  return provider === 'local' ? envSigner(keypairEnvVar) : privySignerFromEnv(env)
}

export interface SignedTransferOpts {
  /** SPL mint address; omit for a native SOL transfer. */
  mint?: string
  /** Solana Pay reference key (read-only account) binding this transfer to one order/proof. */
  reference?: string
  /** Memo program instruction text. */
  memo?: string
  /** Hard cap enforced in code before signing — a policy check should also run before this is called. */
  maxAmount?: number
}

function checkAmount(amount: number, maxAmount: number | undefined): void {
  if (amount <= 0) throw new Error('Invalid amount')
  if (maxAmount != null && amount > maxAmount) throw new Error(`Amount ${amount} exceeds budget ${maxAmount}`)
}

/** Build the transfer instruction(s) — SOL via `SystemProgram`, or SPL via `transfer_checked` with
 * an idempotent ATA-create first (a recipient may never have held this token before). */
async function buildTransferInstructions(
  from: PublicKey,
  recipient: string,
  amount: number,
  opts: SignedTransferOpts,
): Promise<TransactionInstruction[]> {
  const to = new PublicKey(recipient)
  const instructions: TransactionInstruction[] = []

  if (opts.memo) {
    instructions.push(new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(opts.memo, 'utf8') }))
  }

  if (opts.mint) {
    const connection = solanaConnection()
    const mintKey = new PublicKey(opts.mint)
    const mintInfo = await getMint(connection, mintKey)
    const amountRaw = BigInt(Math.round(amount * 10 ** mintInfo.decimals))
    const fromAta = await getAssociatedTokenAddress(mintKey, from)
    const toAta = await getAssociatedTokenAddress(mintKey, to)
    // Idempotent: a no-op if the recipient's ATA already exists. The payer funds the rent for a
    // new one — the same "sender pays so the recipient doesn't need SOL first" shape a real payout needs.
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(from, toAta, to, mintKey))
    const transferIx = createTransferCheckedInstruction(fromAta, mintKey, toAta, from, amountRaw, mintInfo.decimals)
    if (opts.reference) transferIx.keys.push({ pubkey: new PublicKey(opts.reference), isSigner: false, isWritable: false })
    instructions.push(transferIx)
  } else {
    const ix = SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports: Math.round(amount * LAMPORTS_PER_SOL) })
    if (opts.reference) ix.keys.push({ pubkey: new PublicKey(opts.reference), isSigner: false, isWritable: false })
    instructions.push(ix)
  }
  return instructions
}

async function buildTransferTransaction(
  signer: WalletSigner,
  recipient: string,
  amount: number,
  opts: SignedTransferOpts,
): Promise<{ tx: Transaction; connection: ReturnType<typeof solanaConnection>; blockhash: string; lastValidBlockHeight: number }> {
  checkAmount(amount, opts.maxAmount)
  const connection = solanaConnection()
  const from = new PublicKey(await signer.address())
  const instructions = await buildTransferInstructions(from, recipient, amount, opts)
  const tx = new Transaction().add(...instructions)
  tx.feePayer = from
  const latest = await connection.getLatestBlockhash('confirmed')
  tx.recentBlockhash = latest.blockhash
  return { tx, connection, ...latest }
}

/**
 * Sign and send a SOL or SPL-token transfer through any `WalletSigner`. Returns the confirmed
 * signature. Throws (never signs or sends) if `amount` is non-positive or exceeds `opts.maxAmount`.
 */
export async function signAndSendTransfer(
  signer: WalletSigner,
  recipient: string,
  amount: number,
  opts: SignedTransferOpts = {},
): Promise<string> {
  const { tx, connection, blockhash, lastValidBlockHeight } = await buildTransferTransaction(signer, recipient, amount, opts)
  const signed = await signer.signTransaction(tx)
  const sig = await connection.sendRawTransaction(signed.serialize())
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed')
  return sig
}

/**
 * Sign a SOL or SPL-token transfer WITHOUT submitting it. Returns the signed transaction, base64
 * encoded, ready to hand to whoever will submit it (e.g. an x402 merchant/facilitator). The signer
 * decides to pay; the recipient decides when — and whether — to actually broadcast it.
 */
export async function signTransferTransaction(
  signer: WalletSigner,
  recipient: string,
  amount: number,
  opts: SignedTransferOpts = {},
): Promise<string> {
  const { tx } = await buildTransferTransaction(signer, recipient, amount, opts)
  const signed = await signer.signTransaction(tx)
  return signed.serialize().toString('base64')
}

/**
 * Submit + confirm a transaction someone else already signed (base64-encoded). Returns the
 * confirmed signature. Does NOT by itself prove the transaction paid anyone in particular — pair
 * this with `verifyPayment()` before treating the payment as settled.
 */
export async function submitSignedTransaction(serializedBase64: string): Promise<string> {
  const connection = solanaConnection()
  const raw = Buffer.from(serializedBase64, 'base64')
  const latest = await connection.getLatestBlockhash('confirmed')
  const sig = await connection.sendRawTransaction(raw)
  await connection.confirmTransaction({ signature: sig, ...latest }, 'confirmed')
  return sig
}
