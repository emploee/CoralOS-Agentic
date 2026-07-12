# Deliver Service

Seller behavior usually starts in one of these places:

- `coral-agents/seller-agent/src/service.ts` — `deliverServiceResult()`, the CoralOS round's seller.
- `examples/txodds/agent/service.ts` — the single-agent web flow's `deliverService()`.
- A harness adapter in `packages/harness-runtime/src/adapters/` — if the "service" is actually a headless `claude-code` run or an arbitrary CLI instead of in-process code.

## Pattern

1. Parse the buyer request (`WANT.arg`, or the harness order's `arg`).
2. Price the result in the seller's `BID` — before any upstream work happens, and bounded by the harness's code-enforced economics (never below cost floor, never above the buyer's stated budget).
3. Perform upstream procurement only after award **and** the deposit is confirmed funded — never speculatively, and never before policy has cleared the deposit. See `coral-agents/seller-agent/src/index.ts`'s `PROCURE_RAIL=x402` leg for the reference implementation (`packages/payment-runtime`'s `procureUpstream()`).
4. Return deterministic output where possible — see `risk-policy` and `fan-card` in `service.ts` for services that never touch an LLM at all, just because the domain doesn't need one.
5. Include hashes or source references so a verifier can check the delivery (`references/verifier-gate.md`). The buyer hashes whatever comes back on `DELIVERED`, so the payload itself must be the complete, self-contained artifact — nothing external to fetch later.

Do not let service code hold unrestricted wallet authority. Use `payment-runtime` and policy checks for paid upstream calls — service modules should never import a signing keypair directly.

## Fail-open pattern for LLM-backed services

`freelanceService` in `coral-agents/seller-agent/src/service.ts` is the template for any service that *does* need a model: if the LLM call throws, it returns an honest `{ error: "llm unavailable: ..." }` payload instead of retrying, stalling, or fabricating a deliverable. The verifier's structure check (`references/verifier-gate.md`, step 2) fails any payload with a top-level `error`, so the escrow is never released for a delivery the seller couldn't actually produce — the seller loses the round, not the buyer's money. Prefer this over inventing a fallback deliverable: an honest failure that costs a round is safer than a plausible-looking one that gets released and later disputed.

Every branch — deterministic or LLM-backed, success or failure — still returns an `LlmUse` entry (`status: used|fallback|skipped|error`) so the run ledger always records whether a model was consulted for that delivery, even when the answer is "no."

## Adding a new service

- Add the service name to the seller's supported-services list and its `SellerConfig`/bid pricing.
- Add it to `policy.allowedServices` (or `POLICY_SERVICES`) wherever the buyer's policy is configured — an unlisted service can bid but the buyer's `service-allowlist` policy rule will refuse the deposit.
- If the payload has a fixed, checkable shape, give the verifier a deterministic fast path for it (see the `txline` fixture check in `verifier-agent/src/verify.ts`) instead of relying on the LLM judge for every delivery.
