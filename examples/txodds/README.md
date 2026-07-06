# The default demo — a World Cup oracle

> **The fastest way to see the rails, and the thing you fork.** One agent sells a verified World Cup read
> for devnet SOL; the kit's arbiter-gated escrow settles the delivery automatically, on-chain. Free tier,
> devnet, no Docker.

This is **the default demo, not the product** — it proves the loop end-to-end so you don't have to build
it. To sell your own thing, swap the `deliverService()` in [`agent/service.ts`](agent/service.ts) (ad
copy, a research brief, a routed job, a verified fact). The demo happens to be pointed at the hackathon's
own dataset ([TxODDS' **TxLINE**](https://txline-docs.txodds.com)); your service can be anything an agent
can deliver.

## What it is

```
examples/txodds/
  agent/
    edge.ts       analyzeEdge(): verified odds -> fair (break-even) odds + an LLM read (the product)
    service.ts    the deliverService() fork point: data -> LLM edge -> the string the buyer pays for
    escrow.ts     buyer-side escrow client (deposit/release); fetches the IDL on-chain
    txline.ts     standalone TxLINE data client (guest auth + fixtures/odds/scores)
  server/
    proxy.ts      live-data + escrow backend: subscribes on devnet, serves /api/board /api/edge /api/settle
    mint.ts       one-time: mint a free-tier TxLINE token into .env (optional)
  web/            React 18 app (no build): the board, the agent's call, auto-settlement links
  escrow/         the Anchor escrow contract (the settlement spine) + its client/tests
```

## The product

`analyzeEdge()` is the on-thesis transform: **verified de-margined odds in -> fair (break-even) odds +
a one-line read out**, paid for on delivery. The proxy exposes it at `/api/edge`; the same function is
the body of the standalone `deliverService()` reference in `service.ts` if you fork the agent.

On delivery the proxy settles through the **arbiter** (`agent/arbiter.ts`): the buyer funds an escrow
it can't claw back, and a neutral arbiter releases to the seller on verified delivery. The escrow
`reference` is bound to the read (`sha256`), so the on-chain order provably *is* the data bought.

## Run it

From the repo root (this is what `npm run dev` does):

```sh
npm install --prefix scripts && node scripts/setup.js   # devnet wallets -> .env (fund the buyer)
# add an LLM key to .env, then:
npm run dev            # proxy (:8801) + Oracle UI (:3020), opens the browser
```

**The LLM key** is the agent's brain (the one-line read). The kit's LLM is **Venice AI** — new accounts
redeem code **`IMPERIAL50`** at [venice.ai/settings/api](https://venice.ai/settings/api) for **$50 in
free credits**, then set `LLM_PROVIDER=venice` + `VENICE_API_KEY=...`. Anthropic (`ANTHROPIC_API_KEY`)
and OpenAI (`LLM_PROVIDER=openai` + `OPENAI_API_KEY`) work too — no code change. Full switching, and how
to add a provider in code: **[../../LLM.md](../../LLM.md)**. Without a key the board still renders and
the read falls back to a deterministic one.

Or run the two processes by hand from `examples/txodds/`:

```sh
npm install
npm run proxy          # live data + escrow on http://localhost:8801
npm run web            # the Oracle UI on http://localhost:3020
```

The proxy needs `BUYER_KEYPAIR_B58` in the repo `.env` (from `node scripts/setup.js`) funded with a
little devnet SOL. It subscribes that wallet to the free World Cup tier on devnet, then serves **only
fixtures with verified live odds**. The browser never sees the token or the key - everything sensitive
stays in the proxy. Without funding/a key, the board shows clearly-labelled sample data.

On the board you can also click **Pay with Phantom / Solflare** to buy the read yourself: a real
**Solana Pay** reference-tagged transfer from your wallet to the seller, verified on-chain by the proxy
(`/api/pay-intent` + `/api/pay-verify`). Needs a Devnet-funded wallet.

The board also includes **Run Pay.sh procurement demo**. That route calls
`/api/pay-sh-edge`, has the seller buy simulated upstream context through the shared
`payment-runtime` Pay.sh rail, writes `PAYMENT_REQUIRED -> PAYMENT_PROOF -> PAYMENT_CONFIRMED` into
the run transcript, then settles the buyer payment through the same escrow path. Each run folder gets
a formal `proof_receipts.json` artifact plus `procurement.json` beside the delivered read and
settlement files.

**Every settle leaves a run** — agent-settled or wallet-paid, the proxy persists it to a run ledger
(`data/txodds-runs/`, session `web-oracle`): the read, the order-bound reference, the txs. The UI's
**Runs panel** lists them (`/api/runs`, `/api/run?runId=`), and **Grade runs** (`/api/grade-runs`)
checks each settled read against the **actual match result** once the fixture resolves, writing
`outcome.json` into the run folder — paid reads graded against reality, not just delivered.

## CoralOS round (the multi-agent view)

The web demo above is one agent. For the **multi-agent** version - a buyer agent + a World Cup seller
agent trading this same edge **over CoralOS (MCP)** and settling via the escrow on devnet - see
[`coral/`](coral/README.md):

```sh
docker compose up -d coral        # coral-server (the MCP coordinator) - from the repo root
npm run coral                     # one buyer + one seller; watch a full WANT -> ... -> RELEASED round
```

Needs Docker + `TXLINE_API_KEY` (`npm run mint`). Verified: a real `RELEASED` tx on devnet.

## The research watcher (events → paid WANTs)

[`research/`](research/watcher.ts) turns this live board into a **market trigger**: it polls
`/api/board`, diffs snapshots ([`detect.ts`](research/detect.ts), unit-tested), and queues a job
when a fixture's implied probability moves ≥ `MOVE_PCT` (default 5pp) or verified odds go live.
The event-driven buyer in [`../marketplace/research.ts`](../marketplace/research.ts) polls
`GET /next` and posts one WANT per event — **quiet board, no spend**.

```sh
npm run proxy      # the live board (:8801)
npm run watch      # the watcher (:4600) — GET /next | /queue | /api/health
```

## Verified on devnet (2026-06)

| Check | Value |
|---|---|
| Devnet program | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` |
| Devnet API host | `https://txline-dev.txodds.com` |
| Free tier | service **level 1** - World Cup & Int Friendlies, on-chain price **0** |

**Three corrections** vs. the published TxODDS examples - all already applied in `server/proxy.ts`:
1. **Host:** use `txline-dev.txodds.com` (the repo's `oracle-dev.txodds.com` does not resolve).
2. **Mint:** subscribe with the treasury's `4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG`, **not** the
   IDL's stale `TXLINE_MINT`. `subscribe_v2` is in the IDL but not deployed on devnet, so use the legacy
   `subscribe(1, 4)` with the real mint.
3. **Odds path:** `/api/odds/snapshot/{fixtureId}` - a path segment, not a query param.

## The escrow contracts

Two deployed devnet programs in [`escrow/`](escrow/README.md) - the only Rust in the kit, called (not
forked) by the TS clients:
- **escrow** (`R5NWNg9...CeXet`) - the settlement spine (`agent/escrow.ts`, IDL fetched on-chain).
- **arbiter** (`FJtuVXsy...ktXd`) - the trusted-neutral wrapper the demo settles through (`agent/arbiter.ts`,
  bundled IDL): the buyer funds a vault it can't claw back; a trusted neutral arbiter releases to the seller.

The demo runs against the deployed programs with no local build; `escrow/README.md` covers
building/redeploying your own.
