# Examples

First-class, actively maintained examples — put new example code here unless there's a strong reason for a new top-level example directory:

- `examples/txodds` — the default paid service (single agent, no CoralOS required for the web flow).
- `examples/marketplace` — the multi-agent CoralOS market (classic / freelancer / research launchers, feed server, React visualizer). See `docs/AGENT_ORCHESTRATION.md` for the deeper agent-framework patterns (capability/safety/tool-loop, signal agents, trace/arena UI) that live here.

Suggested new examples:

- Pay.sh research seller: buyer pays escrow, seller pays upstream API, verifier checks report, escrow releases.
- x402 service seller: external HTTP caller receives `402`, pays, retries with proof, receives `deliverService` output.
- USDC escrow: same marketplace lifecycle using stablecoin settlement.
- Allowance agent: safe budgets for autonomous upstream procurement.

Every example should include a README, a runnable command, and at least one focused test when practical.
