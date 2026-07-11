# CLAUDE.md

This file gives Claude Code repository context for local development.

## Repository Purpose

The repository implements a devnet agent-commerce reference system. Agents coordinate through CoralOS, exchange typed market messages, and settle through Solana payment rails. The default service reads TxODDS TxLINE football data, but the runtime and protocol are service-agnostic.

Primary lifecycle:

```text
WANT -> BID -> AWARD -> ESCROW_REQUIRED -> DEPOSITED -> DELIVERED -> VERIFIED -> RELEASED
```

The Rust surface is limited to `examples/txodds/escrow`, which contains the escrow and arbiter programs. Most repository code is TypeScript.

## Layout

| Path | Purpose |
|---|---|
| `packages/agent-runtime/` | LLM shim, Coral MCP client, Solana guard/helpers, market protocol, run ledger, reputation, and policy. |
| `packages/harness-runtime/` | Seller execution adapter SDK for `node-llm`, `claude-code`, and arbitrary CLI harnesses. |
| `packages/payment-runtime/` | Rail interface/router, working devnet Solana Pay and escrow rails, scaffold rails, and proof receipts. |
| `packages/solana-agent-tools/` | Read-only Solana context tools and optional Solana Agent Kit adapter. |
| `examples/txodds/` | TxODDS proxy, web UI, service implementation, feed server, research watcher, and escrow workspace. |
| `coral-agents/` | Buyer, seller, verifier, and echo agent containers. |
| `scripts/` | Setup, wallet provisioning, and example runner scripts. |

## Common Commands

```sh
npm run setup
npm run dev
```

Runtime package checks:

```sh
cd packages/agent-runtime && npm install && npm run typecheck && npm test && npm run build
cd packages/harness-runtime && npm install && npm run typecheck && npm test && npm run build
cd packages/payment-runtime && npm install && npm run typecheck && npm test && npm run build
```

TxODDS checks:

```sh
cd examples/txodds && npm install && npm run typecheck && npm test
cd examples/txodds/feed && npm install && npm run typecheck && npm test
```

## TxODDS Example

Key files:

| File | Role |
|---|---|
| `examples/txodds/agent/txline.ts` | TxLINE client. |
| `examples/txodds/agent/edge.ts` | Verified odds to fair-line analysis. |
| `examples/txodds/agent/service.ts` | `deliverService()` for paid delivery. |
| `examples/txodds/server/proxy.ts` | Proxy, settlement endpoints, run persistence, grading. |
| `examples/txodds/research/watcher.ts` | Odds-move event queue. |
| `examples/txodds/escrow/` | Escrow and arbiter Anchor programs. |

`npm run dev` starts the proxy on `:8801` and the static UI on `:3020`.

## CoralOS Usage

The single-agent TxODDS web flow does not require CoralOS. Multi-agent flows use `docker-compose.yml` to run a pinned `coral-server` container and launch agents from `coral-agents/`.

CoralOS provides:

- per-session agent launching;
- thread messages and mentions;
- blocking wait primitives;
- extended session state for feed/UI replay.

The market protocol is owned by `packages/agent-runtime/src/market/protocol.ts`; Coral transports opaque strings.

## Agent Orchestration Framework

`packages/agent-runtime/src/agent/` holds capability grants, process-level safety gates
(`BudgetGuard`/`StepCounter`), a `Tool` contract with an audit-log shape, an evaluation/ranking
helper, and a bounded provider-agnostic LLM tool-calling loop (`runToolLoop`), available for
building new Coral-native agents.

## Payment and Policy

Solana value movement is devnet by default. Runtime helpers reject mainnet RPC URLs unless `ALLOW_MAINNET=1` is set.

Policy checks are centralized in `packages/agent-runtime/src/policy` and cover spend caps, service allowlists, payout binding, award-price binding, rate limiting, and verifier gating.

Harness processes should not receive signing keys. Agent processes hold wallet authority and call policy before deposits/releases. See `PAY.md` for how the three payment rails (Solana Pay, escrow, x402) are actually used, `CORAL.md` for how the coordination layer works, and `LLM.md` for how LLM-backed decisions are proposed and enforced.

## Environment

Common variables:

| Variable | Purpose |
|---|---|
| `BUYER_KEYPAIR_B58` | Buyer funding keypair for devnet transactions. |
| `ARBITER_KEYPAIR_B58` | Arbiter release/refund keypair. |
| `WALLET` / `SELLER_WALLET` | Seller payout addresses. |
| `SOLANA_RPC_URL` | Defaults to devnet if unset. |
| `LLM_PROVIDER` | `venice`, `openai`, or `anthropic`. |
| `VENICE_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | Provider keys. |
| `TXLINE_API_KEY` | TxLINE token for TxODDS examples. |

Never commit `.env`, private keys, provider keys, seed phrases, or generated wallet secrets.
