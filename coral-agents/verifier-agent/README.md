# verifier-agent

The verifier agent checks delivered payloads. It receives `VERIFY` messages and replies with
`VERIFIED pass|fail`. Its verdict is informational — the buyer's x402 payment already settled before
delivery, so a fail verdict feeds reputation, it can no longer block or reclaim a payment.

## Messages

```text
VERIFY round=<n> sha=<hash> service=<service> arg=<arg> payload=<raw>
VERIFIED round=<n> verdict=pass|fail by=<verifier> reason=<text>
```

Buyer agents send `VERIFY` when `VERIFIER_AGENT` is set (optionally gated per round by
`VERIFY_GATE_ENABLED` — see `coral-agents/buyer-agent/README.md`).

## Checks

Fully deterministic — `checkDelivery()` runs these, in order, and the first one that decides wins:

1. The delivered payload must hash to the supplied SHA-256 value.
2. The payload must be parseable JSON.
3. The payload must not be a top-level error report.
4. Otherwise: pass — the verifier can only check what it actually received, not judge intent.

## Files

| File | Role |
|---|---|
| `src/index.ts` | Coral loop: `VERIFY` in, `VERIFIED` out. |
| `src/verify.ts` | `checkDelivery()` — the deterministic checks above. |
| `src/verify.test.ts` | Unit tests. |

## Environment

| Variable | Description |
|---|---|
| `AGENT_NAME` | Defaults to `verifier-agent`. |

Buyer-side variables:

| Variable | Description |
|---|---|
| `VERIFIER_AGENT` | Agent name to mention for `VERIFY`. |
| `VERIFY_WINDOW_MS` | Wait time for verifier response. |

No wallet or signing key is required by the verifier.

## Runtime

`coral-agent.toml` declares both `[runtimes.docker]` and `[runtimes.executable]`. The TxODDS round
(`examples/txodds/coral/round.ts`) requests `runtime: 'executable'` for this agent specifically —
coral-server execs `node dist/index.js` directly as its own child process, no container. That's safe
here because the verifier holds no signing key, unlike buyer/seller (real devnet wallets), which stay
on `runtime: 'docker'` for the process isolation that's actually worth having when a key is involved.
Requires `docker/coral-server.Dockerfile`'s Node.js layer (the stock coral-server image has none) and
`dist/index.js` to exist on the host before a round starts — `round.ts`'s `ensureVerifierBuilt()`
builds it automatically if missing.
