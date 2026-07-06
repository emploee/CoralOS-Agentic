# seller-agent

The seller agent bids on supported `WANT` messages, requests escrow funding after an award, verifies the funded escrow, runs a harness adapter, and posts a delivered payload.

## Flow

```text
WANT service=<service> arg=<arg>
  -> BID price=<sol> by=<agent>
  -> AWARD to=<agent>
  -> ESCROW_REQUIRED settlement=arbiter reference=<bound order>
  -> funded escrow verification
  -> optional PAYMENT_REQUIRED / PAYMENT_PROOF / PAYMENT_CONFIRMED
  -> DELIVERED payload=<json>
```

In arbiter mode, the seller verifies the escrow buyer as the vault PDA from `DEPOSITED`, not the original payer wallet.

## Files

| File | Role |
|---|---|
| `src/index.ts` | Coral market loop and funding verification. |
| `src/escrow.ts` | Read-only escrow funding check. |
| `src/service.ts` | TxODDS service delivery. |
| `src/payment.ts` | Older direct-payment helper/tests. |
| `src/replay.ts` | Replay helpers/tests. |

## Harness Adapter

Bidding and delivery use `@pay/harness-runtime`.

| Harness | Description |
|---|---|
| `node-llm` | In-process default around seller service logic. |
| `claude-code` | Headless Claude Code in an isolated workdir. |
| `cli` | Generic subprocess harness defined by `HARNESS_CMD`. |

Harnesses produce quotes, events, and hash-bound delivery artifacts. The seller process keeps wallet and escrow authority.

## Optional Upstream Procurement

Set `PROCURE_RAIL=pay-sh` to buy upstream context after escrow is funded and before delivery. The seller posts:

```text
PAYMENT_REQUIRED
PAYMENT_PROOF
PAYMENT_CONFIRMED
```

The marketplace feed folds these messages into `proofReceipts` and writes `proof_receipts.json`.

Current variables:

| Variable | Default |
|---|---|
| `PROCURE_PROVIDER` | `pay.sh/txodds-context` |
| `PROCURE_AMOUNT` | `0.03` |

The Pay.sh rail is a simulated proof-adapter rail until a live provider API is implemented.

## Environment

| Variable | Description |
|---|---|
| `SELLER_WALLET` | Payout address. |
| `AGENT_NAME` | Agent/persona name. |
| `SERVICES` | Supported services, usually `txline`. |
| `FLOOR_SOL` | Minimum bid. |
| `PERSONA` | Persona label/config. |
| `SETTLEMENT_MODE` | `arbiter` or `direct`. |
| `ESCROW_DEADLINE_SECS` | Escrow deadline. |
| `SOLANA_RPC_URL` | Devnet by default. |
| `TXLINE_API_KEY` | TxODDS token for TxLINE service. |
| `HARNESS` | Harness adapter, default `node-llm`. |
| `HARNESS_CMD` | CLI harness command when `HARNESS=cli`. |
| `LLM_PROVIDER` and provider key | Optional analysis/pricing. |

Without a live LLM provider, `service.ts` can return deterministic analysis output where supported.

## Tests

```sh
npm install
npm run typecheck
npm test
```
