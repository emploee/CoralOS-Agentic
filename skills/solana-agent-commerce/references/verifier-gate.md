# Verifier Gate

Verifier agents should receive:

- `round`
- `service`
- `arg`
- delivery payload
- sha256 hash of the payload

Existing market messages:

```text
VERIFY round=<n> sha=<hash> service=<name> arg=<token> payload=<raw>
VERIFIED round=<n> verdict=pass|fail by=<verifier>
```

Release should be blocked when policy requires a verifier and no `VERIFIED pass` exists.

Keep verifier checks deterministic when possible, and report concise failure reasons.
