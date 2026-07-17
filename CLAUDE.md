# CLAUDE.md

This file gives Claude Code repository context for local development.

## Repository Purpose

The repository implements a devnet agent-commerce reference system. Agents coordinate through CoralOS, exchange typed market messages, and settle through Solana payment rails. The default service reads TxODDS TxLINE football data, but the runtime and protocol are service-agnostic.

Primary lifecycle:

```text
WANT -> BID -> AWARD -> PAYMENT_REQUIRED -> PAYMENT_PROOF -> PAYMENT_CONFIRMED -> DELIVERED -> VERIFIED -> SETTLED
```

Settlement is x402: the buyer pays the seller directly and finally, before delivery. There is no
escrow in the default flow — the escrow/arbiter Anchor programs still exist and are deployed
(`examples/txodds/escrow`), available as an alternative building block, but unused by
`coral-agents/buyer-agent`/`seller-agent`. The Rust surface is limited to that directory; most
repository code is TypeScript.

## Layout

| Path | Purpose |
|---|---|
| `packages/agent-runtime/` | Coral MCP client, Solana guard/helpers, market protocol, run ledger, reputation, and policy. |
| `packages/harness-runtime/` | Seller execution adapter SDK for `in-process`, `claude-code`, and arbitrary CLI harnesses. |
| `packages/payment-runtime/` | Rail interface/router, working devnet Solana Pay and escrow rails, scaffold rails, and proof receipts. |
| `packages/solana-agent-tools/` | Read-only Solana context tools and optional Solana Agent Kit adapter. |
| `examples/txodds/` | TxODDS proxy, web UI, service implementation, feed server, and escrow workspace. |
| `coral-agents/` | Buyer, seller, and verifier agent containers. |
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
| `examples/txodds/server/proxy.ts` | Proxy, settlement endpoints, run persistence. |
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

`packages/agent-runtime/src/agent/` holds small scoring/ranking helpers (`rank`/`best`/
`evaluateDirectionalCall`) for picking the best of several options and grading past calls,
available for building new Coral-native agents.

## Payment and Policy

Solana value movement is devnet by default. Runtime helpers reject mainnet RPC URLs unless `ALLOW_MAINNET=1` is set.

Policy checks are centralized in `packages/agent-runtime/src/policy` and cover spend caps, service allowlists, payout binding, award-price binding, and rate limiting — all checked before the buyer signs a payment, since x402 settlement is direct and final and there is no later release step to gate.

Harness processes should not receive signing keys. Agent processes hold wallet authority and call policy before every payment. See `PAY.md` for how the three payment rails (x402, Solana Pay, escrow) are actually used and `CORAL.md` for how the coordination layer works.

## Environment

Common variables:

| Variable | Purpose |
|---|---|
| `BUYER_KEYPAIR_B58` | Buyer funding keypair for devnet transactions. |
| `WALLET` / `SELLER_WALLET` | Seller payout addresses. |
| `SOLANA_RPC_URL` | Defaults to devnet if unset. |
| `TXLINE_API_KEY` | TxLINE token for TxODDS examples. |

Never commit `.env`, private keys, provider keys, seed phrases, or generated wallet secrets.
