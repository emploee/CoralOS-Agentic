# @pay/agent-runtime

The runtime an agent stands on — so you write only *behavior*. The World Cup Oracle
(`examples/txodds`) uses the **LLM** + **Solana** modules; the **CoralOS** + **Market** modules are the
rails for growing it into a multi-agent market.

```ts
import { complete, solanaConnection, generatePaymentUrl } from '@pay/agent-runtime'
```

`examples/txodds` depends on it via a local `file:` link. Build its `dist` before dependents:
`npm install && npm run build` (also `npm run typecheck`, `npm test`).

## The modules

Each is a folder under `src/` with its own barrel; the root `src/index.ts` re-exports them all.

| Module | Exports | Folder |
|--------|---------|--------|
| **LLM** | `complete()` — SDK-free provider shim (**Venice AI** is the kit's LLM; `LLM_PROVIDER` also accepts `openai`/`anthropic`) + `parseJsonReply` | `llm/` (`complete.ts`) |
| **Solana** | `solanaConnection`/`assertDevnet` (devnet guard), `generatePaymentUrl`/`verifyPayment`/`signTransfer`/`loadKeypairB58` (reference-bound) | `solana/` (`connection.ts`, `pay.ts`) |
| **CoralOS** | `startCoralAgent(config, run)`, `CoralMcpAgent`, and the `ctx` verbs (`waitForMention`, `waitForAgent`, `reply`, `send`, `createThread`) | `coral/` (`mcp.ts`, `server.ts`) |
| **Market** | `formatWant`/`parseBid`/`parseAward`/`parseVerify`/`parseVerified`/… + `selectBids`/`pickCheapest` — the WANT/BID/AWARD (+ VERIFY/VERIFIED) wire protocol (pure) | `market/` (`protocol.ts`) |
| **Ledger** | `writeRun`/`readRun`/`listRuns` — one folder per paid round (hash-bound delivery, verdict, Explorer-linked txs, transcript) + `reputation()` derived from it | `ledger/` (`run.ts`, `store.ts`, `reputation.ts`) |
| **Policy** | `enforce(action, policy)` + `policyFromEnv` — the choke point every deposit/release passes: spend caps, service allowlist, payout + award-price binding, rate limit, verifier gate | `policy/` (`policy.ts`) |

The runtime is coordination + helpers — it never holds a keypair. Settlement is the escrow contract,
called agent-side.

## How to use it

You write the loop; the runtime handles connecting and routing:

```ts
await startCoralAgent({ agentName: 'seller-agent' }, async (ctx) => {
  while (true) {
    const m = await ctx.waitForMention()          // a CoralOS @mention (or null on timeout)
    if (m) await ctx.reply(m, 'BID round=1 price=0.0002 by=seller-cheap')
  }
})
```

`ctx.waitForMentionInThread(threadId)` scopes to one thread; `ctx.waitForAgent(name)` blocks until an
agent comes online before you send it work.

## Extend it

| Want… | Do this |
|---|---|
| new data to sell | edit the edge transform / `deliverService` in `examples/txodds/agent` |
| a different LLM | set `LLM_PROVIDER`/`LLM_MODEL` (no code change), or call `complete()` directly |
| a multi-agent market | `startCoralAgent({ agentName }, run)` + the `market/` protocol + the escrow client |

For exact signatures, read the small, commented modules in `src/` — each is one concern.
