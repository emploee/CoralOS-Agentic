# buyer-agent

The buyer agent creates market demand, collects bids, awards a seller, opens escrow, waits for delivery, optionally verifies it, and releases funds through policy.

## Flow

```text
WANT -> BID* -> AWARD
  -> ESCROW_REQUIRED settlement=arbiter reference=<bound order>
  -> policy check
  -> ARBITER_OPENED / DEPOSITED vault=<vault PDA>
  -> DELIVERED
  -> VERIFY -> VERIFIED pass|fail
  -> policy check
  -> ARBITER_RELEASED or refundable hold
```

`SETTLEMENT_MODE=direct` keeps the base escrow path available. `SETTLEMENT_MODE=arbiter` is the default for the current CoralOS round flow.

## Files

| File | Role |
|---|---|
| `src/index.ts` | Market loop: WANT/BID/AWARD, policy-gated deposit, wait for DELIVERED, optional VERIFY, policy-gated release. |
| `src/award/award.ts` | `pickWinner()` — award selection via a bounded tool loop, deterministic cheapest-bid fallback. See Award Loop below. |
| `src/award/award-tools.ts` | Tools for the award loop: `fetch_seller_reputation`, `compute_value_score`, `submit_award`. |
| `src/settlement/escrow.ts` | Direct base escrow client (`SETTLEMENT_MODE=direct`). |
| `src/settlement/arbiter.ts` | Arbiter client and vault PDA helpers (`SETTLEMENT_MODE=arbiter`, the default). |
| `src/feed/wantFeed.ts` | Event-mode polling for external jobs (`WANT_FEED_URL`), instead of rotating `BUYER_ARGS`. |
| `src/reputation/reputation.ts` | Fetches per-seller reputation (structured and formatted) from the feed API (`REPUTATION_URL`). |
| `src/verify/verify-gate.ts` | `decideVerifyEscalation()` — per-round judgment on whether to actually escalate to the verifier. See Verify Gate below. |

## Award Loop

`pickWinner()` (`src/award/award.ts`) runs a bounded tool-calling loop (`runToolLoop`, capped at 5 rounds)
instead of a single LLM call: the model calls `fetch_seller_reputation` and `compute_value_score`
(a deterministic price × reputation formula) before it must call `submit_award` to terminate. If the
loop errors, exhausts its rounds, or picks a seller outside the collected bid pool, the buyer falls
back to the cheapest bid — same failure-mode shape as the seller's bid decision loop
(`coral-agents/seller-agent/README.md`'s Bid Decision Loop).

## Verify Gate

`decideVerifyEscalation()` (`src/verify/verify-gate.ts`) decides per round whether to actually send
`VERIFY`, instead of the static `VERIFIER_AGENT` on/off used every round when `VERIFY_GATE_ENABLED`
is unset. It only skips escalation for a seller with an established (3+ delivery), clean
(`verifiedFail === 0`) record — otherwise it always escalates.

**Important**: skipping escalation does not safely bypass release policy — `policy.ts`'s
`requireVerifier` is hardcoded to `!!VERIFIER_AGENT`, so a skipped round without a `VERIFIED pass`
has its release denied exactly like a verifier timeout: funds stay in escrow, refundable after the
deadline. This is an opt-in efficiency/scrutiny tradeoff, not a free win. Off by default.

## Environment

| Variable | Description |
|---|---|
| `BUYER_KEYPAIR_B58` | Funds deposits. |
| `ARBITER_KEYPAIR_B58` | Signs arbiter release/refund. |
| `SELLER_WALLET` | Payout binding when a specific seller wallet is required. |
| `BUYER_SERVICE` | Service name, default `txline`. |
| `BUYER_ARG` / `BUYER_ARGS` | Request argument(s). |
| `BUYER_MAX_SOL` | Budget cap. |
| `MARKET_SELLERS` | Seller names to include. |
| `SETTLEMENT_MODE` | `arbiter` or `direct`. |
| `VERIFIER_AGENT` | Enables verifier gate when set. |
| `VERIFY_WINDOW_MS` | Verifier response window. |
| `VERIFY_GATE_ENABLED` | Set to `1` to skip escalation for sellers with a clean, established record — see Verify Gate above. Default `0` (verify every delivery). |
| `WANT_FEED_URL` | Event-mode job source. |
| `REPUTATION_URL` | Feed reputation endpoint — folded into award selection and, when `VERIFY_GATE_ENABLED=1`, the verify-gate decision. |
| `POLICY_MAX_SOL_PER_ROUND` | Policy spend cap per round. |
| `POLICY_MAX_SOL_PER_SESSION` | Policy spend cap per session. |
| `POLICY_SERVICES` | Allowed services. |
| `POLICY_MIN_INTERVAL_MS` | Minimum interval between policy actions. |
| `LLM_PROVIDER` and provider key | Optional award reasoning. |

If no LLM provider is configured, award selection falls back to the cheapest valid bid.

## Tests

```sh
npm install
npm run typecheck
npm test
```

Live settlement is exercised through the example launchers.
