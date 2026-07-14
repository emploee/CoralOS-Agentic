# Market Protocol

Market messages live in `packages/agent-runtime/src/market/protocol.ts`. Every message carries a `round=<n>` tag — Coral moves opaque strings, so `round` (not Coral) is what correlates a reply to its request.

## 1. Core round messages — the actual settlement path

Typed, each with a `format*`/`parse*` pair:

```text
WANT             round=<n> service=<name> arg=<token> budget=<sol>
BID              round=<n> price=<sol> by=<seller> [note=<text>]
AWARD            round=<n> to=<seller> [reason="..."]
ESCROW_REQUIRED  round=<n> reference=<R> seller=<addr> amount=<sol> deadline=<secs> [settlement=direct|arbiter]
DEPOSITED        round=<n> reference=<R> buyer=<addr> sig=<sig> [settlement=...] [vault=<pda>] [arbiter=<addr>]
VERIFY           round=<n> sha=<hash> service=<name> arg=<token> payload=<raw>
VERIFIED         round=<n> verdict=pass|fail by=<verifier> [sha=<hash>] [reason="..."]
LLM_USED         round=<n> agent=<name> purpose=<name> status=used|fallback|skipped|error [provider=] [model=] [usedFor=] [inputHash=] [outputHash=] affectedFunds=false [reason="..."] [guardrail="..."]
```

`ESCROW_REQUIRED`/`DEPOSITED` are not a legacy path kept for backward compatibility — they are the primary settlement primitive every CoralOS round uses. Treat them as load-bearing.

## 2. Generic payment messages — for rails outside the escrow round

Also typed, same file:

```text
PAYMENT_REQUIRED  round=<n> rail=<rail> amount=<amount> currency=<asset> reference=<id> [seller=] [url=] [deadline=]
PAYMENT_PROOF     round=<n> rail=<rail> reference=<id> proof=<receipt> [buyer=] [sig=]
PAYMENT_CONFIRMED round=<n> rail=<rail> reference=<id> paid=true|false [amount=] [currency=] [sig=]
SETTLED           round=<n> rail=<rail> reference=<id> [amount=] [currency=] [sig=] [reason="..."]
REFUNDED          round=<n> rail=<rail> reference=<id> [amount=] [currency=] [sig=] [reason="..."]
```

These aren't hypothetical — the real consumer is `packages/payment-runtime/src/procure.ts`'s `procureUpstream()`, used by `coral-agents/seller-agent` (`PROCURE_RAIL=x402`) to post its own upstream purchase onto the market thread (unmentioned — bus-visible, buyer-loop-invisible) so `examples/txodds/feed` can fold it into the round's proof receipts. That's a side leg (the seller buying something it needs), not the buyer-seller settlement itself.

`rail` is typed as `PaymentRailKind` in this file, which still lists retired kinds — `pay-sh`, `spl-usdc`, `allowance`, `embedded-wallet`, `payout` — that `packages/payment-runtime` no longer implements. Only `solana-pay` | `escrow` | `x402` have a working rail behind them; don't format a message with one of the retired kinds expecting a rail to exist for it.

## 3. Untyped verbs

`DELIVERED` and `RELEASED`/`ARBITER_RELEASED` have **no** formatter/parser in `protocol.ts`. Agents build and match them as plain strings:

- `` `DELIVERED round=${deposited.round} ${delivery.payload}` `` — built directly in `seller-agent/src/index.ts`. `buyer-agent/src/index.ts` matches with `verb(t) === 'DELIVERED'` and strips the prefix with a regex. `payload` is free text (usually JSON), always the last field on the line, so it may contain spaces.
- `` `${releaseVerb} round=${round} sig=${releaseSig} settlement=${requestedSettlement}` `` — `buyer-agent` chooses `releaseVerb` as `ARBITER_RELEASED` or `RELEASED` based on which settlement mode was actually used.

If a change needs a new field on `DELIVERED` or `RELEASED`, prefer promoting it to a typed message in `protocol.ts` over extending the ad-hoc string — that's where round-trip parser tests and the run ledger's expectations live.

## When adding fields

- Include a parser and a formatter, in the same file, next to the existing pair for that verb.
- Add a unit test in `protocol.test.ts` — assert `parseX(formatX(input))` recovers `input`.
- Keep fields tokenized (`key=value`, no spaces) unless the value is intentionally the final free-text field (`note=`, `payload=`, or a quoted `reason="..."`).
- If the field can contain a `"`, neutralize it before formatting (see `formatAward`'s `reason.replace(/"/g, "'")`) — don't let it break the next parser downstream.
