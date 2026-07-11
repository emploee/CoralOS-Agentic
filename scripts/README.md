# scripts

Helper scripts for the kit.

## `setup.js` — one-time wallet setup

```sh
npm run setup
```

Installs the root workspace and setup-script dependencies. Then it generates a buyer + seller devnet keypair, writes them into the repo-root `.env` (filling
`WALLET` and `BUYER_KEYPAIR_B58` from `.env.example`), and prints both addresses to **fund** at
[faucet.solana.com](https://faucet.solana.com). Re-running re-reads your `.env`, so it preserves a key
(e.g. `ANTHROPIC_API_KEY`) you've already added.

## `txodds.js` — run the demo

```sh
npm run dev        # = node scripts/txodds.js
```

Starts the data/escrow proxy (:8801), the TxODDS feed (:4000), Coral Console probe (:5555/ui/console),
and Oracle UI (:3020), then opens the browser. Devnet only for settlement. The console probe is
allow-skip unless `CORAL_CONSOLE_REQUIRED=1` is set.

## `coral-console-e2e.mjs` - Coral Console probe

```sh
npm run coral:console:e2e
```

Starts `docker compose up -d coral`, waits for `http://localhost:5555/ui/console`, verifies it serves
the Coral Console HTML entrypoint, and writes `.artifacts/coral-console/console-e2e.json`.

## `run-example.js` - run an example with local package bootstrap

```sh
node scripts/run-example.js examples/txodds coral
```

Installs the root workspace on first run and builds local workspace dependencies first (`@pay/agent-runtime`,
and `@pay/solana-agent-tools` for any example that imports it). It also enforces per-example Node floors,
so an example can require a newer Node without moving the repo-wide Node 20 baseline.
