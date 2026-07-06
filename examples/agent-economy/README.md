# Agent Economy Examples

These examples exercise CoralOS coordination and Solana devnet payment flows with three entry paths:

| Path | Description |
|---|---|
| `autonomous/` | Buyer agent purchases from seller agent inside a CoralOS session. |
| `bridge/` | HTTP bridge plus React UI lets a human wallet send an order through `user-proxy`. |
| `quickstart/` | Bare HTTP 402 seller and buyer with no Docker or CoralOS. |
| `web/` | React dashboard served by the bridge and usable in Vite dev mode. |
| `solana-agent-kit/` | Optional read-only Solana Agent Kit integration. |

CoralOS is used for coordination only. Payments are signed by agents or user wallets and verified on devnet.

## Prerequisites

- Docker Desktop for CoralOS paths.
- Node.js 20+ for repository examples.
- Devnet SOL for buyer/broker/wallet payment flows.
- Optional LLM provider key for live model output.
- Phantom or Solflare configured for Devnet when using checkout.

Generate local wallet variables from the repo root:

```sh
npm run setup
```

## Build Agent Images

From the repo root:

```sh
bash build-agents.sh seller
bash build-agents.sh buyer
docker build -t user-proxy:0.1.0 coral-agents/user_proxy
```

Start CoralOS:

```sh
docker compose up -d coral
```

## Autonomous Purchase

```sh
cd examples/agent-economy/autonomous
npm install
npm start
```

The launcher creates a session containing `buyer-agent` and `seller-agent`. Agent options such as buyer keypair and seller wallet are read from the repo-root `.env`.

Useful logs:

```sh
docker logs -f buyer-agent
docker logs -f seller-agent
```

## Checkout Bridge

Start through Docker from the repo root:

```sh
docker compose up -d coral bridge
```

Open:

```text
http://localhost:3010
```

The bridge:

1. serves the React app;
2. creates or reuses a CoralOS session with seller and `user-proxy`;
3. injects human orders as `user-proxy` through the puppet API;
4. returns seller payment requests to the browser;
5. verifies submitted transaction signatures.

For live UI edits:

```sh
cd examples/agent-economy/web
npm install
npm run dev
```

## Swarm/Broker Flow

Provision broker and seller wallets:

```sh
node ../../scripts/provision-swarm.js
```

Fund the broker wallet on devnet. The bridge dashboard can then run the broker flow: the broker requests quotes from sellers, pays the selected upstream seller, and resells to the buyer.

Broker details: `../../coral-agents/broker/README.md`.

## HTTP 402 Quickstart

The quickstart runs without Docker:

```sh
cd examples/agent-economy/quickstart
npm install
npm run server
npm run buyer
```

See `quickstart/README.md`.

## Optional Solana Agent Kit Example

This example requires Node 22 because of `solana-agent-kit@2.x`:

```sh
cd examples/agent-economy/solana-agent-kit
npm install
npm run smoke
```

It exposes read-only wallet, token, Jupiter, Pyth, and non-executable transfer-intent actions.

## Implementation Map

| File or directory | Role |
|---|---|
| `config/coral.toml` | Wallet-free CoralOS config and local agent registry. |
| `autonomous/start.ts` | Creates the autonomous buyer/seller session. |
| `bridge/server.ts` | Bridge API, puppet API calls, session-state reads, static UI serving. |
| `web/src/` | React dashboard. |
| `quickstart/` | Bare HTTP 402 flow. |
| `../../coral-agents/seller-agent` | Seller implementation. |
| `../../coral-agents/buyer-agent` | Buyer implementation. |
| `../../coral-agents/broker` | Broker implementation. |
| `../txodds/escrow` | Escrow and arbiter programs. |

## Security Notes

- Keep private keys and provider keys in `.env` or deployment secrets only.
- Keep CoralOS wallet-free.
- Use devnet wallets for local examples.
- Do not route signing authority into harness or read-only tool processes.
