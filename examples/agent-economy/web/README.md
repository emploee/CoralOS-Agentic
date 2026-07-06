# Agent Economy Web UI

This Vite React app is the dashboard served by the checkout bridge. It talks to the bridge API and does not connect directly to CoralOS or Solana RPC.

## Views

| View | Purpose |
|---|---|
| Autonomous | Starts and watches the buyer-agent to seller-agent flow. |
| Checkout | Connects a Devnet wallet, submits an order, signs payment, and submits proof. |
| Swarm | Starts and watches a broker flow with multiple seller quote lanes. |

All views display session metadata from the bridge's `/coral` endpoint when available.

## Development

Start the backend:

```sh
docker compose up -d coral bridge
```

Start Vite:

```sh
cd examples/agent-economy/web
npm install
npm run dev
```

Vite proxies the bridge endpoints on `:3010`.

## Build

```sh
npm run typecheck
npm run build
```

The bridge Docker image serves the built static app.

## Data/API Files

| File | Role |
|---|---|
| `src/api.ts` | Typed client for bridge endpoints. |
| `src/main.tsx` | Wallet providers and browser polyfills. |
| `src/hooks/useCheckout.ts` | Wallet transfer and payment-proof submission. |
| `src/hooks/useFeed.ts` | Polling feed for autonomous and swarm views. |
| `src/components/SessionHeader.tsx` | Session roster/thread metadata. |
| `src/components/AutonomousTab.tsx` | Autonomous flow rendering. |
| `src/components/CheckoutTab.tsx` | Checkout flow rendering. |
| `src/components/SwarmTab.tsx` | Broker/swarm rendering. |
