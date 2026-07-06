# @pay/agent-runtime

Shared TypeScript runtime for repository agents and examples. It provides LLM calls, Solana helpers, CoralOS client utilities, market protocol parsers/formatters, run ledger storage, reputation calculation, and policy enforcement.

```ts
import { complete, solanaConnection, generatePaymentUrl } from '@pay/agent-runtime'
```

Local dependents use a `file:` dependency and import built output from `dist/`, so build this package before dependents:

```sh
npm install
npm run typecheck
npm test
npm run build
```

## Modules

| Module | Folder | Main exports |
|---|---|---|
| LLM | `src/llm/` | `complete()`, `parseJsonReply`. |
| Solana | `src/solana/` | `solanaConnection`, `assertDevnet`, `generatePaymentUrl`, `verifyPayment`, `signTransfer`, `loadKeypairB58`. |
| CoralOS | `src/coral/` | `startCoralAgent`, `CoralMcpAgent`, context helpers. |
| Market | `src/market/` | `format*`, `parse*`, `selectBids`, `pickCheapest` for market/payment/verifier messages. |
| Ledger | `src/ledger/` | `writeRun`, `readRun`, `listRuns`, reputation helpers. |
| Policy | `src/policy/` | `enforce(action, policy)`, `policyFromEnv`. |

The runtime does not hold keypairs. Agents and examples load keys and call runtime helpers.

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

## Extension Points

| Task | Location |
|---|---|
| Add/modify a market message | `src/market/protocol.ts` and tests. |
| Add provider support | `src/llm/complete.ts`. |
| Change run persistence | `src/ledger/`. |
| Change spend/release rules | `src/policy/`. |
