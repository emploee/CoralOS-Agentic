# Marketplace

The marketplace example runs a CoralOS session where buyer and seller agents exchange market messages and settle the awarded order through devnet Solana escrow. The same feed server and visualizer support the classic, freelancer, and research launchers.

## Flow

```text
WANT -> BID -> AWARD -> ESCROW_REQUIRED -> DEPOSITED -> DELIVERED -> VERIFIED -> RELEASED
```

The verifier step is enabled by launchers that include `verifier-agent`.

## Prerequisites

- Docker with `coral-server` running.
- Agent images built with `bash build-agents.sh`.
- Repo-root `.env` with funded devnet buyer/arbiter/seller variables.
- `TXLINE_API_KEY` for TxODDS-backed services.
- Optional LLM provider configuration; see `../../LLM.md`.

Mint a TxLINE token when needed:

```sh
cd examples/txodds
npm run mint
```

Start CoralOS and build agents from the repo root:

```sh
docker compose up -d coral
bash build-agents.sh
```

## Launchers

Run from `examples/marketplace` or through the root scripts.

| Command | Description |
|---|---|
| `npm start` / `npm run marketplace` | Classic buyer plus TxODDS seller personas. |
| `npm run freelancer` / root `npm run freelancer` | Harness seller market with verifier gate. |
| `npm run research` / root `npm run research` | Event-driven buyer that polls the TxODDS watcher for jobs. |

Classic market:

```sh
cd examples/marketplace
npm install
npm start
```

Freelancer market:

```sh
docker build -f ../../coral-agents/verifier-agent/Dockerfile -t verifier-agent:0.1.0 ../..
npm run freelancer
```

Optional Claude Code seller:

```sh
bash ../../build-agents.sh claude
CLAUDE_SELLER=1 npm run freelancer
```

Research market:

```sh
cd ../txodds && npm run proxy
cd ../txodds && npm run watch
cd ../marketplace && npm run research
```

## Configuration

| Variable | Effect |
|---|---|
| `BUYER_ARG` | TxODDS request, such as `fixtures` or `edge <fixtureId>`. |
| `BUYER_ARGS` | Comma-separated rotating request list. |
| `BUYER_MAX_SOL` | Per-round budget cap. |
| `MARKET_SELLERS` | Seller agent names included in the session. |
| `VERIFIER_AGENT` | Enables verifier-gated release when set. |
| `WANT_FEED_URL` | Enables event mode by polling a watcher endpoint. |
| `REPUTATION_URL` | Adds ledger-derived reputation lines to award reasoning. |
| `LLM_PROVIDER`, `LLM_MODEL` | LLM provider/model selection. |
| `TRACE=1` | Logs Coral calls, PDA addresses, and transaction links. |

## Feed and Visualizer

The feed server reads Coral extended session state, folds messages into typed rounds, writes run ledger artifacts, and exposes browser-safe HTTP APIs.

```sh
cd examples/marketplace/feed
SESSION=<session-id> npm start
```

Start the visualizer:

```sh
npm run marketplace:web
```

Feed endpoints:

| Endpoint | Description |
|---|---|
| `GET /api/health` | Health check. |
| `GET /api/feed?session=<id>` | Typed rounds and source metadata. |
| `GET /api/threads?session=<id>` | Coral thread messages with mentions and participants. |
| `GET /api/session?session=<id>` | Session roster/status. |
| `GET /api/runs` | Persisted run ledger list. |
| `GET /api/reputation` | Ledger-derived seller track records. |
| `GET /api/events` | Research watcher queue proxy. |
| `POST /api/start` | Launch a market session for the dashboard. |

## Run Ledger

Every folded round is persisted under `examples/marketplace/runs/` unless `RUNS_DIR` is set.

Artifacts include:

- `want.json`;
- `bids.json`;
- `award.json`;
- `escrow.json`;
- `delivery.json`;
- `verification.json`;
- `proof_receipts.json`;
- `txs.json`;
- `transcript.jsonl`.

When CoralOS is unavailable, finished sessions can be replayed from the ledger with `source: "ledger"`.

## Tests

```sh
cd examples/marketplace/feed
npm install
npm test
```

```sh
cd examples/marketplace/web
npm install
npm test
npm run e2e
```

The web e2e starts the real feed server with a recorded Coral extended-state fixture.

## Implementation References

| Path | Responsibility |
|---|---|
| `start.ts` | Classic market session graph. |
| `freelancer.ts` | Harness-seller and verifier session graph. |
| `research.ts` | Event-mode session graph. |
| `feed/src/foldRounds.ts` | Market transcript to typed rounds. |
| `feed/src/coralState.ts` | Extended-state parsing with thread/mention metadata. |
| `web/src/` | React visualizer. |
| `../../coral-agents/buyer-agent` | Buyer market loop. |
| `../../coral-agents/seller-agent` | Seller market loop and harness adapter boundary. |
