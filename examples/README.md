# Examples

`txodds/` is this kit's one example: the default single-agent paid service, plus a multi-agent
CoralOS round built on top of the same service. Actively maintained, fully tested, and runnable
end-to-end.

| Example | Description | Primary command |
|---|---|---|
| `txodds/` | TxODDS proxy and static UI (single-agent), plus a CoralOS buyer/seller/verifier round (multi-agent). Uses TxLINE data, edge analysis, settlement endpoints, run persistence, a feed server, and a research watcher. Free TxLINE access is scoped to the World Cup 2026 window — see its README. | `npm run dev` (single-agent), `npm run demo:coral` (multi-agent) |

## Shared Flow

```text
WANT -> BID -> AWARD -> PAYMENT_REQUIRED -> PAYMENT_PROOF -> PAYMENT_CONFIRMED -> DELIVERED -> VERIFIED -> SETTLED
```

Not every flow uses every step. The single-agent web flow settles directly through the proxy (no
CoralOS messages); the CoralOS round runs the full lifecycle above.

## Requirements

| Flow | Docker | Wallet | Notes |
|---|---|---|---|
| Single-agent (`npm run dev`) | No | Funded buyer for settlement | Proxy and UI only. |
| Multi-agent CoralOS round (`npm run demo:coral`) | Yes | Funded buyer/seller env | Requires built agent images (`bash build-agents.sh`). |

See the root [README](../README.md) for setup and command tables.
