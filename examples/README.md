# examples

Three examples, one set of rails — **WANT → BID → AWARD → DEPOSITED → DELIVERED → (VERIFIED) →
RELEASED** on Solana devnet. Fork the `deliverService()` in any of them to sell your own thing; the
World Cup service is only the default demo.

- **[txodds/](txodds/README.md)** — **the default demo (start here).** One agent sells a verified odds
  read and the escrow auto-settles on delivery. `npm run dev` (from the repo root) brings up the proxy +
  the React board — no Docker. Fastest way to see the rails; swap its `deliverService()`
  ([`agent/service.ts`](txodds/agent/service.ts)) and you're selling your own service. Also home to
  the **research watcher** ([`research/`](txodds/research/watcher.ts)) that diffs the live board and
  queues WANTs for the research round.

- **[marketplace/](marketplace/README.md)** — **the full market, three rounds.** LLM seller agents
  compete in a shared CoralOS thread; the buyer awards best value and settles via the escrow contract.
  `npm start` is the classic round; `npm run freelancer` pits heterogeneous harnesses (plain LLM vs
  headless **Claude Code**) against each other with an independent **verifier gating the release**
  (validated live on devnet — both the settle path and the refuse path); `npm run research` runs the
  **event-driven** round — a WANT only when a line actually moves, quiet board = no spend. Includes a
  React visualizer, and its `feed/` writes every round to the **run ledger** (`runs/` —
  `/api/runs` + `/api/reputation`, replayable with coral down). Needs Docker.

- **[agent-economy/](agent-economy/README.md)** — **three front doors** on CoralOS: autonomous
  (agent→agent), a human checkout (Phantom/Solflare wallet), and a bare 402 pay-per-call quickstart. All
  settle in devnet SOL. Also includes an optional Node 22 Solana Agent Kit read-only tools example
  (`solana-agent-kit/`) for wallet/token/price context without signing authority. Needs Docker for the
  CoralOS front doors.

- **[txodds-agent-desk/](txodds-agent-desk/README.md)** - the operator console: a Tauri v2 shell
  and no-build browser UI over the existing TxODDS proxy, run ledger, proof receipts, settlement
  endpoints, optional marketplace reputation, and watcher queue. Browser mode needs no Rust:
  `npm run desk` from the repo root.

Full pitch + quick start in the [root README](../README.md).
