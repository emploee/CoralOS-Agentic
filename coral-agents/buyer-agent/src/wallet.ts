import { envSigner, signAndSendTransfer, type WalletSigner } from '@pay/agent-runtime'

/**
 * The buyer's wallet, as a `WalletSigner` (see `agent-runtime/src/solana/signer.ts`) loaded from
 * `BUYER_KEYPAIR_B58`. Kept as a lazy singleton so importing this module doesn't require the env var
 * until a payment is actually attempted.
 */
let signer: WalletSigner | undefined
function buyerSigner(): WalletSigner {
  return (signer ??= envSigner('BUYER_KEYPAIR_B58'))
}

/** Return the buyer's public key in base58 format. */
export async function getBuyerPublicKey(): Promise<string> {
  return buyerSigner().address()
}

/**
 * Parse a `solana:` pay URL, verify the amount is within budget, and broadcast the transfer.
 * Returns the confirmed transaction signature.
 *
 * @param solanaPayUrl - A Solana Pay transfer URL (`solana:<recipient>?amount=X&reference=Y`).
 * @param maxSol       - Maximum SOL the buyer is authorised to spend per call.
 * @throws if the amount is invalid, exceeds `maxSol`, or the transaction fails.
 */
export async function payFromUrl(solanaPayUrl: string, maxSol: number): Promise<string> {
  const raw = solanaPayUrl.replace(/^solana:/, 'solana://')
  const url = new URL(raw)
  const recipient = url.hostname || url.pathname.replace(/^\/\//, '')
  const amountSol = parseFloat(url.searchParams.get('amount') ?? '0')
  const reference = url.searchParams.get('reference') ?? undefined

  // Validated here (not just inside signAndSendTransfer) so a bad amount/over-budget request never
  // needs BUYER_KEYPAIR_B58 to be set — `buyerSigner()` is an eager function-call argument below, so
  // it would otherwise resolve (and throw on a missing key) before signAndSendTransfer's own check runs.
  if (amountSol <= 0) throw new Error('Invalid amount in Solana Pay URL')
  if (amountSol > maxSol) throw new Error(`Amount ${amountSol} SOL exceeds budget ${maxSol} SOL`)

  const sig = await signAndSendTransfer(buyerSigner(), recipient, amountSol, { reference, maxAmount: maxSol })
  console.error(`[buyer-agent] paid ${amountSol} SOL -> ${recipient} sig=${sig}`)
  return sig
}

/**
 * Send a SOL transfer to `recipient`, optionally tagging it with a Solana Pay `reference` public
 * key so the seller can confirm the payment on-chain without parsing memos. Returns the confirmed
 * signature.
 *
 * This is the payment primitive the LLM buyer (`llm_buyer.ts`) uses to satisfy an HTTP 402
 * challenge, once its own code-enforced guard (`guard.ts`) has approved the recipient/reference/
 * budget — the LLM decides whether to pay, this function only executes an already-approved payment.
 *
 * @param recipient - Base58 recipient pubkey from the challenge.
 * @param amountSol - Amount from the challenge (already budget-checked by the caller).
 * @param reference - Optional base58 reference key from the challenge.
 */
export async function signTransfer(recipient: string, amountSol: number, reference?: string): Promise<string> {
  const sig = await signAndSendTransfer(buyerSigner(), recipient, amountSol, { reference })
  console.error(`[buyer-agent] paid ${amountSol} SOL -> ${recipient} ref=${reference ?? 'none'} sig=${sig}`)
  return sig
}
