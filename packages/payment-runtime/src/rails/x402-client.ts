/**
 * x402 client — the buyer side. `fetchWithX402` is the flagship entry point: fetch a resource,
 * transparently pay on `402`, retry, and verify the settlement response before trusting the body —
 * the same "model/caller proposes, deterministic code disposes" shape every other paid flow in
 * this repo uses, just over plain HTTP instead of a CoralOS thread.
 */
import { signTransferTransaction, verifyPayment as verifySolanaPay, type WalletSigner } from '@pay/agent-runtime'
import { assertApiProcurementAllowed } from '../policy/api-procurement-policy.js'
import type { AllowancePolicy } from '../policy/spend-policy.js'
import type { X402Accept, X402Challenge, X402PaymentPayload } from './x402-server.js'
import {
  money,
  requestId,
  type MarketOrder,
  type PaymentCurrency,
  type PaymentQuote,
  type PaymentQuoteInput,
  type PaymentRail,
  type PaymentRequest,
  type PaymentVerification,
} from '../types.js'

export interface X402ClientRailOptions {
  facilitatorUrl?: string
  network?: 'solana' | string
}

/** The generic `PaymentRail` shape, for callers that route x402 through `PaymentRailRouter` alongside other rails. */
export function x402ClientRail(opts: X402ClientRailOptions = {}): PaymentRail {
  return {
    kind: 'x402',
    async quote(input: PaymentQuoteInput): Promise<PaymentQuote> {
      return {
        rail: 'x402',
        service: input.service,
        amount: money(input.amount),
        currency: input.currency ?? 'USDC',
        buyer: input.buyer,
        ...(input.seller ? { seller: input.seller } : {}),
        metadata: input.metadata,
      }
    },
    async requestPayment(order: MarketOrder): Promise<PaymentRequest> {
      return {
        id: requestId('x402', order.id),
        rail: 'x402',
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
        buyer: order.buyer,
        seller: order.seller,
        headers: { 'X-PAYMENT-NETWORK': opts.network ?? 'solana' },
        metadata: { ...order.metadata, facilitatorUrl: opts.facilitatorUrl },
      }
    },
    async verifyPayment(request: PaymentRequest): Promise<PaymentVerification> {
      const proof = String(request.metadata?.paymentProof ?? request.metadata?.proof ?? '')
      return {
        paid: proof.length > 0,
        rail: 'x402',
        proof: proof || undefined,
        amount: request.amount,
        currency: request.currency,
        payer: request.buyer,
        recipient: request.seller,
        reason: proof ? undefined : 'missing x402 payment proof',
        metadata: request.metadata,
      }
    },
  }
}

/**
 * Pick an accept entry from a 402 challenge, sign (never submit) the matching transfer, and
 * base64-encode it as an `X-PAYMENT` header value. The merchant/facilitator submits it — see
 * `x402-server.ts`'s `settleX402`.
 */
export async function buildPaymentPayload(
  challenge: X402Challenge,
  signer: WalletSigner,
  select: (accepts: X402Accept[]) => X402Accept | undefined = (accepts) => accepts[0],
): Promise<{ header: string; accept: X402Accept }> {
  const accept = select(challenge.body.accepts)
  if (!accept) throw new Error('x402 challenge carries no acceptable payment option')

  const transaction = await signTransferTransaction(signer, accept.payTo, Number(accept.amount), {
    mint: accept.mint,
    reference: accept.reference,
    memo: `x402:${accept.resource}`.slice(0, 100),
  })
  const payload: X402PaymentPayload = { scheme: 'exact', network: accept.network, payload: { transaction, reference: accept.reference } }
  return { header: Buffer.from(JSON.stringify(payload)).toString('base64'), accept }
}

export interface FetchWithX402Opts {
  signer: WalletSigner
  policy: AllowancePolicy
  /** Which payment option to use if the challenge offers several. Defaults to the first. */
  select?: (accepts: X402Accept[]) => X402Accept | undefined
}

export class X402PaymentError extends Error {}

export interface X402Settlement {
  txSignature: string
  accept: X402Accept
}

export interface X402FetchResult {
  response: Response
  /** Present only if a 402 challenge was actually paid to get this response — absent for a free resource. */
  settlement?: X402Settlement
}

/**
 * Fetch a resource; if it answers `402`, pay and retry once. Verifies the settlement the server
 * reports in `X-PAYMENT-RESPONSE` against the same on-chain primitive `solana-pay` uses before
 * returning the body — a merchant claiming success in a header is not enough on its own.
 */
export async function fetchWithX402(url: string, init: RequestInit = {}, opts: FetchWithX402Opts): Promise<X402FetchResult> {
  const first = await fetch(url, init)
  if (first.status !== 402) return { response: first }

  const challenge = (await first.json()) as X402Challenge
  const accept = (opts.select ?? ((accepts: X402Accept[]) => accepts[0]))(challenge.body.accepts)
  if (!accept) throw new X402PaymentError('402 challenge carried no acceptable payment option')

  assertApiProcurementAllowed({ provider: accept.payTo, service: accept.resource, amount: Number(accept.amount), currency: accept.asset as PaymentCurrency }, opts.policy)

  const { header } = await buildPaymentPayload(challenge, opts.signer, opts.select)
  const retry = await fetch(url, { ...init, headers: { ...init.headers, 'X-PAYMENT': header } })

  const settlementHeader = retry.headers.get('X-PAYMENT-RESPONSE')
  if (!settlementHeader) throw new X402PaymentError('merchant did not return X-PAYMENT-RESPONSE after a paid retry')
  let settled: { txSignature?: string; settled?: boolean }
  try {
    settled = JSON.parse(Buffer.from(settlementHeader, 'base64').toString('utf8'))
  } catch {
    throw new X402PaymentError('X-PAYMENT-RESPONSE is not valid base64 JSON')
  }
  if (!settled.settled || !settled.txSignature) throw new X402PaymentError('merchant reported the payment as unsettled')

  const paid = await verifySolanaPay(settled.txSignature, {
    recipient: accept.payTo,
    amountSol: Number(accept.amount),
    reference: accept.reference,
    mint: accept.mint,
  })
  if (!paid) throw new X402PaymentError('X-PAYMENT-RESPONSE signature did not verify on-chain against the challenge terms')

  return { response: retry, settlement: { txSignature: settled.txSignature, accept } }
}

/**
 * Like `fetchWithX402`, but for a caller that specifically wants to *procure* a paid resource (e.g.
 * `procureUpstream` in `../procure.ts`) rather than opportunistically fetch something that might be
 * free. Throws if the resource doesn't actually require payment — a procurement leg with no
 * settlement to report is a bug in the caller's URL, not a valid "free resource" outcome.
 */
export async function payViaX402(url: string, init: RequestInit, opts: FetchWithX402Opts): Promise<Required<X402FetchResult>> {
  const result = await fetchWithX402(url, init, opts)
  if (!result.settlement) throw new X402PaymentError(`${url} did not require payment (no 402 challenge) — nothing to procure`)
  return result as Required<X402FetchResult>
}
