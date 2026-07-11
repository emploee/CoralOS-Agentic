# echo-agent

The **minimal CoralOS agent** — it connects over MCP and echoes back any mention. Its jobs:

1. **Connectivity check** — the smallest possible round-trip to prove the MCP handshake works
   before debugging a real agent's logic.
2. **Template** — the smallest possible `startCoralAgent` example to copy when writing a new agent.

```ts
// src/index.ts — the whole agent
await startCoralAgent({ agentName: 'echo-agent' }, async (ctx) => {
  while (true) {
    const mention = await ctx.waitForMention()
    if (mention) await ctx.reply(mention, `echo: ${mention.text}`)
  }
})
```

That's the entire shape of a CoralOS agent: connect → `waitForMention` → `reply`. The seller and
buyer are this pattern with real logic inside.

## Env

`CORAL_CONNECTION_URL` — injected by coral-server when it launches the container. No wallet, no keys.

Build with `docker build -f coral-agents/echo-agent/Dockerfile -t echo-agent:0.1.0 .` (from repo
root). Registered via the launching example's `coral.toml` `[registry] localAgents` scan — see
`examples/txodds/coral/coral.toml` for the pattern.
