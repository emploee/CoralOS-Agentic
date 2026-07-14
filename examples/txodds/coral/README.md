# TxODDS CoralOS Round

This folder launches the TxODDS service as a CoralOS multi-agent session. A buyer posts a TxODDS request, the seller bids, the buyer awards it, and the order settles through the arbiter-backed devnet escrow.

## Message Flow

```text
buyer-agent
  -> WANT service=txline arg=<fixtureId>

seller-agent
  -> BID price=<sol> by=<agent>

buyer-agent
  -> AWARD to=<seller>
seller
  -> ESCROW_REQUIRED reference=<order hash> settlement=arbiter
buyer-agent
  -> DEPOSITED settlement=arbiter vault=<vault PDA>
seller
  -> DELIVERED payload=<json>
buyer-agent
  -> VERIFY sha=<delivery hash>
verifier-agent
  -> VERIFIED verdict=pass
buyer-agent
  -> ARBITER_RELEASED sig=<devnet tx>
```

The escrow buyer is the arbiter vault PDA, and the delivery/order reference is bound into the settlement record.

## Requirements

- Docker with `coral-server` running.
- Agent images built from the repo root.
- Repo-root `.env` containing:
  - `BUYER_KEYPAIR_B58`, funded with devnet SOL;
  - `ARBITER_KEYPAIR_B58`;
  - `WALLET` or `SELLER_WALLET`;
  - `TXLINE_API_KEY`;
  - optional LLM provider configuration.

## Run

From the repo root:

```sh
docker compose up -d coral
bash build-agents.sh
```

From `examples/txodds`:

```sh
npm run coral
```

`round.ts` reads a live fixture id from the proxy's `/api/board` when available, starts the buyer and seller, and injects `SETTLEMENT_MODE=arbiter`.

Default seller:

| Agent | Services |
|---|---|
| `seller-agent` | `txline` |

## Logs

CoralOS names containers by generated ids. Find and tail by image:

```sh
docker logs -f $(docker ps -qf ancestor=buyer-agent:0.1.0 | head -1)
docker logs -f $(docker ps -qf ancestor=seller-agent:0.1.0 | head -1)
```

Set `TRACE=1` for Coral calls, PDA addresses, and transaction links.

## References

- Repository CoralOS wiring: `../../../CORAL.md`
- Buyer implementation: `../../../coral-agents/buyer-agent`
- Seller implementation: `../../../coral-agents/seller-agent`
- Escrow programs: `../escrow/README.md`
