# TxODDS Agent Desk — the operator console (Tauri)

A desktop window onto what the kit already runs: the live board, the **run ledger**, the formal
**proof receipts**, and the settlement rails. Built as a [Tauri](https://tauri.app) v2 shell around
a no-build static UI (`ui/`) — the same ethos as the oracle web app.

**No bespoke glue, by design.** The desk holds no keys, signs nothing, and re-implements no market
logic. Every byte it renders and every action it takes is one of the existing HTTP surfaces:

| Source | What the desk uses it for |
|--------|---------------------------|
| txodds proxy `:8801` (`examples/txodds`, `npm run proxy`) | the live board, `/api/runs` + `/api/run` (the run ledger incl. `proofReceipts`), `/api/settle`, `/api/pay-sh-edge` (payment-runtime procurement), `/api/grade-runs` |
| marketplace feed `:4000` (optional) | `/api/reputation` — the ledger-derived seller scoreboard |
| research watcher `:4600` (optional) | the odds-move event queue status |

If a source is down, its panel degrades to a hint; the desk never invents data. Settle and
procurement clicks land on the proxy's **policy-gated** endpoints — the same `enforce()` choke
point the agents use.

## Tabs

- **Runs** — the run ledger as a console: every paid round, its delivery hash, escrow reference,
  verifier verdict, proof receipts, Explorer-linked txs, and the reality grade.
- **Receipts** — every `ProofReceipt` across all runs (rail, provider, amount, paid, proof), with
  scaffold rails honestly badged **simulated** — the money trail the ledger persists as
  `proof_receipts.json`.
- **Board** — live fixtures with two buttons per fixture: *buy read + settle* (escrow/arbiter) and
  *procure via Pay.sh + settle* (the payment-runtime demo).

## Run it

Start the data side first (repo root):

```sh
npm run dev                    # or: cd examples/txodds && npm run proxy
```

**In a browser (no Rust needed)** — the UI is plain static files:

```sh
cd examples/txodds-agent-desk && npm run ui    # serves ui/ on :3030
```

**As the desktop app** — needs the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
(Rust stable; on Windows: MSVC build tools + WebView2, on Linux: webkit2gtk):

```sh
cd examples/txodds-agent-desk
npm install                    # @tauri-apps/cli
npm run dev                    # tauri dev — compiles src-tauri, opens the window
npm run build                  # tauri build — a distributable bundle
```

> The first `npm run dev` compiles the Rust shell (a few minutes). The shell itself is ~10 lines
> (`src-tauri/src/main.rs`): no commands, no IPC, no fs/shell permissions — the CSP only allows
> `connect-src` to the three localhost services above. Inside the shell, Explorer links copy to the
> clipboard (new-window navigation stays blocked); in the browser they open normally.

## Why a desk at all

The web oracle is the seller's storefront; the marketplace visualizer is the market's spectator
stand. The desk is the **operator's** seat: one window that answers "what did my agent do for the
money, what did it pay upstream, and did reality agree" — and lets you poke the rails to find out.
