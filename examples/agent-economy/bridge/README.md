# Checkout Bridge

The bridge exposes an HTTP API and serves the React dashboard for human wallet checkout. It represents a human user in CoralOS by injecting messages as the `user-proxy` agent through the CoralOS puppet API.

## Flow

```text
Browser -> POST /order { service }
Bridge -> puppet message as user-proxy
Seller -> payment request in Coral thread
Browser wallet -> devnet SOL transfer
Browser -> POST /order/:reference/paid { sig }
Seller -> verifies transfer and delivers
Bridge -> reads delivery from extended session state
```

The puppet API is used for sending. Replies are read from:

```text
GET /api/v1/local/session/{namespace}/{session}/extended
```

## Run

Docker path from repo root:

```sh
docker compose up -d coral bridge
```

Open:

```text
http://localhost:3010
```

Bare process path:

```sh
cd examples/agent-economy/bridge
npm install
SELLER_WALLET=<devnet pubkey> npm start
```

When run bare, the bridge serves files from `./web`. The Docker image builds `../web` and copies the output into `/app/web`.

## Files

| File | Role |
|---|---|
| `server.ts` | Bridge API, session creation, puppet calls, session-state reads, static UI serving. |
| `smoke.ts` | Headless order/payment/delivery check using `.env` keypair instead of a browser wallet. |
| `web/` | Built React output copied by the Docker image. |
| `../web/` | React source. |

## Headless Check

```sh
npm run smoke
```

Requires CoralOS, seller agent image, and a funded devnet wallet in `.env`.

## Security Notes

- The bridge does not need private keys for browser wallet checkout.
- The smoke test uses the `.env` keypair for automated payment.
- Keep secrets outside source control.
- Run checkout wallets on Devnet for local examples.
