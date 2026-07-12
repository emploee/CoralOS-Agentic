# Buyer + Verifier Tool Loops

Scoped-down slice of `docs/AGENT_DEPTH_PLAN.md`'s Phases 3–4 — the two extensions judged actually
worth building now. Everything else in that plan (expanded tool surface, memory/reflection,
planning, proactive behavior, persistent goals, self-improvement) is left as proposed, not started.

## Why just these two

Phase 1 (seller bid decision loop) already proved the pattern: `runToolLoop()` + a deterministic
clamp tool + a forced-final decision tool, with the clamp re-applied after the loop regardless of
what the model reports. Phases 3–4 are the same pattern applied to the two agent roles that don't
have it yet — buyer award, verifier judgment — so after this, all three roles in the lifecycle
(seller bids, buyer awards, verifier judges) follow one consistent, already-tested shape instead of
two of them still being a single unstructured LLM call.

Everything past Phase 4 trades a clear, mirrored implementation for open-ended new behavior
(memory, planning, self-tuning) that doesn't have a concrete consumer yet — not worth building
speculatively.

## What's needed

### Buyer award loop

Replace `pickWinner()`'s single `complete()` call in `coral-agents/buyer-agent/src/index.ts` with a
`runToolLoop()`, same shape as `decideBid()` in `packages/harness-runtime/src/quote.ts`.

| Add | File | Mirrors |
|---|---|---|
| `FetchSellerReputation` tool | `coral-agents/buyer-agent/src/award-tools.ts` (new) | Wraps the existing `fetchReputationLines()` in `reputation.ts` — no new data source. |
| `ComputeValueScore` tool | same file | Deterministic price × reputation scoring, replacing the inline prompt-only comparison. |
| `SubmitAward` forced-final tool | same file | `submit_bid_decision` in `packages/harness-runtime/src/bid-tools.ts`. |
| Loop wiring | `coral-agents/buyer-agent/src/index.ts`, inside `pickWinner()` | `decideBid()` in `quote.ts`. |
| Unit tests | `coral-agents/buyer-agent/src/award-tools.test.ts` (new) | `bid-tools`/`quote.test.ts` pattern. |

No change to `EscrowTerms`, `formatAward`, or any market message — `pickWinner()` still returns
`{ winner, reason, llm }` exactly as it does today; only how it gets there changes.

### Verifier loop

Replace the LLM-judge branch inside `checkDelivery()` (`coral-agents/verifier-agent/src/verify.ts`)
with a `runToolLoop()`. The deterministic hash/structure checks that run *before* it are untouched.

| Add | File | Mirrors |
|---|---|---|
| `InspectPayloadStructure` tool | `coral-agents/verifier-agent/src/verify-tools.ts` (new) | `clamp_price` — a deterministic re-check the model can call before deciding. |
| `SubmitVerdict` forced-final tool | same file | `{ pass: boolean, reason: string }`, same shape `checkDelivery()` already returns. |
| Loop wiring | `coral-agents/verifier-agent/src/verify.ts` | `decideBid()` in `quote.ts`. |
| Unit tests | `coral-agents/verifier-agent/src/verify-tools.test.ts` (new) | `verify.test.ts` pattern. |

`checkDelivery()`'s signature and return shape (`VerdictWithLlm`) don't change — a `fail` from the
hash/structure checks still short-circuits before the loop ever runs.

No `BID_REVIEW_ENABLED`-style opt-in flag needed for either — Phase 1's tool loop replaced
`decideBid()`'s single-call implementation outright, not behind a flag, and these two follow the
same precedent.

## What it does to the repo

- **New files**: 4 (`award-tools.ts` + its test, `verify-tools.ts` + its test).
- **Modified files**: `buyer-agent/src/index.ts`, `verifier-agent/src/verify.ts`, and both agents'
  READMEs (Files table gets one new row each).
- **Dependencies**: none new. `runToolLoop`, `Tool`, `BudgetGuard`, `StepCounter` all already come
  from `@pay/agent-runtime`, which both agents already depend on.
- **Market protocol**: unchanged. `AWARD` and `VERIFIED` are formatted from the same fields as
  today — `packages/agent-runtime/src/market/protocol.ts` needs no edits.
- **Env vars**: none new required.
- **Audit trail**: `LLM_USED` messages (`buyer_award`, `verifier_judgment` purposes) already exist
  on the wire for both flows — they gain a richer tool-call trace (`ToolLoopOutcome.records`)
  instead of a single prompt/completion pair, but the message shape on the thread is unchanged.
- **Fund-safety invariants**: unaffected. `enforce({kind:'release', verified}, policy)` in
  `buyer-agent/src/index.ts` still gates release on the verdict exactly as before; the tool loop
  only changes how the verdict/award gets decided, not what happens with it afterward.

## Testing

```sh
npm test -w buyer-agent
npm test -w verifier-agent
```

Then one manual `npm run coral` round with `TRACE=1` to confirm the tool-call trace shows up in
logs and the round still completes end to end (`WANT → … → ARBITER_RELEASED`) with no protocol
changes visible on the wire.
