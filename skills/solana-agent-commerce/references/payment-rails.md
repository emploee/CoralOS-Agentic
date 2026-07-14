# Payment Rails

Payment rail code lives in `packages/payment-runtime`.

Implement the `PaymentRail` interface from `src/types.ts`:

- `quote`
- `requestPayment`
- `verifyPayment`
- optional `release`
- optional `refund`

Rail selection belongs in `src/rail-router.ts`.

Three rails, deliberately — they solve different problems, not overlapping ones:

- `solana-pay`: human checkout and simple one-off digital goods; also the direct-transfer primitive escrow's vault funding and x402's settlement leg build on.
- `escrow`: disputed or verifier-gated work — money is locked in a program-owned PDA until release/refund conditions are met. This is the CoralOS round's core lifecycle.
- `x402`: cheap, instant, per-call HTTP API payments — money moves immediately, no dispute window. Used for `coral-agents/seller-agent`'s real upstream-procurement leg (`PROCURE_RAIL=x402`), not just a standalone demo.

spl-usdc, allowance, embedded-wallet, payout, and pay-sh were removed — they either had no production consumer, were redundant with what escrow/x402 already provide, or (pay-sh) were replaced outright with a real x402 implementation rather than kept as a permanent scaffold.

New rails should return a normalized `PaymentVerification` with `paid`, `rail`, `proof`, optional `txSignature`, `amount`, and `currency`.

## Consuming a rail

All chain operations route through `@pay/agent-runtime`'s `WalletSigner` (`keypairSigner`/`envSigner`) —
a rail never imports `@solana/web3.js` for signing directly. Pick a signer, build the rail, call it:

```ts
import { envSigner } from '@pay/agent-runtime'
import { solanaPayRail, escrowRail, x402ClientRail, fetchWithX402, payViaX402 } from '@pay/payment-runtime'

// Solana Pay — a reference-bound checkout URL, verified on-chain.
const pay = solanaPayRail({ recipient: sellerPubkey })
const request = await pay.requestPayment(order)

// Escrow — PaymentRail wrapper for the SOL flow (see examples/txodds/escrow for the client that
// actually drives the deployed Anchor program; this wrapper is the protocol-shaped view of it).
const escrow = escrowRail({ arbiter: arbiterPubkey })

// x402 — client signs a challenge but doesn't submit; the merchant submits and settles.
const { response } = await fetchWithX402(
  'https://example.com/paid-resource', {},
  { signer: envSigner('BUYER_KEYPAIR_B58'), policy: { maxPerCall: 0.05 } },
)

// payViaX402 — for a caller that specifically wants to *procure* a paid resource (throws if the
// resource turns out to be free — see procure.ts's procureUpstream, seller-agent's real use case).
const { response: body, settlement } = await payViaX402(
  'http://host.docker.internal:8801/api/edge-x402', {},
  { signer: envSigner('SELLER_KEYPAIR_B58'), policy: {} },
)
```

`x402ClientRail`/`buildPaymentPayload` are the lower-level primitives `fetchWithX402` is built on, for
callers that need to inspect or hold a signed-but-unsubmitted payload before deciding to retry.

## See also

- `references/escrow-idl.md` — the on-chain program `escrowRail` wraps, and the `direct`/`arbiter` settlement-mode split.
- `references/market-protocol.md` — the `PAYMENT_REQUIRED`/`PAYMENT_PROOF`/`PAYMENT_CONFIRMED` messages `procureUpstream()` posts for the x402 leg, and how they differ from the core round's `ESCROW_REQUIRED`/`DEPOSITED`.
