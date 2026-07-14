# CoralOS Integration

CoralOS provides multi-agent coordination. Solana payment signing and settlement remain agent-side.

## Layers

| Layer | Files | Responsibility |
|---|---|---|
| Runtime | `packages/agent-runtime/src/coral/` | MCP client, tool discovery, agent entrypoint, context helpers. |
| Protocol | `packages/agent-runtime/src/market/protocol.ts` | Market message formatters/parsers. Coral transports these as strings. |
| Agents | `coral-agents/` | Buyer, seller, and verifier implementations. |
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

### Adding Another Seller

The TxODDS round (`examples/txodds/coral/round.ts`) runs a single `seller-agent`. To add a second,
competing seller, reuse the `seller-agent` Docker image with a new manifest under its own
`coral-agents/` directory, overriding just the market identity and pricing:

```toml
# coral-agents/seller-fast/coral-agent.toml
[agent]
name = "seller-fast"
image = "seller-agent"

[agent.env]
AGENT_NAME = "seller-fast"
PERSONA = "a fast generalist"
FLOOR_SOL = "0.0001"
SERVICES = "txline"
```

No new code needed — just a new `coral-agent.toml` directory under `coral-agents/`, and adding it to
`round.ts`'s agent list so the buyer's `MARKET_SELLERS` includes it.

### Agent Discovery

`examples/txodds/coral/coral.toml` uses a wildcard registry:

```toml
[registry]
localAgents = ["/agents/*"]
```

Every directory under `coral-agents/` with a `coral-agent.toml` is auto-registered. Nothing needs to be hand-listed.

### Agent Runtimes

Every `coral-agent.toml` can declare `[runtimes.docker]`, `[runtimes.executable]`, or both — CoralOS
either launches the agent as a container (via the mounted Docker socket) or execs it directly as its
own child process. `examples/txodds/coral/round.ts`'s `agent()` helper picks per agent:

- **`runtime: 'docker'`** — `buyer-agent` and `seller-agent`. These hold real devnet signing
  keys, so container process isolation is worth the overhead.
- **`runtime: 'executable'`** — `verifier-agent`. It holds no key, so there's no isolation to trade
  away, and coral-server just execs `node dist/index.js` directly — no image, no `docker build`.

The stock `ghcr.io/coral-protocol/coral-server` image has no Node.js (it's `ubuntu:noble` + a minimal
JRE), so `runtime: 'executable'` needs `docker/coral-server.Dockerfile`'s Node layer to actually work
— `docker-compose.yml`'s `coral` service builds from that Dockerfile, not the bare upstream image.

This is deliberately not applied to `buyer-agent`/`seller-agent` — moving wallet-holding agents off
Docker was considered and set aside; see the "Not adopted" note below for the same reasoning applied
to Coral Cloud.

## Session Creation

```ts
// examples/txodds/coral/round.ts
const session = await createSession({
  agentGraphRequest: {
    agents: [
      { name: 'buyer-agent', ... },
      { name: 'seller-agent', ... },
      { name: 'verifier-agent', ... },
    ],
  },
  namespace: 'txodds',
  immediateExecution: true,
})
```

CoralOS starts each graph agent per its declared runtime (a container, or a direct child process —
see "Agent Runtimes" above) and injects `CORAL_CONNECTION_URL` either way.

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

const bid = formatBid({ round: 1, priceSol: 0.0002, by: 'seller-agent' })
// => "BID round=1 price=0.0002 by=seller-agent"

// Parse incoming messages
const parsed = parseMarketMessage('BID round=1 price=0.0002 by=seller-agent')
// => { verb: 'BID', round: 1, priceSol: 0.0002, by: 'seller-agent' }
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

## Not Adopted: Coral Cloud LLM Proxy

CoralOS agents can route every model call through **Coral Cloud** (`llm.coralcloud.ai`), a hosted
OpenAI-compatible proxy, by declaring `[[llm.proxies]]` in `coral-agent.toml` and setting a
`CORAL_API_KEY`. This repo doesn't use it — LLM calls go straight to Groq/Anthropic/OpenAI/Venice
(`packages/agent-runtime/src/llm/complete.ts`). That's a deliberate choice, not an oversight: Coral
Cloud trades this kit's bring-your-own-key flexibility (in particular Groq's free renewing-rate-limit
path, which the whole kit is built around — see `README.md`) for a dependency on a separate hosted
account. Worth knowing it exists if you're forking this for a context where a Coral Cloud account is
already a given.

## Running

```sh
# Single-agent (no CoralOS needed)
npm run dev

# One-command multi-agent CoralOS round (brings up coral-server + creates a round automatically)
npm run dev:agentic

# ...or the manual steps dev:agentic wraps, useful if one of them is stuck and you want to isolate which:
docker compose up -d coral
bash build-agents.sh
npm run demo:coral
```

### Cleaning Up Agent Containers

Buyer/seller agent containers are **not** docker-compose services — CoralOS launches them dynamically
per round (one per seller persona, with per-round env), through the Docker socket mounted into the
`coral` container, so a static compose `services:` entry can't represent them. `docker compose down`
only stops `coral-server` itself.

```sh
npm run agents:stop    # force-removes every buyer-agent/seller-agent container, any time
```

Every new round already does this automatically before it starts (`round.ts`'s `stopPreviousRound()`),
and `npm run dev:agentic`'s Ctrl+C shutdown handler does it too — the only case you'd run this by hand
is wanting a clean slate without immediately starting a new round.

## Claude Code Plugin: `coral-skills`

`.claude/settings.json` pre-registers and enables the official
[`Coral-Protocol/coral-skill-set`](https://github.com/Coral-Protocol/coral-skill-set) plugin
marketplace, via `extraKnownMarketplaces` + `enabledPlugins`. It ships one skill, `coral-skills`,
that routes CoralOS *infrastructure* questions — starting/inspecting `coral-server`, the live
runtime/OpenAPI schema, connecting an arbitrary agent via Coralizer, session create/poll/watch/close,
Coral Cloud API keys and custom-tool callbacks, coordination-topology vocabulary — to the current
upstream reference doc.

That's a different layer from `skills/solana-agent-commerce/` in this repo: `coral-skills` answers
"how do I run/operate CoralOS itself," this repo's own skill answers "how does *this repo's* market
protocol, escrow, verifier gate, and payment rails work." Don't vendor `coral-skill-set`'s reference
docs into this repo's `skills/` — it's upstream-maintained and would go stale immediately; keep
referencing it as an external plugin instead.

## See Also

- [PAY.md](PAY.md) — payment rails and settlement.
- [LLM.md](LLM.md) — provider config for bid/award/verify decisions.
- [API.md](API.md) — using the market protocol with any API.
