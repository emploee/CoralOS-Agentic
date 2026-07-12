# Verifier Gate

The verifier (`coral-agents/verifier-agent`) is an independent third party in the settlement — it holds no keys and moves no funds. It surfaces the arbiter program's "neutral third signer" idea into the market conversation instead of on-chain.

## Wire messages

Both typed in `packages/agent-runtime/src/market/protocol.ts` (see `references/market-protocol.md`):

```text
VERIFY   round=<n> sha=<hash> service=<name> arg=<token> payload=<raw>          buyer -> verifier (mentioned, not broadcast)
VERIFIED round=<n> verdict=pass|fail by=<verifier> [sha=<hash>] [reason="..."]  verifier -> buyer
```

`sha` is `sha256Hex(deliveredPayload)`, computed by the buyer over the exact `DELIVERED` payload it received. That's what binds the verdict to *that specific artifact* — not "any delivery from this seller" — and it's the same content-hash convention the run ledger and the escrow `reference` use.

## How the verdict is produced (`coral-agents/verifier-agent/src/verify.ts`, `checkDelivery()`)

Deterministic checks run first and cannot be prompt-injected around — a malicious or malformed payload can't talk its way past step 1 or 2 by including persuasive text:

1. **Content hash** — recompute `sha256Hex(payload)`, compare to `req.sha`. Mismatch -> immediate `fail`, LLM never consulted.
2. **Structure** — payload must parse as JSON and must not carry a top-level `error` field. Either failure -> immediate `fail`, LLM never consulted.
3. **Known-shape fast path** — for `service=txline`, if the payload's `service`/`fixtureId` fields match the request, verdict is `pass` without ever calling the model.
4. **LLM acceptance judge** (only reached if 1–3 didn't already decide) — asks the model for `{"pass": boolean, "reason": string}` against the order and payload. If the call throws or the reply doesn't parse, the deterministic checks already passed, so the verdict falls back to `pass` — an unavailable LLM never blocks a structurally valid delivery, and it can never override a `fail` from steps 1–2 either.

Every verdict also emits an `LLM_USED` message (`status=used|fallback|skipped|error`) so the run ledger records whether the model was actually consulted for that round, and `affectedFunds=false` on the trace — the model proposes an opinion, `checkDelivery`'s deterministic gates and the policy layer below actually decide.

## Wiring the gate into release

Release goes through the same policy choke point as deposits (`packages/agent-runtime/src/policy/policy.ts`):

```ts
const releaseDecision = enforce({ kind: 'release', round, ...(verified ? { verified } : {}) }, policy)
if (!releaseDecision.ok) {
  // funds stay in escrow, refundable by the buyer after `deadline` — nothing is force-settled
}
```

`policy.requireVerifier` is set from `!!env.VERIFIER_AGENT` by `policyFromEnv()` — a deploy-time choice, not something one round can opt out of. When it's `true`, `enforce` denies release unless `verified === 'pass'`. When no verifier is configured, `requireVerifier` is `false` and release proceeds on delivery alone.

A denied release is not a failure state to route around — the escrow already carries a `deadline`, and a buyer-side refund after that deadline is the designed recovery path. Don't add a bypass for a stuck round; either extend the verifier's checks or fix why it's failing.

## Writing a new verifier check

- Put every deterministic check before any LLM call, and make each one short-circuit (skip, don't call, the model) on failure.
- Keep `reason` short — `verify.ts` truncates to well under 100 chars — it's surfaced on the thread and written into the ledger.
- On LLM error or an unparseable response, fail open only to whatever the deterministic checks already decided. Never let an LLM failure turn a deterministic `fail` into a `pass`.
- If you add a new fast-path shape (like the `txline` check in step 3), keep it deterministic and put it before the LLM judge, not after.
