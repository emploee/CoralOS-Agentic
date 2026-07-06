# Examples

The examples exercise the shared runtime, market protocol, payment rails, run ledger, and Solana devnet settlement paths.

| Example | Description | Primary command |
|---|---|---|
| `txodds/` | Single-agent TxODDS proxy and static UI. Uses TxLINE data, edge analysis, settlement endpoints, run persistence, and research watcher. | `npm run dev` |
| `marketplace/` | CoralOS market with buyer/seller agents, verifier-gated variants, event-driven research, feed server, visualizer, and run ledger. | `npm run marketplace` |
| `agent-economy/` | Autonomous purchase, checkout bridge, bare HTTP 402 quickstart, dashboard, and optional Solana Agent Kit read-only tools. | `npm run agent-economy` |
| `txodds-agent-desk/` | Browser/Tauri operator UI over proxy, run ledger, proof receipts, settlement endpoints, optional reputation, and watcher state. | `npm run desk` |

## Shared Flow

```text
WANT -> BID -> AWARD -> ESCROW_REQUIRED -> DEPOSITED -> DELIVERED -> VERIFIED -> RELEASED
```

Not every example uses every step. The bare HTTP 402 quickstart uses request/challenge/proof instead of CoralOS messages.

## Requirements by Example

| Example | Docker | Wallet | LLM key | Notes |
|---|---|---|---|---|
| `txodds/` | No | Funded buyer for settlement | Optional with fallback | Proxy and UI only. |
| `marketplace/` | Yes | Funded buyer/arbiter/seller env | Optional with fallback | Requires built agent images. |
| `agent-economy/autonomous` | Yes | Funded buyer/seller env | Optional depending service | Agent-to-agent flow. |
| `agent-economy/bridge` | Yes | Devnet wallet for checkout | Optional depending service | Serves React dashboard. |
| `agent-economy/quickstart` | No | Buyer keypair and seller address | Optional | Bare HTTP 402 flow. |
| `agent-economy/solana-agent-kit` | No | Public address only | No | Requires Node 22. |
| `txodds-agent-desk` | No for browser mode | No signing in desk | No | Reads local APIs. |

See the root [README](../README.md) for setup and command tables.
