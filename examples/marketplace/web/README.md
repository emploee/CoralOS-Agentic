# Marketplace Visualizer

This Vite React app reads the marketplace feed server and renders market rounds, Coral thread state, run ledger details, proof receipts, verifier results, and seller reputation. The browser does not connect directly to CoralOS or Solana.

## Views

| View | Data rendered |
|---|---|
| Market | `WANT`, bids, winner, award reasoning, verifier verdict, proof receipts, settlement state, transaction links, reputation strip, and watcher events. |
| Coral bus | Session roster, thread messages, sender labels, market verb badges, and mention chips. |
| Runs | Persisted ledger records with want, bids, award, escrow, delivery hash, verifier result, proof receipts, and transaction links. |

When `/api/feed` returns `source: "ledger"`, the UI displays replay state instead of live CoralOS state.

## Run

Start the feed server:

```sh
cd ../feed
SESSION=<session-id> npm start
```

Start the app:

```sh
npm run dev
```

From the repo root:

```sh
npm run marketplace:web
```

The dashboard can also call `POST /api/start` on the feed server to launch a session, if the local environment has the required Docker and wallet setup.

## Data Contract

The app polls the feed server. The feed server is responsible for CoralOS auth, Solana-derived ledger data, and protocol parsing.

| Endpoint | Use |
|---|---|
| `/api/feed` | Market rounds. |
| `/api/threads` | Coral bus view. |
| `/api/session` | Agent roster and session state. |
| `/api/runs` | Run ledger list/detail. |
| `/api/reputation` | Seller track records. |
| `/api/events` | Research watcher queue. |
| `/api/start` | Optional local session launcher. |

`foldRounds` in the feed reuses `@pay/agent-runtime` market parsers, so wire-format parsing has one source of truth.

## Tests

```sh
cd examples/marketplace/web
npm test
npm run e2e
```

The Playwright e2e starts the real feed server with `feed/tests/coral-session.json`, then renders the real app against the feed API.

Feed tests:

```sh
cd ../feed
npm test
```

## Edit Points

| Change | Files |
|---|---|
| Add bid fields | `src/components/BidRow.tsx`, shared `Round` type, `../feed/src/foldRounds.ts`. |
| Change round rendering | `src/components/RoundCard.tsx`, `src/styles.css`. |
| Change Coral bus rendering | `src/components/CoralView.tsx`. |
| Change run ledger rendering | `src/components/RunsView.tsx`. |
| Replace polling | `src/api.ts` and feed server API implementation. |
