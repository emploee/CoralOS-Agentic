# Solana Agent Kit read-only tools

This optional example loads `@pay/solana-agent-tools` into `solana-agent-kit` as a small allowlisted
plugin. It gives richer agents chain context without making Solana Agent Kit the money-moving authority.

## What it exposes

| Action | Tool | Moves funds? |
|---|---|---|
| `solana.read_wallet_balance` | `readWalletBalance` | No |
| `solana.read_token_balances` | `readTokenBalances` | No |
| `solana.fetch_token_price` | `fetchTokenPrice` | No |
| `solana.fetch_pyth_price` | `fetchPythPrice` | No |
| `solana.simulate_transfer_intent` | `simulateTransferIntent` | No |

The wallet passed to SAK is read-only: every signing method throws. The transfer intent action runs
the repo policy gate and returns an instruction-shaped explanation with `executable: false`.

## Run it

`solana-agent-kit@2.x` currently requires Node 22, so this example is intentionally isolated from the
Node 20 runtime packages.

```sh
npm install
npm run smoke      # deterministic mock mode, used by CI
npm run demo       # live devnet balance read + Jupiter/Pyth price reads
```

For live reads, set `WALLET` to a devnet address. No private key is needed:

```ini
WALLET=11111111111111111111111111111111
SOLANA_RPC_URL=https://api.devnet.solana.com
JUPITER_API_KEY=... # optional, used when Jupiter requires one
```

## Future fund-moving actions

Do not add swaps, bridges, token launches, or live transfers here. A future SAK action that can move
funds must be a separate reviewed surface and pass through the repo's existing chain:

`policy.enforce()` -> devnet guard -> simulation -> explicit approval -> ledger proof receipt -> UI transaction surface.
