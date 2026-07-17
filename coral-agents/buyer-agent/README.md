# buyer-agent

The buyer agent creates market demand, collects bids, awards a seller, pays directly via x402, waits
for delivery, and optionally verifies it.

## Flow

```text
WANT -> BID* -> AWARD
  -> PAYMENT_REQUIRED rail=x402 reference=<ref> seller=<addr>
  -> policy check
  -> PAYMENT_PROOF proof=<signed tx> (buyer signs, does not submit)
  -> PAYMENT_CONFIRMED (seller submits + verifies on-chain)
  -> DELIVERED
  -> VERIFY -> VERIFIED pass|fail   (informational - payment already settled)
  -> SETTLED
```

Payment is direct and final, before delivery — there is no escrow, no release step, and no refund
path. A seller that takes payment and never delivers keeps it; reputation
(`src/reputation/reputation.ts`) is the defense, not a fund guarantee. See the root `PAY.md` for the
trade-off this accepts.

## Files

| File | Role |
|---|---|
| `src/index.ts` | Market loop: WANT/BID/AWARD, policy-gated x402 payment, wait for DELIVERED, optional VERIFY, SETTLED. |
| `src/award/award.ts` | `pickWinner()` — deterministic best-value selection: price weighed against seller track record. See Award Selection below. |
| `src/feed/wantFeed.ts` | Event-mode polling for external jobs (`WANT_FEED_URL`), instead of rotating `BUYER_ARGS`. |
| `src/reputation/reputation.ts` | Fetches per-seller reputation (structured and formatted) from the feed API (`REPUTATION_URL`). |
| `src/verify/verify-gate.ts` | `decideVerifyEscalation()` — per-round judgment on whether to actually escalate to the verifier. See Verify Gate below. |

## Award Selection

`pickWinner()` (`src/award/award.ts`) blends price (60%) against seller track record (40%, a neutral
score for a newcomer with no history) into a 0-100 value score per bid; the highest score wins, ties
broken by price. Deterministic — no model call, no fallback path needed.

## Verify Gate

`decideVerifyEscalation()` (`src/verify/verify-gate.ts`) decides per round whether to actually send
`VERIFY`, instead of the static `VERIFIER_AGENT` on/off used every round when `VERIFY_GATE_ENABLED`
is unset. It only skips escalation for a seller with an established (3+ delivery), clean
(`verifiedFail === 0`) record — otherwise it always escalates.

**Important**: skipping escalation is purely a reputation-tracking trade-off now, not a fund-safety
one — the x402 payment already settled by the time VERIFY would fire, so a skipped round simply means
no independent read on that particular delivery, not a difference in what happens to the funds.

## Environment

| Variable | Description |
|---|---|
| `BUYER_KEYPAIR_B58` | Signs x402 payments. |
| `SELLER_WALLET` | Payout binding when a specific seller wallet is required. |
| `BUYER_SERVICE` | Service name, default `txline`. |
| `BUYER_ARG` / `BUYER_ARGS` | Request argument(s). |
| `BUYER_MAX_SOL` | Budget cap. |
| `MARKET_SELLERS` | Seller names to include. |
| `VERIFIER_AGENT` | Enables verifier gate when set. |
| `VERIFY_WINDOW_MS` | Verifier response window. |
| `VERIFY_GATE_ENABLED` | Set to `1` to skip escalation for sellers with a clean, established record — see Verify Gate above. Default `0` (verify every delivery). |
| `WANT_FEED_URL` | Event-mode job source. |
| `REPUTATION_URL` | Feed reputation endpoint — folded into award selection and, when `VERIFY_GATE_ENABLED=1`, the verify-gate decision. |
| `POLICY_MAX_SOL_PER_ROUND` | Policy spend cap per round. |
| `POLICY_MAX_SOL_PER_SESSION` | Policy spend cap per session. |
| `POLICY_SERVICES` | Allowed services. |
| `POLICY_MIN_INTERVAL_MS` | Minimum interval between policy actions. |

## Tests

```sh
npm install
npm run typecheck
npm test
```

Live settlement is exercised through the example launchers.
