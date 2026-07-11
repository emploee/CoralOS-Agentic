# Payment Rail Integration

## Shipped Rails

| Rail | Type | Status |
|---|---|---|
| `solana-pay` | Direct reference-bound transfer | Deployed, tested. |
| `escrow` | Dispute-resistant delayed-delivery settlement (SOL + SPL) | Deployed, tested. |
| `x402` | Instant per-call micropayment over HTTP | Deployed, tested. |

## Deployed Programs (Devnet)

| Program | ID | IDL |
|---|---|---|
| Escrow | `R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet` | On-chain (includes `initialize_spl`/`release_spl`/`refund_spl`). |
| Arbiter | `FJtuVXsyXuRKqgJBEPAXmktkd13CqStapgevzGwYktXd` | Bundled (`arbiter_idl.json`). |

## Where Each Rail Is Used

| Rail | Consumer | Path |
|---|---|---|
| Solana Pay | Proxy settlement endpoints | `examples/txodds/server/proxy.ts` |
| Escrow | CoralOS round buyer→seller settlement | `examples/txodds/coral/round.ts` via `examples/txodds/escrow/client/escrow.ts` |
| x402 | Seller upstream procurement | `coral-agents/seller-agent` with `PROCURE_RAIL=x402` |

## x402 Procurement Setup

```sh
PROCURE_RAIL=x402 SELLER_KEYPAIR_B58=<base58> PROCURE_X402_URL=http://host.docker.internal:8801/api/edge-x402 npm run demo:coral
```

The seller pays for upstream data via a real 402 challenge→sign→pay→verify flow before delivering to the buyer. See [PAY.md](../PAY.md) for the full x402 API.

## Escrow SPL Flow

The escrow programs support both SOL and SPL token deposits. The SPL instructions (`initialize_spl`, `release_spl`, `refund_spl`) are available via the direct Anchor client:

```ts
import { depositSpl, releaseSpl, refundSpl } from './escrow'
```

The `PaymentRail`-shaped wrapper (`packages/payment-runtime/src/rails/escrow.ts`) currently exposes SOL escrow only. SPL callers use the Anchor client directly.

## Verification

```sh
npm run build
npm run typecheck
npm test
cargo check --workspace    # from examples/txodds/escrow
```

See `packages/payment-runtime/README.md` for the per-rail status table.
