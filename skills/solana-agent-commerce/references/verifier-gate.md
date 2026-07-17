# Verifier Gate

The verifier (`coral-agents/verifier-agent`) is an independent third party in the market — it holds
no keys and moves no funds. Its verdict is **informational**: settlement is x402 (direct and final,
before delivery), so by the time `VERIFY` fires the payment has already landed. A `fail` verdict
feeds reputation; it cannot block or reclaim a payment.

## Wire messages

Both typed in `packages/agent-runtime/src/market/protocol.ts` (see `references/market-protocol.md`):

```text
VERIFY   round=<n> sha=<hash> service=<name> arg=<token> payload=<raw>          buyer -> verifier (mentioned, not broadcast)
VERIFIED round=<n> verdict=pass|fail by=<verifier> [sha=<hash>] [reason="..."]  verifier -> buyer
```

`sha` is `sha256Hex(deliveredPayload)`, computed by the buyer over the exact `DELIVERED` payload it received. That's what binds the verdict to *that specific artifact* — not "any delivery from this seller."

## How the verdict is produced (`coral-agents/verifier-agent/src/verify.ts`, `checkDelivery()`)

Fully deterministic — no model, no judgment call:

1. **Content hash** — recompute `sha256Hex(payload)`, compare to `req.sha`. Mismatch -> `fail`.
2. **Structure** — payload must parse as JSON and must not carry a top-level `error` field. Either failure -> `fail`.
3. **Otherwise** -> `pass`. The verifier can only check what it actually received, not judge intent behind it.

## Why VERIFY exists without a release to gate

`decideVerifyEscalation()` (`coral-agents/buyer-agent/src/verify/verify-gate.ts`) decides per round
whether to actually send `VERIFY` at all, gated by `VERIFY_GATE_ENABLED` (default off — verify every
delivery). It only skips escalation for a seller with an established (3+ delivery), clean
(`verifiedFail === 0`) record. Since there's no fund-safety consequence to skipping now (the payment
already settled either way), this is purely a reputation-tracking trade-off, not the fund-risk
trade-off it used to be under escrow.

`policy.ts` has no `verifier-gate` rule and no `release` action anymore — the only policy check left
is `enforce({kind:'payment', ...}, policy)`, and it runs **before** the buyer signs, not after
delivery. See `references/market-protocol.md` and the root `PAY.md` for the full payment flow.

## Writing a new verifier check

- Keep every check deterministic and short-circuit on failure.
- Keep `reason` short — `verify.ts` truncates to well under 100 chars — it's surfaced on the thread and written into the ledger.
- If you add a new fast-path shape, keep it deterministic like the existing checks — there's no LLM judge left to fall back to, so a check here is the only chance to catch something.
