# Marketplace feed server

A ~60-line Express proxy — the only backend the visualizer needs. It reads a CoralOS session's
transcript (extended state, behind the dev token), folds it into typed market `Round`s, and serves
CORS-enabled JSON for the React app to poll.

```
GET  /api/health              → { ok: true }
GET  /api/feed?session=<sid>  → { session, rounds, updatedAt, source }
GET  /api/runs                → { runs, updatedAt }   (the persisted run ledger)
POST /api/start               → { session }   (launches a market session — the dashboard's button)
```

Every live poll also lands each round in the **run ledger** (`RUNS_DIR`, default
`examples/marketplace/runs/`, gitignored): one folder per round with `want.json`, `bids.json`,
`award.json`, `escrow.json`, `delivery.json` (sha256 content-hashed), `txs.json` (Explorer-linked
signatures), and `transcript.jsonl` — the raw Coral messages. If coral-server goes away, `/api/feed`
replays the session from those folders (`source: "ledger"`), so a finished round stays inspectable.
*"What did the agent actually do for the money?" — open the run folder.*

Set `FEED_FIXTURE=<recorded-extended-state.json>` to serve a recorded transcript instead of hitting
coral — this is how the web e2e exercises the real fold/parse path with no devnet.

`foldRounds` (the fold logic) **reuses `@pay/agent-runtime`'s parsers**, so the market wire protocol
has one source of truth. It's pure and has its own unit tests.

```sh
npm install
npm test            # foldRounds + persist tests (full round, declined seller, refund, ledger replay)
npm start           # serves on :4000  (env: CORAL_SERVER_URL, CORAL_TOKEN, SESSION, MARKET_SELLERS, RUNS_DIR, PORT)
```

The browser never touches coral or Solana — keeping the token server-side and avoiding CORS. See
[`docs/MARKETPLACE_FRONTEND.md`](../../../docs/MARKETPLACE_FRONTEND.md).
