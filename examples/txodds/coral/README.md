# TxODDS CoralOS Round

This folder launches the TxODDS service as a CoralOS multi-agent session. A buyer posts a TxODDS request, the seller bids, the buyer awards it, and the order settles directly over x402 — payment before delivery, no escrow.

## Message Flow

```text
buyer-agent
  -> WANT service=txline arg=<fixtureId>

seller-agent
  -> BID price=<sol> by=<agent>

buyer-agent
  -> AWARD to=<seller>
seller
  -> PAYMENT_REQUIRED rail=x402 reference=<ref> seller=<addr>
buyer-agent
  -> PAYMENT_PROOF proof=<signed tx> (signed, not submitted)
seller
  -> submit + verify on-chain
  -> PAYMENT_CONFIRMED paid=true sig=<devnet tx>
  -> DELIVERED payload=<json>
buyer-agent
  -> VERIFY sha=<delivery hash>
verifier-agent
  -> VERIFIED verdict=pass   (informational - payment already settled)
buyer-agent
  -> SETTLED sig=<devnet tx>
```

The buyer signs the payment; the seller submits and verifies it before delivering. Payment is direct
and final — there is no refund path.

## Requirements

- Docker with `coral-server` running.
- Agent images built from the repo root.
- Repo-root `.env` containing:
  - `BUYER_KEYPAIR_B58`, funded with devnet SOL;
  - `WALLET` or `SELLER_WALLET`;
  - `TXLINE_API_KEY`.

## Run

From the repo root:

```sh
docker compose up -d coral
bash build-agents.sh
```

From `examples/txodds`:

```sh
npm run coral
```

`round.ts` reads a live fixture id from the proxy's `/api/board` when available and starts the buyer and seller.

Default seller:

| Agent | Services |
|---|---|
| `seller-agent` | `txline` (`sharp-movement` too under `SHARP_MOVEMENT_ENABLED=1`, see below) |

## Sharp-Movement Round (opt-in)

Instead of the buyer rotating fixed args, the research watcher (`../research/watcher.ts`) polls the
proxy's live board every 60 seconds, detects odds moves, and drives the buyer autonomously through
`WANT_FEED_URL` event mode:

```sh
# repo-root .env: SHARP_MOVEMENT_ENABLED=1

npm run watch                  # in one terminal — starts the odds-move watcher (or `npm run dev`, which starts it too)
npm run coral:sharp-movement   # in another — same launcher as `coral`, adds sharp-movement to the
                                # seller's SERVICES and points the buyer's WANT_FEED_URL at the watcher
```

`round.ts` sets both automatically once `SHARP_MOVEMENT_ENABLED=1` is set — no separate agent, no
persona roster, just the one `seller-agent` offering one more service. The seller's `sharp-movement`
delivery doesn't re-detect the move — the watcher already confirmed one happened before the WANT
existed — it reports the fixture's *current* market decisiveness (magnitude/confidence from the
spread between the top two outcomes) plus a deterministic plain-language read. See
`coral-agents/seller-agent/README.md`'s Sharp-Movement Analysis section.

Grading (was the flagged move's leading outcome actually right, once the match finished?) runs as a
background pass on the proxy (`GRADE_POLL_MS`, default 5 minutes) and writes an `outcome`
(`ScoreOutcome`, `packages/agent-runtime/src/ledger/run.ts`) onto the persisted run record — see
`../research/GRADING.md`. The web UI's scoreboard (`examples/txodds/web/app.js`'s `Scoreboard`)
shows the running accuracy across the whole run ledger.

### TxLINE endpoints used

| Endpoint | Used by |
|---|---|
| `POST /auth/guest/start` | `TxLineClient` (guest JWT, cached) — every other call needs it. |
| `GET /api/fixtures/snapshot` | Board rendering, `txline` fixture/edge lookups, sharp-movement's teams lookup. |
| `GET /api/odds/snapshot/{fixtureId}` | Board odds, `txline` edge reads, sharp-movement's market read. |
| `GET /api/scores/snapshot/{fixtureId}` | Post-match grading (`research/grade.ts`) — was the prediction right? |

## Logs

CoralOS names containers by generated ids. Find and tail by image:

```sh
docker logs -f $(docker ps -qf ancestor=buyer-agent:0.1.0 | head -1)
docker logs -f $(docker ps -qf ancestor=seller-agent:0.1.0 | head -1)
```

Set `TRACE=1` for Coral calls, PDA addresses, and transaction links.

## References

- Repository CoralOS wiring: `../../../CORAL.md`
- Buyer implementation: `../../../coral-agents/buyer-agent`
- Seller implementation: `../../../coral-agents/seller-agent`
- Escrow programs: `../escrow/README.md`
