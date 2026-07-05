# Payment Rails

Payment rail code lives in `packages/payment-runtime`.

Implement the `PaymentRail` interface from `src/types.ts`:

- `quote`
- `requestPayment`
- `verifyPayment`
- optional `release`
- optional `refund`

Rail selection belongs in `src/rail-router.ts`.

Use cases:

- `solana-pay`: human checkout and simple one-off digital goods.
- `escrow`: disputed or verifier-gated work.
- `spl-usdc`: stablecoin settlement.
- `x402`: paid HTTP APIs.
- `pay-sh`: upstream paid API procurement.
- `allowance`: safe autonomous spending budgets.
- `embedded-wallet`: wallet abstraction for agents or non-crypto users.
- `payout`: seller, verifier, broker, or referrer distribution.

New rails should return a normalized `PaymentVerification` with `paid`, `rail`, `proof`, optional `txSignature`, `amount`, and `currency`.
