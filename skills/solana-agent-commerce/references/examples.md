# Examples

Good example locations:

- `examples/agent-economy`
- `examples/marketplace`
- `examples/txodds`

Suggested new examples:

- Pay.sh research seller: buyer pays escrow, seller pays upstream API, verifier checks report, escrow releases.
- x402 service seller: external HTTP caller receives `402`, pays, retries with proof, receives `deliverService` output.
- USDC escrow: same marketplace lifecycle using stablecoin settlement.
- Allowance agent: safe budgets for autonomous upstream procurement.

Every example should include a README, a runnable command, and at least one focused test when practical.
