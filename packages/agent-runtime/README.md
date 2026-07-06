# @pay/agent-runtime

Shared TypeScript runtime for repository agents and examples. It provides LLM calls, Solana helpers, CoralOS client utilities, market protocol parsers/formatters, run ledger storage, reputation calculation, and policy enforcement.

```ts
import { complete, solanaConnection, generatePaymentUrl } from '@pay/agent-runtime'
```

Local dependents are npm workspaces and import built output from `dist/`, so build shared packages before dependents:

```sh
npm install --no-audit --no-fund
npm run build:packages
npm run typecheck -w @pay/agent-runtime
npm test -w @pay/agent-runtime
```

## Modules

| Module | Folder | Main exports |
|---|---|---|
| LLM | `src/llm/` | `complete()`, `parseJsonReply`. |
| Solana | `src/solana/` | `solanaConnection`, `assertDevnet`, `generatePaymentUrl`, `verifyPayment`, `signTransfer`, `loadKeypairB58`. |
| CoralOS | `src/coral/` | `startCoralAgent`, `CoralMcpAgent`, context helpers. |
| Market | `src/market/` | `format*`, `parse*`, `selectBids`, `pickCheapest` for market/payment/verifier messages. |
| Ledger | `src/ledger/` | `writeRun`, `readRun`, `listRuns`, `proofArtifact`, reputation helpers. |
| Policy | `src/policy/` | `enforce(action, policy)`, `policyFromEnv`. |

The runtime does not hold keypairs. Agents and examples load keys and call runtime helpers.

Run folders include `proof.json`, a compact machine-readable E2E proof derived from `RunRecord`, alongside the full ledger facets.

## LLM Provider Notes

`complete()` supports Venice, OpenAI, and Anthropic through environment variables.

```ini
LLM_PROVIDER=venice
VENICE_API_KEY=...
# LLM_MODEL=llama-3.3-70b
```

Venice default model: `llama-3.3-70b`.

`LLM_MODEL=kimi-k2-7-code` is supported. For Venice Kimi models, the runtime raises very small `maxTokens` calls to `1024` because those models may spend part of the budget before emitting `message.content`. Other providers and non-Kimi Venice models keep the caller's requested budget.

See the root `LLM.md` for provider selection details.

## CoralOS Agent Example

```ts
await startCoralAgent({ agentName: 'seller-agent' }, async (ctx) => {
  while (true) {
    const mention = await ctx.waitForMention()
    if (!mention) continue
    await ctx.reply(mention, 'BID round=1 price=0.0002 by=seller')
  }
})
```

`ctx.waitForMentionInThread(threadId)` scopes replies by thread. `ctx.waitForAgent(name)` waits for a named participant before sending work.

## Policy Checks

The policy module centralizes checks used before value movement:

- spend caps;
- service allowlists;
- payout binding;
- award-price binding;
- rate limiting;
- verifier gate.

Solana helpers default to devnet and reject mainnet RPC URLs unless `ALLOW_MAINNET=1` is set.

`LLM_USED` traces carry provider/model, `usedFor`, optional input/output hashes, and `affectedFunds=false`; prompts and completions are not persisted.

## Extension Points

| Task | Location |
|---|---|
| Add/modify a market message | `src/market/protocol.ts` and tests. |
| Add provider support | `src/llm/complete.ts`. |
| Change run persistence | `src/ledger/`. |
| Change spend/release rules | `src/policy/`. |
