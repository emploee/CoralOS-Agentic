# @pay/agent-runtime

The TypeScript runtime every agent in this kit is built on. It owns the agent loop, lifecycle,
messaging, shared state, and the CoralOS (MCP) connection — so you only write *behavior*.

```ts
import { startCoralAgent, BaseStrategy, AgentManager } from '@pay/agent-runtime'
```

The `coral-agents/` agents depend on it via a local `file:` link. Build its `dist` before dependents:
`npm install && npm run build` (also `npm run typecheck`, `npm test`).

## What it gives you

| Export | What it is |
|--------|-----------|
| `startCoralAgent(config, run)` | the entrypoint — connects an agent to CoralOS and hands you a `ctx` |
| `ctx` | `waitForMention`, `waitForMentionInThread`, `waitForAgent`, `reply`, `send`, `createThread` |
| `CoralMcpAgent` | the MCP client underneath (StreamableHTTP transport, tool discovery) |
| `BaseStrategy` / `Strategy` | behavior interface: `run(state, signal)` + `handleMessage(text, state)` |
| `AgentManager` | runs many agents in one process; owns the shared `bus` + `state` |
| `MessageBus` | broadcast / direct messaging between agents |
| `SharedState` | a versioned key-value blackboard all agents read/write |
| `WorkflowEngine` | a DAG of steps for multi-step jobs |
| `strategies/*` | templates: `Idle`, `RpcPoll`, `Weather`, `Transfer`, `Payment`, `HeliusMonitor` |

## The two ways to use it

**1. A CoralOS agent** (what `coral-agents/` does) — you write the loop; the runtime handles spawning,
connecting, and routing:
```ts
await startCoralAgent({ agentName: 'seller-agent' }, async (ctx) => {
  while (true) {
    const m = await ctx.waitForMention()          // a CoralOS @mention (or null on timeout)
    if (m) await ctx.reply(m, 'PAYMENT_REQUIRED …')
  }
})
```
`ctx.waitForMentionInThread(threadId)` is the same but scoped to one thread — for agents juggling
several at once (e.g. the broker shopping multiple sellers; see `docs/SWARM.md`).

**2. A reusable Strategy** — for the `AgentManager`/in-process side, or to share logic:
```ts
class RiskStrategy extends BaseStrategy {
  readonly name = 'risk'
  async run(state, signal) { while (!signal.aborted) { /* poll/act — respect the AbortSignal */ } }
  async handleMessage(text) { return assess(text) }
}
```

`AgentManager` runs several in one process and gives them a shared `bus` (broadcast/direct) and
`state` (a versioned blackboard); `WorkflowEngine` orders multi-step jobs by dependency.

## Extend it

| Want… | Do this |
|---|---|
| new data to sell | edit `deliverService` in `coral-agents/seller-agent` |
| new autonomous behavior | `startCoralAgent({ agentName }, run)` — a new agent |
| many agents in one process | `AgentManager` + `bus` + `state` |
| reusable logic | subclass `BaseStrategy` |

> You build *on* the runtime — you rarely edit it. The job of `startCoralAgent` / `BaseStrategy` is to
> make your behavior "just work" against CoralOS and Solana.

For exact signatures, read the source in `src/` (each module is small and commented) — `coral_mcp.ts`
(the MCP client), `strategy.ts`, `manager.ts`, `message_bus.ts`, `shared_state.ts`, `workflow.ts`.
