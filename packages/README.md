# packages

- **[agent-runtime/](agent-runtime/README.md)** — the runtime the agent imports: the LLM provider
  shim, Solana Pay + devnet guard, a CoralOS MCP client, the market protocol (incl. VERIFY/VERIFIED),
  the run ledger + reputation, and the policy choke point.
- **[harness-runtime/](harness-runtime/README.md)** — the harness adapter SDK: one
  `HarnessAdapter` interface (`quote`/`run`) so a seller can be a prompt (`node-llm`), headless
  **Claude Code** (`claude-code`), or any CLI (`HARNESS=cli HARNESS_CMD='hermes {prompt}'`).
  Harness processes never hold keys. Build after agent-runtime.
- **[payment-runtime/](payment-runtime/README.md)** - the payment rail router: one `PaymentRail`
  interface, `PaymentRailRouter`, allowance/merchant/procurement policies, and proof-receipt helpers.
  Solana Pay + escrow are working devnet rails; Pay.sh, x402, USDC, allowance, embedded-wallet, and
  payout are typed scaffolds with a status table in the package README. Build after
  agent-runtime.
- **[solana-agent-tools/](solana-agent-tools/README.md)** - optional read-only Solana tools for richer
  agents and Solana Agent Kit-style plugins: wallet/token reads, Jupiter/Pyth price reads, and a
  non-executable transfer-intent simulation that can call `policy.enforce()`. No swaps, bridges, token
  launches, signing, or live transfers in v1. Build after agent-runtime.
