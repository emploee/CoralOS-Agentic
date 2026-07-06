# @pay/payment-runtime — payment rails for agent commerce

One `PaymentRail` interface (`quote` → `requestPayment` → `verifyPayment`, optional
`release`/`refund`), a `PaymentRailRouter` that picks a rail per order, and spend/merchant/procurement
policies. Built so an agent can say *"pay for this order over rail X"* without the market code caring
which rail X is — the same seam the harness adapter gives execution, applied to money.

## Rail status — what's real and what's scaffold

Be honest with yourself before you demo: **two rails move real devnet SOL; the rest are typed
scaffolds** that model the message/proof flow so the protocol, ledger, and UI around them are real
even where the money movement isn't yet.

| Rail | Module | Status |
|------|--------|--------|
| Solana Pay | `rails/solana-pay.ts` | **Working demo rail** — builds a reference-bound payment URL via `@pay/agent-runtime` and `verifyPayment` confirms the transfer on devnet (recipient + amount + reference). |
| Escrow | `rails/escrow.ts` | **Working devnet rail** — a typed wrapper over the deployed escrow/arbiter programs. The on-chain deposit/release happens in the escrow clients (`examples/txodds/agent/escrow.ts`, the coral agents); this rail binds the order to the reference and records the signatures the caller supplies. |
| Pay.sh | `rails/pay-sh.ts` | **Simulated / proof-adapter rail** — provider-allowlisted quotes and a receipt-based `verifyPayment`; the receipt is caller-supplied (the TxODDS demo derives a deterministic `pay-sh-demo:sha256(...)` receipt). No live Pay.sh API call yet. |
| x402 | `rails/x402-client.ts`, `rails/x402-server.ts` | **Challenge/proof scaffold** — emits the HTTP 402 challenge shape (`accepts[]`, payment headers) and accepts a `paymentProof`; no facilitator round-trip yet. |
| USDC | `rails/spl-usdc.ts` | **Metadata/token-escrow scaffold** — the escrow rail re-flagged for USDC orders with mint/token-program metadata; no SPL transfer is sent. |
| Allowance | `rails/allowance.ts` | **Policy wrapper** — wraps any inner rail and enforces an `AllowancePolicy` (per-call cap, budget, service/provider allowlists) before quoting or requesting payment. As real as its inner rail. |
| Embedded | `rails/embedded-wallet.ts` | **Provider wrapper scaffold** — tags an inner rail with a wallet provider (`privy`/`dynamic`/`para`/`magic`); no provider SDK is called. |
| Payout | `rails/payout.ts` | **Payout proof scaffold** — models the seller-side payout leg; `verifyPayment`/`release` accept a caller-supplied signature as proof. |

`rails/memo.ts` is a helper, not a rail: `settlementMemo(order)` formats the canonical
`order= round= service= rail=` memo string.

## The interface

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

`PaymentRailRouter` (`rail-router.ts`) registers rails and picks one per order: an explicit
`order.rail` wins, `requireEscrow` forces the escrow rail, non-SOL currencies prefer `spl-usdc`,
otherwise `solana-pay`. `verifyPayment` routes by the request's own rail, so a proof is always
checked by the rail that issued the request.

Verifications carry a `proof` — the receipt/reference/signature. `toProofReceipt(verification, …)`
(`receipt.ts`) folds it into the run ledger's formal **proof receipt** artifact (`proofReceipts` on
the `RunRecord`, `proof_receipts.json` in the run folder, `simulated: true` while the rail is a
scaffold), so "what was paid upstream and how was it proven" survives the session.

## Policies (`policy/`)

- `spend-policy.ts` — `enforceAllowance(spend, policy)`: max per call, total budget, service +
  provider allowlists (tested).
- `merchant-policy.ts` — which services a merchant may sell, price bounds.
- `api-procurement-policy.ts` — the buyer-side allowlist for procuring upstream APIs (provider +
  spend caps), used by the TxODDS Pay.sh demo.

These complement — not replace — the market policy choke point in
`packages/agent-runtime/src/policy/` (spend caps, award-price binding, verifier gate); that one
gates escrow deposits/releases, this one gates rail usage.

## Where it's used today

- `examples/txodds/agent/procurement.ts` — the seller buys upstream TxODDS context through the
  Pay.sh rail before delivering (`/api/pay-sh-edge` on the proxy); the receipt lands in the run
  ledger and the Oracle UI.
- `coral-agents/seller-agent` — in the multi-agent market, the seller can procure upstream context
  through a rail before delivering and posts `PAYMENT_REQUIRED` / `PAYMENT_PROOF` /
  `PAYMENT_CONFIRMED` to the thread (see the seller README).

## Build / test

```sh
cd packages/agent-runtime && npm install && npm run build   # file: dep — build first
cd packages/payment-runtime && npm install
npm run typecheck
npm test        # rail-router + spend-policy + proof receipts
npm run build   # dependents need dist/
```

Devnet only, like everything in the kit: the working rails go through
`@pay/agent-runtime`'s `solanaConnection()`/`assertDevnet` guard.

## Promoting a scaffold to a real rail

Each scaffold marks exactly one seam to fill: Pay.sh needs the live catalog/receipt API call in
`verifyPayment`; x402 needs the facilitator round-trip; USDC needs the SPL transfer (and a
token-aware escrow program); Embedded needs a provider SDK behind the wrapper. Keep the
`PaymentRail` signature — the router, policies, ledger receipts, and UIs already speak it.
