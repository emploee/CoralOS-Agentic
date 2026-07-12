# Agent Depth Plan

Bounded tool-calling loops for seller bid decisions, with optional adversarial review — extended
below into a longer roadmap toward deeper multi-agent autonomy, still bound by the same invariants.

Phases 7–10 below are one-paragraph categories. [docs/E2E_AGENTIC_DECISIONS.md](E2E_AGENTIC_DECISIONS.md)
is the concrete version — every lifecycle point where a script currently decides, what judgment
would replace it, and what that judgment weighs.

## Status

| Phase | Description | Status |
|---|---|---|
| 1 | Seller bid decision loop | Implemented |
| 2 | Adversarial bid review | Implemented |
| 3 | Buyer award loop | Not implemented (stretch) |
| 4 | Verifier loop | Not implemented (stretch) |
| 5 | Expanded tool surface | Not implemented (proposed) |
| 6 | Memory + reflection | Not implemented (proposed) |
| 7 | LLM-driven planning (plan-and-execute / ReAct) | Not implemented (proposed) |
| 8 | Proactive behavior | Not implemented (proposed) |
| 9 | Persistent goals + strategy adaptation | Not implemented (proposed) |
| 10 | Self-improvement / strategy evolution loops | Not implemented (proposed, highest risk — see Invariants) |

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

Scoped, ready-to-build version of this phase and Phase 4: [docs/BUYER_VERIFIER_LOOPS.md](BUYER_VERIFIER_LOOPS.md).

Same shape for `coral-agents/buyer-agent/src/index.ts`'s award pick (currently `pickWinner()`: a
single LLM call with a deterministic cheapest-bid fallback, no tool loop yet):

| Tool | Purpose |
|---|---|
| `FetchSellerReputation` | Wraps the existing `/api/reputation` read (`fetchReputationLines()` in `coral-agents/buyer-agent/src/reputation.ts`) instead of inlining reputation text into the prompt. |
| `ComputeValueScore` | Deterministic multi-dimensional scoring — price × reputation × risk signal — replacing the current single price-vs-reputation prompt with an auditable, callable computation. |
| `SubmitAward` | Forced final tool: `{ by: string, reason: string }`. |

No adversarial reviewer needed — the verifier already plays that role later in the lifecycle.

*(Supersedes the old standalone `llm_buyer.ts` idea: that file implemented a separate, single-agent
HTTP-402 purchase loop and was removed as dead code — it was never imported by the live
`index.ts`. Buyer-side intelligence work belongs here, in the actual award path.)*

## Phase 4 (Stretch) — Verifier Loop

`checkDelivery()`'s deterministic hash/structure checks (`coral-agents/verifier-agent/src/verify.ts`)
stay unchanged and run before any LLM — see `skills/solana-agent-commerce/references/verifier-gate.md`
for why that ordering is load-bearing. Only the existing "impartial judge" LLM call becomes a
`runToolLoop()`, with tools such as:

| Tool | Purpose |
|---|---|
| `InspectPayloadStructure` | Deterministic re-check the model can call to confirm its own read of the payload before judging. |
| `SubmitVerdict` | Forced final tool: `{ pass: boolean, reason: string }` — same shape `checkDelivery()` already parses. |

A `fail` from the deterministic checks must remain non-overridable by anything this phase adds —
the tool loop only replaces the "ask the model" step, not the gate in front of it.

## Phase 5 (Proposed) — Expanded Tool Surface

Give the Phase 1/3/4 tool loops more to call before deciding, instead of growing the prompt with
inlined context. Some of this is already available and just needs wrapping as a `Tool`:

| Existing primitive | File | Wrap as a tool for |
|---|---|---|
| `readWalletBalance` / `readTokenBalances` | `packages/solana-agent-tools/src/balances.ts` | Pre-bid risk/exposure checks. |
| `fetchTokenPrice` / `fetchPythPrice` | `packages/solana-agent-tools/src/prices.ts` | Cost estimation for services priced against a reference asset. |
| `listRuns` / `listSessionRuns` / `readRun` | `packages/agent-runtime/src/ledger/store.ts` | Reputation/history lookups (the feed's `/api/reputation` already builds on this — see `fetchReputationLines()`). |

New tools worth building: `FetchRecentBids` (recent market activity for a service, from the ledger),
`EstimateDeliveryCost` (harness-specific cost model for `service.ts`), `FetchCompetitorHistory`
(per-seller win/loss/verification-pass rate).

Widen `ToolLoopConfig.maxRounds` and the per-loop `BudgetGuard`/`StepCounter`
(`packages/agent-runtime/src/agent/loop.ts`, `safety.ts`) per decision loop, not globally — a
seller's per-bid loop should stay tightly bounded even if the agent process's overall budget is
generous.

**Invariant held**: every tool here is read-only or pure computation. None of them sign a
transaction or move funds — `clamp_price`/policy still make the final call.

## Phase 6 (Proposed) — Memory + Reflection

Per-round history is already persisted (`RunRecord` via `packages/agent-runtime/src/ledger/`) — this
phase is about *using* it, not creating a new store:

1. **Short-term**: fold the current round's own tool-call trace back into the transcript for a
   multi-step decision (already how `runToolLoop()` works within one call).
2. **Long-term**: a post-round reflection step — a bounded LLM call given a batch of recent
   `RunRecord`s (bids, deliveries, verdicts) — proposes what changed and why.

The reflection's output is a **persisted, reviewable artifact** (a new ledger-adjacent record, not
a live prompt/config rewrite). Whether a suggested pricing or persona adjustment actually takes
effect is a separate, explicit promotion step — see Phase 10's invariant on this same boundary.

## Phase 7 (Proposed, higher effort) — LLM-Driven Planning (Plan-and-Execute / ReAct)

Today each agent's `src/index.ts` is a fixed procedural loop (`WANT` → collect bids → `AWARD` →
deposit → wait `DELIVERED` → `VERIFY` → release), which is also what makes it easy to audit line by
line. This phase would let an agent LLM-generate a short plan for *how it pursues its goal within a
round* (e.g., which service/arg to request next in event mode, how to sequence procurement before
delivery) and execute that plan via tools.

**Invariant held**: this changes *internal* decision-making only. The market protocol's message
verbs (`WANT`/`BID`/`AWARD`/`ESCROW_REQUIRED`/`DEPOSITED`/`DELIVERED`/`VERIFY`/`VERIFIED`/`RELEASED`)
do not change shape — see `skills/solana-agent-commerce/references/market-protocol.md`. A generated
plan can choose *which* protocol message to send next, never invent a new one.

## Phase 8 (Proposed) — Proactive Behavior

Buyer and seller agents currently only act on `ctx.waitForMention()` (buyer) or a fixed poll cycle
(`CYCLE_MS`, `WANT_FEED_URL` in event mode). This phase adds background triggers — e.g. the buyer
posts a `WANT` when `research/watcher.ts`-style event detection fires, instead of only on a timer or
external feed poll.

**Invariant held**: a proactively-posted `WANT` still carries a `budget` and still passes through
`enforce({kind:'deposit', ...}, policy)` before any deposit — proactivity changes *when* an agent
acts, never *whether* policy is consulted before funds move.

## Phase 9 (Proposed) — Persistent Goals + Strategy Adaptation

Give a persona a longer-lived goal (e.g. "keep verification pass rate above 85% while maximizing
price") stored alongside its config (`coral-agent.toml` env, or a new goal file per persona), and
let a periodic reflection call (Phase 6) propose adjustments to bid pricing or service selection
against that goal.

**Invariant held**: same promotion boundary as Phase 6 — a goal-driven adjustment is a config change
that lands through review, not a runtime self-mutation.

## Phase 10 (Proposed, highest risk) — Self-Improvement / Strategy Evolution Loops

After a batch of rounds, an LLM analysis pass proposes prompt, pricing-heuristic, or persona changes
based on aggregate performance (win rate, verification pass rate, spend efficiency).

This is explicitly the phase most likely to erode the repo's core guarantee (`CLAUDE.md`: "models
propose, code enforces"), so it gets its own hard rule, on top of the general invariants below:

- **No phase may let an LLM alter its own policy bounds, spend caps, or the `clamp_price`-style
  deterministic clamps.** Those stay code, permanently — a self-improvement loop can propose a new
  *floor* or *budget* value, but changing it is a human/CI-reviewed config edit, never something the
  loop applies to itself mid-session.
- Self-modification output is data (a suggested diff), not code execution. Nothing in this repo
  should let an agent process rewrite and reload its own source at runtime.

## Invariants

These do not change across any phase, including the proposed ones above:

- No new CoralOS message verbs. Tool-loop/planning reasoning is internal to one agent's decision.
- No process/container topology change.
- No settlement rail change.
- Policy (`packages/agent-runtime/src/policy`) remains the sole fund-moving gate.
- No phase may let an LLM alter its own policy bounds, spend caps, or deterministic price/verdict
  clamps (Phase 10's rule generalizes to every phase above it).
- Anything framed as "learning," "reflection," or "adaptation" lands as a persisted, reviewable
  artifact before it can change future behavior — never a live self-rewrite mid-session.

## Testing

```sh
# Unit tests for tools and loop integration
npm test -w harness-runtime

# Seller agent e2e (confirms escrow path untouched)
npm test -w seller-agent
```

New phases should follow the same pattern established by Phases 1–2: unit-test the new tool(s) and
loop wiring in isolation, confirm the existing agent e2e suites still pass unchanged, then a manual
flag-gated run (`BID_REVIEW_ENABLED=1`-style opt-in) before making a phase the default.
