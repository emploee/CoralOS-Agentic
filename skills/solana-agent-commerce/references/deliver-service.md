# Deliver Service

Seller behavior usually starts in one of these places:

- `coral-agents/seller-agent/src/service.ts` — `deliverServiceResult()`, the CoralOS round's seller.
- `examples/txodds/agent/service.ts` — the single-agent web flow's `deliverService()`.
- A harness adapter in `packages/harness-runtime/src/adapters/` — if the "service" is actually a headless `claude-code` run or an arbitrary CLI instead of in-process code.

## Pattern

1. Parse the buyer request (`WANT.arg`, or the harness order's `arg`).
2. Price the result in the seller's `BID` — before any upstream work happens, and bounded by the harness's code-enforced economics (never below cost floor, never above the buyer's stated budget).
3. Perform upstream procurement only after award **and** the buyer's x402 payment is confirmed — never speculatively, and never before it lands. See `coral-agents/seller-agent/src/index.ts`'s `PROCURE_RAIL=x402` leg for the reference implementation (`packages/payment-runtime`'s `procureUpstream()`).
4. Return deterministic output — see `txlineService`/`sharpMovementService` in `service.ts`; nothing in the delivery path touches a model.
5. Include hashes or source references so a verifier can check the delivery (`references/verifier-gate.md`). The buyer hashes whatever comes back on `DELIVERED`, so the payload itself must be the complete, self-contained artifact — nothing external to fetch later.

Do not let service code hold unrestricted wallet authority. Use `payment-runtime` and policy checks for paid upstream calls — service modules should never import a signing keypair directly.

**Remember settlement is already final by the time delivery code runs.** The buyer's x402 payment
confirmed *before* `deliverServiceResult()`/`deliverService()` is even called — there's no
release/refund step downstream that a bad delivery can still be caught by. Fail honestly (return an
`{ error: "..." }` payload on a real failure, like `txlineGet` does when `TXLINE_API_KEY` is unset or
the upstream call fails) rather than fabricating a plausible-looking deliverable — the verifier's
structure check (`references/verifier-gate.md`) will flag a top-level `error` field for reputation
purposes, but it can't undo the payment either way.

## Adding a new service

- Add the service name to the seller's supported-services list and its `SellerConfig`/bid pricing.
- Add it to `policy.allowedServices` (or `POLICY_SERVICES`) wherever the buyer's policy is configured — an unlisted service can bid but the buyer's `service-allowlist` policy rule will refuse the payment.
- If the payload has a fixed, checkable shape, add it to the verifier's structural checks (`verifier-agent/src/verify.ts`) if it needs anything beyond "valid JSON, no top-level error."
