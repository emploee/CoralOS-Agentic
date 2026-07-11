# Coral Agents

This directory contains the Dockerized agents launched by CoralOS sessions.

Each agent has a `coral-agent.toml` manifest and an implementation in its folder. CoralOS injects `CORAL_CONNECTION_URL` at launch. Agents connect through `@pay/agent-runtime` or the MCP client directly.

## Agents

| Agent | Role |
|---|---|
| `buyer-agent` | Posts `WANT`, collects bids, awards, deposits through policy, optionally verifies delivery, and releases/refunds. |
| `seller-agent` | Bids on supported services, verifies funded escrow, runs a harness adapter, and delivers hash-bound payloads. |
| `verifier-agent` | Checks delivery hash/structure and replies `VERIFIED pass|fail`. No wallet authority. |
| `echo-agent` | Minimal MCP connectivity check. |
| `user_proxy` | Idle Python participant driven by the puppet API. No example in this repo currently launches it. |

Seller personas reuse the seller image with different manifest defaults such as `AGENT_NAME`, `PERSONA`, `FLOOR_SOL`, `SERVICES`, and `HARNESS`.

## Build

```sh
bash build-agents.sh
bash build-agents.sh claude
```

The `claude` build creates `seller-agent-claude:0.1.0` with the Claude Code CLI available for the harness adapter.

## Settlement Boundary

Agents hold signing authority and run policy checks. Harness processes only produce quotes, events, and delivery artifacts. CoralOS coordinates messages but does not hold wallets.

## Launch References

| Launcher | Description |
|---|---|
| `examples/txodds/coral/round.ts` | TxODDS buyer and seller personas. |
