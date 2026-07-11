# CoralOS Integration

CoralOS provides multi-agent coordination. Solana payment signing and settlement remain agent-side.

## Layers

| Layer | Files | Responsibility |
|---|---|---|
| Runtime | `packages/agent-runtime/src/coral/` | MCP client, tool discovery, agent entrypoint, context helpers. |
| Protocol | `packages/agent-runtime/src/market/protocol.ts` | Market message formatters/parsers. Coral transports these as strings. |
| Agents | `coral-agents/` | Buyer, seller, verifier, echo, and user-proxy implementations. |
| Orchestration | `docker-compose.yml`, `examples/txodds/coral/round.ts` | Start CoralOS and create sessions from agent graphs. |
| UI/feed | `examples/txodds/feed` | Read extended session state and expose browser-safe APIs. |

## Runtime API

`CoralMcpAgent` wraps the MCP SDK and connects to `CORAL_CONNECTION_URL` (injected by CoralOS at container start).

| Method | Purpose |
|---|---|
| `waitForMention(maxWaitMs)` | Block until this agent is mentioned, or return `null` on timeout. |
| `waitForMentionInThread(threadId, maxWaitMs)` | Block for mentions scoped to a single thread. |
| `waitForAgent(name, maxWaitMs)` | Wait for a named agent to appear. |
| `sendMessage(content, threadId, mentions)` | Send a message and mention recipients. |
| `createThread(name, participants)` | Create a thread and return its id. |

### Agent Entrypoint

```ts
import { startCoralAgent } from '@pay/agent-runtime'

await startCoralAgent({ agentName: 'my-agent' }, async (ctx) => {
  while (true) {
    const message = await ctx.waitForMention()
    if (!message) continue
    // Parse market protocol messages
    const parsed = parseMarketMessage(message.content)
    // Respond
    await ctx.reply(message, 'BID round=1 price=0.0002 by=my-agent')
  }
})
```

## Agent Roles

| Agent | Role |
|---|---|
| `buyer-agent` | Creates market thread, sends `WANT`, collects bids, awards, deposits, verifies, and releases. |
| `seller-agent` | Bids on supported services, verifies funded escrow, runs a harness adapter, and delivers payloads. |
| `verifier-agent` | Checks delivery hash/structure and replies `VERIFIED pass` or `fail`. |
| `echo-agent` | Minimal connectivity test agent. |
| `user_proxy` | Idle session participant driven by the puppet API. |

### Seller Personas

Seller personas reuse the `seller-agent` Docker image with different manifest values:

```toml
# coral-agents/seller-worldcup/coral-agent.toml
[agent]
name = "seller-worldcup"
image = "seller-agent"

[agent.env]
AGENT_NAME = "seller-worldcup"
PERSONA = "worldcup-specialist"
FLOOR_SOL = "0.0001"
SERVICES = "txline"
```

No new code needed — just a new `coral-agent.toml` directory under `coral-agents/`.

### Agent Discovery

`examples/txodds/coral/coral.toml` uses a wildcard registry:

```toml
[registry]
localAgents = ["/agents/*"]
```

Every directory under `coral-agents/` with a `coral-agent.toml` is auto-registered. Nothing needs to be hand-listed.

## Session Creation

```ts
// examples/txodds/coral/round.ts
const session = await createSession({
  agentGraphRequest: {
    agents: [
      { name: 'buyer-agent', ... },
      { name: 'seller-worldcup', ... },
      { name: 'verifier-agent', ... },
    ],
  },
  namespace: 'txodds',
  immediateExecution: true,
})
```

CoralOS starts one container per graph agent and injects `CORAL_CONNECTION_URL`.

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

Solana deposit/release/refund calls happen outside CoralOS. CoralOS carries coordination messages only — see [PAY.md](PAY.md) for settlement details.

### Protocol Messages

All message types are defined in `packages/agent-runtime/src/market/protocol.ts`:

```ts
import { formatWant, formatBid, parseMarketMessage } from '@pay/agent-runtime'

// Format outgoing messages
const want = formatWant({ round: 1, service: 'txline', arg: 'FIFA World Cup', budgetSol: 0.001 })
// => "WANT round=1 service=txline arg=FIFA World Cup budget=0.001"

const bid = formatBid({ round: 1, priceSol: 0.0002, by: 'seller-worldcup' })
// => "BID round=1 price=0.0002 by=seller-worldcup"

// Parse incoming messages
const parsed = parseMarketMessage('BID round=1 price=0.0002 by=seller-worldcup')
// => { verb: 'BID', round: 1, priceSol: 0.0002, by: 'seller-worldcup' }
```

## Extended State and Feed

`examples/txodds/feed` reads CoralOS extended state and serves browser APIs:

| Endpoint | Purpose |
|---|---|
| `/api/feed` | Typed market rounds. |
| `/api/threads` | Coral thread messages with bus context. |
| `/api/session` | Session roster/state. |
| `/api/runs` | Persisted run ledger records. |
| `/api/reputation` | Ledger-derived seller reputation. |

When CoralOS is unavailable, feed endpoints replay finished sessions from ledger files.

## Configuration

`examples/txodds/coral/coral.toml`:

| Section | Setting |
|---|---|
| `[auth]` | Dev token used by launchers. |
| `[registry]` | `localAgents = ["/agents/*"]` for local agent discovery. |
| `[docker]` | Host settings for launched containers. |

## Coral Console

```text
http://localhost:5555/ui/console
```

```sh
npm run coral:console:e2e    # Probe by itself
npm run dev                  # Probes automatically before launch
```

Set `CORAL_CONSOLE=0` to skip the probe. Set `CORAL_CONSOLE_REQUIRED=1` to make failures fatal.

## Running

```sh
# Single-agent (no CoralOS needed)
npm run dev

# Multi-agent CoralOS round
docker compose up -d coral
bash build-agents.sh
npm run demo:coral
```

## See Also

- [PAY.md](PAY.md) — payment rails and settlement.
- [LLM.md](LLM.md) — provider config for bid/award/verify decisions.
- [API.md](API.md) — using the market protocol with any API.
