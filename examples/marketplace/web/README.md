# Marketplace visualizer

A read-only React app over the live auction, in **three tabs**. It watches agents transact; there's
no human buyer and **no wallet** — fully on-thesis.

- **Market** — each round's `WANT`, the competing bids (winner highlighted, harness tags,
  self-selected sellers shown as declined), the buyer's reasoning, the **verifier's verdict** (a
  fail renders "release refused, funds refundable"), upstream **proof receipts**, the on-chain
  settlement with Explorer links — plus the ledger-derived **reputation** strip and the research
  watcher's **event queue**.
- **Coral bus** — the coordination itself: the agent roster with presence, and every thread's
  messages with sender colors, market-verb badges, and `@mention` chips. The proof it's an MCP
  session, not a REST poll.
- **Runs** — the run ledger as a page: expand any round into want → bids → award reasoning →
  escrow → sha256-bound delivery → verdict → proof receipts → Explorer-linked txs.

When coral-server is down, a **replay banner** shows and everything serves from the persisted run
folders (`source: "ledger"`).

```
 web/ (React, this app) ──poll──▶ feed/ (Express) ──read──▶ coral session state + runs/ (ledger)
```

## Run

```sh
cd ../feed && npm start                 # the feed on :4000 (another shell; SESSION=<id> to pin one)
npm run dev                             # this app on :5173
# or from the repo root: npm run marketplace:web
```

The **Start a market** button asks the feed server (`POST /api/start`) to launch a session and then
watches it live — fund your wallets first. (Logs-flow alternative: `npm run marketplace` at the
repo root, then paste the printed session id into the input or open `/?session=<id>`.)

## How it works

The browser never touches coral or Solana. The **feed server** reads the session's extended state,
folds the transcript into typed `Round`s with `foldRounds` — which **reuses `@pay/agent-runtime`'s own
parsers**, so the wire protocol has one source of truth — and serves CORS-enabled JSON the app polls.

## Test (no devnet, no LLM key)

```sh
cd examples/marketplace/web
npm test          # Vitest + Testing Library — rounds, proof receipts, verification pass/fail, harness tags, the bus view
npm run e2e       # Playwright — the REAL feed server folding a recorded coral transcript → real app,
                  # incl. the Coral bus tab (mentions/roster) and the Runs tab (ledger + sha256 + txs)
cd ../feed && npm test   # foldRounds + collectMessages (bus context) verified against the same transcript
```

The e2e is **not** a route mock: Playwright starts the real feed server with a recorded CoralOS
extended-state response (`feed/tests/coral-session.json`, captured from a settled devnet round), so it
exercises the actual `collectMessages → foldRounds → HTTP → UI` path. The only thing replaced is coral
itself — which makes it deterministic and CI-friendly with no devnet or LLM key.

## Fork points

| Want… | Edit |
|-------|------|
| a new bid field (eta, reputation) | `src/components/BidRow.tsx` + the `Round` type + `../feed/src/foldRounds.ts` |
| a different look | `src/components/RoundCard.tsx` + `src/styles.css` |
| live push instead of polling | swap `useFeed`'s `setInterval` for an SSE endpoint on the feed server |
| let a human fund/settle (advanced) | add wallet-standard via framework-kit — see the `solana-dev` skill |

For the data contract behind every view, see the feed server's [README](../feed/README.md).
