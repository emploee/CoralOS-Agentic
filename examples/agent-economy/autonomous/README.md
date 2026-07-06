# Autonomous Agent Purchase

This example launches a CoralOS session containing a buyer agent and a seller agent. The buyer requests a service, decides whether to pay, sends a devnet SOL payment, and receives the seller delivery.

## Run

Prerequisites from the repo root:

```sh
docker compose up -d coral
bash build-agents.sh buyer
bash build-agents.sh seller
```

Start the session:

```sh
cd examples/agent-economy/autonomous
npm install
npm start
```

`start.ts` reads required agent options from the repo-root `.env`, including the buyer keypair and seller wallet.

## Logs

```sh
docker logs -f buyer-agent
docker logs -f seller-agent
```

## Edit Points

| Change | File |
|---|---|
| Seller payload | `../../../coral-agents/seller-agent/src/service.ts` |
| Buyer goal | `../../../coral-agents/buyer-agent/src/goal.ts` |
| Buyer decision logic | `../../../coral-agents/buyer-agent/src/llm_buyer.ts` |
| Session graph/options | `start.ts` |

## Notes

- CoralOS coordinates messages only.
- The buyer signs payment transactions.
- Use devnet wallets for local runs.
