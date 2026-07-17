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

- `x402`: cheap, instant, per-call payments — money moves immediately, no dispute window. **This is the CoralOS round's core settlement** (buyer pays seller, direct and final, before delivery — see `references/market-protocol.md`), and also `coral-agents/seller-agent`'s optional upstream-procurement leg (`PROCURE_RAIL=x402`).
- `solana-pay`: human checkout and simple one-off digital goods; also the direct-transfer primitive x402's settlement leg builds on (`signTransferTransaction`/`verifyPayment`).
- `escrow`: disputed or verifier-gated work — money is locked in a program-owned PDA until release/refund conditions are met. Deployed and available as a building block; the CoralOS round does not use it by default (x402 does instead).

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

- `references/escrow-idl.md` — the on-chain program `escrowRail` wraps; deployed but not used by the default coral-agents flow.
- `references/market-protocol.md` — the `PAYMENT_REQUIRED`/`PAYMENT_PROOF`/`PAYMENT_CONFIRMED` messages, and how the round's primary settlement leg and the seller's optional procurement leg share the same message types but different references.
