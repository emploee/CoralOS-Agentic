# TxODDS Example

This example runs the default paid service: TxODDS TxLINE data is read by a server-side proxy, transformed into a fair-line analysis, and optionally settled through devnet Solana escrow.

## Layout

```text
examples/txodds/
  agent/
    txline.ts      TxLINE client
    edge.ts        verified odds -> fair-line analysis
    service.ts     deliverService() wrapper
    escrow.ts      base escrow client
    arbiter.ts     arbiter wrapper client
  server/
    proxy.ts       local API proxy, settlement, run persistence
    mint.ts        TxLINE token setup helper
  web/             static React UI
  research/        board watcher and event detector
  coral/           CoralOS round launcher/config
  escrow/          Anchor escrow and arbiter programs
```

## Local Flow

`npm run dev` starts:

| Process | Port | Responsibility |
|---|---|---|
| Proxy | `8801` | TxLINE access, edge analysis, payment/settlement endpoints, run ledger. |
| Coral Console | `5555` | Built-in Coral Server console at `/ui/console`, started/probed when Docker is available. |
| Feed | `4000` | CoralOS session reader and run ledger replay API. |
| Web UI | `3020` | Board, analysis, settlement status, runs, proof receipts, grading. |

The browser only calls the local proxy. TxLINE tokens and keypairs stay server-side.

## Run

From the repo root:

```sh
npm run setup
npm run dev
```

`npm run dev` can also be run from this directory. The Coral Console probe is allow-skip by default: local proxy/UI development continues if Docker Desktop is not running. Use `CORAL_CONSOLE_REQUIRED=1 npm run dev` when you want the console to be a hard dev preflight.

From this directory:

```sh
npm install
npm run proxy
npm run web
```

Required for live settlement:

- `BUYER_KEYPAIR_B58` in repo-root `.env`;
- buyer wallet funded with devnet SOL;
- devnet `SOLANA_RPC_URL` or the default devnet endpoint.

Optional for live model output:

- `LLM_PROVIDER`;
- provider key such as `VENICE_API_KEY`, `OPENAI_API_KEY`, or `ANTHROPIC_API_KEY`.

Without a provider key, the analysis path can return deterministic fallback output.

## Proxy API

| Endpoint | Purpose |
|---|---|
| `GET /api/board` | Fixtures with verified live odds, or labelled sample data if unavailable. |
| `GET /api/fixtures` | TxLINE fixture passthrough. |
| `GET /api/odds?fixtureId=<id>` | TxLINE odds passthrough. |
| `GET /api/edge?fixtureId=<id>` | Edge analysis for one fixture. |
| `GET /api/settle?fixtureId=<id>&amount=<sol>` | Arbiter/base escrow settlement path. |
| `GET /api/pay-intent` | Solana Pay intent for wallet checkout. |
| `GET /api/pay-verify` | Reference-bound Solana Pay verification. |
| `GET /api/pay-sh-edge` | Simulated Pay.sh procurement plus edge delivery. |
| `GET /api/runs` / `GET /api/run?runId=<id>` | Run ledger records. |
| `GET /api/grade-runs` | Outcome grading for persisted runs where score data is available. |

## Settlement

The example uses two deployed devnet programs:

| Program | ID | Role |
|---|---|---|
| Escrow | `R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet` | Base SOL escrow PDA. |
| Arbiter | `FJtuVXsyXuRKqgJBEPAXmktkd13CqStapgevzGwYktXd` | Vault-as-buyer wrapper for neutral release/refund. |

The delivery hash/reference is recorded with transaction signatures in the run ledger.

## CoralOS Round

The single-agent web flow does not require CoralOS. The multi-agent TxODDS round launches buyer and seller personas through CoralOS:

```sh
docker compose up -d coral
cd examples/txodds
npm run coral
```

Requirements:

- Docker;
- built agent images;
- `TXLINE_API_KEY`;
- funded buyer and arbiter keypairs.

See `coral/README.md`.

## Research Watcher

The watcher polls `/api/board`, diffs snapshots with `research/detect.ts`, and queues jobs when verified odds appear or implied probability moves beyond `MOVE_PCT`.

```sh
npm run proxy
npm run watch
```

Watcher endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Health check. |
| `GET /queue` | Current queued events. |
| `GET /next` | Pop the next event for event-mode buyer. |

The research marketplace launcher consumes this queue through `WANT_FEED_URL`.

## TxODDS Notes

| Item | Value |
|---|---|
| Host | `https://txline-dev.txodds.com` |
| Subscription mint | `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` |
| Odds endpoint | `/api/odds/snapshot/{fixtureId}` |
| Free-tier competitions | World Cup and International Friendlies |

See `WORLDCUP_API.md` for the TxLINE API surface used by this example.
