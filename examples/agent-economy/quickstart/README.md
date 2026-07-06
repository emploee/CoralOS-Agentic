# HTTP 402 Quickstart

This example implements a minimal pay-per-call flow with two local Node processes and plain HTTP `402` responses. It does not use Docker or CoralOS.

## Flow

```text
buyer.ts -> GET /api/data -> server.ts
server.ts -> 402 + payment challenge
buyer.ts -> devnet SOL transfer
buyer.ts -> GET /api/data with proof
server.ts -> verifies on-chain transfer
server.ts -> 200 + data
```

## Run

```sh
npm install
export SELLER_WALLET=<devnet pubkey>
export BUYER_KEYPAIR_B58=<base58 devnet keypair>
export LLM_PROVIDER=venice
export VENICE_API_KEY=...
# export LLM_MODEL=kimi-k2-7-code

npm run server
npm run buyer
```

`VENICE_API_KEY` is optional. Without an LLM provider, the buyer uses deterministic budget policy.

Generate and fund local devnet wallets from the repo root:

```sh
node scripts/setup.js
```

## Files

| File | Role |
|---|---|
| `server.ts` | HTTP 402 seller and `deliverData()`. |
| `verify.ts` | On-chain transfer verification. |
| `buyer.ts` | Buyer loop, budget guard, optional LLM decision/summarization. |

## Environment

| Variable | Description |
|---|---|
| `SELLER_WALLET` or `WALLET` | Recipient public key. |
| `BUYER_KEYPAIR_B58` | Buyer signing keypair for devnet transfer. |
| `SOLANA_RPC_URL` | Defaults to devnet. |
| `ENDPOINT` | Seller endpoint, default `http://localhost:3001/api/data`. |
| `BUYER_MAX_SOL` | Buyer budget cap. |
| `LLM_PROVIDER`, provider key, `LLM_MODEL` | Optional LLM behavior. |

## Related CoralOS Path

For the coordinated agent version, use `../autonomous` or `../bridge`. The seller logic is still implemented in `coral-agents/seller-agent/src/service.ts`.
