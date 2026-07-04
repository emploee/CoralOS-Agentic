# @pay/harness-runtime — the harness adapter SDK

One interface so the market doesn't care whether a seller is a prompt, a coding harness, or a
research swarm. The seller agent (`coral-agents/seller-agent`) keeps the wallet, the market
protocol, and the escrow checks; the **adapter** only prices work and produces hash-bound
artifacts. **Harness processes never hold keys.**

```ts
interface HarnessAdapter {
  name: string
  quote(want: Want, cfg: SellerConfig): Promise<BidDecision>   // price it, or decline
  run(order: Order, onEvent?): Promise<Delivery>               // do it, stream progress
}
```

`Delivery.payload` goes on the `DELIVERED` message; `Delivery.sha256` is the same content-hash
convention the run ledger and the escrow `reference` bind — payment is for *that* artifact.
Events stream into the run ledger's transcript, so "what did the agent actually do?" stays
answerable.

## Adapters

Pick one with `HARNESS=<name>` on the seller (default `node-llm`):

| Name | What runs |
|---|---|
| `node-llm` | The in-process baseline — wraps the seller's `deliverService()` fork point. Always works; every other harness is measured against it. |
| `claude-code` | Headless Claude Code (`claude -p --output-format json`) in an isolated per-order workdir. Env: `CLAUDE_CODE_BIN`, `CLAUDE_CODE_MAX_TURNS`, `HARNESS_TIMEOUT_MS`. |
| `cli` | Any other harness CLI. `HARNESS_CMD` is the argv (JSON array or space-split; `{prompt}` substitutes the order prompt, otherwise it arrives on stdin). `HARNESS_NAME` labels it — e.g. Hermes: `HARNESS=cli HARNESS_CMD='hermes {prompt}' HARNESS_NAME=hermes`. |

All adapters share the same LLM bidder (`quote.ts`) with **code-enforced economics**: never bid a
service not carried, never below the cost floor, never above the buyer's budget — a prompt
injection inside a WANT can't force a loss-making bid.

## Coral config injection (the harness joins the session)

When the seller passes the session's MCP URL (`CORAL_CONNECTION_URL`), the `claude-code` adapter
writes into the order workdir:

- `.mcp.json` — a `coral` MCP server entry (Streamable-HTTP) pointing at that URL
- `.claude/settings.local.json` — `enableAllProjectMcpServers: true`

so the harness itself can use Coral tools mid-order (the
[tutorial_orchestrate_agent_harnesses](https://github.com/renxinxing123/tutorial_orchestrate_agent_harnesses)
pattern: coral-server mints per-agent MCP URLs; the launcher injects them into the harness's
config). Other harnesses do the same via `CliHarnessSpec.configFiles`.

## Dev

```sh
npm install
npm run typecheck && npm test
npm run build        # dependents (coral-agents/seller-agent) need the dist
```
