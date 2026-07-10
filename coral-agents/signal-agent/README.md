# signal-agent

`signal-agent` turns live TxODDS odds movement into paid research `WANT`s for the marketplace's
[research market](../../examples/marketplace/research.ts). It is the Coral-native replacement for
hand-running `examples/txodds/research/watcher.ts` as a bare, unbounded HTTP script: same
poll-and-diff logic, but a proper `coral-agents/*` citizen — its own tests, Dockerfile,
`coral-agent.toml` — that joins the CoralOS session (visible in Coral Console and the marketplace
web app's "Coral bus" tab) and bounds its poll loop with `@pay/agent-runtime`'s agent-safety
framework (`BudgetGuard` + `StepCounter`) instead of looping forever unsupervised.

## Why it exists

The research market (`npm run research`) previously needed the TxODDS watcher hand-run as a fourth,
unrelated terminal (`cd examples/txodds && npm run watch`), invisible to CoralOS and with no
resource bound. `signal-agent` folds that role into the agent roster: it's a specialist that
*detects*, with no wallet and no verdict authority — the same `detect` capability slot the shared
framework reserves for exactly this role (see `packages/agent-runtime/src/agent/capability.ts`).

## Messages

It does not reply to mentions — it is a pure observer. On every detection it posts one line to its
own `signal-log` thread, so the detection is visible on the bus even if nothing else is watching:

```text
SIGNAL kind=new-fixture|odds-move fixtureId=<id> [movePct=<pp>] note="<board-derived text>"
```

## HTTP contract (unchanged from the watcher)

| Endpoint | Purpose |
|---|---|
| `GET /next` | Pop the next queued event as a buyer `WANT` shape (`{service, arg, budgetSol?, note}`), or `204` when quiet. |
| `GET /queue` | Current queue, for debugging/dashboards. |
| `GET /api/health` | `{ ok, queued, toolCalls, steps }` — includes live safety-gate counters. |

## Run

Same run shape as the watcher it replaces — start the TxODDS proxy first, then this, from the repo root:

```sh
cd examples/txodds && npm run proxy
cd coral-agents/signal-agent && npm install && npm run build && npm start
```

Point the research market at it exactly as it pointed at the watcher:

```sh
docker compose up -d coral
cd examples/marketplace && npm run research   # WANT_FEED_URL defaults to :4600, same port
```

`coral-agent.toml` also declares a Docker runtime for `signal-agent`, but the verified, documented
path today is running it as a host process (as above) — Coral-launched containers reaching a
host-run TxODDS proxy, and a buyer container reaching a Coral-launched signal-agent container by
HTTP, are both real Docker-networking questions this kit has not exercised end-to-end yet. Treat the
Docker runtime entry as forward-looking, not verified.

## Files

| File | Role |
|---|---|
| `src/detect.ts` | Pure board-diff logic (new-fixture / odds-move). |
| `src/detect.test.ts` | Unit tests. |
| `src/index.ts` | Coral connection, safety-bounded poll loop, and the `/next` `/queue` `/api/health` server. |

## Environment

| Variable | Description |
|---|---|
| `AGENT_NAME` | Defaults to `signal-agent`. |
| `PROXY_BASE` | TxODDS proxy base URL. Defaults to `http://localhost:8801`; use `http://host.docker.internal:8801` from inside Docker. |
| `POLL_MS` | Poll interval. Defaults to `15000`. |
| `MOVE_PCT` | Minimum implied-probability delta (pp) to flag. Defaults to `5`. |
| `PORT` | HTTP port. Defaults to `4600`. |
| `RESEARCH_BUDGET_SOL` | Optional per-event budget hint attached to `/next` responses. |
| `SIGNAL_MAX_TOOL_CALLS` | `BudgetGuard` tool-call cap. Defaults to `2000`. |
| `SIGNAL_MAX_DURATION_SECS` | `BudgetGuard` session-duration cap, seconds. Defaults to `21600` (6h). |

No wallet or signing key is required — this agent moves no funds and issues no verdicts.
