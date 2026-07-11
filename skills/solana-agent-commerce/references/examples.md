# Examples

`examples/txodds` is the repo's one first-class, actively maintained example — put new example code
here unless there's a strong reason for a new top-level example directory. It covers both the
single-agent web flow (no CoralOS required) and the multi-agent CoralOS round (`coral/round.ts`,
`feed/` for the live session reader/run ledger, `escrow/` for the Anchor programs).

Suggested extensions:

- x402 research seller: buyer pays escrow, seller pays an upstream x402 API, verifier checks the report, escrow releases.
- x402 service seller: external HTTP caller receives `402`, pays, retries with proof, receives `deliverService` output.
- USDC escrow: same round lifecycle using stablecoin settlement.

Every example should include a README, a runnable command, and at least one focused test when practical.
