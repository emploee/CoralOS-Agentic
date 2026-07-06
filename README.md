# Solana CoralOS Agent Commerce

This repository implements a devnet reference system for paid agent services. Agents coordinate through CoralOS, exchange typed market messages, and settle orders through Solana payment rails. The default service uses TxODDS TxLINE football data, but the protocol, runtime packages, and examples are organized so other services can use the same payment and verification path.

The repository is not mainnet production software. The working value flows are devnet-only unless a separate launch review changes the policy and configuration.

## System Model

The core market lifecycle is:

```text
WANT -> BID -> AWARD -> ESCROW_REQUIRED -> DEPOSITED -> DELIVERED -> VERIFIED -> RELEASED
```

For rail-based procurement, the market protocol also supports:

```text
PAYMENT_REQUIRED -> PAYMENT_PROOF -> PAYMENT_CONFIRMED -> SETTLED
```

Responsibilities are separated by subsystem:

| Subsystem       | Responsibility                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| CoralOS         | Session orchestration, agent discovery, threads, mentions, and blocking coordination.                                |
| Agent runtime   | LLM provider calls, Coral MCP client, market parsers/formatters, run ledger, Solana helpers, and policy enforcement. |
| Harness runtime | Adapter boundary for seller execution through`node-llm`, `claude-code`, or an arbitrary CLI.                     |
| Payment runtime | Rail abstraction, rail routing, payment verification records, and rail-specific policy helpers.                      |
| TxODDS example  | Default paid service, proxy, browser UI, research watcher, escrow clients, and Anchor programs.                      |
| Coral agents    | Buyer, seller, verifier, broker, echo, and user-proxy agent processes launched per session.                          |

## Repository Layout

| Path                             | Purpose                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/agent-runtime/`      | Shared runtime: LLM shim, Coral MCP client, market protocol, Solana guard/helpers, ledger, and policy. |
| `packages/harness-runtime/`    | Seller execution adapter interface and adapter implementations.                                        |
| `packages/payment-runtime/`    | Payment rail interface, router, rail implementations/scaffolds, and proof receipts.                    |
| `packages/solana-agent-tools/` | Read-only Solana context tools and Solana Agent Kit-compatible plugin.                                 |
| `coral-agents/`                | Dockerized agents registered with CoralOS.                                                             |
| `examples/txodds/`             | Default TxODDS oracle, proxy, web UI, research watcher, and escrow programs.                           |
| `examples/marketplace/`        | Multi-seller market launchers, feed server, React visualizer, and run ledger persistence.              |
| `examples/agent-economy/`      | Autonomous agent purchase, human checkout bridge, bare HTTP 402 quickstart, and dashboard.             |
| `examples/txodds-agent-desk/`  | Browser/Tauri operator UI over proxy, ledger, receipts, settlement, reputation, and watcher data.      |
| `scripts/`                     | Setup, example launcher, wallet provisioning, and readiness gate scripts.                              |

## Requirements

| Requirement                     | Used by                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| Node.js 20+                     | Runtime packages, scripts, TxODDS, marketplace, agent economy, desk browser mode.     |
| Docker                          | CoralOS sessions, marketplace, verifier/buyer/seller/broker/user-proxy agents.        |
| Devnet SOL                      | Buyer, broker, and wallet checkout flows.                                             |
| LLM provider key                | Optional for live model output; deterministic fallbacks are present in several paths. |
| Rust, Solana CLI, Anchor 0.32.x | Only needed to rebuild or redeploy`examples/txodds/escrow`.                         |
| Node.js 22+                     | Only needed for the optional Solana Agent Kit example.                                |

Secrets and generated wallets belong in the repo-root `.env`, which is gitignored.

## Initial Setup

```sh
npm install --prefix scripts
node scripts/setup.js
```

The setup script writes devnet wallet variables to `.env` and records public addresses in `WALLETS.txt`. Fund the buyer address with devnet SOL before running settlement flows.

LLM configuration is optional for many demos but required for live model reasoning:

```ini
LLM_PROVIDER=venice
VENICE_API_KEY=...
# or:
# LLM_PROVIDER=openai
# OPENAI_API_KEY=...
# or:
# LLM_PROVIDER=anthropic
# ANTHROPIC_API_KEY=...
```

See [LLM.md](LLM.md) for provider selection, model override behavior, and fallback behavior.

## Common Commands

Run commands from the repo root unless noted.

| Command                                    | Description                                                        | Requirements                                              |
| ------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------- |
| `npm run setup`                          | Install script dependencies and generate`.env` wallets.          | Node 20+.                                                 |
| `npm run dev`                            | Start the TxODDS proxy on`:8801` and static web UI on `:3020`. | Funded buyer wallet for settlement.                       |
| `npm run readiness:e2e`                  | Deterministic readiness gate using recorded data.                  | No Docker, devnet, wallet, or LLM key required.           |
| `npm run demo:coral`                     | Launch the TxODDS CoralOS round.                                   | Docker, built agent images, TxLINE token, funded wallets. |
| `npm run marketplace`                    | Launch the classic multi-seller market.                            | Docker and built agent images.                            |
| `npm run freelancer`                     | Launch verifier-gated harness-seller market.                       | Docker and verifier/seller images.                        |
| `npm run research`                       | Launch event-driven research market.                               | Docker plus TxODDS proxy and watcher.                     |
| `npm run research:watch`                 | Start the TxODDS odds-move watcher.                                | TxODDS proxy.                                             |
| `npm run marketplace:web`                | Start the React market visualizer.                                 | Feed server or dashboard start endpoint.                  |
| `npm run agent-economy`                  | Start autonomous agent-to-agent purchase example.                  | Docker and built agent images.                            |
| `npm run agent-economy:bridge`           | Start human checkout bridge.                                       | Docker, CoralOS, wallet setup.                            |
| `npm run agent-economy:quickstart`       | Start bare HTTP 402 seller.                                        | Node and wallet env.                                      |
| `npm run agent-economy:quickstart:buyer` | Start bare HTTP 402 buyer.                                         | Quickstart server running.                                |
| `npm run agent-economy:web`              | Start the agent-economy dashboard.                                 | Bridge backend.                                           |
| `npm run desk`                           | Start the TxODDS Agent Desk in browser mode.                       | TxODDS proxy recommended.                                 |
| `npm run desk:app`                       | Start the Tauri desktop shell.                                     | Rust/Tauri prerequisites.                                 |

## TxODDS Single-Agent Flow

`npm run dev` starts:

| Process                             | Port     | Responsibility                                                                                        |
| ----------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `examples/txodds/server/proxy.ts` | `8801` | TxLINE subscription, board data, edge analysis, settlement, Solana Pay verification, run persistence. |
| `examples/txodds/web/`            | `3020` | Static React UI for fixtures, analysis, settlement links, runs, proof receipts, and grading.          |

The proxy keeps TxLINE credentials and keypairs server-side. Browser calls use local proxy endpoints such as `/api/board`, `/api/edge`, `/api/settle`, `/api/pay-intent`, `/api/pay-verify`, `/api/runs`, and `/api/grade-runs`.

The default paid service is implemented around `examples/txodds/agent/service.ts` and `examples/txodds/agent/edge.ts`.

## Multi-Agent Market Flow

Multi-agent examples use CoralOS through `docker-compose.yml`:

```sh
docker compose up -d coral
bash build-agents.sh
npm run marketplace
```

The buyer opens a market thread, posts `WANT`, collects `BID` messages, awards a seller, deposits to escrow, waits for delivery, optionally requests verifier approval, and releases through policy.

The marketplace feed server converts Coral extended session state into typed rounds and ledger records:

```sh
cd examples/marketplace/feed
SESSION=<session-id> npm start
```

The visualizer reads the feed API:

```sh
npm run marketplace:web
```

## Payment Rails

`packages/payment-runtime` exposes one `PaymentRail` interface:

```ts
interface PaymentRail {
  kind: PaymentRailKind
  quote(input: PaymentQuoteInput): Promise<PaymentQuote>
  requestPayment(order: MarketOrder): Promise<PaymentRequest>
  verifyPayment(request: PaymentRequest): Promise<PaymentVerification>
  release?(order: MarketOrder): Promise<SettlementResult>
  refund?(order: MarketOrder): Promise<SettlementResult>
}
```

Rail status:

| Rail            | Status                                                       |
| --------------- | ------------------------------------------------------------ |
| Solana Pay      | Working devnet demo rail with reference-bound verification.  |
| Escrow          | Working devnet rail through deployed escrow/arbiter clients. |
| Pay.sh          | Simulated/proof-adapter rail with caller-supplied receipts.  |
| x402            | HTTP 402 challenge/proof scaffold.                           |
| SPL USDC        | Metadata/token-escrow scaffold; no SPL transfer is sent.     |
| Allowance       | Policy wrapper around an inner rail.                         |
| Embedded wallet | Provider wrapper scaffold.                                   |
| Payout          | Seller-side payout proof scaffold.                           |

Proofs can be normalized into `ProofReceipt` records and written to the run ledger.

## Escrow Programs

The Anchor workspace in `examples/txodds/escrow` contains two deployed devnet programs:

| Program | Devnet id                                        | Role                                                               |
| ------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| Escrow  | `R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet`  | Per-order SOL PDA with`initialize`, `release`, and `refund`. |
| Arbiter | `FJtuVXsyXuRKqgJBEPAXmktkd13CqStapgevzGwYktXd` | Vault-as-buyer wrapper with neutral release/refund authority.      |

The base escrow PDA is seeded by `(buyer, reference)`. The arbiter wrapper funds a vault PDA that becomes the escrow buyer, so the payer cannot unilaterally release or refund after delivery.

Use devnet by default. The runtime guard rejects mainnet RPC URLs unless `ALLOW_MAINNET=1` is set.

## Run Ledger

The run ledger records paid rounds as directories containing JSON artifacts:

```text
runs/<session>/round-<n>/
  run.json
  want.json
  bids.json
  award.json
  escrow.json
  delivery.json
  verification.json
  proof_receipts.json
  transcript.jsonl
  txs.json
```

The ledger is used by the marketplace feed, visualizer, reputation calculation, TxODDS proxy, and Agent Desk. Finished sessions can be replayed from ledger files when CoralOS is unavailable.

## Policy Boundaries

Policy checks live in `packages/agent-runtime/src/policy`.

Enforced checks include:

- per-round and per-session spend caps;
- service allowlist;
- payout wallet binding;
- award-price binding;
- minimum interval/rate limiting;
- verifier gate for release;
- devnet guard through Solana connection helpers.

Harness processes do not hold signing keys. Agents keep wallet authority and call policy before deposits and releases.

## Development Checks

Build/test the shared packages before working on dependents:

```sh
cd packages/agent-runtime && npm install && npm run typecheck && npm test && npm run build
cd packages/harness-runtime && npm install && npm run typecheck && npm test && npm run build
cd packages/payment-runtime && npm install && npm run typecheck && npm test && npm run build
```

Run the deterministic readiness gate from the repo root:

```sh
npm run readiness:e2e
```

Package and example READMEs contain narrower test commands.

## Security Notes

- Do not commit `.env`, private keys, API keys, seed phrases, or generated wallet secrets.
- Treat RPC responses, receipts, LLM output, verifier payloads, and Coral messages as untrusted input.
- Keep mainnet disabled unless a separate review defines custody, policy, monitoring, and rollback controls.
- The Agent Desk is a local operator UI, not an authenticated hosted admin system.

## License

MIT
