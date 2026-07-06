# @pay/payment-runtime

Payment rail abstractions for repository examples and agents. The package defines one `PaymentRail` interface, a `PaymentRailRouter`, policy helpers, and proof-receipt normalization.

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

`PaymentRailRouter` selects a rail per order. Explicit `order.rail` wins; `requireEscrow` selects escrow; non-SOL currencies prefer `spl-usdc`; otherwise `solana-pay` is used.

## Rail Status

| Rail | Module | Status |
|---|---|---|
| Solana Pay | `rails/solana-pay.ts` | Working devnet rail; builds reference-bound payment URLs and verifies recipient, amount, and reference. |
| Escrow | `rails/escrow.ts` | Working devnet wrapper over deployed escrow/arbiter clients; records caller-supplied signatures and references. |
| Pay.sh | `rails/pay-sh.ts` | Simulated/proof-adapter rail with provider allowlist and caller-supplied receipts. |
| x402 | `rails/x402-client.ts`, `rails/x402-server.ts` | HTTP 402 challenge/proof scaffold; no facilitator round trip. |
| USDC | `rails/spl-usdc.ts` | Metadata/token-escrow scaffold; no SPL transfer is sent. |
| Allowance | `rails/allowance.ts` | Policy wrapper around an inner rail. |
| Embedded wallet | `rails/embedded-wallet.ts` | Provider wrapper scaffold; no provider SDK call. |
| Payout | `rails/payout.ts` | Payout proof scaffold accepting caller-supplied signatures as proof. |

`rails/memo.ts` is a helper for canonical settlement memo formatting.

## Proof Receipts

`verifyPayment` returns a `PaymentVerification` with fields such as `paid`, `rail`, `proof`, `txSignature`, `amount`, and `currency`. `toProofReceipt()` in `receipt.ts` converts verifications into ledger-compatible proof receipts.

Proof receipts are written into:

- `RunRecord.proofReceipts`;
- `proof_receipts.json` inside run folders;
- feed and UI responses where payment proofs are displayed.

Scaffold rails should mark receipts as simulated until backed by a live provider verification.

## Policies

| File | Purpose |
|---|---|
| `policy/spend-policy.ts` | Allowance caps, total budget, service allowlist, provider allowlist. |
| `policy/merchant-policy.ts` | Merchant/service/price rules. |
| `policy/api-procurement-policy.ts` | Upstream API procurement allowlist and spend checks. |

These policy helpers complement `packages/agent-runtime/src/policy`, which gates escrow deposits and releases.

## Current Consumers

| Consumer | Use |
|---|---|
| `examples/txodds/agent/procurement.ts` | Simulated Pay.sh upstream procurement before delivery. |
| `coral-agents/seller-agent` | Optional upstream procurement messages in the CoralOS market thread. |
| `examples/marketplace/feed` | Folds `PAYMENT_*` messages into proof receipts. |
| `examples/marketplace/web` | Renders proof receipt status. |

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

Examples:

- Pay.sh: live catalog/receipt API verification.
- x402: facilitator round trip.
- USDC: SPL transfer and token-aware escrow support.
- Embedded wallet: provider SDK integration.
