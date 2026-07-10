# Agent Orchestration — from a market script to real agents

This document is the deep-dive companion to `examples/marketplace/`. It explains a pattern set for
building genuinely autonomous, auditable, capability-scoped agents — where it came from, exactly
which pieces of it now exist in this repo as TypeScript, and how to extend your own fork the same
way.

## Why this document exists

A "market script" reads env vars, calls an LLM once, formats a market message, and exits. A "real
agent" has a bounded decision loop, a declared and checked set of things it's allowed to do, a
resource budget it cannot raise itself, and a tamper-evident record of every call it made — whether
or not anything ever goes wrong. The gap between those two is not about which LLM you call; it's
about the scaffolding around the call.

The pattern set below is generalized from a more mature sibling implementation of this same
TxODDS/CoralOS/Solana idea, built in Rust (a `agent-core` crate, a Tauri desktop shell, Python
CoralOS stubs) rather than this repo's pure TypeScript. **Nothing from that codebase is imported or
vendored here** — TypeScript has no compile-time capability tokens, no Tauri IPC boundary, and this
kit's whole premise is "fork one function, stay in one language." What follows is a from-scratch TS
port of the *ideas*, built on top of the primitives this repo already had (the market protocol, the
policy choke point, the run ledger) rather than beside them.

Read this after `CORAL.md` (how CoralOS coordination works) and `examples/marketplace/README.md`
(how to run the market). This document is about what happens *inside* one agent process, and how
agents observe and grade each other over time.

## The maturity ladder

Use this to place your fork, and to know what the next rung looks like.

| Rung | Shape | Example in this repo |
|---|---|---|
| 0 — script | Reads env, calls an LLM once, prints output. No loop, no bounds, no audit trail. | — (nothing in this repo ships at this rung) |
| 1 — policy-gated | A market participant whose fund-moving actions pass through one enforced choke point. | `packages/agent-runtime/src/policy/policy.ts` gating every buyer deposit/release |
| 2 — capability-scoped | The agent's non-financial permissions (may bid? may verify? may detect?) are also explicit and checked, not implied by which container image it happens to be. | `packages/agent-runtime/src/agent/capability.ts` |
| 3 — safety-bounded | The agent's *process*, not just one action, is bounded: max tool calls, max spend, max duration, max consecutive steps. | `packages/agent-runtime/src/agent/safety.ts`, used by `coral-agents/signal-agent` |
| 4 — audited tool loop | Multi-turn reasoning where every tool call — attempted, blocked, succeeded, or failed — is written to a trace before the result is known, and the model must terminate via a structured call, not free text. | `packages/agent-runtime/src/agent/loop.ts` |
| 5 — self-evaluating fleet | Many differentiated agents whose calls are graded against later ground truth, ranked on a live scoreboard, with the full reasoning trail visible in an operator UI. | `evaluateDirectionalCall()` + `ArenaLeaderboard.tsx` + `AgentTraceLog.tsx` (this repo has the pieces; wiring an actual multi-strategy contest is the open next step — see [Where to go next](#where-to-go-next)) |

This repo's `coral-agents/buyer-agent`, `seller-agent`, and `verifier-agent` sat at rung 1 before
this pass (a real policy choke point, but no capability model, no process-level budget, no
structured multi-turn tool loop for the LLM parts of `llm_buyer.ts`). `signal-agent` is the first
agent built at rung 3. Nothing in this repo is at rung 5 yet end-to-end — the leaderboard/trace UI
exists and the evaluation primitive exists, but no agent currently calls
`evaluateDirectionalCall()` in anger. That's the honest state; see below for how to close it.

## Architecture map

```text
┌─ packages/agent-runtime/src/agent/ ──────────────────────────────────────┐
│  capability.ts   who may do what           (replaces: implied by role)   │
│  safety.ts        BudgetGuard, StepCounter, wrapUntrusted (process bound)│
│  tools.ts          Tool contract + ToolCallRecord audit shape             │
│  evaluation.ts    rank/best + evaluateDirectionalCall (self-grading)     │
│  loop.ts            runToolLoop() — bounded, provider-agnostic tool loop  │
└─────────────────────────────────────────────────────────────────────────┘
                 │ used by (today)                 │ designed for (adopt next)
                 ▼                                  ▼
      coral-agents/signal-agent          coral-agents/buyer-agent (llm_buyer.ts),
      (BudgetGuard + StepCounter          seller-agent, and any new specialist —
       bound its poll loop)               see the worked example below

┌─ examples/marketplace/web/src/components/ ───────────────────────────────┐
│  AgentTraceLog.tsx     renders LlmUse[] per round — provider/model/      │
│                        status/guardrail/hashes, never prompts/completions │
│  ArenaLeaderboard.tsx  ranked seller scoreboard from the SAME ledger-    │
│                        derived reputation() the buyer already reads      │
└─────────────────────────────────────────────────────────────────────────┘
```

Nothing above replaces `packages/agent-runtime/src/policy/policy.ts`. Policy is still the *only*
place a deposit or release is authorized — it answers "is this specific fund movement allowed
right now." The new `agent/` module answers a different question: "is this whole agent process
behaving within its declared bounds." A seller can be perfectly policy-compliant (never asks for
more than the awarded price) while still being a liability (loops forever, calls a paid upstream
API 10,000 times, or attempts a tool it was never granted). Rung 1 catches the first kind of
problem; rungs 2–4 catch the second kind.

## The five primitives

### 1. Capability grants (`agent/capability.ts`)

```ts
export type Capability = 'bid' | 'deliver' | 'verify' | 'settle' | 'detect'

const grant = grantCapabilities('signal-agent', ['detect'])
requireCapability(grant, 'settle') // throws — signal-agent was never granted this
```

The reference architecture does this at compile time (Rust zero-sized types + sealed traits — the
compiler literally refuses to build a binary that hands a `FollowCap`-only agent a `settle` tool).
TypeScript has no equivalent. This is the honest runtime analogue: a grant is constructed once at
process startup from config, never from model output or a Coral message, and every capability-gated
action takes it as an explicit argument. It's a runtime check you can unit-test against hostile
inputs (`capability.test.ts` does exactly that) — the same discipline `policy.enforce()` already
uses for money, extended to everything else an agent might attempt.

**When to reach for it:** the moment you add a second *kind* of agent action beyond
bid/deliver/verify/settle (this repo's existing four, which the market protocol already encodes).
`detect` was added for `signal-agent`. If you add, say, an arbiter-analyst role that can only read
proof state and never settle, give it its own capability rather than overloading `verify`.

### 2. Safety gates (`agent/safety.ts`)

```ts
const budget = new BudgetGuard({ maxToolCalls: 2000, maxSpendLamports: 0, maxDurationSecs: 6 * 3600 })
const steps = new StepCounter(2000)

while (true) {
  budget.check()   // throws BudgetExceededError if any limit is hit
  steps.tick()      // throws StepCapExceededError past the cap
  // ... one iteration of work ...
  budget.recordToolCall()
}
```

Three independent limits — tool-call count, lamport spend, wall-clock duration — plus a consecutive
step counter, none of which the agent itself (or a prompt-injected instruction) can raise, because
the guard is constructed outside the loop and passed in by reference. `wrapUntrusted(label, text)`
delimits third-party text before it enters a prompt — not a complete prompt-injection defense, but
the minimum structural hint a well-designed system prompt can use, and it truncates at 32 KiB so a
runaway API response can't fill the context window.

**This is not a replacement for `policy.ts`'s spend caps.** Policy's `maxSolPerRound` bounds what a
single deposit may ask for; `BudgetGuard.maxSpendLamports` bounds cumulative spend an agent
*process* causes across its whole run (useful for an agent that itself pays for upstream context,
like the broker or a Pay.sh-procuring seller). A pure observer like `signal-agent` sets
`maxSpendLamports: Number.MAX_SAFE_INTEGER` because it is structurally incapable of spending — it
holds no wallet. Set the limit to match what the agent can actually do, not a copy-pasted default.

### 3. Tools + audit trail (`agent/tools.ts`)

```ts
export interface Tool<Input, Output> {
  readonly name: string
  readonly description: string
  readonly capability?: Capability   // checked by the loop runner before execute() ever runs
  execute(input: Input): Promise<Output>
}
```

Every tool call the loop runner attempts produces a `ToolCallRecord` — written with
`capabilityGranted` and an `outcome` of `pending → success | blocked | failed | timedOut` — so a
denied capability shows up as a *record*, not a silent no-op. This is the same shape
`AgentTraceLog.tsx` was built to render once an agent starts emitting them (today the market's own
audit trail is `LlmUse[]`, described below; `ToolCallRecord[]` is the framework-level trail for
agents that adopt `runToolLoop`).

### 4. The bounded tool-calling loop (`agent/loop.ts`)

This is the centerpiece, and the one place this port makes a deliberate, documented trade-off
against both its inspiration and against `coral-agents/buyer-agent/src/llm_buyer.ts`.

`llm_buyer.ts` already has a real multi-turn tool loop — but it's hand-rolled directly against
`@anthropic-ai/sdk`'s native `tool_use` blocks, so it only runs under Anthropic. This repo's shared
`llm/complete.ts` shim is deliberately provider-agnostic (Venice/OpenAI/Anthropic, ~150 lines, one
`fetch` call) and does **not** expose native function-calling, by design — adding it would triple
the shim's surface area for three different providers' tool-call schemas.

`runToolLoop()` gets multi-turn tool use out of that primitive a different way: each round, it asks
the model to reply with one strict JSON object —

```text
{"tool": "<tool name>", "input": {...}}
```

— parses it with the existing `parseJsonReply()` (the same helper `verify.ts` and `service.ts`
already use), executes the named tool if one matches, and feeds the result back into the next
round's prompt, wrapped with `wrapUntrusted()`. The model must terminate by calling a designated
final tool — never by prose — so the caller gets a typed result instead of scraping free text. This
is the *same* "model proposes structured JSON, deterministic code decides" contract the whole repo
already runs on (`decideBid`-style patterns, `checkDelivery`'s deterministic-then-LLM order); the
loop just runs it more than once.

```ts
const outcome = await runToolLoop({
  agentId: 'signal-agent',
  system: 'You are a sharp-money analyst...',
  initialPrompt: `Fixture ${id}: current ${now}, previous ${prev}`,
  tools: [fetchOddsSnapshot, computeSharpMovement, submitSignalDecision],
  finalToolName: 'submit_signal_decision',
  maxRounds: 6,
  budget, steps,
})

// Pull the DETERMINISTIC tool's own result out of the trace — never trust the model's
// self-reported summary of what a tool returned.
const movement = toolResult(outcome, 'compute_sharp_movement')
```

`toolResult()` exists specifically so callers can enforce the same rule
`sharp-movement-detector`'s Python/Rust ancestors do: a deterministic tool's own output gates the
decision (is this move actually sharp?); the model's free-text rationale is *always* advisory,
recorded for the trace, never load-bearing.

**Trade-off, stated plainly:** you lose provider-native tool-schema validation and get one loop that
runs identically under Venice, OpenAI, or Anthropic. If you need strict JSON-schema enforcement on
tool arguments, validate `parsed.input` yourself inside `tool.execute()` before acting on it — the
loop hands you the parsed object, not a validated one.

### 5. Evaluation (`agent/evaluation.ts`)

```ts
rank(options)                       // sort ScoredOption<T>[] descending, stable on ties
best(options)                       // top-ranked option, or undefined
evaluateDirectionalCall(predicted, before, after)  // grade a past call against later reality
```

Small and deliberately unopinionated — `rank`/`best` generalize the "pick the best bid" comparison
buyer-agent already does inline, so a signal agent ranking candidate fixtures or a broker ranking
upstream quotes can reuse the same stable-sort contract instead of hand-rolling `Array.sort`.
`evaluateDirectionalCall` is the seed of self-grading: it earns `'correct'` only from a **later
observed fact**, never from the agent's own confidence score — mirroring the reference
architecture's prediction-tracking loop (an agent notes "odds were 2.10, I called shortening"; the
*next* poll either confirms or reverses it). No agent in this repo calls it yet; see below.

## Signal agents: the specialist pattern

`coral-agents/signal-agent` is the first agent built on this framework, and the concrete answer to
"how do I add a new kind of participant, not just a new seller persona." Existing sellers
(`seller-worldcup`, `seller-cheap`, `seller-scribe`, …) are the *same* Docker image with different
`coral-agent.toml` options — persona, floor price, service list. A **specialist** is different code:
a new role the market didn't have before.

`signal-agent` replaces hand-running `examples/txodds/research/watcher.ts` as a bare, unbounded
HTTP script with a proper `coral-agents/*` citizen:

| Before | After |
|---|---|
| A script you `node` directly, invisible to CoralOS. | A participant that connects via `startCoralAgent`, shows up in the Coral Console and session roster. |
| No resource bound — polls forever. | `BudgetGuard` + `StepCounter` cap tool calls and duration; trips → logs and shuts down cleanly. |
| Detected events only visible via its own `/queue` HTTP endpoint. | Also posts a `SIGNAL ...` line to its own Coral thread on every detection — visible on the bus like every other agent's messages. |
| No declared permission model. | Holds the `detect` capability and nothing else — it cannot bid, deliver, verify, or settle, by construction, not by convention. |

It keeps the exact `/next` `/queue` `/api/health` HTTP contract the watcher had, so
`examples/marketplace/research.ts`'s `WANT_FEED_URL` buyer wiring needed zero changes — see
`coral-agents/signal-agent/README.md` for the run instructions and an honest note about what parts
of the Docker-launch path are verified versus forward-looking.

### Worked example: adding your own specialist

Say you want a `contrarian-agent` that watches the same board and deliberately proposes research on
the *opposite* read from what `signal-agent` flags (mirroring the reference architecture's
FollowSharp/FadeSharp pattern). The shape:

1. **New workspace member**: `coral-agents/contrarian-agent/` — copy `signal-agent`'s
   `package.json`/`tsconfig.json` verbatim (they're generic).
2. **Grant it a capability**: it only detects, like `signal-agent` — `grantCapabilities('contrarian-agent', ['detect'])`. If it should also *bid* into the research market with its own persona, grant `'bid'` too and give it a `coral-agent.toml` describing that.
3. **Bound its loop**: construct one `BudgetGuard`/`StepCounter` pair at startup with limits sized to what it actually does (a pure poller needs no spend cap; a bidder needs one via `policy.ts`, not this module).
4. **If it reasons with an LLM**, use `runToolLoop()` rather than a bespoke `complete()` call: define its tools (a read-only board fetch, a deterministic "does this move disagree with consensus" computation, a `submit_contrarian_call` final tool), set `finalToolName`, and pull the deterministic tool's result out via `toolResult()` — never trust the model's own summary for the boolean that gates a signal.
5. **Grade it later**: once it has emitted enough calls with a clear predicted direction, feed pairs of (predicted, before, after) through `evaluateDirectionalCall()` on a schedule (a cron script, or a step in `arena-coordinator`-equivalent code you write) and persist the result — this is the piece that turns "an agent that talks" into "an agent with a track record," the same way `reputation()` already turns settled rounds into seller scores.
6. **Register it in the roster docs**: add a row to `coral-agents/README.md`'s Agents table and `CORAL.md`'s Agent Roles table, matching every other agent's documentation shape.
7. **Wire it into the web UI for free**: if it emits `LLM_USED`-shaped audit entries into a round (via the market protocol, same as every seller/verifier already does), `AgentTraceLog.tsx` renders it with no changes. If you want it on a leaderboard, its settled outcomes need to reach `packages/agent-runtime/src/ledger`'s run records the same way seller awards do — `reputation()` (or a new sibling function, if the scoring formula should differ for a non-seller role) then makes it show up in `ArenaLeaderboard.tsx` automatically.

Steps 1–4 are mechanical (this repo's conventions plus the new framework). Step 5 is the genuinely
open piece — no code in this repo currently closes the loop from "signal detected" to "graded
against what actually happened." That's the most valuable next PR if you want to push this kit
further up the maturity ladder; see below.

## Proof, verification, and the audit trail — what already existed

Two pieces of this pattern set predate this document and did not need porting, only surfacing:

**Verification.** `coral-agents/verifier-agent/src/verify.ts`'s `checkDelivery()` already runs
deterministic checks (content hash matches, payload is JSON, payload isn't a top-level error
report) *before* an optional LLM acceptance judge — exactly the "deterministic gate first, model
opinion second, model can never override a deterministic fail" shape the reference architecture's
`proof-guard-agent` and native `services::proof` module implement. Nothing needed to change here;
if you want a stronger gate (e.g. a real on-chain proof check rather than hash/structure), extend
`checkDelivery`, don't build a parallel path.

**The audit trail.** Every seller/verifier/buyer action that touches an LLM already emits an
`LlmUse` record (`packages/agent-runtime/src/market/protocol.ts`) — provider, model, `usedFor`,
`inputHash`/`outputHash` (never the prompt or completion text itself), `affectedFunds` (always
`false` by construction — models propose, policy/verifier code disposes), and an optional
`guardrail` note. The feed server (`examples/marketplace/feed/src/foldRounds.ts`) already folded
this into every `Round`, and the browser already received it over `/api/feed` — **the only gap was
that the browser-side type definitions and every component were missing it.** `AgentTraceLog.tsx`
closes that gap: zero backend changes, one new component, one new field in
`examples/marketplace/web/src/types.ts`. If your fork adds a new agent, emit `LlmUse` records the
same way `service.ts`/`verify.ts` do and you get this UI for free.

**Reputation.** `packages/agent-runtime/src/ledger/reputation.ts`'s `reputation()` was already a
real, ledger-derived (never self-asserted) score — 60% settle rate, 30% delivery rate, 10%
verification cleanliness — and the buyer already folds it into award reasoning. `ArenaLeaderboard.tsx`
is a UI-only addition: same `/api/reputation` data `ReputationPanel` already showed as a compact
strip, now also as a ranked scoreboard with the full breakdown per seller.

## What is deliberately not ported, and why

| Reference piece | Why it stays out of this kit |
|---|---|
| Compile-time capability tokens (Rust sealed traits / ZSTs) | No TypeScript equivalent; `agent/capability.ts` is the honest runtime analogue, not a workaround. |
| The Tauri desktop shell + native IPC boundary | This kit is browser + Node only, on purpose — no desktop shell of any kind ships here. If you need a local operator UI, keep it to a thin read-only web view over the feed server's HTTP APIs, the same boundary `examples/marketplace/web` already uses. |
| The Python `coral_agent` shared specialist framework | Its `Specialist` base class (connect, poll `DELEGATE` messages, dispatch, reply) is a good pattern, but this repo's agents are already independent processes reachable directly by CoralOS mentions — there's no orchestrator-delegates-to-specialist hop to build a framework around yet. If you add a multi-agent debate/delegation flow (one agent fanning work out to several others within a single round), port this pattern then, not before. |
| Yellowstone gRPC chain streaming, on-chain wager/arena programs | Out of scope for a devnet reference kit whose settlement path is the existing escrow/arbiter Anchor programs; adding a second on-chain program family is a large, separate decision the repo hasn't made. |
| A kill switch | The reference architecture's own `ROADMAP.md` removed this by explicit product decision in favor of the budget/step guards above — same call here. `BudgetGuard`/`StepCounter` are the enforcement; there is no global "trip everything" flag anywhere in this repo. |

## File map — what's new vs. what already existed

| File | Status | Ports |
|---|---|---|
| `packages/agent-runtime/src/agent/capability.ts` | new | Capability tokens, runtime-checked |
| `packages/agent-runtime/src/agent/safety.ts` | new | `BudgetGuard`, `StepCounter`, `wrapUntrusted` |
| `packages/agent-runtime/src/agent/tools.ts` | new | `Tool` contract, `ToolCallRecord` audit shape |
| `packages/agent-runtime/src/agent/evaluation.ts` | new | `rank`/`best`, `evaluateDirectionalCall` |
| `packages/agent-runtime/src/agent/loop.ts` | new | Bounded provider-agnostic tool-calling loop |
| `coral-agents/signal-agent/` | new | The specialist-agent pattern, applied |
| `examples/marketplace/web/src/components/AgentTraceLog.tsx` | new | Renders pre-existing `LlmUse[]` data |
| `examples/marketplace/web/src/components/ArenaLeaderboard.tsx` | new | Renders pre-existing `/api/reputation` data |
| `packages/agent-runtime/src/policy/policy.ts` | unchanged | The fund-movement choke point — still the only path to a deposit/release |
| `coral-agents/verifier-agent/src/verify.ts` | unchanged | Deterministic-gate-then-model verification |
| `packages/agent-runtime/src/ledger/reputation.ts` | unchanged | Ledger-derived scoring |
| `packages/agent-runtime/src/market/protocol.ts` | unchanged | `LlmUse`/`WANT`/`BID`/... wire format |

## Where to go next

If you're extending this kit further, in roughly increasing order of effort:

1. **Adopt the loop in `llm_buyer.ts`.** It already has a real bounded tool loop; porting it onto `runToolLoop()` would make it provider-agnostic and give it a `ToolCallRecord` trail for free, at the cost of native Anthropic tool-schema validation (see the trade-off note above).
2. **Add a second specialist** using the worked example above — a contrarian read, a fundamentals model, a fan-facing narrative agent. Each is a small, independently testable package; none require touching `buyer-agent`, `seller-agent`, or the protocol.
3. **Close the evaluation loop.** Nothing currently calls `evaluateDirectionalCall()` against a real signal. A small scheduled job (or a step inside a new `arena-coordinator`-equivalent script) that replays `signal-agent`'s JSONL-style detections against later board snapshots and persists the verdict would light up rung 5 of the maturity ladder end-to-end.
4. **Render `ToolCallRecord[]`** once an agent actually adopts `runToolLoop()` in the market path — `AgentTraceLog.tsx` renders `LlmUse[]` today; a sibling panel for the framework's own `ToolCallRecord[]` audit shape is a natural, low-risk follow-up once there's real data to show.
