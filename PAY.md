# Payment Protocol

Three Solana-based payment rails, each solving a different problem. All devnet by default.

## Rails

| Rail | Purpose | Used in |
|---|---|---|
| **Solana Pay** | Direct, reference-bound transfer. | Primitive both other rails build on. |
| **Escrow** | Dispute-resistant, delayed-delivery settlement. | Buyer→seller leg of every CoralOS round. |
| **x402** | Instant, per-call micropayment over HTTP. | Seller's upstream procurement leg. |

## PaymentRail Interface

`packages/payment-runtime` exposes one interface for all three:

```ts
import type { PaymentRail, PaymentRailKind, MarketOrder } from '@pay/payment-runtime'

interface PaymentRail {
  kind: PaymentRailKind                                          // 'solana-pay' | 'escrow' | 'x402'
  quote(input: PaymentQuoteInput): Promise<PaymentQuote>
  requestPayment(order: MarketOrder): Promise<PaymentRequest>
  verifyPayment(request: PaymentRequest): Promise<PaymentVerification>
  release?(order: MarketOrder): Promise<SettlementResult>
  refund?(order: MarketOrder): Promise<SettlementResult>
}
```

## Solana Pay

`packages/payment-runtime/src/rails/solana-pay.ts` implements the Solana Pay Transfer Request spec.

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

## Escrow

Programs: `examples/txodds/escrow/programs/{escrow,arbiter}` — deployed to devnet.

| Program | Devnet ID |
|---|---|
| Escrow | `R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet` |
| Arbiter | `FJtuVXsyXuRKqgJBEPAXmktkd13CqStapgevzGwYktXd` |

The CoralOS round calls the Anchor client directly (`examples/txodds/escrow/client/escrow.ts`):

```ts
import { initialize, release, refund } from './escrow'

// Buyer deposits into a vault PDA
const escrowTx = await initialize({
  buyer: buyerKeypair,
  seller: sellerPublicKey,
  reference: orderReference,
  amount: 0.001,                    // SOL
  deadlineSecs: 3600,
})

// After verified delivery — arbiter releases to seller
const releaseTx = await release({
  arbiter: arbiterKeypair,
  buyer: buyerPublicKey,
  seller: sellerPublicKey,
  reference: orderReference,
})

// Or refund after deadline
const refundTx = await refund({
  buyer: buyerKeypair,
  reference: orderReference,
})
```

Both SOL and SPL-token flows are deployed and tested.

**Arbiter mode** (default): the buyer deposits into a vault PDA. The seller only gets paid once `verifier-agent` posts `VERIFIED pass` and the verifier-gate policy check clears.

## x402

`packages/payment-runtime/src/rails/x402-client.ts` implements the client side of the x402 HTTP 402 flow:

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

The server side (`x402-server.ts`) issues 402 challenges and settles payments:

```ts
import { createX402Handler } from '@pay/payment-runtime'

const handler = createX402Handler({
  recipient: merchantPublicKey,
  priceLamports: 50_000,
})
// Use as Express/Connect middleware on any endpoint
```

### Enabling x402 Procurement on a Seller

| Variable | Purpose |
|---|---|
| `PROCURE_RAIL=x402` | Enables the leg. Off by default. |
| `SELLER_KEYPAIR_B58` | Seller's spend key for this leg — distinct from `SELLER_WALLET`. |
| `PROCURE_X402_URL` | Resource to buy. Defaults to `http://host.docker.internal:8801/api/edge-x402`. |

```sh
PROCURE_RAIL=x402 SELLER_KEYPAIR_B58=<base58> npm run demo:coral
```

## Policy

Every deposit and release passes through `packages/agent-runtime/src/policy/policy.ts` before signing:

```ts
import { enforce } from '@pay/agent-runtime'

const violations = enforce(action, policy)
if (violations.length > 0) throw new PolicyError(violations)
// Only then proceed with rail.release(order)
```

| Rule | Stops |
|---|---|
| `spend-cap-round` | Single deposit exceeding per-round cap. |
| `spend-cap-session` | Cumulative session spend exceeding session cap. |
| `award-price` | Deposit exceeding the awarded bid price. |
| `service-allowlist` | Buying a service outside the configured list. |
| `payout-binding` | Escrow seller wallet mismatch. |
| `rate-limit` | Deposits closer than `POLICY_MIN_INTERVAL_MS`. |
| `verifier-gate` | Release without `VERIFIED pass` when verifier is required. |

## Configuration

| Variable | Rail | Notes |
|---|---|---|
| `BUYER_KEYPAIR_B58` | Escrow | Buyer's funding keypair. |
| `ARBITER_KEYPAIR_B58` | Escrow | Arbiter's release/refund keypair. |
| `SELLER_WALLET` | Escrow / Solana Pay | Payout address — receives only. |
| `SETTLEMENT_MODE` | Escrow | `arbiter` (default) or `direct`. |
| `ESCROW_DEADLINE_SECS` | Escrow | Refund deadline for funded deposits. |
| `PROCURE_RAIL` | x402 | `x402` to enable upstream procurement. |
| `SELLER_KEYPAIR_B58` | x402 | Seller's spend key for procurement. |
| `PROCURE_X402_URL` | x402 | x402-protected resource URL. |
| `SOLANA_RPC_URL` | All | Defaults to devnet. |
| `POLICY_MAX_SOL_PER_ROUND` | Policy | Per-round spend cap. |
| `POLICY_MAX_SOL_PER_SESSION` | Policy | Per-session spend cap. |
| `POLICY_SERVICES` | Policy | Service allowlist, comma-separated. |
| `POLICY_MIN_INTERVAL_MS` | Policy | Minimum ms between deposits. |

## Devnet Guard

`packages/agent-runtime/src/solana/connection.ts` rejects mainnet RPC URLs unless `ALLOW_MAINNET=1` is set. Applies to every rail.

## See Also

- [CORAL.md](CORAL.md) — coordination layer and market protocol.
- [LLM.md](LLM.md) — provider config and how LLM decisions interact with policy.
- [API.md](API.md) — using these rails with any API, not just TxODDS.
