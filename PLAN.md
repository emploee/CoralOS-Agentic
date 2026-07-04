# PLAN.md — From Paid-Agent Demo to Agent-Commerce Operating Layer

## Thesis

This repo already owns the hard economic primitive: **WANT → BID → AWARD → DEPOSITED →
DELIVERED → RELEASED**, settled by a deployed Solana escrow + arbiter. What it pays today is
"an LLM returns a string." The upgrade is to make the thing being paid a **real agent harness
doing real work** — Claude Code, Hermes, Delve-style research swarms, Pi-Factory-style software
teams — with an auditable trace of what the harness actually did for the money.

> **This repo = market + payment + escrow.**
> **Harness bridge = any external coding/research agent can join the Coral market.**
> **Pattern repos = execution, memory, telemetry, policy, and Solana-native finance.**

Target one-liner: *a paid marketplace for agent harnesses — agents do useful work in real
harnesses, produce auditable artifacts, compete in a Coral market, and get paid through Solana
settlement.*

## What we already have (don't rebuild)

| Layer | Where | Status |
|---|---|---|
| Market protocol (WANT/BID/AWARD/ESCROW_REQUIRED/DEPOSITED) | `packages/agent-runtime/src/market/protocol.ts` | ✅ typed, parsed, tested |
| CoralOS MCP client + session plumbing | `packages/agent-runtime/src/coral/` | ✅ |
| Escrow + arbiter (deposit / release / refund, 3-party) | `examples/txodds/escrow/` (deployed devnet) | ✅ settlement spine |
| Buyer / seller / broker / user-proxy agents | `coral-agents/` | ✅ launched per session by coral-server |
| Competitive bidding round + SSE feed + visualizer | `examples/marketplace/` | ✅ |
| Devnet guard, Solana Pay, reference-bound payments | `packages/agent-runtime/src/solana/` | ✅ |
| The fork point | `examples/txodds/agent/service.ts` `deliverService()` | ✅ — this is what harnesses replace |

## Source repos and what each contributes

| Repo | Pattern we take | Feeds phase |
|---|---|---|
| [renxinxing123/tutorial_orchestrate_agent_harnesses](https://github.com/renxinxing123/tutorial_orchestrate_agent_harnesses) | Coral-server registers external harnesses via `coral-agent.toml`; session mints per-agent MCP URLs; startup scripts inject the URL into the harness config (`.mcp.json` for Claude Code, `~/.hermes/config.yaml` for Hermes) | **2** |
| [xpriment626/delve](https://github.com/xpriment626/delve) | Coral-backed multi-agent research CLI: specialist agents, live sources, SQLite shared state, negotiation verdicts before finalization, structured final package | **4** |
| [xpriment626/pi-factory](https://github.com/xpriment626/pi-factory) | Long-horizon software factory: blackboard, kanban tickets, planner/architect/implementer/reviewer manifests, operator view | **3** (as one seller), later full adapter |
| [xpriment626/coding-agent-swarms](https://github.com/xpriment626/coding-agent-swarms) | Telemetry: per-iteration reasoning, tool calls, transcripts, raw session events, trace capture UI | **0**, **3** |
| [xpriment626/solana-coralised](https://github.com/xpriment626/solana-coralised) | Postmortem lesson: one skill ≠ one agent; separate protocol actions from coordination; policy middleware as a first-class layer | **5** |
| [xpriment626/refinery](https://github.com/xpriment626/refinery) | Coral-coordinated memory review over bounded files, run artifacts on disk | **6** |
| [xpriment626/savings-mcp](https://github.com/xpriment626/savings-mcp) | Boundary discipline: MCP tools produce structured recommendations; signing/custody/settlement stay outside the tool service | **5**, later finance sellers |
| [xpriment626/normandy-v1](https://github.com/xpriment626/normandy-v1) | Reputation-collateralized credit for agents (pluggable hook programs) | **future** — needs the Run Ledger's track record first |

---

## Phases (build order — each unlocks the next)

The five upgrades from the analysis map to phases as: Run Ledger → **0**, Harness Adapter
SDK → **1**, harness bridge → **2**, Paid Agent Freelancer Factory → **3**, TxLINE Research
Market → **4**, policy middleware → **5**.

### Phase 0 — Run Ledger (foundation, no new deps) — ✅ shipped (core)

*Status:* `packages/agent-runtime/src/ledger/` (types + fs store, tested) and feed persistence
are live: every `/api/feed` poll lands each round in `RUNS_DIR` (default
`examples/marketplace/runs/`), `/api/runs` lists the ledger, and `/api/feed` replays a session
from disk when coral-server is unreachable (`source: "ledger"`). Remaining: a dedicated "Runs"
tab in the visualizer, and `verification.json` (arrives with the Phase 3 verifier).

The moment money is involved, the question is *"what did the agent actually do?"* The answer
must be: click the run, see everything. Everything later (telemetry, verification, reputation,
credit) hangs off this.

**Build**
- `packages/agent-runtime/src/ledger/` — append-only run store. One folder per market round:

  ```
  runs/<session>/round-<n>/
    run.json           # the full RunRecord (what readers load)
    want.json          # the posted WANT
    bids.json          # every bid, with seller + price
    award.json         # winner + award reasoning
    escrow.json        # reference, seller, amount, deadline + deposit tx
    delivery.json      # delivered payload + sha256 content hash
    verification.json  # verifier verdict (Phase 3+)
    transcript.jsonl   # the round's Coral messages, in order
    txs.json           # every Solana signature with Explorer links
  ```

- Emit from the existing paths: `coral-agents/buyer-agent` writes want/award/escrow/txs;
  `coral-agents/seller-agent` writes bids/delivery; the marketplace feed
  (`examples/marketplace/feed/`) already folds session state into rounds — teach it to
  persist instead of only streaming.
- Bind `delivery.json`'s content hash to the escrow `reference` (the proxy already does
  `sha256(read)` — generalize that convention into the ledger).
- UI: a "Runs" tab in `examples/marketplace/web/` that lists rounds and expands into the
  full trail (messages → artifacts → Solana txs).

**Done when:** every `npm start` marketplace round leaves a complete run folder, and the
visualizer can replay a finished round from disk alone (coral-server down).

### Phase 1 — Harness Adapter SDK (`packages/harness-runtime`) — ✅ shipped

*Status:* `packages/harness-runtime` is live: the `HarnessAdapter` contract (`quote`/`run` —
`run` returns the hash-bound `Delivery` directly and streams `HarnessEvent`s via callback, a
simplification of the RunHandle sketch below), the shared LLM bidder moved from the seller
(`quote.ts`, same tests), and the `node-llm` baseline adapter wrapping `deliverService()`.
`coral-agents/seller-agent` now speaks the adapter (`HARNESS` env, default `node-llm`) with zero
behavior change; its Dockerfile builds the new package.

One interface so the market doesn't care whether the seller is a prompt or a factory.

**Build**
- New package `packages/harness-runtime/` (same `file:` dep pattern as `@pay/agent-runtime`):

  ```ts
  interface HarnessAdapter {
    quote(want: Want): Promise<Bid | null>;      // price/ETA/confidence, or decline
    run(order: Order): Promise<RunHandle>;        // start work in an isolated workdir
    deliver(handle: RunHandle): Promise<Delivery>; // artifact manifest + content hash + summary
    events(handle: RunHandle): AsyncIterable<HarnessEvent>; // → transcript.jsonl (Phase 0)
  }
  ```

  `Want`/`Bid` come from `@pay/agent-runtime` `market/` — do not fork the protocol types.
- First adapter: `node-llm` — wraps the current `deliverService()` path so the existing
  seller becomes "just another adapter" with zero behavior change.
- Refactor `coral-agents/seller-agent` to speak `HarnessAdapter` (adapter chosen by env,
  e.g. `HARNESS=node-llm`).

**Done when:** the marketplace round runs unchanged with the seller going through the
adapter interface, and its run folder includes adapter-emitted events.

### Phase 2 — External harness bridge (the Xinxing pattern) — ✅ shipped

*Status:* no separate `harness-seller` agent was needed — harnesses plug in *behind* the existing
seller via adapters (consistent with risk #1 below). Shipped in `packages/harness-runtime`:
`cliHarnessAdapter` (generic subprocess bridge: isolated per-order workdir, config-file injection,
prompt via stdin or `{prompt}` argv, stderr→events, timeout with tree-kill) and the `claude-code`
preset (headless `claude -p --output-format json`; with `CORAL_CONNECTION_URL` set it injects
`.mcp.json` + local settings trusting the session's Coral MCP URL). Any other harness rides
`HARNESS=cli HARNESS_CMD='hermes {prompt}'`. **Proven live**: a real headless Claude Code run
fulfilled a market order in an isolated workdir with a correct hash-bound delivery.
`Dockerfile.claude` bakes the CLI into the seller image.

Sellers stop being TypeScript loops; any harness that can hold an MCP config can join.

**Build**
- `coral-agents/harness-seller/` — a thin Coral-registered agent whose job is: receive the
  session's minted MCP URL, **inject it into the target harness's config**, launch the
  harness, relay market messages both ways, and stream harness events into the ledger.
  - `claude-code` launcher: write project `.mcp.json` + local settings trusting the Coral
    MCP server, start Claude Code headless in an isolated workdir.
  - `hermes` launcher: patch `~/.hermes/config.yaml` (scoped copy) with the Coral MCP URL.
- Register both in the coral config (`examples/agent-economy/config/coral.toml` /
  `docker-compose.yml` + `build-agents.sh`) as launchable local agents.
- Each launcher is also a `HarnessAdapter` (`claude-code`, `hermes`) so Phase 1's seller
  can drive it.
- Isolation: every order gets a fresh workdir under the run folder; the harness never sees
  wallet keys (see Phase 5 — the *seller agent* holds the payout identity, the harness only
  produces artifacts).

**Done when:** a marketplace round completes where the winning bid is fulfilled by Claude
Code running in a sandbox dir, and the run folder shows its transcript + delivered artifact.

### Phase 3 — Flagship demo: Paid Agent Freelancer Factory — ✅ shipped (core)

*Status:* shipped as `examples/freelancer/` + `coral-agents/verifier-agent/`. The protocol gained
`VERIFY`/`VERIFIED` (in `market/protocol.ts`, tested); the verifier agent runs deterministic
checks first (content-hash match, JSON structure, no error payload) with an optional LLM
acceptance judge; the buyer gates release on the verdict when `VERIFIER_AGENT` is set (no verdict
→ funds stay refundable). Sellers: `seller-scribe` (node-llm baseline via the new `freelance`
service) and `seller-claude` (Claude Code harness persona; `CLAUDE_SELLER=1`). The feed folds
verification + `ARBITER_RELEASED` (a pre-existing gap: arbiter rounds — the default — never showed
settled) and the ledger now writes `verification.json`.
**Validated live on devnet (2026-07-04), both paths:** session `019ed3d8…` — seller's LLM broken →
honest error payload → verifier **fail** → policy refused release ×6, funds refundable; session
`e5e5ccc9…` — delivery → verifier **pass** → `ArbitrateRelease` CPI on-chain (e.g. tx `3MEWxbYU…`),
2 rounds settled; both sessions fully captured in the run ledger and reflected in `/api/reputation`
(seller-scribe: 8 won, 2 settled, 5 verify-fails, score 44). Two bugs found by the live round and
fixed: launchers didn't pass `ARBITER_KEYPAIR_B58` (buyer crashed in default arbiter mode), and
`complete()` used `??` so the coral-manifest default `LLM_MODEL=""` overrode the per-provider model
(Anthropic 400 — masked everywhere else by deterministic fallbacks). Remaining: pi-factory team
adapter (stretch), award scoring beyond best-value LLM + cheapest fallback.

The judge-facing story. A buyer posts real work; heterogeneous harnesses compete.

**Build**
- `examples/freelancer/` (sibling of `examples/marketplace/`, reuses its feed + web):
  - Buyer posts a WANT like *"build a landing page"* / *"code-review this diff"* /
    *"data dashboard for this CSV."*
  - Sellers bidding: `node-llm` (cheap, fast, shallow), `claude-code` (mid), `hermes`
    (mid), and — stretch — a `pi-factory` team adapter (planner → architect →
    implementer → reviewer).
  - Buyer awards on price × ETA × confidence (extend the existing `pickCheapest` in
    `market/protocol.ts` with a scoring hook rather than replacing it).
- **Verifier agent** (`coral-agents/verifier-agent/`): independent Coral agent that checks
  the delivery against the WANT's acceptance criteria (tests pass, artifact hash matches,
  summary honest) and writes `verification.json`. Release goes through the **arbiter**
  program (already deployed) with the verifier verdict as the gate — this is exactly the
  3rd-signer role the arbiter was built for.
- Dashboard: full path per run — WANT, bids, award reasoning, escrow tx, harness trace,
  delivered artifact, verifier verdict, release tx.

**Done when:** one command brings up the round, three different harness types bid, the
winner delivers a real artifact (patch + test log + summary), the verifier gates the
arbiter release, and the dashboard replays all of it.

### Phase 4 — TxLINE Research Market (Delve pattern) — ✅ shipped (core)

*Status:* shipped as `examples/research/` + an event mode in the buyer. `detectEvents` (pure,
tested) diffs the oracle proxy's `/api/board` snapshots — new verified fixtures and implied-
probability moves ≥ threshold; the watcher queues them; the buyer polls `WANT_FEED_URL` and posts
a WANT per event (**quiet board → no WANT → no spend**). Specialist personas `seller-moves` /
`seller-stats` compete with `seller-worldcup` on the verified read; the verifier gates release.
A Delve-style deep-research tier joins via `HARNESS=cli HARNESS_CMD='delve {prompt}'` — documented,
not bundled. Remaining: richer sourced-package delivery schema (claims + evidence links beyond the
TxLINE-verified read), live Docker round validation.

Upgrades the World Cup oracle from "LLM reads odds" to specialist research with evidence.

**Build**
- A TxLINE odds/match event triggers a WANT (hook into `examples/txodds/server/proxy.ts`'s
  board polling).
- Specialist sellers (personas under `coral-agents/`, same pattern as `seller-worldcup`):
  market-movement detector, lineup/news agent, statistical-model agent — each delivering a
  **sourced package** (claims + evidence links + confidence), not a bare string.
- `delve` adapter in `packages/harness-runtime` for the deep-research tier.
- The existing `deliverService()` becomes the final aggregation step: the paid insight,
  reference-bound to the evidence package hash.

**Done when:** an odds move on the live board produces a WANT, specialist bids, an awarded
sourced package, and an escrow settle — visible in both the Oracle UI and the run ledger.

### Phase 5 — Policy middleware (before anything touches more money) — ✅ shipped (core)

*Status:* `packages/agent-runtime/src/policy/` is live: pure `enforce(action, policy)` returning
every violated rule — spend-cap-round, spend-cap-session, **award-price** (a real hole this closed:
the buyer never checked `ESCROW_REQUIRED.amount` against the winning bid, so a seller could inflate
after the award), service-allowlist, payout-binding (subsumes `guard.ts`'s inline check),
rate-limit, and verifier-gate on release. The buyer routes every deposit AND release through it
(`policyFromEnv`, `POLICY_*` env, session spend tracked); hostile cases are unit-tested (wrong
payout, price inflation, cap breaches, all-violations-collected). Keys stay in agent processes —
harness adapters never see them (enforced structurally since Phase 2). Remaining: wire the same
choke point through `broker/` (both legs) and the agent-economy bridge; simulation-before-send.

The solana-coralised lesson: policy as a first-class layer, not scattered checks. The
savings-mcp lesson: tools recommend; only the settlement layer moves funds.

**Build**
- `packages/agent-runtime/src/policy/` — a single `enforce(action, ctx)` choke point that
  every escrow request / release / refund passes through:
  - max spend per round + per session (buyer side),
  - devnet guard (already in `solana/connection.ts` — route it through here too),
  - service allowlist (which WANT types this wallet may buy/sell),
  - payout wallet binding (bid's payout address == awarded seller's registered wallet),
  - delivery-hash binding (release only if `delivery.json` hash == escrow `reference`),
  - rate limits, and simulation-before-send where relevant.
- Wire into `coral-agents/buyer-agent`, `broker/` (both legs), and the bridge
  (`examples/agent-economy/bridge/`).
- Hard rule enforced structurally: **harness processes never hold keys.** Keys live only in
  the buyer/seller agent processes; adapters exchange artifacts and hashes.

**Done when:** a hostile-seller test (wrong payout wallet, tampered artifact hash,
overpriced re-bid) is refused by policy with a logged reason in the run folder.

### Phase 6 — Memory & reputation (Refinery pattern) — ✅ shipped (core)

*Status:* reputation is **derived from the run ledger, not asserted**:
`packages/agent-runtime/src/ledger/reputation.ts` folds persisted runs into per-seller track
records (awarded/delivered/settled/verify-fails/refunds → a 0–100 score; tested incl. the no-show
and verify-fail cases), the feed serves it at `/api/reputation`, and the buyer (`REPUTATION_URL`)
folds the lines into its best-value award prompt — "a cheap seller that fails verification is not
a bargain". Remaining: Refinery-style periodic memory review, per-seller memory of *why* bids
won/lost (the ledger currently holds outcomes, not reasoning).

Sellers stop being stateless; the ledger becomes a track record.

**Build**
- Per-seller memory dir (what sold, what was accepted/refunded, buyer complaints, which
  reasoning worked), written from run outcomes.
- A Refinery-style periodic review pass (Coral-coordinated) that compacts and audits those
  memories so they don't rot; proposals land as artifacts, not silent edits.
- Reputation score derived from the run ledger (delivery rate, verifier pass rate, refund
  rate) surfaced in the bid — buyers can weigh it in award scoring (Phase 3 hook).

**Done when:** a seller's bid quality visibly changes based on its own history, and the
buyer's award reasoning cites reputation.

### Future (explicitly out of scope for now)

- **Finance rails:** savings-mcp-style read-only opportunity sellers; Normandy-style
  reputation-collateralized credit ("agents build credit and access working capital") —
  requires a mature Phase 6 track record first.
- **Mainnet anything.** The kit stays devnet-only (`assertDevnet` guard remains).
- **Daytona/cloud sandboxes** for harness isolation — local workdirs are enough until
  Phase 3 is stable.

---

## Risks & lessons baked into the ordering

1. **One skill ≠ one agent** (solana-coralised postmortem). Agents are scoped economically —
   data seller, verifier, broker, arbiter — not per protocol action. That's why harnesses
   plug in *behind* the seller agent (Phase 1/2) instead of each becoming its own Coral agent.
2. **Custody boundary** (savings-mcp). MCP tools and harnesses produce structured outputs;
   only the agent processes with policy enforcement sign transactions. Enforced in Phase 2,
   codified in Phase 5.
3. **Trace before scale** (coding-agent-swarms). The Run Ledger is Phase 0 on purpose: paid
   work without a trace is a novelty; paid work with a replayable trail is infrastructure.
4. **Don't fork the protocol.** All phases extend `market/protocol.ts` types and the
   deployed escrow/arbiter programs. If a phase seems to need a protocol change, it's a
   design smell — add a message type, don't fork the flow.
5. **Windows/dev-loop friction.** External harness launchers (Phase 2) are the flakiest
   part — keep the `node-llm` adapter as the always-works fallback so demos never depend on
   an external harness booting.

## Immediate next steps

1. Phase 0: scaffold `packages/agent-runtime/src/ledger/` + persist marketplace rounds.
2. Phase 1: extract `HarnessAdapter` + `node-llm` adapter (pure refactor, protected by the
   existing marketplace round as the regression test).
3. Phase 2 spike: get Claude Code joining one Coral session via injected `.mcp.json`,
   following the tutorial repo's startup-script pattern, before building the full launcher.
