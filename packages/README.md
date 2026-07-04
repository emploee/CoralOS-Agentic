# packages

- **[agent-runtime/](agent-runtime/README.md)** — the runtime the agent imports: the LLM provider
  shim, Solana Pay + devnet guard, a CoralOS MCP client, the market protocol (incl. VERIFY/VERIFIED),
  the run ledger + reputation, and the policy choke point.
- **[harness-runtime/](harness-runtime/README.md)** — the harness adapter SDK: one
  `HarnessAdapter` interface (`quote`/`run`) so a seller can be a prompt (`node-llm`), headless
  **Claude Code** (`claude-code`), or any CLI (`HARNESS=cli HARNESS_CMD='hermes {prompt}'`).
  Harness processes never hold keys. Build after agent-runtime.
