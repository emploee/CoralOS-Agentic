# Marketplace Feed Server

The feed server is an Express process that reads CoralOS extended session state, folds market messages into typed rounds, persists run ledger artifacts, and serves browser-safe JSON to the visualizer.

The browser never needs CoralOS credentials or direct Solana access.

## API

```text
GET  /api/health
GET  /api/feed?session=<sid>
GET  /api/runs
GET  /api/reputation
GET  /api/threads?session=<sid>
GET  /api/session?session=<sid>
GET  /api/events
POST /api/start
```

| Endpoint | Response purpose |
|---|---|
| `/api/health` | Process health. |
| `/api/feed` | Session id, typed rounds, update time, and source (`coral`, `fixture`, or `ledger`). |
| `/api/runs` | Run ledger records. |
| `/api/reputation` | Seller reputation derived from persisted runs. |
| `/api/threads` | Thread messages with `threadId`, participants, mentions, sender, text, and timestamp. |
| `/api/session` | Agent roster and session metadata. |
| `/api/events` | Proxied research watcher queue from `WATCHER_BASE` (`:4600` by default). |
| `/api/start` | Local market session launcher for the dashboard. |

## Ledger

Each live poll persists folded rounds under `RUNS_DIR`, defaulting to `examples/marketplace/runs/`.

Per-round artifacts:

```text
want.json
bids.json
award.json
escrow.json
delivery.json
verification.json
proof_receipts.json
txs.json
transcript.jsonl
run.json
```

`transcript.jsonl` preserves bus context such as thread ids, mentions, and timestamps. `/api/threads` can replay these transcripts when CoralOS is unavailable.

If CoralOS cannot be reached for a finished session, `/api/feed` can return rounds from persisted ledger files with `source: "ledger"`.

## Fixtures

Set `FEED_FIXTURE=<recorded-extended-state.json>` to use a recorded Coral extended-state response instead of calling CoralOS. This is the deterministic test path used by the web e2e.

## Run

```sh
npm install
npm start
```

Useful environment variables:

| Variable | Description |
|---|---|
| `CORAL_SERVER_URL` | CoralOS server URL. |
| `CORAL_TOKEN` | CoralOS bearer token. |
| `SESSION` | Session id to read. |
| `MARKET_SELLERS` | Seller names for session launch. |
| `RUNS_DIR` | Ledger directory. |
| `WATCHER_BASE` | Research watcher base URL. |
| `PORT` | Feed server port, default `4000`. |
| `FEED_FIXTURE` | Recorded extended-state fixture path. |

## Tests

```sh
npm test
```

Tests cover message collection, `foldRounds`, proof receipt folding, refunds, and ledger replay.
