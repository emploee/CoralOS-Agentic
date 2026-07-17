# Market Protocol

Market messages live in `packages/agent-runtime/src/market/protocol.ts`. Every message carries a `round=<n>` tag — Coral moves opaque strings, so `round` (not Coral) is what correlates a reply to its request.

## 1. Core round messages

Typed, each with a `format*`/`parse*` pair:

```text
WANT             round=<n> service=<name> arg=<token> budget=<sol>
BID              round=<n> price=<sol> by=<seller> [note=<text>]
AWARD            round=<n> to=<seller> [reason="..."]
VERIFY           round=<n> sha=<hash> service=<name> arg=<token> payload=<raw>
VERIFIED         round=<n> verdict=pass|fail by=<verifier> [sha=<hash>] [reason="..."]
```

## 2. Payment messages — the actual settlement path

Also typed, same file. **These are the primary settlement primitive** every CoralOS round uses — the
seller's `AWARD` reply always requests `rail=x402`:

```text
PAYMENT_REQUIRED  round=<n> rail=<rail> amount=<amount> currency=<asset> reference=<id> [seller=] [url=] [deadline=]
PAYMENT_PROOF     round=<n> rail=<rail> reference=<id> proof=<receipt> [buyer=] [sig=]
PAYMENT_CONFIRMED round=<n> rail=<rail> reference=<id> paid=true|false [amount=] [currency=] [sig=]
SETTLED           round=<n> rail=<rail> reference=<id> [amount=] [currency=] [sig=] [reason="..."]
REFUNDED          round=<n> rail=<rail> reference=<id> [amount=] [currency=] [sig=] [reason="..."]
```

There is no escrow message in this list — `ESCROW_REQUIRED`/`DEPOSITED` were removed from
`protocol.ts`; they no longer exist. Payment is direct and final: the buyer signs a transfer
(`PAYMENT_PROOF`, not yet submitted), the seller submits + verifies it on-chain, then delivers.
`REFUNDED` is kept as generic wire-protocol support for rails that *do* have a refund concept (e.g. a
fork re-enabling the escrow programs), but the default x402 flow never emits it — there is no refund
path once a payment is confirmed.

**The same message types carry two different legs**, distinguished by `reference` and order of
appearance, not by anything in the message shape itself:

1. **Primary settlement** — the buyer paying the seller for the round. Always `rail=x402`. The
   *first* `PAYMENT_REQUIRED` seen in a round is always this leg (`AWARD` triggers it immediately).
2. **Upstream procurement** (optional) — the seller, already paid, buying its own upstream resource
   before delivering (`PROCURE_RAIL=x402`, `packages/payment-runtime/src/procure.ts`'s
   `procureUpstream()`). A *different* `reference`. Posted on the market thread unmentioned
   (bus-visible, buyer-loop-invisible) so `examples/txodds/feed` can fold it into the round's proof
   receipts separately from the primary payment.

If you're folding these messages (like `examples/txodds/feed/src/foldRounds.ts` does), key off
`rail === 'x402' && !round.payment` to claim the primary leg; anything else with a `PAYMENT_REQUIRED`
is a procurement leg.

`rail` is typed as `PaymentRailKind` in this file, which still lists retired kinds — `pay-sh`,
`spl-usdc`, `allowance`, `embedded-wallet`, `payout` — that `packages/payment-runtime` no longer
implements. Only `x402` | `solana-pay` | `escrow` have a working rail behind them; don't format a
message with one of the retired kinds expecting a rail to exist for it.

## 3. Untyped verbs

`DELIVERED` has **no** formatter/parser in `protocol.ts`. Agents build and match it as a plain string:

- `` `DELIVERED round=${order.round} ${delivery.payload}` `` — built directly in `seller-agent/src/index.ts`. `buyer-agent/src/index.ts` matches with `verb(t) === 'DELIVERED'` and strips the prefix with a regex. `payload` is free text (usually JSON), always the last field on the line, so it may contain spaces.

If a change needs a new field on `DELIVERED`, prefer promoting it to a typed message in `protocol.ts`
over extending the ad-hoc string — that's where round-trip parser tests and the run ledger's
expectations live.

## When adding fields

- Include a parser and a formatter, in the same file, next to the existing pair for that verb.
- Add a unit test in `protocol.test.ts` — assert `parseX(formatX(input))` recovers `input`.
- Keep fields tokenized (`key=value`, no spaces) unless the value is intentionally the final free-text field (`note=`, `payload=`, or a quoted `reason="..."`).
- If the field can contain a `"`, neutralize it before formatting (see `formatAward`'s `reason.replace(/"/g, "'")`) — don't let it break the next parser downstream.
