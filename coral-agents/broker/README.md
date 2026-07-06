# broker

The broker agent acts as both buyer and seller. It quotes a buyer, requests upstream quotes from configured sellers, pays one seller, then resells the result to the buyer.

## Flow

```text
buyer -> request <service> -> broker
broker -> quote requests to SWARM_SELLERS, one thread per seller
seller -> quote reply
broker -> pays selected seller on devnet
broker -> charges buyer with markup
broker -> delivers result to buyer
```

The broker uses one Coral thread per upstream seller and correlates replies with `ctx.waitForMentionInThread()`.

## Files

| File | Role |
|---|---|
| `src/index.ts` | Broker coordination and quote selection. |
| `src/payment.ts` | Seller-side payment request/verification helpers. |
| `src/wallet.ts` | Buyer-side payment helper for upstream seller payment. |
| `src/logic.ts` | Pure broker logic. |

## Configuration

| Variable | Description |
|---|---|
| `BROKER_KEYPAIR_B58` | Keypair used to pay upstream sellers and receive buyer payment. |
| `SELLER_WALLET` | Broker receive wallet, usually broker public key. |
| `SWARM_SELLERS` | Comma-separated seller names. |
| `MARKUP` | Resale markup. |
| `BROKER_MAX_SOL` | Upstream spend cap. |
| `SOLANA_RPC_URL` | Devnet RPC by default. |

Provision local broker and seller wallets:

```sh
node scripts/provision-swarm.js
```

Fund the broker wallet on devnet before running the flow.

## Edit Points

| Change | Location |
|---|---|
| Upstream seller set | `SWARM_SELLERS`. |
| Selection algorithm | `src/index.ts` / `src/logic.ts`. |
| Markup | `MARKUP`. |
| Payment guardrails | `BROKER_MAX_SOL` and wallet logic. |
