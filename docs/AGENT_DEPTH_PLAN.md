# Agent Depth Plan

Bounded tool-calling loops for seller bid decisions, with optional adversarial review.

## Status

- **Phase 1**: Implemented. `decideBid()` runs `runToolLoop()` with `clamp_price`/`submit_bid_decision` tools.
- **Phase 2**: Implemented. Adversarial reviewer (`bid-review.ts`, `BID_REVIEW_ENABLED`) is wired in, opt-in.
- **Phase 3**: Not implemented (buyer award loop).
- **Phase 4**: Not implemented (verifier loop).

## Phase 1 — Seller Bid Decision Loop

`packages/harness-runtime/src/quote.ts` → `decideBid()`

### Tools (`packages/harness-runtime/src/bid-tools.ts`)

| Tool | Type | Purpose |
|---|---|---|
| `clamp_price` | Deterministic | Clamps a proposed price into `[floor, budget]`, returns clamped value + whether clamping occurred. |
| `submit_bid_decision` | Forced final | `{ bid: boolean, priceSol: number, note: string }` — ends the loop. |

### Loop Config

```ts
{
  maxRounds: 4,
  budget: new BudgetGuard({ maxToolCalls: 8, maxSpendLamports: 0, maxDurationSecs: 30 }),
  steps: new StepCounter(4),
}
```

### Flow

1. Hard guards run first (impossible jobs rejected without an LLM call).
2. `runToolLoop()` runs with the tools above.
3. The model's proposed price passes through the same deterministic clamp `decideBid()` already applied pre-loop — the `clamp_price` tool result is auditable, not the sole enforcement.
4. `BidDecision.llm` gains the tool-call trace (`ToolLoopOutcome.records`).

## Phase 2 — Adversarial Bid Review

`packages/harness-runtime/src/bid-review.ts` → `reviewBid()`

A second, independently-prompted `runToolLoop()` call with a skeptical reviewer system prompt. Single forced-final tool: `SubmitReviewVerdict: { approve: boolean, concern?: string }`.

- Does **not** share the first loop's transcript — fresh prompt with only the proposed decision.
- If `approve: false`, the seller sits the round out.
- Gated by `BID_REVIEW_ENABLED` (default `"0"`).

```toml
# coral-agents/seller-worldcup/coral-agent.toml
[agent.env]
BID_REVIEW_ENABLED = "1"
```

## Phase 3 (Stretch) — Buyer Award Loop

Same shape for `coral-agents/buyer-agent/src/index.ts`'s award pick:

| Tool | Purpose |
|---|---|
| `FetchSellerReputation` | Wraps `/api/reputation` read. |
| `ComputeValueScore` | Deterministic price × reputation scoring. |
| `SubmitAward` | Forced final tool. |

No adversarial reviewer needed — the verifier already plays that role later in the lifecycle.

## Phase 4 (Stretch) — Verifier Loop

`checkDelivery()`'s deterministic hash/structure checks stay unchanged and run before any LLM. Only the "impartial judge" LLM call becomes a `runToolLoop()` with `InspectPayloadStructure` and `SubmitVerdict`.

## Invariants

These do not change across any phase:

- No new CoralOS message verbs. Tool-loop reasoning is internal to one agent's decision.
- No process/container topology change.
- No settlement rail change.
- Policy (`packages/agent-runtime/src/policy`) remains the sole fund-moving gate.

## Testing

```sh
# Unit tests for tools and loop integration
npm test -w harness-runtime

# Seller agent e2e (confirms escrow path untouched)
npm test -w seller-agent

# Manual: run with review enabled on one persona
BID_REVIEW_ENABLED=1 npm run demo:coral
```
