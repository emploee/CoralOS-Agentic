# scripts

Helper scripts for the kit.

## `setup.js` — one-time wallet setup

```sh
npm install --prefix scripts
node scripts/setup.js
```

Generates a buyer + seller devnet keypair, writes them into the repo-root `.env` (filling
`WALLET` and `BUYER_KEYPAIR_B58` from `.env.example`), and prints both addresses to **fund** at
[faucet.solana.com](https://faucet.solana.com). Re-running re-reads your `.env`, so it preserves a key
(e.g. `ANTHROPIC_API_KEY`) you've already added.

## `provision-swarm.js` — wallets for the swarm demo

```sh
node scripts/provision-swarm.js
```

Generates a **broker** keypair plus two upstream **seller** receive addresses and writes them into
the repo-root `.env` (`BROKER_KEYPAIR_B58`, `BROKER_WALLET`, `SELLER_CHEAP_WALLET`,
`SELLER_PREMIUM_WALLET`), appending the addresses to `WALLETS.txt`. Run `node scripts/setup.js`
first (it creates the base wallets), then fund the broker at
[faucet.solana.com](https://faucet.solana.com) — it pays the upstream sellers. Needed by the
agent-economy **Swarm** tab and the marketplace's `ENABLE_BROKER=1` round; both print a hint
pointing here when the keys are missing.

## `txodds.js` — run the demo

```sh
npm run dev        # = node scripts/txodds.js
```

Starts the data/escrow proxy (:8801) + the Oracle UI (:3020) and opens the browser. Devnet only.

## `readiness-e2e.mjs` - production-readiness gate

```sh
npm run readiness:e2e
```

Boots the real marketplace feed against a temporary recorded Coral session, asserts the critical
HTTP surfaces (`/api/health`, `/api/feed`, `/api/threads`, `/api/runs`), verifies a
`proof_receipts.json` ledger artifact, and smokes the TxODDS Agent Desk JS/config. No Docker, devnet,
LLM key, or wallet needed.
