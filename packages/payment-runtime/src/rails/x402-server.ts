/**
 * x402 server — the merchant side. Mints a reference-bound challenge, then settles a submitted
 * `X-PAYMENT` payload either directly (this file, submit + confirm + verify on-chain) or via a
 * facilitator (`X402_FACILITATOR_URL`, the Coinbase-style `/verify` + `/settle` round trip).
 *
 * The client SIGNS but does not submit (see `x402-client.ts`'s `buildPaymentPayload`) — only the
 * merchant decides whether/when to broadcast, so a client is never tricked into paying for a
 * resource it won't actually receive. A submitted transaction is never trusted just because it
 * landed on-chain: `settleX402` always re-verifies recipient/amount/reference through the same
 * `verifyPayment()` primitive `solana-pay` and `payout` use before reporting `settled: true`.
 */
import { generateReference, submitSignedTransaction, verifyPayment as verifySolanaPay } from '@pay/agent-runtime'
import type { MarketOrder, PaymentRequest } from '../types.js'
import { x402ClientRail, type X402ClientRailOptions } from './x402-client.js'

export interface X402Accept {
  network: string
  asset: string
  amount: string
  payTo: string
  resource: string
  /** Solana Pay-style reference key (read-only account) — the same non-transferability binding solana-pay uses. */
  reference: string
  /** SPL mint address when `asset` is a token; omitted for native SOL. */
  mint?: string
}

export interface X402Challenge {
  status: 402
  headers: Record<string, string>
  body: {
    accepts: X402Accept[]
  }
}

export function x402ServerRail(opts: X402ClientRailOptions = {}) {
  return x402ClientRail(opts)
}

/** Mint a 402 challenge with a fresh, single-use reference key bound to `resource`. */
export function x402Challenge(order: MarketOrder, request: PaymentRequest, resource: string, opts: { mint?: string } = {}): X402Challenge {
  if (!order.seller) throw new Error('x402 challenge requires a recipient (order.seller)')
  return {
    status: 402,
    headers: { 'Content-Type': 'application/json', 'X-PAYMENT-RAIL': 'x402' },
    body: {
      accepts: [{
        network: String(request.headers?.['X-PAYMENT-NETWORK'] ?? 'solana'),
        asset: order.currency,
        amount: order.amount,
        payTo: order.seller,
        resource,
        reference: generateReference(),
        ...(opts.mint ? { mint: opts.mint } : {}),
      }],
    },
  }
}

/** The `X-PAYMENT` header's decoded shape — mirrors what `buildPaymentPayload` (x402-client.ts) produces. */
export interface X402PaymentPayload {
  scheme: 'exact'
  network: string
  payload: {
    /** Base64-encoded, signed-but-unsubmitted transaction. */
    transaction: string
    reference: string
  }
}

export interface X402SettleResult {
  settled: boolean
  txSignature?: string
  reason?: string
}

function decodePayload(header: string): X402PaymentPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Partial<X402PaymentPayload>
    if (parsed.scheme !== 'exact' || typeof parsed.payload?.transaction !== 'string' || typeof parsed.payload.reference !== 'string') return null
    return parsed as X402PaymentPayload
  } catch {
    return null
  }
}

/**
 * Settle an `X-PAYMENT` header against the `expected` accept entry from the challenge that
 * produced it. Submits the signed transaction, confirms it, then re-verifies on-chain that it
 * actually paid `expected.payTo` the `expected.amount` carrying `expected.reference` — the
 * settlement is never trusted on submission success alone.
 *
 * Routes through `X402_FACILITATOR_URL` (POST `/verify` then `/settle`) when set, matching the
 * Coinbase x402 facilitator shape; otherwise settles directly against `solanaConnection()`.
 */
export async function settleX402(header: string, expected: X402Accept): Promise<X402SettleResult> {
  const payload = decodePayload(header)
  if (!payload) return { settled: false, reason: 'X-PAYMENT header is not a valid base64-encoded payment payload' }
  if (payload.payload.reference !== expected.reference) {
    return { settled: false, reason: 'payment reference does not match the challenge' }
  }

  const facilitatorUrl = process.env.X402_FACILITATOR_URL
  return facilitatorUrl ? settleViaFacilitator(facilitatorUrl, header, expected) : settleDirect(payload, expected)
}

async function settleDirect(payload: X402PaymentPayload, expected: X402Accept): Promise<X402SettleResult> {
  let sig: string
  try {
    sig = await submitSignedTransaction(payload.payload.transaction)
  } catch (e) {
    return { settled: false, reason: `submit failed: ${(e as Error).message}` }
  }

  const paid = await verifySolanaPay(sig, {
    recipient: expected.payTo,
    amountSol: Number(expected.amount),
    reference: expected.reference,
    mint: expected.mint,
  })
  if (!paid) return { settled: false, txSignature: sig, reason: 'submitted transaction did not verify against the challenge terms' }
  return { settled: true, txSignature: sig }
}

interface FacilitatorResponse {
  success?: boolean
  isValid?: boolean
  txHash?: string
  transaction?: string
  error?: string
  errorReason?: string
}

async function settleViaFacilitator(facilitatorUrl: string, header: string, expected: X402Accept): Promise<X402SettleResult> {
  const body = { x402Version: 1, paymentHeader: header, paymentRequirements: expected }
  try {
    const verifyRes = await fetch(`${facilitatorUrl}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const verifyBody = (await verifyRes.json()) as FacilitatorResponse
    if (!verifyRes.ok || verifyBody.isValid === false) {
      return { settled: false, reason: verifyBody.error ?? verifyBody.errorReason ?? `facilitator /verify rejected: HTTP ${verifyRes.status}` }
    }

    const settleRes = await fetch(`${facilitatorUrl}/settle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const settleBody = (await settleRes.json()) as FacilitatorResponse
    if (!settleRes.ok || settleBody.success === false) {
      return { settled: false, reason: settleBody.error ?? settleBody.errorReason ?? `facilitator /settle rejected: HTTP ${settleRes.status}` }
    }
    return { settled: true, txSignature: settleBody.txHash ?? settleBody.transaction }
  } catch (e) {
    return { settled: false, reason: `facilitator request failed: ${(e as Error).message}` }
  }
}
