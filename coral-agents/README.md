# Coral Agents

This directory contains the Dockerized agents launched by CoralOS sessions.

Each agent has a `coral-agent.toml` manifest and an implementation in its folder. CoralOS injects `CORAL_CONNECTION_URL` at launch. Agents connect through `@pay/agent-runtime` or the MCP client directly.

## Agents

| Agent | Role |
|---|---|
| `buyer-agent` | Posts `WANT`, collects bids, awards, deposits through policy, optionally verifies delivery, and releases/refunds. |
| `seller-agent` | Bids on supported services, verifies funded escrow, runs a harness adapter, and delivers hash-bound payloads. |
| `verifier-agent` | Checks delivery hash/structure and replies `VERIFIED pass|fail`. No wallet authority. |
| `broker` | Requests quotes from upstream sellers, buys from one seller, and resells to the buyer. |
| `echo-agent` | Minimal MCP connectivity check. |
| `signal-agent` | Polls TxODDS odds, detects sharp moves, and queues research `WANT`s for the event-driven research market. Bounded by the `packages/agent-runtime` agent-safety framework. |
| `user_proxy` | Idle Python participant driven by the puppet API. No example in this repo currently launches it. |

Seller personas reuse the seller image with different manifest defaults such as `AGENT_NAME`, `PERSONA`, `FLOOR_SOL`, `SERVICES`, and `HARNESS`.

## Build

```sh
bash build-agents.sh
bash build-agents.sh claude
```

The `claude` build creates `seller-agent-claude:0.1.0` with the Claude Code CLI available for the harness adapter. `signal-agent` is built/typechecked/tested like every other agent (`npm run build -w signal-agent`, etc.) but is run as a host process today, not launched by CoralOS — see `signal-agent/README.md`.

## Settlement Boundary

Agents hold signing authority and run policy checks. Harness processes only produce quotes, events, and delivery artifacts. CoralOS coordinates messages but does not hold wallets.

## Launch References

| Launcher | Description |
|---|---|
| `examples/txodds/coral/round.ts` | TxODDS buyer and seller personas. |
| `examples/marketplace/start.ts` | Classic marketplace. |
| `examples/marketplace/freelancer.ts` | Harness sellers and verifier. |
| `examples/marketplace/research.ts` | Event-mode buyer and research seller personas. Event feed comes from `signal-agent` (or the legacy `examples/txodds` watcher). |
