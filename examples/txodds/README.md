# TxODDS Example

This example runs the default paid service: TxODDS TxLINE data is read by a server-side proxy, transformed into a fair-line analysis, and settled directly over x402 on devnet.

> **Free-tier disclaimer:** the TxLINE guest/free-tier access this example subscribes to (`npm run mint`, `agent/txline.ts`) is scoped to the **World Cup 2026 tournament window** and International Friendlies — it is a promotional data grant tied to that event, not a permanent free API. Outside that window, guest subscription or the odds/fixtures endpoints may stop returning live data or may be withdrawn entirely. If you fork this kit after the World Cup 2026 period, expect to either (a) obtain your own commercial TxODDS/TxLINE credentials, or (b) swap in a different data source behind `agent/service.ts` — the market protocol, policy, ledger, and payment paths are service-agnostic and do not depend on TxODDS specifically. See `WORLDCUP_API.md` for the exact endpoints and constraints this assumption applies to.

## Layout

```text
examples/txodds/
  agent/
    txline.ts      TxLINE client
    edge.ts        verified odds -> fair-line analysis
    service.ts     deliverService() wrapper
  server/
    proxy.ts       local API proxy (board data, x402 edge reference merchant, CoralOS round launch/forwarding)
    mint.ts        TxLINE token setup helper
  web/             static React UI
  coral/           CoralOS round launcher/config
  escrow/          Anchor escrow and arbiter programs (deployed, available; not used by the default flow)
```

## Local Flow

`npm run dev` starts:

| Process | Port | Responsibility |
|---|---|---|
| Proxy | `8801` | TxLINE access, board data, x402 edge reference merchant, CoralOS round launch/forwarding. |
| Coral Console | `5555` | Built-in Coral Server console at `/ui/console`, started/probed when Docker is available. |
| Feed | `4000` | CoralOS session reader and run ledger replay API. |
| Web UI | `3020` | Fixture board plus the live CoralOS agent feed (WANT/BID/AWARD/payment/verify/settle). |

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

## Proxy API

| Endpoint | Purpose |
|---|---|
| `GET /api/board` | Fixtures with verified live odds, or labelled sample data if unavailable. |
| `GET /api/edge-x402?fixtureId=<id>` | Edge analysis gated behind a real x402 challenge/pay/settle round trip. Also `coral-agents/seller-agent`'s default `PROCURE_X402_URL` target when `PROCURE_RAIL=x402` — see `PAY.md`. |
| `POST /api/agentic/start` | Launches a CoralOS round (`coral/round.ts`). |
| `GET /api/agentic/feed` / `GET /api/agentic/threads` / `GET /api/agentic/runs` | Forwarded to the feed server for the live agent UI. |

## Settlement

The buyer pays the seller directly over x402 — signed by the buyer, submitted and verified on-chain
by the seller, before delivery. Direct and final: there is no escrow and no refund path. The
delivery hash/reference is recorded with the payment transaction signature in the run ledger.

Two escrow/arbiter Anchor programs remain deployed to devnet and available as an alternative
building block (not used by this example's default flow) — see the root `README.md`'s Escrow
Programs section.

## CoralOS Round

The web UI's live agent feed shows a CoralOS round already in progress or lets you start one. The
underlying multi-agent TxODDS round launches a buyer and a seller through CoralOS:

```sh
docker compose up -d coral
cd examples/txodds
npm run coral
```

Requirements:

- Docker;
- built agent images;
- `TXLINE_API_KEY`;
- a funded buyer keypair.

See `coral/README.md`.

## Research Watcher

The watcher polls `/api/board` every 60 seconds, extracts each fixture's 1X2 market with
`agent/market.ts`'s `select1x2Market` (the proxy's board attaches `.odds` as an *array* of markets —
this is the step that turns it into the single `{PriceNames,Pct}` object `research/detect.ts`'s
`detectEvents` actually needs; skipping it, as this file used to, means no move is ever detected),
diffs snapshots, and queues jobs when verified odds appear or implied probability moves beyond
`MOVE_PCT`.

```sh
npm run proxy
npm run watch
```

Watcher endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Health check. |
| `GET /queue` | Current queued events. |
| `GET /next` | Pop the next event for event-mode buyer — `odds-move` events request `sharp-movement`, `new-fixture` events request `txline`. |

`buyer-agent`'s event-mode consumes this queue through `WANT_FEED_URL` (see
`coral-agents/buyer-agent/src/feed/wantFeed.ts`), wired into the CoralOS round by
`SHARP_MOVEMENT_ENABLED=1` — see `coral/README.md`'s Sharp-Movement Round section.

## TxODDS Notes

| Item | Value |
|---|---|
| Host | `https://txline-dev.txodds.com` |
| Subscription mint | `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG` |
| Odds endpoint | `/api/odds/snapshot/{fixtureId}` |
| Free-tier competitions | World Cup and International Friendlies |

See `WORLDCUP_API.md` for the TxLINE API surface used by this example.
