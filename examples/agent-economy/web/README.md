# web — the React frontend (default demo UI)

A Vite + React + TypeScript + Solana wallet-adapter app — the polished front door to the agent
economy. It's the **default** UI: the bridge builds and serves it at `http://localhost:3010`.

Three tabs, all talking only to the bridge (never directly to CoralOS or Solana):

- **Autonomous** — click Run; watch an LLM buyer agent pay the seller on-chain, live, with the
  **MCP-primitive strip** (create-session → create_thread → send_message → wait_for_mention) and
  `@mention` chips showing what each step rides on.
- **Checkout** — connect Phantom (Devnet), pick a service, pay with one click. The timeline
  narrates the **puppet trick**: the bridge posts *as* `user-proxy` into the Coral thread, and the
  seller's reply is read back from session state.
- **Swarm** — a broker shops two sellers and resells at a markup; the feed draws **one lane per
  Coral thread** (buyer↔broker + a private thread per seller) — two on-chain settlements per request.

Every tab shows a **session header** (session id, agent roster with presence dots, thread count)
fed by the bridge's `GET /coral`.

## Develop (hot reload)

The served build is static, so for live edits run the Vite dev server (React Fast Refresh) with the
bridge up:

```sh
docker compose up -d coral bridge        # backend on :3010
npm install && npm run dev               # → http://localhost:5173, proxied to the bridge
```

The dev server proxies `/order`, `/autonomous`, `/swarm`, `/coral`, and `/health` to the bridge on
:3010, so the UI is live while the agents/payments run against the real backend.

## Build

```sh
npm run build                            # → dist/  (what the bridge serves in production)
npm run typecheck
```

## How it's wired

- `src/api.ts` — typed client for the bridge endpoints (`/order`, `/order/:ref/paid`,
  `/autonomous/*`, `/swarm/*`, `/coral`).
- `src/main.tsx` — wallet providers (Phantom, devnet) + a `Buffer` polyfill for web3.js.
- `src/hooks/useCheckout.ts` — builds the reference-bound transfer, Phantom signs, submits the
  proof — narrating each Coral step.
- `src/hooks/useFeed.ts` — polls a conversation feed (autonomous or swarm).
- `src/components/SessionHeader.tsx` — the Coral facts behind a tab (roster, presence, threads).

The backend doesn't change — this is purely a nicer window onto the same economy.
