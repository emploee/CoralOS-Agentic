/**
 * Solana Pay primitives — the runtime's settlement pillar.
 *
 * Consolidated here so every agent shares one implementation instead of copy-pasting payment code
 * (the audit's duplication finding). All connections go through `solanaConnection()`, so the devnet
 * guard applies everywhere a payment moves.
 */
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import { encodeURL, validateTransfer } from '@solana/pay'
import BigNumber from 'bignumber.js'
import { solanaConnection } from './connection.js'

/** Return from {@link generatePaymentUrl}. */
export interface PaymentUrl {
  /** Full `solana:` URL encoding the transfer request (recipient, amount, reference). */
  url: string
  /**
   * Unique single-use **reference** public key (base58) binding this payment to one order. The buyer
   * writes it into the transfer as a read-only account; the seller verifies the payment carries it.
   * This makes a payment proof non-transferable — and it is the same key that seeds the escrow PDA.
   */
  reference: string
  /** Requested amount, in the token's human units (SOL, or the SPL token when `mint` is set). */
  amountSol: number
}

/**
 * Decode a base58 64-byte keypair from an env var (the `solana-keygen` format, base58-encoded).
 * Pure-BigInt decode so no `bs58` dependency is needed.
 */
export function loadKeypairB58(envVar: string): Keypair {
  const b58 = process.env[envVar]
  if (!b58) throw new Error(`${envVar} not set — generate with: solana-keygen new --no-bip39-passphrase`)
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let n = BigInt(0)
  for (const c of b58) {
    const idx = ALPHABET.indexOf(c)
    if (idx < 0) throw new Error('Invalid base58 character')
    n = n * BigInt(58) + BigInt(idx)
  }
  const hex = n.toString(16).padStart(128, '0')
  const bytes = new Uint8Array(64)
  for (let i = 0; i < 64; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return Keypair.fromSecretKey(bytes)
}

/**
 * A fresh, single-use Solana Pay-style reference key (base58) — the same non-transferability
 * binding {@link generatePaymentUrl} uses, exposed standalone for protocols (like x402) that need
 * the key without a full payment URL.
 */
export function generateReference(): string {
  return Keypair.generate().publicKey.toBase58()
}

/** Generate a Solana Pay transfer URL tagged with a fresh, single-use reference key. */
export function generatePaymentUrl(opts: {
  recipient: string
  amountSol: number
  label?: string
  message?: string
  /** SPL mint address — requests payment in that token instead of native SOL. */
  mint?: string
}): PaymentUrl {
  const reference = Keypair.generate().publicKey // unique per order — single-use binding
  const url = encodeURL({
    recipient: new PublicKey(opts.recipient),
    amount: new BigNumber(opts.amountSol),
    reference,
    label: opts.label ?? 'Agent Service',
    message: (opts.message ?? '').slice(0, 100),
    ...(opts.mint ? { splToken: new PublicKey(opts.mint) } : {}),
  })
  return { url: url.toString(), reference: reference.toBase58(), amountSol: opts.amountSol }
}

/**
 * Verify on-chain that `sig` transferred `amountSol` to `recipient` carrying `reference`. Binding to
 * the per-order reference is what makes the proof non-transferable. Pass `mint` to verify an SPL
 * token transfer instead of native SOL — `@solana/pay` reads the mint's decimals on-chain, so
 * `amountSol` stays in the token's human units (e.g. `5.5` USDC) either way. Returns `false` on any error.
 */
export async function verifyPayment(
  sig: string,
  opts: { recipient: string; amountSol: number; reference: string; mint?: string },
): Promise<boolean> {
  try {
    await validateTransfer(
      solanaConnection(),
      sig,
      {
        recipient: new PublicKey(opts.recipient),
        amount: new BigNumber(opts.amountSol),
        reference: new PublicKey(opts.reference),
        ...(opts.mint ? { splToken: new PublicKey(opts.mint) } : {}),
      },
      { commitment: 'confirmed' },
    )
    return true
  } catch {
    return false
  }
}

/**
 * Sign and send a SOL transfer to `recipient`, optionally tagging it with a Solana Pay `reference`
 * (read-only, non-signer account) so the seller can verify it on-chain. Budget-checked against
 * `maxSol`. Returns the confirmed signature.
 */
export async function signTransfer(
  keypair: Keypair,
  recipient: string,
  amountSol: number,
  opts: { reference?: string; maxSol?: number } = {},
): Promise<string> {
  if (amountSol <= 0) throw new Error('Invalid amount')
  if (opts.maxSol != null && amountSol > opts.maxSol) {
    throw new Error(`Amount ${amountSol} SOL exceeds budget ${opts.maxSol} SOL`)
  }
  const ix = SystemProgram.transfer({
    fromPubkey: keypair.publicKey,
    toPubkey: new PublicKey(recipient),
    lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
  })
  if (opts.reference) {
    ix.keys.push({ pubkey: new PublicKey(opts.reference), isSigner: false, isWritable: false })
  }
  const tx = new Transaction().add(ix)
  return sendAndConfirmTransaction(solanaConnection(), tx, [keypair], { commitment: 'confirmed' })
}
