# @pay/payment-runtime

Payment rail abstractions for repository examples and agents. The package defines one `PaymentRail` interface, a `PaymentRailRouter`, policy helpers, and proof-receipt normalization.

Three rails, deliberately: **escrow** for dispute-resistant, delayed-delivery settlement, and **x402** for cheap, instant, per-call micropayments — they solve different problems, not overlapping ones. **Solana Pay** is the direct-transfer primitive both `escrow`'s vault funding and `x402`'s settlement leg build on. Everything else that previously lived here (spl-usdc, allowance, embedded-wallet, payout, pay-sh) was removed: either redundant with what escrow/x402 already provide, or (pay-sh) replaced outright with a real x402 implementation rather than kept as a permanent scaffold.

## Interface

```ts
interface PaymentRail {
  kind: PaymentRailKind
  quote(input: PaymentQuoteInput): Promise<PaymentQuote>
  requestPayment(order: MarketOrder): Promise<PaymentRequest>
  verifyPayment(request: PaymentRequest): Promise<PaymentVerification>
  release?(order: MarketOrder): Promise<SettlementResult>
  refund?(order: MarketOrder): Promise<SettlementResult>
}
```

`PaymentRailRouter` selects a rail per order. Explicit `order.rail` wins; `requireEscrow` selects escrow; otherwise `solana-pay` is used if registered.

## Rail Status

| Rail | Module | Status |
|---|---|---|
| Solana Pay | `rails/solana-pay.ts` | Working devnet rail; builds reference-bound payment URLs and verifies recipient, amount, reference, and (optional) SPL mint via `@solana/pay`. |
| Escrow | `rails/escrow.ts` | Working devnet wrapper over deployed escrow/arbiter clients for the SOL flow. SPL escrow (`initialize_spl`/`release_spl`/`refund_spl` + arbiter parity) is deployed to the same live devnet programs and passing `tests/escrow.ts`'s `escrow spl (devnet)` suite — see `examples/txodds/escrow/README.md` — but this rail's own wrapper (`rails/escrow.ts`) still only calls the SOL client; the SPL client functions (`depositSpl`/`releaseSpl`/`refundSpl`) are called directly, not yet folded into the `PaymentRail` interface here. |
| x402 | `rails/x402-client.ts`, `rails/x402-server.ts` | Working: `x402Challenge`/`settleX402` mint and settle a fresh reference-bound challenge (direct on-chain submit or a facilitator round trip via `X402_FACILITATOR_URL`); `buildPaymentPayload`/`fetchWithX402`/`payViaX402` sign client-side and verify the merchant's `X-PAYMENT-RESPONSE` on-chain before trusting a 200. Reference merchant: `examples/txodds/server/proxy.ts`'s `/api/edge-x402`. Real consumer: `coral-agents/seller-agent`'s `PROCURE_RAIL=x402` upstream-procurement leg (`procure.ts`). |

`rails/memo.ts` is a helper for canonical settlement memo formatting.

## Proof Receipts

`verifyPayment` returns a `PaymentVerification` with fields such as `paid`, `rail`, `proof`, `txSignature`, `amount`, and `currency`. `toProofReceipt()` in `receipt.ts` converts verifications into ledger-compatible proof receipts.

Proof receipts are written into:

- `RunRecord.proofReceipts`;
- `proof_receipts.json` inside run folders;
- feed and UI responses where payment proofs are displayed.

## Policies

| File | Purpose |
|---|---|
| `policy/spend-policy.ts` | Allowance caps, total budget, service allowlist, provider allowlist — `AllowancePolicy`, consumed by `fetchWithX402`/`payViaX402`. |
| `policy/merchant-policy.ts` | Merchant/service/price rules. |
| `policy/api-procurement-policy.ts` | Upstream API procurement allowlist and spend checks — gates every x402 payment before it's signed. |

These policy helpers complement `packages/agent-runtime/src/policy`, which gates escrow deposits and releases.

## Current Consumers

| Consumer | Use |
|---|---|
| `coral-agents/seller-agent` | Real x402 upstream procurement (`PROCURE_RAIL=x402`) — messages posted to the CoralOS market thread, folded into proof receipts. |
| `examples/txodds/feed` | Folds `PAYMENT_*` messages into proof receipts. |

## Build and Test

Build/test through the root npm workspace so `@pay/*` packages resolve consistently:

```sh
npm install --no-audit --no-fund
npm run build:packages
npm run typecheck -w @pay/payment-runtime
npm test -w @pay/payment-runtime
```

## Promoting a Scaffold Rail

Keep the `PaymentRail` interface stable. Fill the rail-specific verification seam, add failure-mode tests, and ensure proof receipts preserve enough data for audit/replay.

Remaining scaffold:

- Escrow SPL: deployed and live-tested at the program level; `rails/escrow.ts` itself still only wires the SOL client into the `PaymentRail` interface — fold `EscrowSpl` in the same way.
