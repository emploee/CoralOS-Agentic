# Solana CoralOS Agent Commerce

Devnet reference system for paid agent services. Agents coordinate through CoralOS, exchange typed market messages, and settle orders through Solana payment rails. The default service uses TxODDS TxLINE football data; the protocol, runtime packages, and examples support any service.

Not mainnet production software. All value flows are devnet-only unless a separate launch review changes the policy.

## System Model

```text
WANT -> BID -> AWARD -> ESCROW_REQUIRED -> DEPOSITED -> DELIVERED -> VERIFIED -> RELEASED | ARBITER_RELEASED
```

Rail-based procurement:

```text
PAYMENT_REQUIRED -> PAYMENT_PROOF -> PAYMENT_CONFIRMED -> SETTLED
```

| Subsystem | Responsibility |
|---|---|
| CoralOS | Session orchestration, agent discovery, threads, mentions, blocking coordination. |
| Agent runtime | LLM calls, Coral MCP client, market parsers, run ledger, Solana helpers, policy, bounded tool-calling loop. |
| Harness runtime | Seller execution adapter (`node-llm`, `claude-code`, or arbitrary CLI). |
| Payment runtime | Rail abstraction, routing, verification records, rail-specific policy. |
| TxODDS example | Default paid service, proxy, browser UI, live agent feed, research watcher, escrow clients, Anchor programs. |
| Coral agents | Buyer, seller, and verifier agent processes. |

## Coral Agents

| Agent | Role | Launched as |
|---|---|---|
| `buyer-agent` | Posts `WANT`, collects bids, awards, deposits to escrow, verifies delivery, releases/refunds. | CoralOS container. |
| `seller-agent` | Bids, verifies funded escrow, runs harness adapter, delivers. | CoralOS container. |
| `verifier-agent` | Checks delivery hash/structure, replies `VERIFIED pass\|fail`. Holds no wallet. | CoralOS container. |

The TxODDS round (`examples/txodds/coral/round.ts`) runs one buyer, one seller, and the verifier — no persona roster to configure. To add a competing seller, copy `coral-agents/seller-agent/coral-agent.toml` into a new `coral-agents/` directory with its own `AGENT_NAME`/`PERSONA`/`FLOOR_SOL`/`SERVICES`, and add it to the round's agent list.

**Agent discovery:** `examples/txodds/coral/coral.toml` uses `[registry] localAgents = ["/agents/*"]` to wildcard-scan `coral-agents/` for any `coral-agent.toml`. No manual registration needed.

## Forking This Kit

1. **Replace the service.** `examples/txodds/agent/service.ts` → `deliverService()` is marked "THE fork point."
2. **Point sellers at it.** Set `SERVICES` in a persona manifest or env var.
3. **Choose your rails.** Solana Pay works with no setup. Escrow needs deployed programs (see below). x402 needs `PROCURE_RAIL=x402` (see below).
4. **Devnet-only by default.** `ALLOW_MAINNET=1` must be explicitly set to use mainnet.
5. **Three payment rails ship.** Solana Pay, escrow, x402 — see [PAY.md](PAY.md) for how each is used.

## Repository Layout

| Path | Purpose |
|---|---|
| `packages/agent-runtime/` | Shared runtime: LLM shim, Coral MCP client, market protocol, Solana guard/helpers, ledger, policy. |
| `packages/harness-runtime/` | Seller execution adapter interface and implementations. |
| `packages/payment-runtime/` | Payment rail interface, router, implementations, proof receipts. |
| `packages/solana-agent-tools/` | Read-only Solana context tools and Solana Agent Kit plugin. |
| `coral-agents/` | Dockerized agents registered with CoralOS. |
| `examples/txodds/` | TxODDS oracle, proxy, web UI, feed, research watcher, escrow programs. |
| `scripts/` | Setup, example launcher, wallet provisioning. |

## Requirements

| Requirement | Used by |
|---|---|
| Node.js 20+ | Runtime packages, scripts, TxODDS. |
| Docker | CoralOS sessions and agent containers. |
| Devnet SOL | Buyer and wallet checkout flows. |
| LLM provider key | Optional; deterministic fallbacks exist. |
| Rust, Solana CLI, Anchor 0.32.x | Only for rebuilding `examples/txodds/escrow`. |

Secrets and generated wallets go in `.env` (gitignored).

## Setup

```sh
npm run setup
```

Installs the workspace, writes devnet wallet variables to `.env`, records public addresses in `WALLETS.txt`. Fund the buyer address with devnet SOL before running settlement flows.

Optional LLM configuration — Groq recommended (free, renewing rate limit, no expiring credits):

```ini
LLM_PROVIDER=groq
GROQ_API_KEY=...
```

See [LLM.md](LLM.md) for provider selection and fallback behavior.

## Verify

```sh
npm run build
npm run typecheck
npm test
```

No Docker, devnet, wallets, or LLM keys required.

## Live Devnet E2E

```sh
npm run e2e:devnet
```

Requires Docker/CoralOS, funded devnet wallets, `ARBITER_KEYPAIR_B58`, and TxLINE access.

### Prerequisites

- **Docker running.** Checked with `docker info`.
- **`.env` has `WALLET`, `BUYER_KEYPAIR_B58`, `ARBITER_KEYPAIR_B58`, `TXLINE_API_KEY`.** `npm run setup` generates the first three; `TXLINE_API_KEY` needs `npm run mint`.
- **Buyer wallet funded.** Devnet SOL from the web faucet (CLI/RPC airdrops are gated).
- **Arbiter wallet funded** for multi-agent flow. The single-agent path (`npm run dev`) auto-tops it up; `demo:coral` does not.
- **`TXLINE_API_KEY` fresh.** Short-lived; re-run `cd examples/txodds && npm run mint` before each session.
- **First run builds Docker images** (`build-agents.sh`). Set `BUILD_AGENT_IMAGES=0` to skip rebuilds.

## Commands

| Command | Description | Requirements |
|---|---|---|
| `npm run setup` | Install workspace, generate `.env` wallets. | Node 20+. |
| `npm run build` | Build workspace packages and agents. | Workspace installed. |
| `npm run typecheck` | Typecheck everything. | Workspace installed. |
| `npm test` | Run all unit tests. | Workspace installed. |
| `npm run dev` | Start TxODDS proxy, feed, UI, Coral Console probe. | Funded buyer wallet; Docker optional for console. |
| `npm run e2e:devnet` | Live devnet CoralOS/escrow smoke. | Docker, CoralOS, TxLINE, funded wallets. |
| `npm run demo:coral` | Launch TxODDS CoralOS round. | Docker, built images, TxLINE, funded wallets. |

## Single-Agent Flow

`npm run dev` starts:

| Process | Port | Responsibility |
|---|---|---|
| `examples/txodds/server/proxy.ts` | `8801` | TxLINE subscription, board data, edge analysis, settlement, Solana Pay verification, run persistence. |
| Coral Server / Console | `5555` | CoralOS coordinator and visual console at `/ui/console` (when Docker available). |
| `examples/txodds/feed` | `4000` | Coral session reader, thread API, run ledger replay, feed endpoints. |
| `examples/txodds/web/` | `3020` | Static React UI for fixtures, analysis, settlement, runs, proof receipts, grading. |

## Multi-Agent Flow

```sh
docker compose up -d coral
bash build-agents.sh
npm run demo:coral
```

Buyer opens a market thread, posts `WANT`, collects `BID`, awards a seller, deposits to escrow, waits for delivery, requests verification, releases through policy.

## Payment Rails

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

| Rail | Status |
|---|---|
| Solana Pay | Working devnet demo with reference-bound verification. |
| Escrow | Working devnet rail — SOL and SPL flows deployed and tested. |
| x402 | Working: challenge/settle flow. Consumer: `coral-agents/seller-agent` with `PROCURE_RAIL=x402`. |

### x402 Upstream Procurement

| Variable | Purpose |
|---|---|
| `PROCURE_RAIL=x402` | Enables the x402 procurement leg. Off by default. |
| `SELLER_KEYPAIR_B58` | Seller's spend key for this leg (distinct from `SELLER_WALLET`). Needs devnet SOL. |
| `PROCURE_X402_URL` | x402-protected resource URL. Defaults to `http://host.docker.internal:8801/api/edge-x402`. |

```sh
PROCURE_RAIL=x402 SELLER_KEYPAIR_B58=<base58> npm run demo:coral
```

## Escrow Programs

| Program | Devnet ID | Role |
|---|---|---|
| Escrow | `R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet` | Per-order SOL PDA with `initialize`, `release`, `refund`. |
| Arbiter | `FJtuVXsyXuRKqgJBEPAXmktkd13CqStapgevzGwYktXd` | Vault-as-buyer wrapper with neutral release/refund authority. |

### Deploying Your Own

```sh
cd examples/txodds/escrow
anchor keys sync   # for a genuinely new deploy
anchor build
anchor deploy --provider.cluster devnet
```

For upgrades to already-deployed programs, see `examples/txodds/escrow/README.md`.

## Run Ledger

```text
runs/<session>/round-<n>/
  run.json, want.json, bids.json, award.json, escrow.json,
  delivery.json, verification.json, proof_receipts.json,
  proof.json, llm.json, transcript.jsonl, txs.json
```

`proof.json` is the compact E2E success artifact. Used by `examples/txodds/feed`, reputation, and the proxy.

## Policy

Policy checks in `packages/agent-runtime/src/policy`:

- Per-round and per-session spend caps
- Service allowlist
- Payout wallet binding
- Award-price binding
- Rate limiting
- Verifier gate for release
- Devnet guard

Harness processes hold no signing keys. Agents call policy before deposits and releases.

## Further Reading

| Doc | Covers |
|---|---|
| [PAY.md](PAY.md) | Payment rails usage, policy enforcement, code examples. |
| [CORAL.md](CORAL.md) | CoralOS session/agent mechanics. |
| [LLM.md](LLM.md) | Provider selection, model override, fallback behavior. |
| [API.md](API.md) | Service-agnostic API usage guide for any integration, including bounded tool-calling loops, adversarial review, and payment rail wiring. |
| [TXODDS.md](TXODDS.md) | TxODDS TxLINE integration details. |

## Security

- Do not commit `.env`, private keys, API keys, or seed phrases.
- Treat RPC responses, receipts, LLM output, and Coral messages as untrusted input.
- Keep mainnet disabled unless a separate review approves.

## License

MIT
