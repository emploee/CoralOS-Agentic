# verifier-agent

The verifier agent checks delivered payloads before buyer release. It receives `VERIFY` messages and replies with `VERIFIED pass|fail`.

## Messages

```text
VERIFY round=<n> sha=<hash> service=<service> arg=<arg> payload=<raw>
VERIFIED round=<n> verdict=pass|fail by=<verifier> reason=<text>
```

Buyer agents can require `VERIFIED pass` before release by setting `VERIFIER_AGENT`.

## Checks

Deterministic checks run first, in order, and any one of them decides the verdict without
consulting the model:

1. The delivered payload must hash to the supplied SHA-256 value.
2. The payload must be parseable JSON when JSON is expected.
3. The payload must not be a top-level error report.
4. Known service shapes (e.g. a `txline` fixture matching the requested arg) pass deterministically.

Only if none of those decide does an LLM acceptance loop run: the model calls
`inspect_payload_structure` (auditable confirmation of its own read) before it must call
`submit_verdict` to terminate. If the loop errors or exhausts its rounds without deciding,
deterministic checks having already passed means the fallback verdict is `pass` — an unavailable
verifier never blocks a structurally valid delivery.

The loop's budget scales with `assessScrutiny()` (`verify-tools.ts`): a payload matching a known,
well-formed delivery shape gets a tighter round budget; anything unrecognized gets the full budget
plus an extra prompt push toward inspecting structure first — a generalization of the old
txline-only fast path to every known service shape.

## Files

| File | Role |
|---|---|
| `src/index.ts` | Coral loop: `VERIFY` in, `VERIFIED` out. |
| `src/verify.ts` | `checkDelivery()` — deterministic checks, then the bounded LLM acceptance loop. |
| `src/verify-tools.ts` | Tools for the acceptance loop (`inspect_payload_structure`, `submit_verdict`) and `assessScrutiny()`. |
| `src/verify.test.ts` | Unit tests. |

## Environment

| Variable | Description |
|---|---|
| `AGENT_NAME` | Defaults to `verifier-agent`. |
| `LLM_PROVIDER` and provider key | Optional acceptance check. |

Buyer-side variables:

| Variable | Description |
|---|---|
| `VERIFIER_AGENT` | Agent name to mention for `VERIFY`. |
| `VERIFY_WINDOW_MS` | Wait time for verifier response. |

No wallet or signing key is required by the verifier.
