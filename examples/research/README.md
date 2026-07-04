# Research market — live odds events trigger paid specialist research

Upgrades the World Cup oracle from "LLM reads odds on a loop" to an **event-driven research
market**: a real market event (an implied-probability move on the live TxLINE board) creates the
WANT; specialist agents compete to sell the read; the verifier gates the escrow release. A quiet
board spends nothing.

```
txodds proxy (:8801)  →  watcher (:4600)          →  buyer (event mode)
   /api/board             detectEvents():             WANT_FEED_URL=…/next
   verified 1X2 odds       · new-fixture              no event → no WANT → no spend
                           · odds-move ≥ 5pp
                                                      WANT txline <fixtureId>
seller-moves      "why did the line move"  ──BID──┐
seller-stats      "model vs market"        ──BID──┼→ AWARD → escrow → DELIVERED
seller-worldcup   the generalist oracle    ──BID──┘   → VERIFY → VERIFIED → ARBITER_RELEASED
```

The specialists differ **only by manifest** (`coral-agents/seller-moves`, `seller-stats` —
persona + floor); all deliver the verified TxLINE edge read. A deep-research tier (e.g.
[xpriment626/delve](https://github.com/xpriment626/delve)) joins the same way with
`HARNESS=cli HARNESS_CMD='delve {prompt}'` (see [`packages/harness-runtime`](../../packages/harness-runtime)).

## Run it

Needs Docker (coral-server), a funded devnet buyer, and a TxLINE token (`npm run mint` in
examples/txodds):

```sh
cd examples/txodds && npm run proxy          # 1. the live board
cd examples/research && npm install
npm run watch                                # 2. the event watcher (:4600)
docker compose up -d coral                   # 3. repo root (once)
npm start                                    # 4. the market session
```

Tune the trigger: `MOVE_PCT` (implied-probability move in percentage points, default 5),
`POLL_MS`, `RESEARCH_BUDGET_SOL` (per-event budget, capped by the buyer's `BUYER_MAX_SOL`).

`npm test` covers the event detector; the watcher endpoints (`/next`, `/queue`) and the buyer's
feed client (`coral-agents/buyer-agent/src/wantFeed.ts`) are unit-tested against mocks.

Every settled round lands in the run ledger (`examples/marketplace/runs/` via the feed server):
the event note travels in the WANT round's transcript, so the trail reads *odds moved → job
posted → specialist won → verified → paid*.
