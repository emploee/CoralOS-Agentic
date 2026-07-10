# Examples

Two examples carry this kit: `txodds/` (the default single-agent paid service) and `marketplace/`
(the multi-agent CoralOS market). Both are actively maintained, fully tested, and runnable
end-to-end without touching any other example.

| Example | Description | Primary command |
|---|---|---|
| `txodds/` | Single-agent TxODDS proxy and static UI. Uses TxLINE data, edge analysis, settlement endpoints, run persistence, and research watcher. Free TxLINE access is scoped to the World Cup 2026 window — see its README. | `npm run dev` |
| `marketplace/` | CoralOS market with buyer/seller agents, verifier-gated variants, event-driven research, feed server, visualizer, and run ledger. Deeply expanded with a shared agent framework (capability/safety/tool-loop), a Coral-native signal agent, and trace/arena UI — see `docs/AGENT_ORCHESTRATION.md`. | `npm run marketplace` |

## Shared Flow

```text
WANT -> BID -> AWARD -> ESCROW_REQUIRED -> DEPOSITED -> DELIVERED -> VERIFIED -> RELEASED
```

Not every example uses every step. The `txodds/` single-agent web flow settles directly through the
proxy (no CoralOS messages); `marketplace/` runs the full CoralOS lifecycle above.

## Requirements by Example

| Example | Docker | Wallet | LLM key | Notes |
|---|---|---|---|---|
| `txodds/` | No | Funded buyer for settlement | Optional with fallback | Proxy and UI only. |
| `marketplace/` | Yes | Funded buyer/arbiter/seller env | Optional with fallback | Requires built agent images. |

See the root [README](../README.md) for setup and command tables, and [docs/AGENT_ORCHESTRATION.md](../docs/AGENT_ORCHESTRATION.md)
for how `marketplace/` implements real agent-orchestration patterns (capability grants, budget/step
safety gates, a bounded LLM tool-call loop, a Coral-native signal agent, and an audit/arena UI) in
pure TypeScript.
