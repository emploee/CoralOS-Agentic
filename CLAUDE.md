# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repo Is

A **Solana × CoralOS starter kit for agents that earn** — a forkable hackathon template for autonomous
services that get paid on-chain. The full devnet loop is already wired —
**WANT → BID → AWARD → DEPOSITED → DELIVERED → RELEASED**: an LLM agent sells a service, buyers reason
about value, sellers compete on price/quality, funds lock in a Solana escrow, delivery triggers release,
no-shows refund. A builder's job is **one function** — replace `deliverService()`
([`examples/txodds/agent/service.ts`](examples/txodds/agent/service.ts)) with something an agent can
sell — plus the seller persona and the buyer's value criteria.

The **World Cup oracle is the default demo, not the product**: it sells a verified, de-margined odds
read to prove the rails end-to-end. Frame work around outcomes (a freelancer / research / broker /
oracle / reseller agent), not the sports data.

The stack is pure TypeScript end-to-end; the **only Rust is the escrow + arbiter Anchor programs**, the
**settlement spine** (not optional, already deployed to devnet). Two ways to see it: `npm run dev` brings
up the single-agent demo (data/escrow proxy + React UI, **no Docker**); the full market —
`docker compose up -d coral` + `bash build-agents.sh` + `cd examples/marketplace && npm start` — runs
competing buyer/seller agents over coral-server (MCP), settling via the escrow on devnet. The kit's LLM
is **Venice AI** (free credits; `LLM_PROVIDER` also accepts `openai`/`anthropic` — see `LLM.md`).

## Repo Layout

| Directory | Purpose |
|-----------|---------|
| `examples/txodds/` | The World Cup Oracle (the headline example). `agent/` (`edge.ts` — the verified-odds→LLM-call transform; `service.ts` — the `deliverService` fork point; `escrow.ts` — the buyer-side escrow client), `server/` (`mint.ts`, `proxy.ts` — the live data + escrow proxy), `web/` (the no-build React app), `escrow/` (the Anchor escrow + arbiter programs — the settlement spine). |
| `examples/agent-economy/` | **Three front doors** on CoralOS (needs Docker): `autonomous/` (agent→agent purchase), `bridge/` (HTTP bridge + React checkout — the human front door), `quickstart/` (bare 402 pay-per-call, no Docker/CoralOS), `web/` (3-tab dashboard), `config/coral.toml`. Escrow references point at `examples/txodds/escrow/`. |
| `examples/marketplace/` | **Competitive bidding market** (needs Docker): `start.ts` launches a buyer + persona sellers in one CoralOS session; `feed/` (folds session state into rounds AND persists each round to the **run ledger** `runs/`; serves `/api/runs` + `/api/reputation`; replays a session from disk when coral is down), `web/` (React visualizer + Playwright tests). Settles via the escrow. |
| `examples/freelancer/` | **Verifier-gated freelancer market** (needs Docker): heterogeneous harnesses (`seller-scribe` node-llm vs `seller-claude` Claude Code) bid on a brief; `verifier-agent` gates the release. |
| `examples/research/` | **Event-driven research market** (needs Docker + the txodds proxy): `src/watcher.ts` turns live odds moves into queued WANTs (`detectEvents`, tested); the buyer polls it via `WANT_FEED_URL` — quiet board, no spend. |
| `packages/agent-runtime/` | The runtime, one folder each under `src/`: the LLM provider shim (`llm/`), Solana Pay + devnet guard (`solana/`), a CoralOS MCP client (`coral/`), the market protocol incl. VERIFY/VERIFIED (`market/`), the **run ledger + reputation** (`ledger/`), and the **policy choke point** (`policy/` — spend caps, payout/award-price binding, verifier gate). Root `src/index.ts` re-exports all of them. |
| `packages/harness-runtime/` | The **harness adapter SDK**: one `HarnessAdapter` interface (`quote`/`run`, hash-bound deliveries, streamed events) so a seller can be a prompt (`node-llm`), headless Claude Code (`claude-code`, Coral MCP config injection), or any CLI (`HARNESS=cli HARNESS_CMD='hermes {prompt}'`). Harness processes never hold keys. Build after agent-runtime. |
| `coral-agents/` | The agents coral-server launches per session: `buyer-agent` (policy-enforced, verifier-gated, event-mode capable), `seller-agent` (harness-adapter seller; personas `seller-worldcup`/`seller-scribe`/`seller-claude`/`seller-moves`/`seller-stats` reuse its image), `verifier-agent` (independent delivery checks — release gate), plus `broker/` (swarm — buys upstream, resells at a markup, escrow both legs), `echo-agent/` (minimal test agent), `user_proxy/` (the human's puppet for the bridge). |
| `scripts/` | `txodds.js` (the `npm run dev` launcher — proxy + web + browser) and `setup.js` (devnet wallet generation → `.env`). |

## Commands

### Run the demo

```sh
npm run dev                 # = node scripts/txodds.js — proxy (:8801) + Oracle UI (:3020) + browser
node scripts/setup.js       # generate devnet wallets → .env (fund the buyer at faucet.solana.com)
```

By hand (what `npm run dev` automates), from `examples/txodds/`:

```sh
npm run proxy               # tsx server/proxy.ts — live TxODDS data + escrow settle on :8801
npm run web                 # serve web -l 3020   — the Oracle UI
npm run mint                # mint a fresh TxLINE free-tier token into .env (optional)
```

### packages/agent-runtime (the runtime)

```sh
cd packages/agent-runtime && npm install
cd packages/agent-runtime && npm run typecheck
cd packages/agent-runtime && npm test
cd packages/agent-runtime && npm run build    # dependents (examples/txodds, harness-runtime, agents) need its dist
cd packages/harness-runtime && npm run build  # after agent-runtime; the seller needs its dist
```

### Typecheck / test the example

```sh
cd examples/txodds && npm install && npm run typecheck && npm test   # incl. edge.test.ts
```

## Architecture

### packages/agent-runtime — the runtime

- **LLM** (`llm/`) — `complete.ts` (`complete()` — SDK-free `fetch` shim; **Venice AI** is the kit's LLM,
  `LLM_PROVIDER` also accepts `openai`/`anthropic`, no code change) + `parseJsonReply` for model output.
- **Solana** (`solana/`) — `connection.ts` (`solanaConnection`/`assertDevnet` guard) + `pay.ts`
  (`generatePaymentUrl`/`verifyPayment`/`signTransfer`/`loadKeypairB58`, reference-bound).
- **CoralOS** (`coral/`) + **market** (`market/`) — an MCP client and the WANT/BID/AWARD protocol. Not
  used by the single-agent web oracle; they power the **CoralOS round** (`coral-agents/` +
  `examples/txodds/coral/`).

### examples/txodds — the World Cup Oracle

- `agent/edge.ts` — `analyzeEdge()`: verified de-margined odds → an LLM one-line call + confidence,
  with a deterministic fallback (so it renders with no LLM key). Shared by the proxy and the agent.
- `agent/escrow.ts` — the buyer-side escrow client (`makeProgram`/`deposit`/`release`/`escrowPda`). It
  fetches the program IDL **on-chain**, so only the deployed devnet program is needed, not a local build.
- `agent/arbiter.ts` — client for the deployed **arbiter** wrapper (bundled IDL `arbiter_idl.json`).
- `server/proxy.ts` — subscribes the buyer wallet to the free World Cup tier on devnet, then serves:
  `/api/board` (only fixtures with verified live 1X2 odds, inlined), `/api/edge` (the agent's read),
  `/api/settle` (settles via the **arbiter** wrapper, falling back to the direct escrow; the escrow
  `reference` is bound to the read as `sha256(...)`). `/api/fixtures` + `/api/odds` are raw passthroughs.
- `web/app.js` — the React app. Loads `/api/board`, renders the board + the agent's read, and on
  delivery auto-settles (no button), showing the 3-party arbiter settlement + Explorer links.

### examples/txodds/escrow — the settlement spine (+ the arbiter)

A Cargo workspace with **two** deployed devnet programs: `programs/escrow` (the spine — buyer deposits
into a per-order PDA seeded by `(buyer, reference)`, releases on delivery / refunds after a deadline)
and `programs/arbiter` (the trustless wrapper — a neutral 3rd signer gates release/refund via the
vault-as-buyer CPI pattern, so the buyer can't take delivery and refund). The demo settles through the
arbiter. Build with `anchor build`; the demo runs against the deployed ids. See its `README.md`.

## Key Constraints

- **Web demo: no Docker** (proxy + web). **CoralOS round: needs Docker** — `docker-compose.yml` runs
  coral-server, which launches `coral-agents/` (buyer + seller) per session; `examples/txodds/coral/round.ts`
  (`npm run coral`) is the launcher. The round settles via the base escrow (the web view adds the arbiter).
- **Devnet only** — payment + escrow code build their `Connection` via `solanaConnection()`
  (`@pay/agent-runtime`), which throws on a mainnet RPC unless `ALLOW_MAINNET=1`; it defaults to
  `https://api.devnet.solana.com`. Never put a funded mainnet keypair in `.env`.
- **`examples/txodds` depends on `@pay/agent-runtime` via a `file:` dep** — run `npm run build` in
  `packages/agent-runtime` first so the dist exists.
- **Secrets live in `.env`** (gitignored). `server/proxy.ts` loads the repo-root `.env`; the proxy needs
  `BUYER_KEYPAIR_B58` (from `setup.js`, funded) and `VENICE_API_KEY` (or another provider's key — see `LLM.md`).
