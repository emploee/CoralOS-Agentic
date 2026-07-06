# verifier-agent

The verifier agent checks delivered payloads before buyer release. It receives `VERIFY` messages and replies with `VERIFIED pass|fail`.

## Messages

```text
VERIFY round=<n> sha=<hash> service=<service> arg=<arg> payload=<raw>
VERIFIED round=<n> verdict=pass|fail by=<verifier> reason=<text>
```

Buyer agents can require `VERIFIED pass` before release by setting `VERIFIER_AGENT`.

## Checks

Deterministic checks run first:

1. The delivered payload must hash to the supplied SHA-256 value.
2. The payload must be parseable JSON when JSON is expected.
3. The payload must not be a top-level error report.

An optional LLM acceptance check can run after deterministic checks. If the provider is unavailable, deterministic checks still define the result.

## Files

| File | Role |
|---|---|
| `src/index.ts` | Coral loop: `VERIFY` in, `VERIFIED` out. |
| `src/verify.ts` | `checkDelivery()` pure verifier logic and optional LLM call. |
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
