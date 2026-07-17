# Payment Protocol

Three Solana-based payment rails, each solving a different problem. All devnet by default.

## Rails

| Rail | Purpose | Used in |
|---|---|---|
| **x402** | Direct, final, pay-before-delivery. | Buyer→seller leg of every CoralOS round (the default), and the seller's optional upstream procurement leg. |
| **Solana Pay** | Direct, reference-bound transfer. | Primitive x402 builds on; also usable standalone. |
| **Escrow** | Dispute-resistant, delayed-delivery settlement. | Deployed and available as a building block; not used by the default coral-agents flow. |

## PaymentRail Interface

`packages/payment-runtime` exposes one interface for all three:

```ts
import type { PaymentRail, PaymentRailKind, MarketOrder } from '@pay/payment-runtime'

interface PaymentRail {
  kind: PaymentRailKind                                          // 'x402' | 'solana-pay' | 'escrow'
  quote(input: PaymentQuoteInput): Promise<PaymentQuote>
  requestPayment(order: MarketOrder): Promise<PaymentRequest>
  verifyPayment(request: PaymentRequest): Promise<PaymentVerification>
  release?(order: MarketOrder): Promise<SettlementResult>
  refund?(order: MarketOrder): Promise<SettlementResult>
}
```

## x402 — Primary Settlement (buyer ↔ seller)

`coral-agents/buyer-agent` and `seller-agent` settle every round directly over x402, using the same
sign → submit → verify primitives (`@pay/agent-runtime`'s `solana/signer.ts` and `solana/pay.ts`) the
HTTP reference merchant below uses — just wired over CoralOS market messages instead of raw HTTP.
**Payment is direct and final, before delivery: there is no escrow, and no refund path.** A seller
that takes payment and never delivers keeps it; reputation (`ledger/reputation.ts`) is the only
defense, not a fund guarantee.

```text
AWARD -> PAYMENT_REQUIRED (seller mints a reference) -> PAYMENT_PROOF (buyer signs, doesn't submit)
       -> PAYMENT_CONFIRMED (seller submits + verifies on-chain) -> DELIVERED -> SETTLED
```

Seller, on `AWARD` (`seller-agent/src/index.ts`):

```ts
import { generateReference, formatPaymentRequired } from '@pay/agent-runtime'

const reference = generateReference()
await ctx.reply(mention, formatPaymentRequired({
  round, rail: 'x402', amount: String(priceSol), currency: 'SOL', reference, seller: SELLER_WALLET,
}))
```

Buyer, on `PAYMENT_REQUIRED` (`buyer-agent/src/index.ts`) — policy runs BEFORE signing, since there's
no later release step left to gate:

```ts
import { enforce, keypairSigner, signTransferTransaction, formatPaymentProof } from '@pay/agent-runtime'

const decision = enforce({ kind: 'payment', round, service, amountSol, payout: terms.seller, ... }, policy)
if (!decision.ok) throw new Error(decision.violations.join('; '))

// Signed, NOT submitted - the seller (merchant) decides whether/when to broadcast.
const proof = await signTransferTransaction(keypairSigner(buyer), terms.seller, amountSol, { reference: terms.reference })
await ctx.reply(mention, formatPaymentProof({ round, rail: 'x402', reference: terms.reference, proof, buyer: buyer.publicKey.toBase58() }))
```

Seller, on `PAYMENT_PROOF` — a submitted transaction is never trusted on landing alone:

```ts
import { submitSignedTransaction, verifyPayment, formatPaymentConfirmed } from '@pay/agent-runtime'

const sig = await submitSignedTransaction(proof.proof)
const paid = await verifyPayment(sig, { recipient: SELLER_WALLET, amountSol: order.priceSol, reference: proof.reference })
await ctx.reply(mention, formatPaymentConfirmed({ round: order.round, rail: 'x402', reference: proof.reference, paid, ...(paid ? { txSignature: sig } : {}) }))
// only then: deliver
```

## x402 — HTTP Reference Merchant & Upstream Procurement

`packages/payment-runtime/src/rails/x402-client.ts` implements the client side of the x402 HTTP 402
flow — the pattern a buyer uses against a plain HTTP endpoint (not a CoralOS thread):

```ts
import { fetchWithX402, payViaX402 } from '@pay/payment-runtime'

// Fetch a resource, auto-pay if 402 is returned
const { response, settlement } = await fetchWithX402(
  'http://localhost:8801/api/edge-x402',
  { headers: { Accept: 'application/json' } },
  { signer: sellerKeypair },
)
// settlement?.txSignature — on-chain proof when a 402 was paid

// Or throw if no 402 challenge is returned (procurement must pay)
const result = await payViaX402(
  'http://localhost:8801/api/edge-x402',
  { headers: { Accept: 'application/json' } },
  { signer: sellerKeypair },
)
```

The server side (`x402-server.ts`) mints challenges and settles payments — this is what
`examples/txodds/server/proxy.ts`'s `/api/edge-x402` runs, and what the seller's optional upstream
procurement leg (`PROCURE_RAIL=x402`, below) pays against:

```ts
import { x402Challenge, settleX402 } from '@pay/payment-runtime'

const challenge = x402Challenge(order, request, resourcePath)
// ... on a submitted X-PAYMENT header:
const result = await settleX402(paymentHeader, expectedAccept)
// result.settled / result.txSignature
```

### Enabling x402 Procurement on a Seller

A *second*, independent x402 leg: the seller (already paid by the buyer) turns around and buys
upstream context for itself before delivering.

| Variable | Purpose |
|---|---|
| `PROCURE_RAIL=x402` | Enables the leg. Off by default. |
| `SELLER_KEYPAIR_B58` | Seller's spend key for this leg — distinct from `SELLER_WALLET`. |
| `PROCURE_X402_URL` | Resource to buy. Defaults to `http://host.docker.internal:8801/api/edge-x402`. |

```sh
PROCURE_RAIL=x402 SELLER_KEYPAIR_B58=<base58> npm run demo:coral
```

## Solana Pay

`packages/payment-runtime/src/rails/solana-pay.ts` implements the Solana Pay Transfer Request spec —
the primitive x402's `signTransferTransaction`/`verifyPayment` build on.

```ts
import { solanaPayRail } from '@pay/payment-runtime'

const rail = solanaPayRail({ recipient: sellerPublicKey })

// Build a payment request URL
const request = await rail.requestPayment({
  amount: 0.001,
  reference: orderReference,
  recipient: sellerPublicKey,
})
// => solana:<recipient>?amount=0.001&reference=<ref>

// Verify on-chain — never trusts a caller's claim alone
const verification = await rail.verifyPayment(request)
// => { status: 'confirmed', txSignature: '...' }
```

## Escrow (available, not used by default)

Programs: `examples/txodds/escrow/programs/{escrow,arbiter}` — deployed to devnet, tested, and kept
as a building block for forks that want conditional/delayed settlement instead of x402's direct-and-
final payment. `coral-agents/buyer-agent`/`seller-agent` do not use these programs.

| Program | Devnet ID |
|---|---|
| Escrow | `R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet` |
| Arbiter | `FJtuVXsyXuRKqgJBEPAXmktkd13CqStapgevzGwYktXd` |

The trade-off escrow offers over the default x402 flow: the buyer's funds are locked, not sent,
until either the buyer releases on verified delivery or the deadline passes and the buyer reclaims
them. If you want that guarantee back in a fork, this is the pair of programs to build on — see
`examples/txodds/escrow/README.md` for the Anchor client shape and deploy/upgrade instructions.

## Policy

Every x402 payment passes through `packages/agent-runtime/src/policy/policy.ts` **before** the buyer
signs it — settlement is direct and final, so this is the only fund-moving gate; there's no later
release step left to check:

```ts
import { enforce } from '@pay/agent-runtime'

const decision = enforce({ kind: 'payment', ... }, policy)
if (!decision.ok) throw new Error(decision.violations.join('; '))
// Only then sign and send the PAYMENT_PROOF
```

| Rule | Stops |
|---|---|
| `spend-cap-round` | Single payment exceeding per-round cap. |
| `spend-cap-session` | Cumulative session spend exceeding session cap. |
| `award-price` | Payment exceeding the awarded bid price. |
| `service-allowlist` | Buying a service outside the configured list. |
| `payout-binding` | Payment recipient wallet mismatch. |
| `rate-limit` | Payments closer than `POLICY_MIN_INTERVAL_MS`. |

The x402 upstream-procurement leg (`packages/payment-runtime/src/procure.ts`) is gated separately by
an `AllowancePolicy` (`packages/payment-runtime/src/policy/spend-policy.ts`): per-call and per-day
caps, allowed providers/services/currencies, and expiry. This is distinct from the primary-payment
policy above — it governs what the seller is allowed to *spend upstream*, not what the buyer pays.

## Configuration

| Variable | Rail | Notes |
|---|---|---|
| `BUYER_KEYPAIR_B58` | x402 | Buyer's payment-signing keypair. |
| `SELLER_WALLET` | x402 / Solana Pay | Payout address — receives only. |
| `PROCURE_RAIL` | x402 | `x402` to enable the seller's upstream procurement leg. |
| `SELLER_KEYPAIR_B58` | x402 | Seller's spend key for procurement. |
| `PROCURE_X402_URL` | x402 | x402-protected resource URL. |
| `SOLANA_RPC_URL` | All | Defaults to devnet. |
| `POLICY_MAX_SOL_PER_ROUND` | Policy | Per-round spend cap. |
| `POLICY_MAX_SOL_PER_SESSION` | Policy | Per-session spend cap. |
| `POLICY_SERVICES` | Policy | Service allowlist, comma-separated. |
| `POLICY_MIN_INTERVAL_MS` | Policy | Minimum ms between payments. |

## Devnet Guard

`packages/agent-runtime/src/solana/connection.ts` rejects mainnet RPC URLs unless `ALLOW_MAINNET=1` is set. Applies to every rail.

## See Also

- [CORAL.md](CORAL.md) — coordination layer and market protocol.
- [API.md](API.md) — using these rails with any API, not just TxODDS.
