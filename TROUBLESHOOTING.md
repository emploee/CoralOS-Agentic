# Troubleshooting

The single-agent TxODDS demo runs two Node processes: a proxy and a static web server. Multi-agent examples add Docker and CoralOS. Most local failures are caused by missing dependencies, unfunded devnet wallets, missing provider keys, unavailable upstream data, or occupied ports.

## Setup

### `Cannot find module '@solana/web3.js'` from `scripts/setup.js`

Install script dependencies:

```sh
npm install --prefix scripts
node scripts/setup.js
```

### `npm run dev` says Node 20+ is required

Install Node.js 20 or newer and reopen the terminal so `node --version` resolves to the new runtime.

## Wallet Funding

### Wallet addresses

`node scripts/setup.js` prints generated addresses and writes them to `WALLETS.txt`.

### Devnet faucet errors

Use `https://faucet.solana.com` for devnet SOL. Fund the buyer wallet for escrow and Solana Pay flows. A small amount is enough for local examples.

## TxODDS Board

### Board shows sample fixtures

The proxy only returns fixtures with verified live odds. If TxLINE has no priced markets at the moment, the UI uses labelled sample data.

Check the proxy directly:

```sh
curl http://localhost:8801/api/board
```

A non-empty array indicates live data. An empty array usually means no verified markets are currently available for the free-tier competitions.

### Subscribe or auth errors

The proxy needs:

- `BUYER_KEYPAIR_B58` in the repo-root `.env`;
- the buyer wallet funded on devnet;
- reachability to `https://txline-dev.txodds.com`;
- a valid `TXLINE_API_KEY` if using a minted token path.

Restart `npm run dev` after updating `.env`.

## LLM Output

### UI says `deterministic`

The LLM call failed or no provider was configured. Set an explicit provider and key in `.env`, for example:

```ini
LLM_PROVIDER=venice
VENICE_API_KEY=...
```

OpenAI and Anthropic are also supported; see [LLM.md](LLM.md). Restart the process after changing `.env`. Use `TRACE=1` to inspect provider/model selection.

## Settlement

### Settlement endpoint is unavailable

The escrow and arbiter paths need a funded devnet buyer wallet and the deployed devnet programs.

### `escrow IDL not found on-chain`

The default escrow program ID is `R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet` on devnet. Ensure `SOLANA_RPC_URL` points to devnet. If using a redeployed program, update the relevant client constants and IDL.

### `anchor build` fails

Anchor builds are only required when changing `examples/txodds/escrow`. Use Anchor 0.32.x. On Windows, if the IDL is emitted but `.so` output is missing, build the program with `cargo build-sbf` from the program folder and copy the artifact into `target/deploy/` before deployment.

## Ports

If `:3020`, `:8801`, `:4000`, `:4600`, or `:5173` is already in use, stop the process that owns the port.

Windows example:

```sh
netstat -ano | findstr :3020
```

macOS/Linux example:

```sh
lsof -i :3020
```

## Reporting

When opening an issue, include:

- OS and Node version;
- command that failed;
- whether the buyer wallet is funded;
- relevant `.env` variable names without secret values;
- proxy or agent logs.
