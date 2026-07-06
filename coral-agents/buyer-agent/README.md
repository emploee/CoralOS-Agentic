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

`SETTLEMENT_MODE=direct` keeps the base escrow path available. `SETTLEMENT_MODE=arbiter` is the default for current marketplace-style flows.

## Files

| File | Role |
|---|---|
| `src/index.ts` | Market loop and policy-gated deposit/release. |
| `src/arbiter.ts` | Arbiter client and vault PDA helpers. |
| `src/escrow.ts` | Direct base escrow client. |
| `src/wantFeed.ts` | Event-mode polling for external jobs. |
| `src/reputation.ts` | Reputation lines from feed API. |
| `src/goal.ts` | Buyer goal defaults. |
| `src/llm_buyer.ts` | Award reasoning and fallback selection. |

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
| `WANT_FEED_URL` | Event-mode job source. |
| `REPUTATION_URL` | Feed reputation endpoint. |
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
