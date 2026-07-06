# Agents that earn — a Solana × CoralOS starter kit

> **Fork-ready rails for autonomous services that get paid on-chain.** An LLM agent sells a service;
> buyers reason about value; sellers compete on price and quality; funds lock in a Solana **devnet**
> escrow; delivery triggers release; no-shows get refunded. The whole loop —
> **WANT → BID → AWARD → DEPOSITED → DELIVERED → RELEASED** — is already wired. Your job is **one
> function**: replace [`deliverService()`](examples/txodds/agent/service.ts) with something an agent can sell.

Don't spend the hackathon wiring up LLMs, agent coordination, bidding, frontend state, Solana Pay, and
escrow. That's all here and running on devnet. **Fork it, ask an LLM how to turn it into your paid agent
idea, and ship a marketplace in hours.** Every team can hand judges a live **Explorer link** proving the
payment settled on-chain.

> **Doing the [TxODDS World Cup hackathon](https://superteam.fun/earn/hackathon/world-cup)** ($50K across
> markets, trading agents, and fan experiences)? This kit already runs on TxODDS' live football API +
> Solana — **[TXODDS.md](TXODDS.md)** maps it to each track and shows the fork point for each.

## What you actually build (it's one function)

This kit turns an agent idea into a **settling economy**. You change three things — everything else (the
payment rails, the escrow, the competitive market, the live board) stays:

1. **The service** — [`deliverService()`](examples/txodds/agent/service.ts): the string a buyer pays for.
2. **The seller persona** — floor price, quality, inventory (a `coral-agent.toml`).
3. **The buyer's criteria** — how it reasons about value and picks a winner.

Some things agents can sell on these exact rails:

| Idea                       | what`deliverService()` returns                          | the buyer is paying for  |
| -------------------------- | --------------------------------------------------------- | ------------------------ |
| **Freelancer agent** | ad copy, a landing section, a tweet thread                | words that convert       |
| **Research agent**   | a sourced brief answering a question                      | a decision-ready summary |
| **Broker agent**     | routes the job to the best sub-agent, resells at a markup | one call instead of ten  |
| **Oracle agent**     | a verified fact / a checked output                        | trust in a number        |
| **Reseller agent**   | packages other agents' services into one                  | a bundle, one payment    |

The first two already ship as working marketplace rounds: `npm run freelancer` (heterogeneous
harnesses — a plain LLM vs headless **Claude Code** — bid on a brief, an independent verifier gates
the release) and `npm run research` (live odds moves trigger the WANT — quiet board, no spend).
See [`examples/marketplace`](examples/marketplace/README.md); fork those instead of starting blank.

> **The World Cup oracle is only the default demo — not the product.** It sells a verified, de-margined
> betting line to prove the rails work end-to-end. The invitation isn't "here's a repo about sports
> odds"; it's **"here are the rails for autonomous services with on-chain settlement — fork one function,
> change the persona, change the buyer criteria, and build the thing agents buy."**

## The loop, already wired

The competitive market runs one round as a chain of on-chain-anchored steps. All of it ships working:

```
WANT ─▶ BID ─▶ AWARD ─▶ DEPOSITED ─▶ DELIVERED ─▶ (VERIFIED) ─▶ RELEASED
 │       │       │          │            │            │             │
 buyer   sellers buyer     funds lock   seller       independent   escrow pays
 asks    compete picks    in escrow    delivers     verifier      the winner
                 best      (devnet)     the service  gates the     (or REFUNDED
                 value                  (hash-bound) release       on a no-show)
```

**Validated live on devnet, both ways.** A seller that delivered a broken payload got its release
**refused** (verifier fail → policy gate → funds stayed refundable), and a good delivery settled
through the neutral arbiter —
[see the release tx](https://explorer.solana.com/tx/3MEWxbYUPVGV4QXN3VH4J7Rripz4vbrFKCbBNAbXtYAhXG3NecAkFZkQmYmqBuykJZkHhkiMruXkbnYDCN1BpbM8?cluster=devnet).
Every round leaves a **run ledger** folder (bids, award reasoning, hash-bound delivery, verifier
verdict, Explorer-linked txs) and feeds a **reputation score** buyers weigh on the next award.

| You get, prebuilt                                      | Where                                                                     | So you don't have to                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------ |
| **LLM brain** (Venice AI)                        | [`packages/agent-runtime/src/llm`](packages/agent-runtime/src/llm)       | wire an LLM SDK, prompts, JSON-guarding    |
| **Agent coordination** (CoralOS / MCP)           | [`packages/agent-runtime/src/coral`](packages/agent-runtime/src/coral)   | run a message bus, thread state, sessions  |
| **Bidding market** (WANT/BID/AWARD)              | [`packages/agent-runtime/src/market`](packages/agent-runtime/src/market) | invent a negotiation protocol              |
| **Frontend state** (live rounds/bids/settlement) | [`examples/marketplace/web`](examples/marketplace/web)                   | build a React app that streams the market  |
| **Solana Pay** (reference-bound transfers)       | [`packages/agent-runtime/src/solana`](packages/agent-runtime/src/solana) | hand-roll payment URLs + verification      |
| **Escrow** (deposit → release / refund)         | [`examples/txodds/escrow`](examples/txodds/escrow)                       | write, audit, and deploy an Anchor program |
| **Payment rails** (one interface; 2 live, 6 scaffolds) | [`packages/payment-runtime`](packages/payment-runtime)             | re-plumb payments per provider (see its README's honest status table) |
| **Read-only Solana tools** (SAK-style context plugin) | [`packages/solana-agent-tools`](packages/solana-agent-tools)       | give agents balances/prices without handing them signing authority |
| **Harness adapters** (Claude Code / any CLI sells) | [`packages/harness-runtime`](packages/harness-runtime)                 | bridge external agent harnesses yourself   |
| **Verifier gate** (release only on a pass)       | [`coral-agents/verifier-agent`](coral-agents/verifier-agent)             | build independent delivery checks          |
| **Policy choke point** (caps, bindings, gates)   | [`packages/agent-runtime/src/policy`](packages/agent-runtime/src/policy) | scatter ad-hoc safety checks               |
| **Run ledger + reputation** (auditable rounds)   | [`packages/agent-runtime/src/ledger`](packages/agent-runtime/src/ledger) | build an audit trail + track record        |

## Prerequisites

Everything runs on **devnet** — free play money, real on-chain settlement. Keys live in a local `.env`
(none in the repo).

| Need                               | Why                                            | Get it                                                                                                                 |
| ---------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Node 20+**                 | the runtime, the demo, the market              | [nodejs.org](https://nodejs.org)                                                                                        |
| **An LLM key**               | the agent's reasoning + delivery               | **Venice AI** (`VENICE_API_KEY`, **free credits** — see [LLM.md](LLM.md)). Anthropic / OpenAI also work. |
| **A funded devnet wallet**   | the buyer signs the escrow deposit → release  | generated in step 1; fund at[faucet.solana.com](https://faucet.solana.com)                                              |
| **Docker** *(market only)* | coral-server coordinates the multi-agent round | [docker.com](https://www.docker.com) — the single-agent demo needs none                                                |

The optional Solana Agent Kit example uses `solana-agent-kit@2.x`, which currently needs **Node 22+**.
The core runtime, rails, and other examples keep the repo-wide **Node 20+** floor.

## Quick start

### 1. Fork & set up (once)

```sh
git clone https://github.com/trilltino/solana_coralOS.git && cd solana_coralOS
npm install --prefix scripts   # script deps (web3.js, bs58)
node scripts/setup.js          # creates .env + two devnet wallets (also saved to WALLETS.txt)
```

Open the generated `.env`, add your **Venice AI** key, then **fund the buyer wallet** at
[faucet.solana.com](https://faucet.solana.com) (GitHub sign-in — the only devnet faucet that works):

```ini
# This kit's LLM is Venice AI — OpenAI-compatible, with free credits for the hackathon.
LLM_PROVIDER=venice
VENICE_API_KEY=...
# Anthropic / OpenAI also work — see LLM.md
```

> **Free credits via Venice AI.** New accounts can redeem **$50 in credits**: sign up at
> [venice.ai](https://venice.ai), create a key at [venice.ai/settings/api](https://venice.ai/settings/api),
> and paste the redeem code **`IMPERIAL50`** into the box at the bottom of that API page. Default model
> `llama-3.3-70b` (override with `LLM_MODEL`). The code is a public referral — it may be per-account,
> rate-limited, or expire. Full provider/key/model switching (env **or** in code): **[LLM.md](LLM.md)**.

### 2. See the rails — pick a view

**Fastest (no Docker) — the single-agent demo.** One agent sells the default service and auto-settles:

```sh
npm run dev        # proxy (:8801) + demo UI (:3020), opens the browser
```

Select a fixture and watch the agent's read get delivered and the escrow settle **automatically** on
delivery — buyer funds → arbiter releases to the seller, each step linked on the Solana Explorer.

**The full market (Docker) — buyers + competing sellers.** The complete WANT → … → RELEASED loop:

```sh
docker compose up -d coral        # coral-server (the MCP coordinator)
bash build-agents.sh              # build the agent images (buyer + sellers)
npm run marketplace               # launch the auction (installs deps on first run)
npm run marketplace:web           # (optional, 2nd terminal) the React visualizer
```

A buyer broadcasts a WANT; LLM sellers compete with bids; the winner is escrowed, delivers, and gets
released — with a React visualizer of live rounds, bids, and settlement badges.

## Run the examples

One `npm run` per example, from the repo root. **Each command installs that example's deps on first run
(and builds the runtime if it needs it)** — no manual `npm install`. First do `npm run setup` once (wallets
→ `.env`) and add your Venice key.

| Command | Runs | Needs |
|---|---|---|
| `npm run dev` | **the default demo** — the oracle proxy + UI, auto-settles on delivery | funded wallet + LLM key (renders demo data without) |
| `npm run readiness:e2e` | **production-readiness e2e gate** - recorded Coral state -> feed -> ledger/proof receipts + desk smoke | no Docker/devnet/LLM key |
| `npm run demo:coral` | the same oracle as a **multi-agent CoralOS round** (buyer + competing sellers) | Docker + `docker compose up -d coral` + a TxLINE token (`npm --prefix examples/txodds run mint`) |
| `npm run marketplace` | **the full market** — a buyer + LLM sellers bidding in one session | Docker + `docker compose up -d coral` + `bash build-agents.sh` |
| `npm run marketplace:web` | the market **visualizer** — live rounds, bids, settlement badges (:5173) | the marketplace feed running |
| `npm run freelancer` | **the freelancer market** — heterogeneous harnesses bid on a brief; an independent verifier gates the escrow release | Docker + coral + `bash build-agents.sh` (add `CLAUDE_SELLER=1` after `bash build-agents.sh claude`) |
| `npm run research` | **the research market** — live odds moves trigger paid research rounds (quiet board = no spend) | Docker + coral + the txodds proxy + `npm run research:watch` |
| `npm run research:watch` | the research **event watcher** — diffs the live board, queues WANTs (:4600) | the txodds proxy (`npm run dev` or `npm --prefix examples/txodds run proxy`) |
| `npm run agent-economy` | **autonomous** agent→agent purchase | Docker + `docker compose up -d coral` |
| `npm run agent-economy:bridge` | the **human checkout** bridge (HTTP + React) | Docker + `docker compose up -d coral` |
| `npm run agent-economy:quickstart` | the **bare 402** pay-per-call seller (no Docker, no CoralOS) | LLM key + funded wallet |
| `npm run agent-economy:quickstart:buyer` | the quickstart **buyer** (run in a 2nd terminal) | the quickstart server running |
| `npm run agent-economy:solana-tools` | optional **Solana Agent Kit read-only context** demo | Node 22+; no private key needed |
| `npm run agent-economy:solana-tools:smoke` | deterministic mock smoke for the SAK tools example | Node 22+ |
| `npm run agent-economy:web` | the agent-economy **3-tab dashboard** | — (talks to the bridge) |
| `npm run desk` | **TxODDS Agent Desk** in a browser (:3030) - run ledger, proof receipts, board actions | the txodds proxy (`npm run dev` or `npm --prefix examples/txodds run proxy`) |
| `npm run desk:app` | the same desk as a **Tauri desktop app** | Rust/Tauri prerequisites + the txodds proxy |

> **Docker ones** (`marketplace`, `demo:coral`, `agent-economy`, `:bridge`) coordinate over coral-server,
> so start it first: `docker compose up -d coral`, and `bash build-agents.sh` to build the agent images.
> **No-Docker ones** (`dev`, `agent-economy:quickstart`, `:web`, `marketplace:web`, `desk`) run straight
> from Node; `desk:app` adds the Tauri/Rust shell.

Production-readiness status and the launch blockers live in
[`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md). The automated gate is
`npm run readiness:e2e`: it boots the real marketplace feed with a recorded Coral transcript,
asserts feed/threads/runs/proof receipts over HTTP, and smokes the Agent Desk.

## Make it yours

1. **Change the service.** Open [`examples/txodds/agent/service.ts`](examples/txodds/agent/service.ts) —
   the `deliverService()` fork point — and return your own value from `deliverService(request)`. Sell copy,
   a brief, a routed job, a verified fact. The default body sells World Cup odds; that's all it is.
2. **Change the seller.** Give your seller a persona (floor price, quality, inventory) in its
   `coral-agent.toml` under [`coral-agents/`](coral-agents).
3. **Change the buyer's criteria.** Tell the buyer how to value bids and pick a winner
   ([`coral-agents/buyer-agent`](coral-agents/buyer-agent)).

Stuck on the idea? **Ask an LLM: "given this loop and `deliverService()`, what paid agent should I
build?"** — the rails don't care what you sell.

## Under the hood — the runtime

Agents import [`packages/agent-runtime`](packages/agent-runtime) and write only behaviour. Six modules,
one per concern:

- **`llm/`** — [`complete()`](packages/agent-runtime/src/llm/complete.ts), one provider-agnostic call
  over `fetch` (no SDK). **Venice AI** is the kit's LLM; `LLM_PROVIDER` also accepts `anthropic` / `openai`,
  no code change (see **[LLM.md](LLM.md)**). The model **proposes**, code **disposes** — callers guard
  every number.
- **`solana/`** — Solana Pay helpers + [`solanaConnection()`](packages/agent-runtime/src/solana/connection.ts),
  the **devnet guard** that throws on a mainnet RPC unless `ALLOW_MAINNET=1`, so it applies everywhere
  value moves.
- **`coral/`** — a CoralOS (MCP) client + agent entrypoint: the coordination fabric the sellers and
  buyer meet on. Deep dive, source → example: **[CORAL.md](CORAL.md)**; official docs:
  [docs.coralos.ai](https://docs.coralos.ai/welcome).
- **`market/`** — the WANT/BID/AWARD wire format (now incl. **VERIFY/VERIFIED**): the negotiation
  protocol, pure and testable.
- **`ledger/`** — the **run ledger**: one folder per paid round (bids, award reasoning, sha256-bound
  delivery, verifier verdict, payment proof receipts, Explorer-linked txs, the raw transcript) +
  **reputation** derived from it.
  "What did the agent actually do for the money?" — open the run.
- **`policy/`** — [`enforce()`](packages/agent-runtime/src/policy/policy.ts), the choke point every
  deposit/release passes: spend caps, service allowlist, payout binding, award-price binding
  (a seller can't inflate the escrow after winning), verifier gate.

And one more package: [`packages/harness-runtime`](packages/harness-runtime) — the **harness adapter
SDK**. One interface (`quote`/`run`) so a seller can be a prompt (`node-llm`), **headless Claude Code**
(`claude-code`, with Coral MCP config injection), or any CLI (`HARNESS=cli HARNESS_CMD='hermes {prompt}'`).
The agent keeps the wallet and the escrow checks; the harness only produces hash-bound artifacts —
**harness processes never hold keys**.

Optional companion: [`packages/solana-agent-tools`](packages/solana-agent-tools) exposes read-only
Solana context tools for richer agents and a Solana Agent Kit-compatible plugin. It can read balances,
SPL token accounts, Jupiter prices, and Pyth Hermes prices, plus simulate a transfer intent through
`policy.enforce()`. It cannot swap, bridge, launch tokens, sign, or broadcast.

### The escrow contract — the settlement spine

The only Rust in the kit: **two** deployed devnet programs, **called** (not forked) by the agents' TS
clients. The base escrow ([`escrow/lib.rs`](examples/txodds/escrow/programs/escrow/src/lib.rs)) is the
settlement spine; the arbiter ([`arbiter/lib.rs`](examples/txodds/escrow/programs/arbiter/src/lib.rs)) is
a trustless wrapper so the buyer can't take delivery **and** refund.

| Program                               | Instruction                                  | Does                                                                                     |
| ------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **escrow** `R5NWNg9...CeXet`  | `initialize(amount, reference, deadline)`  | buyer deposits SOL into a PDA seeded by`(buyer, reference)`                            |
|                                       | `release()` / `refund()`                 | buyer pays the seller on delivery / reclaims after the deadline                          |
| **arbiter** `FJtuVXsy...ktXd` | `open(amount, reference, deadline)`        | payer funds a**vault PDA** that becomes the escrow's buyer (payer can't claw back) |
|                                       | `arbitrate_release` / `arbitrate_refund` | only the**neutral arbiter** releases to the seller / refunds the payer             |

The escrow `reference` is **bound to the delivery** (`sha256(...)`), so the on-chain order provably *is*
the thing bought. Written to the Solana security checklist: `init` (never `init_if_needed`), `has_one` on
buyer **and** seller, `close = buyer`, checked math. It's already deployed — the demo runs against the
deployed ids with no local build. **Devnet only** — never put a funded mainnet key in `.env`. See
[`examples/txodds/escrow/README.md`](examples/txodds/escrow/README.md).

## Repo layout

| Directory                   | Purpose                                                                                                                                                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `examples/txodds/`        | **the default demo** — the World Cup oracle. `agent/` (`service.ts` = the `deliverService()` fork point; `edge.ts` = its transform; escrow/arbiter clients), `server/` (proxy + mint), `web/` (React board), `research/` (the odds-move **event watcher** feeding the research round), `escrow/` (the two Anchor programs) |
| `examples/marketplace/`   | **the full market** — a buyer + competing sellers in one CoralOS session, in three rounds: `start.ts` (classic), `freelancer.ts` (harness sellers + **verifier-gated** release), `research.ts` (event-driven — odds moves trigger the WANTs); `feed/` (rounds + the **run ledger** `runs/`, `/api/runs`, `/api/reputation`, disk replay), `web/` (React visualizer). Needs Docker |
| `examples/agent-economy/` | **three front doors** on CoralOS — autonomous (agent→agent), a human checkout bridge, and a bare 402 pay-per-call quickstart; plus an optional Solana Agent Kit read-only tools example                                                                                                                                    |
| `examples/txodds-agent-desk/` | the **operator console** — a Tauri desktop shell over the proxy + run ledger + proof receipts (`npm run desk` for the browser version, no Rust needed)                                                                                                    |
| `coral-agents/`           | the agents coral-server launches per session —`buyer-agent`, `seller-agent` (+ personas incl. `seller-claude`), `verifier-agent` (the release gate), `broker` (swarm reseller), `echo-agent`, `user_proxy`                                                 |
| `packages/agent-runtime/` | the runtime —`llm/`, `solana/`, `coral/`, `market/`, `ledger/`, `policy/`                                                                                                                                                                                    |
| `packages/harness-runtime/` | the **harness adapter SDK** — `node-llm` / `claude-code` / any CLI as market sellers                                                                                                                                                                       |
| `packages/payment-runtime/` | the **payment rail router** — Solana Pay + escrow live; Pay.sh / x402 / USDC / allowance / embedded / payout as typed scaffolds (status table in its README)                                                                                              |
| `packages/solana-agent-tools/` | the optional **read-only Solana agent tools** package — wallet/token reads, Jupiter/Pyth prices, and transfer-intent simulation for SAK-style agents; no fund-moving actions in v1                                                                     |
| `scripts/`                | `txodds.js` (`npm run dev`), `setup.js` (devnet wallets), `provision-swarm.js` (broker + seller wallets for the swarm demo)                                                                                                                                     |
| `docker-compose.yml`      | coral-server (the MCP coordinator) for the market                                                                                                                                                                                                                     |

## The LLM: Venice AI

This kit's agents think with **Venice AI** — OpenAI-compatible, with **free credits** to keep the
hackathon zero-cost. Anthropic and OpenAI are drop-in alternatives. Setup, the redeem code, model
choice, and how to switch providers in env **or in code**: **[LLM.md](LLM.md)**.

## Optional: Claude Code skills

**Solana dev skill** (Anchor, testing, payments):

```sh
npx skills add https://github.com/solana-foundation/solana-dev-skill --global --yes
```

## License

MIT
