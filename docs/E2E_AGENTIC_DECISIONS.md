# End-to-End Agentic Decisions

`docs/AGENT_DEPTH_PLAN.md`'s Phases 7–10 describe *categories* (planning, proactivity, persistent
goals, self-improvement) in one paragraph each. This document is the concrete version: every point
in the buyer/seller/verifier lifecycle where control currently belongs to a fixed script, what
judgment would replace it, and what that judgment actually weighs. `docs/BUYER_VERIFIER_LOOPS.md`
(Phases 3–4) is a prerequisite, not an alternative to this — it gets the award and verdict calls
into the same tool-loop shape Phase 1 already uses, which the decisions below build on.

## Reading the table

For each decision: **Today** (what the code does unconditionally), **Proposed** (what the agent
would judge instead), and **What it weighs** (the actual inputs to that judgment — not "the LLM
decides," but *on what basis*). A decision only belongs on this list if an agent choosing
differently would change *what happens*, not just *a number's value* — that's what separates this
from Phase 1/3/4's bounded micro-decisions.

## Buyer Agent (`coral-agents/buyer-agent/src/index.ts`)

| # | Decision | Today | Proposed | What it weighs |
|---|---|---|---|---|
| D1 | When to act | Fixed `CYCLE_MS` timer, or poll `WANT_FEED_URL` and act on whatever arrives. | Agent judges whether a detected opportunity (`research/watcher.ts`-style signal) is worth acting on *now* — vs. waiting, vs. skipping it entirely. | Recent session spend vs. budget, how similar opportunities performed last time, urgency of the signal. |
| D2 | What to request | Fixed `BUYER_SERVICE`/`BUYER_ARGS` rotation, or whatever the feed hands it. | Agent picks *which* of several candidate service/arg combinations to pursue this round. | Persistent goal (D-in Phase 9's goal config), which services have been reliable, budget remaining. |
| D3 | Which bid to award | Phase 3 (scoped): tool loop, deterministic value score. | Unchanged by this document — D3 stays a bounded micro-decision, not full agency. Listed for lifecycle completeness. | — |
| D4 | Whether to escalate to the verifier | Static: `VERIFIER_AGENT` set or not, same every round regardless of counterparty. | Agent decides *per round* whether this delivery warrants independent verification. | Seller's verification-pass history, order size relative to budget, how unusual the delivery looks vs. past deliveries from this seller. |
| D5 | Whether to proceed past `ESCROW_REQUIRED` | Mechanical: deposit if `policy.enforce()` passes, no judgment above that. | Agent can decline to deposit even when policy would allow it, if the awarded terms look anomalous. | Deadline/amount vs. this seller's historical `ESCROW_REQUIRED` terms; policy still has final veto either way. |
| D6 | What changes next round | Nothing — every round is stateless except a fresh reputation-lines fetch. | Reflection step reads recent `RunRecord`s and adjusts which sellers/services get weighted higher in D2/D3. | Win/loss and verification pass-rate per seller over the last N rounds. |

## Seller Agent (`coral-agents/seller-agent/src/index.ts`, `service.ts`)

| # | Decision | Today | Proposed | What it weighs |
|---|---|---|---|---|
| D7 | Whether to bid at all | Mechanical: `SERVICES` list membership + hard cost-floor guard, then price. | Agent decides bid/no-bid strategically, not just capability-gated. | Current in-flight order load, recent win rate for this service, whether this order fits the persona's specialization goal (Phase 9). |
| D8 | Price | Phase 1 (implemented): tool loop, clamped `[floor, budget]`. | Unchanged. Already real bounded agency — the template the rest of this doc extends. | — |
| D9 | Whether to procure upstream | Static: `PROCURE_RAIL=x402` on/off, same behavior every order when set. | Agent judges per-order whether the upstream resource is worth buying given this order's price. | Order price vs. procurement cost, whether the harness's deterministic fallback would be good enough without it. |
| D10 | How to deliver | Fixed: call the harness adapter, deterministic template + optional single inline LLM call (see `txlineEdge`'s `liveReadOrFallback`). | Real planning: agent breaks delivery into sub-steps (gather → synthesize → format) via `runToolLoop()`, adapting mid-delivery to what it finds. This is Phase 7 proper, scoped to one concrete consumer. | What the buyer's `arg` actually asks for, what upstream data returned, whether an intermediate result changes what's worth fetching next. |
| D11 | Strategy evolution | None. | Persona-level reflection adjusts `FLOOR_SOL` or which services to specialize in, based on aggregate stats. | Same history D6 reads, viewed from the seller side. |

## Verifier Agent (`coral-agents/verifier-agent/src/verify.ts`)

| # | Decision | Today | Proposed | What it weighs |
|---|---|---|---|---|
| D12 | Pass/fail judgment | Phase 4 (scoped): deterministic hash/structure gates, then tool loop. | Unchanged. | — |
| D13 | How thoroughly to check | Fixed: same checks every time, regardless of stakes. | Verifier decides how much scrutiny to apply — deeper multi-tool investigation for high-value or unfamiliar sellers, fast-path for known-good ones (the existing `txline` fixture fast path, generalized into a judgment instead of a hardcoded special case). | Order size, seller's verification history, whether the payload's shape matches what this seller has delivered before. |

## Build order

These aren't independent — most need shared infrastructure before they're buildable:

1. **History/memory read path** (Phase 6 prerequisite) — needed by D1, D4, D6, D7, D9, D11, D13. All of them judge against "what happened before," which means a reflection/lookup step over `RunRecord`s, not per-decision ad hoc queries. Build this once, reuse across all seven.
2. **Multi-step tool loop with intermediate state** (Phase 7 prerequisite) — needed by D10 specifically. `runToolLoop()` today runs to a single forced-final tool; D10 needs a loop that can use one tool's output to decide the next tool call, which the existing loop already supports mechanically (`transcript` accumulates prior results) — this is a matter of designing the tool set, not new plumbing.
3. **Proactive trigger** (Phase 8 prerequisite) — needed by D1 only. Requires `research/watcher.ts`'s event stream to be consumable outside the current `WANT_FEED_URL` poll shape.
4. **Persistent goal config** (Phase 9 prerequisite) — needed by D2, D7, D11. A goal needs somewhere to live (persona config, not a runtime-mutable value) before D2/D7/D11 have anything to weigh against.

Build (1) first — it unblocks the most decisions for the least new infrastructure.

## Invariants (unchanged from `AGENT_DEPTH_PLAN.md`, restated for this scope)

Every decision above is a judgment about **when**, **whether**, or **how carefully** — never about
**how much** or **what rule applies**:

- None of D1–D13 changes what `policy.enforce()` checks (`packages/agent-runtime/src/policy/policy.ts`)
  or what a `RELEASED`/`ARBITER_RELEASED` message requires. D5 can make the buyer *more* cautious
  than policy requires; it can never make it less.
- None of D1–D13 introduces a new market-protocol message or changes an existing one's shape
  (`packages/agent-runtime/src/market/protocol.ts` needs no edits for any of this).
- D6 and D11 ("what changes next round") produce a persisted, reviewable artifact — a reflection
  record, not a live rewrite of `policy.ts`, `clamp_price`, or any spend cap. Same rule as
  `AGENT_DEPTH_PLAN.md` Phase 10, restated here because D6/D11 are literally that phase applied
  concretely.
- D7/D9/D13 ("whether to act," "how thoroughly") can only make an agent *more* conservative than
  today's static behavior, never bypass a check that runs today unconditionally (e.g., D9 can
  choose not to procure; it cannot choose to procure *without* the existing x402 payment settling).

## What "agentic" means after this, honestly

Even fully built, this doesn't make policy/settlement judgment calls — that boundary holds by
design (see the Invariants above and the reasoning in `CLAUDE.md`). What it does change: today,
removing the LLM changes the *quality* of three numbers and the system behaves identically
otherwise. After D1–D13, removing the LLM would change *which rounds happen, with which
counterparties, how carefully, and what a seller chooses to specialize in* — the system would
behave differently, not just worse. That's the actual bar for "agentic" this document is aiming at.
