# TxODDS Agent Desk

The Agent Desk is a browser/Tauri UI over existing local services. It reads proxy, ledger, receipt, settlement, reputation, and watcher APIs. It does not hold keys, sign transactions, or reimplement market logic.

## Data Sources

| Source | Endpoints used |
|---|---|
| TxODDS proxy `:8801` | `/api/runs`, `/api/run`, `/api/settle`, `/api/pay-sh-edge`, `/api/grade-runs`, board data. |
| Marketplace feed `:4000` | `/api/reputation` when available. |
| Research watcher `:4600` | Event queue status when available. |

If a source is unavailable, the corresponding panel shows a local status message. Settlement and procurement actions call proxy endpoints that already apply policy checks.

## Tabs

| Tab | Data |
|---|---|
| Runs | Run ledger records, delivery hash, escrow reference, verifier verdict, proof receipts, transaction links, grading status. |
| Receipts | `ProofReceipt` records across runs, including rail, provider, amount, paid flag, proof, and simulated flag. |
| Board | Live fixtures and actions for standard settlement or Pay.sh procurement settlement. |

## Browser Mode

Start the data side:

```sh
npm run dev
```

Serve the UI:

```sh
cd examples/txodds-agent-desk
npm run ui
```

Open:

```text
http://localhost:3030
```

## Tauri Mode

Requires Tauri prerequisites, Rust stable, and platform-specific WebView dependencies.

```sh
cd examples/txodds-agent-desk
npm install
npm run dev
npm run build
```

The Rust shell is intentionally small (`src-tauri/src/main.rs`) and defines no custom commands, IPC, filesystem access, or shell access. The CSP allows connections only to the expected localhost services.

## Security Notes

- The desk is a local operator UI, not a hosted authenticated admin system.
- Transaction signing remains in the proxy/agent/wallet paths.
- In Tauri mode, external navigation is blocked; transaction links are copied rather than opened.
