# CoralOS Integration

This document maps CoralOS usage in the repository. CoralOS is used for multi-agent coordination; Solana payment signing and settlement remain agent-side.

Official documentation starts at `https://docs.coralos.ai/welcome`.

## Role in This Repository

CoralOS provides:

- local session creation from an agent graph;
- Coral Console at `/ui/console` for local visual inspection and debugging;
- container launch for registered local agents;
- thread-based messaging with mentions;
- blocking coordination primitives;
- extended session state for feeds and dashboards;
- puppet API calls used by the human checkout bridge.

CoralOS does not hold wallets in this repository. `examples/txodds/coral/coral.toml` has no wallet section, and all value movement is performed by agent processes through Solana clients.

## Layers

| Layer         | Files                                                                   | Responsibility                                                         |
| ------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Runtime       | `packages/agent-runtime/src/coral/`                                   | MCP client, tool discovery, agent entrypoint, context helpers.         |
| Protocol      | `packages/agent-runtime/src/market/protocol.ts`                       | Market message formatters/parsers. Coral transports these as strings.  |
| Agents        | `coral-agents/`                                                       | Buyer, seller, verifier, broker, echo, and user-proxy implementations. |
| Orchestration | `docker-compose.yml`, `examples/*/coral*.ts`, marketplace launchers | Start CoralOS and create sessions from agent graphs.                   |
| UI/feed       | `examples/marketplace/feed`, `examples/agent-economy/bridge`        | Read extended session state and expose browser-safe APIs.              |

## Runtime API

`CoralMcpAgent` wraps the MCP SDK and connects to `CORAL_CONNECTION_URL`, which is injected by CoralOS when an agent starts.

Main methods:

| Method                                          | Purpose                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `waitForMention(maxWaitMs)`                   | Block until this agent is mentioned, or return`null` on timeout. |
| `waitForMentionInThread(threadId, maxWaitMs)` | Block for mentions scoped to a single thread.                      |
| `waitForAgent(name, maxWaitMs)`               | Wait for a named agent to appear.                                  |
| `sendMessage(content, threadId, mentions)`    | Send a message and mention recipients.                             |
| `createThread(name, participants)`            | Create a thread and return its id.                                 |

`startCoralAgent()` builds the standard process shape:

```ts
await startCoralAgent({ agentName }, async (ctx) => {
  while (true) {
    const message = await ctx.waitForMention()
    if (!message) continue
    await ctx.reply(message, 'BID round=1 price=0.0002 by=seller')
  }
})
```

Tool names are discovered dynamically by substring to tolerate small CoralOS naming changes.

## Agent Roles

| Agent              | Role                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `buyer-agent`    | Creates market thread, sends`WANT`, collects bids, awards, deposits, verifies, and releases.     |
| `seller-agent`   | Bids on supported services, verifies funded escrow, runs a harness adapter, and delivers payloads. |
| `verifier-agent` | Checks delivery hash/structure and replies `VERIFIED pass                                          |
| `broker`         | Opens private seller threads, buys upstream, and resells with a markup.                            |
| `echo-agent`     | Minimal connectivity test agent.                                                                   |
| `user_proxy`     | Idle session participant driven by the puppet API for human checkout.                              |

Seller personas reuse the seller image with different manifest options.

## Session Creation

Launchers call:

```text
POST /api/v1/local/session
```

with an `agentGraphRequest`, namespace request, and immediate execution mode. CoralOS starts one container per graph agent and injects `CORAL_CONNECTION_URL`.

Relevant examples:

| File                                        | Session                                   |
| ------------------------------------------- | ----------------------------------------- |
| `examples/txodds/coral/round.ts`          | TxODDS buyer plus seller personas.        |
| `examples/marketplace/start.ts`           | Classic market.                           |
| `examples/marketplace/freelancer.ts`      | Harness sellers plus verifier.            |
| `examples/marketplace/research.ts`        | Event-driven buyer plus research sellers. |
| `examples/agent-economy/bridge/server.ts` | Seller plus`user-proxy` for checkout.   |

## Market Flow

```text
buyer-agent  -> createThread("market", sellers, verifier)
buyer-agent  -> WANT round=<n> service=<service> arg=<arg> budget=<sol>
seller-*     -> BID round=<n> price=<sol> by=<seller>
buyer-agent  -> AWARD round=<n> to=<seller>
seller       -> ESCROW_REQUIRED round=<n> reference=<hash> settlement=arbiter
buyer-agent  -> policy check, then escrow/arbiter deposit
buyer-agent  -> DEPOSITED round=<n> vault=<vault PDA>
seller       -> funded escrow check, harness run
seller       -> DELIVERED round=<n> payload=<json>
buyer-agent  -> VERIFY round=<n> sha=<hash> ...
verifier     -> VERIFIED round=<n> verdict=pass|fail
buyer-agent  -> policy check, then release or leave funds refundable
```

The Solana deposit/release/refund calls are outside CoralOS. CoralOS carries coordination messages only.

## Extended State and Feed

`GET /api/v1/local/session/{namespace}/{session}/extended` returns session state and transcripts. The marketplace feed reads this state, folds messages into typed rounds, persists run ledger artifacts, and serves browser APIs:

| Endpoint            | Purpose                                 |
| ------------------- | --------------------------------------- |
| `/api/feed`       | Typed market rounds.                    |
| `/api/threads`    | Coral thread messages with bus context. |
| `/api/session`    | Session roster/state.                   |
| `/api/runs`       | Persisted run ledger records.           |
| `/api/reputation` | Ledger-derived seller reputation.       |

When CoralOS is unavailable, feed endpoints can replay finished sessions from ledger files.

## Puppet API

The checkout bridge uses the puppet API to send messages as `user-proxy`:

```text
POST /api/v1/puppet/{namespace}/{session}/user-proxy/thread...
```

The puppet API is send-only for this use case, so the bridge reads seller replies through extended session state.

## Configuration

`examples/txodds/coral/coral.toml` configures local development:

| Section        | Setting                                                    |
| -------------- | ---------------------------------------------------------- |
| `[auth]`     | Dev token used by launchers.                               |
| `[registry]` | `localAgents = ["/agents/*"]` for local agent discovery. |
| `[docker]`   | Host settings for launched containers.                     |

`docker-compose.yml` runs the pinned CoralOS server container and mounts the local agent registry and Docker socket.

## Coral Console

Coral Server serves Coral Console locally at:

```text
http://localhost:5555/ui/console
```

The root dev script probes this endpoint automatically:

```sh
npm run dev
```

Run the probe by itself when debugging CoralOS:

```sh
npm run coral:console:e2e
```

The probe writes `.artifacts/coral-console/console-e2e.json`. In `npm run dev`, Docker/CoralOS failures are non-fatal unless `CORAL_CONSOLE_REQUIRED=1` is set. Set `CORAL_CONSOLE=0` to skip the probe.

## Development Notes

- Keep market grammar changes in `packages/agent-runtime/src/market/protocol.ts`.
- Keep Solana signing in agent processes, not CoralOS or harness processes.
- Use one thread per concurrent seller request when implementing broker-style fan-out.
- Preserve `round=<n>` fields on market messages so shared-thread replies can be correlated.
- Use recorded extended-state fixtures for deterministic UI/feed tests.
