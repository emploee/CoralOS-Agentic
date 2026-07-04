# End-to-End CoralOS Implementation

> A complete walkthrough of how CoralOS is wired through the repo — from the MCP primitives in the runtime, to the agents, to a running multi-agent market round.

---

## 1. Architecture in Three Layers

```
┌─ Layer 3 — orchestration + examples ───────────────────────────────────────────┐
│  docker-compose.yml     pinned coral-server container                           │
│  examples/*/coral.toml  registry scan, auth, no-wallet config                   │
│  examples/*/start.ts    POST /api/v1/local/session (declarative agent graph)    │
│  examples/*/feed/       session → round feed + run ledger                       │
│  examples/*/web/        React visualizer over the feed                          │
└──────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ spawns containers, injects CORAL_CONNECTION_URL
                                       ▼
┌─ Layer 2 — agents (coral-agents/*) ──────────────────────────────────────────────┐
│  buyer-agent  seller-agent  verifier-agent  broker  echo-agent  user_proxy      │
│  each: coral-agent.toml manifest + Docker image + MCP participant               │
└──────────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │ import { startCoralAgent, CoralMcpAgent, … }
                                       ▼
┌─ Layer 1 — runtime (packages/agent-runtime/src) ─────────────────────────────────┐
│  coral/mcp.ts       MCP client + the 4 primitives + mention parsing             │
│  coral/server.ts    startCoralAgent() + CoralAgentContext                       │
│  market/protocol.ts WANT/BID/AWARD/… wire format (pure, network-free)           │
└──────────────────────────────────────────────────────────────────────────────────┘
```

The golden rule is **coordination vs. settlement separation**:

- **CoralOS** moves messages and blocks on mentions. It holds **no keys** and signs **no transactions**.
- **Solana** moves money through the escrow/arbiter programs. That logic lives in the agents themselves and in `packages/agent-runtime/src/solana`.

---

## 2. Layer 1 — The Runtime

### 2.1 `CoralMcpAgent` (`packages/agent-runtime/src/coral/mcp.ts`)

A thin wrapper over the official MCP SDK. On `connect()` it opens a **Streamable-HTTP** transport to `CORAL_CONNECTION_URL`, then introspects the available tools by substring so it survives coral-server renames.

It exposes four primitives, each one MCP `callTool`:

| Method | MCP tool | Purpose |
|--------|----------|---------|
| `waitForMention(maxWaitMs?)` | `coral_wait_for_mention` | Blocks server-side until someone `@mentions` this agent |
| `waitForMentionInThread(threadId, maxWaitMs?)` | `coral_wait_for_mention` | Same, but ignores mentions from other threads |
| `waitForAgent(name, maxWaitMs?)` | `coral_wait_for_agent` | Blocks until a named agent comes online |
| `sendMessage(content, threadId, mentions?)` | `coral_send_message` | Posts into a thread, optionally `@mentioning` recipients |
| `createThread(name, participants)` | `coral_create_thread` | Creates a thread and returns its id |

Important helpers:

- `parseMention(raw)` normalizes drifting coral-server message envelopes (`messages[]`, `message`, or flat `text`) and detects the `"Timeout reached"` string so callers receive `null` on timeout.
- `waitForMentionInThread()` is essential for concurrent request/response patterns (used heavily by the broker).

### 2.2 `startCoralAgent()` (`packages/agent-runtime/src/coral/server.ts`)

The ergonomic entrypoint every agent's `index.ts` calls:

```ts
await startCoralAgent({ agentName: 'seller-worldcup' }, async (ctx) => {
  while (true) {
    const m = await ctx.waitForMention()
    if (!m) continue
    // parse m.text, do work, settle on Solana
    await ctx.reply(m, response)
  }
})
```

The context `ctx` exposes:

```ts
interface CoralAgentContext {
  waitForMention(): Promise<Mention | null>
  waitForMentionInThread(threadId): Promise<Mention | null>
  waitForAgent(name): Promise<boolean>
  reply(to: Mention, text: string): Promise<void>
  send(text: string, opts?: { threadId?: string; mentions?: string[] }): Promise<void>
  createThread(name: string, participants: string[]): Promise<string>
}
```

`CORAL_CONNECTION_URL` is **injected by coral-server at container start** — the agent never configures a host.

### 2.3 The Market Protocol (`packages/agent-runtime/src/market/protocol.ts`)

Coral moves opaque strings; the market grammar lives in pure TypeScript.

Key types:

```ts
Want         // round, service, arg, budget
Bid          // round, price, by, note
Award        // round, to, reason
EscrowTerms  // round, reference, seller, amount, deadline, settlement
Deposited    // round, reference, buyer, sig, vault, arbiter
VerifyRequest // round, sha, service, arg, payload
Verdict      // round, verdict: 'pass' | 'fail', by, reason
```

Every message carries `round=<n>` because many agents talk on one shared thread. The protocol functions are pure `string ↔ object` converters, so they are unit-testable with no network.

### 2.4 Solana primitives (`packages/agent-runtime/src/solana/`)

Used by agents when they need to move money:

- `solanaConnection()` — returns a devnet `Connection`, throws on mainnet unless `ALLOW_MAINNET=1`.
- `signTransfer()` — signs a reference-tagged SOL transfer.
- `generatePaymentUrl()` / `verifyPayment()` — Solana Pay helpers.
- `loadKeypairB58()` — loads an `Ed25519Keypair` from a base58 env var.

These are **never called by coral-server**; they run inside the agent process.

---

## 3. Layer 2 — The Agents

Each agent is a containerized Node (or Python) program plus a `coral-agent.toml` manifest. They are discovered and launched by coral-server, not run directly.

### 3.1 `buyer-agent`

**File:** `coral-agents/buyer-agent/src/index.ts`

Responsible for the left half of the loop: `WANT → BID → AWARD → DEPOSITED → RELEASED`.

Typical flow:

1. Wait until required sellers are online (`ctx.waitForAgent`).
2. Create a market thread: `ctx.createThread('market', sellers)`.
3. Broadcast `WANT round=N service=... arg=... budget=...`.
4. Collect bids for a timed window (`waitForMentionInThread`).
5. Score bids with an LLM (best value, considering price, ETA, confidence, reputation) and fall back to cheapest.
6. Send `AWARD round=N to=<winner> reason=...`.
7. Wait for `ESCROW_REQUIRED` from the winner.
8. Run policy checks (`packages/agent-runtime/src/policy/policy.ts`).
9. Deposit into the escrow/arbiter program.
10. Send `DEPOSITED round=N reference=R sig=... vault=...`.
11. Wait for `DELIVERED`.
12. Optionally send `VERIFY` to the verifier agent.
13. On `VERIFIED pass`, release escrow to the seller.

Configuration knobs (from `coral-agent.toml` / env):

- `BUYER_KEYPAIR_B58` — buyer wallet
- `BUYER_MAX_SOL` — per-order budget
- `LLM_PROVIDER`, `VENICE_API_KEY`, etc.
- `REPUTATION_URL` — optional endpoint for seller reputation
- `VERIFIER_AGENT` — if set, release is gated on verifier
- `POLICY_*` — spend caps, service allowlist, rate limits

### 3.2 `seller-agent`

**File:** `coral-agents/seller-agent/src/index.ts`

Responsible for the right half of the loop: `BID → ESCROW_REQUIRED → DELIVERED`.

Flow:

1. Block on `waitForMention`.
2. Parse the message.
3. If `WANT`:
   - Decide whether to bid (service inventory match, floor price, budget).
   - Optionally use the LLM to price/qualify.
   - Reply `BID round=N price=... by=... note=...`.
4. If `AWARD` to this seller:
   - Compute the escrow `reference = sha256(order preimage)`.
   - Reply `ESCROW_REQUIRED round=N reference=R seller=S amount=A deadline=D settlement=arbiter`.
5. If `DEPOSITED`:
   - Verify the escrow is funded on-chain.
   - Run the harness adapter to produce the delivery.
   - Reply `DELIVERED round=N <payload>`.

Harness integration:

```ts
const adapter = adapterFromEnv(deliverService)
const decision = await adapter.quote(want, cfg)
const delivery = await adapter.run(order, onEvent)
```

Available harnesses: `node-llm` (in-process), `claude-code` (headless Claude Code), `cli` (any subprocess).

Personas are config. `seller-worldcup`, `seller-cheap`, `seller-premium`, `seller-scribe`, `seller-claude`, `seller-moves`, `seller-stats` all reuse the same image.

### 3.3 `verifier-agent`

**File:** `coral-agents/verifier-agent/src/index.ts`

A **keyless, walletless** independent agent that checks deliveries.

- Receives `VERIFY round=N sha=... service=... arg=... payload=...`
- Runs deterministic checks first: hash match, JSON structure, no error payload.
- Optionally calls an LLM as a judge.
- Replies `VERIFIED round=N verdict=pass|fail by=verifier reason=...`

The buyer uses this as a release gate when `VERIFIER_AGENT` is configured.

### 3.4 `broker`

**File:** `coral-agents/broker/src/index.ts`

A swarm reseller: both buyer and seller in one agent.

1. Receives a `WANT` from an upstream buyer.
2. Creates a **private thread per upstream seller**.
3. Requests quotes from each seller.
4. Uses `waitForMentionInThread` to correlate replies without cross-talk.
5. Buys the cheapest upstream quote.
6. Resells to the original buyer at a configured `MARKUP`.
7. Two escrow settlements per request.

This is the strongest example of why Coral's multi-thread + correlation primitives matter.

### 3.5 `user_proxy`

**File:** `coral-agents/user_proxy/agent.py`

A Python agent that does nothing except exist in the session. The bridge uses the **puppet API** to post messages *as* `user-proxy`, allowing a human to participate in an MCP session from a React UI.

### 3.6 `echo-agent`

Minimal smoke-test agent: echoes any `@mention`.

---

## 4. Layer 3 — Orchestration

### 4.1 `docker-compose.yml`

Runs the pinned `coral-server` image:

```yaml
coral:
  image: ghcr.io/coral-protocol/coral-server:latest@sha256:...
  ports: ["5555:5555"]
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
    - ./examples/txodds/coral/coral.toml:/config/coral.toml:ro
    - ./coral-agents:/agents:ro
```

Key mounts:

- `docker.sock` — lets coral-server spawn agent containers.
- `coral.toml` — server config.
- `/agents` — local agent registry.

Environment variables are forwarded to spawned agents: wallet keys, RPC URL, LLM keys, TxLINE token, trace flags. **No wallet config is set on coral-server itself**.

### 4.2 `coral.toml`

Example from `examples/txodds/coral/coral.toml`:

```toml
[registry]
localAgents = ["/agents/*"]
localAgentRescanTimer = "5s"

[auth]
keys = ["dev"]

[docker]
address = "host.docker.internal"
```

- `localAgents = ["/agents/*"]` — every subfolder of `coral-agents/` becomes a launchable agent by name.
- `auth.keys` — bearer token launchers send.
- `docker.address` — how spawned agents reach the host coral-server.
- **No `[wallet]` section** — the coordinator is custody-free.

### 4.3 `coral-agent.toml`

Each agent folder contains a manifest. Example `coral-agents/seller-agent/coral-agent.toml`:

```toml
[agent]
name = "seller-agent"
version = "0.1.0"

[options]
FLOOR_SOL = { type = "float", default = 0.0001 }
PERSONA = { type = "string", default = "balanced" }
SERVICES = { type = "string", default = "txline" }
HARNESS = { type = "string", default = "node-llm" }
```

The `[options]` table is how coral-server injects typed per-agent configuration at launch time. Personas like `seller-worldcup` reuse the same Docker image with a different `coral-agent.toml`.

### 4.4 Session launchers

Launchers are small TypeScript scripts that POST to coral-server.

Example from `examples/txodds/coral/round.ts`:

```ts
const session = await fetch('http://localhost:5555/api/v1/local/session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer dev' },
  body: JSON.stringify({
    agentGraphRequest: {
      agents: [
        { id: 'buyer', name: 'buyer-agent', provider: { runtime: 'docker' }, options: { ... } },
        { id: 'seller-wc', name: 'seller-worldcup', provider: { runtime: 'docker' }, options: { ... } },
        { id: 'seller-fast', name: 'seller-fast', provider: { runtime: 'docker' }, options: { ... } },
      ]
    },
    namespaceProvider: { type: 'create_if_not_exists', namespaceRequest: { name: 'default' } },
    execution: { mode: 'immediate' }
  })
})
```

coral-server then:

1. Resolves each `name` to a local agent from the registry.
2. Builds/runs one Docker container per agent.
3. Injects `CORAL_CONNECTION_URL` into each container.
4. Connects the agents to the shared MCP bus.
5. Returns the session id.

Other endpoints used:

- `GET /api/v1/local/session/{ns}/{sid}/extended` — full session transcript/state (used by feeds and the bridge).
- `POST /api/v1/puppet/{ns}/{sid}/user-proxy/thread/...` — inject a message as an agent (human bridge).

---

## 5. End-to-End: One Market Round

Here is the exact message flow for one round, mapped to Coral primitives and Solana transactions.

```
Step  Actor            Action / Message                                      Primitive / Program
──────────────────────────────────────────────────────────────────────────────────────────────────
1     coral-server     Spawn buyer + sellers as containers                   POST /api/v1/local/session
2     buyer-agent      Wait for sellers to come online                       wait_for_agent
3     buyer-agent      Create thread "market" with sellers                   create_thread
4     buyer-agent      WANT round=1 service=txline arg="edge 187..." budget=0.001  send_message @sellers
5     seller-*         (blocked, wake on mention)                            wait_for_mention
6     seller-worldcup  BID round=1 price=0.00045 by=seller-worldcup note=... send_message @buyer
7     seller-fast      BID round=1 price=0.00030 by=seller-fast note=...     send_message @buyer
8     buyer-agent      Collect bids for window                               wait_for_mention_in_thread
9     buyer-agent      Score bids (LLM or cheapest fallback)
10    buyer-agent      AWARD round=1 to=seller-worldcup reason=...           send_message @seller-worldcup
11    seller-worldcup  ESCROW_REQUIRED round=1 reference=<sha256> seller=... amount=0.00045 deadline=... settlement=arbiter  send_message @buyer
12    buyer-agent      Policy check                                          enforce(action, policy)
13    buyer-agent      Deposit SOL into arbiter vault                        arbiter.open()  ──▶ on-chain
14    buyer-agent      DEPOSITED round=1 reference=R sig=<tx> vault=<PDA>    send_message @seller-worldcup
15    seller-worldcup  Verify escrow funded on-chain                         escrow read-only RPC
16    seller-worldcup  Run harness adapter, produce delivery
17    seller-worldcup  DELIVERED round=1 {teams, fair line, read}            send_message @buyer
18    buyer-agent      VERIFY round=1 sha=... service=... payload=...        send_message @verifier-agent
19    verifier-agent   Deterministic + optional LLM checks
20    verifier-agent   VERIFIED round=1 verdict=pass by=verifier-agent       send_message @buyer
21    buyer-agent      Policy check (verifier-gate)
22    buyer-agent      Release escrow to seller                              arbiter.arbitrate_release()  ──▶ on-chain
23    buyer-agent      ARBITER_RELEASED round=1 sig=<tx>                     send_message @seller-worldcup
24    marketplace feed Persist run folder + emit SSE                         file system + /api/feed
```

Every line that is not marked "on-chain" is a Coral MCP tool call. Money moves only in steps 13 and 22, and those happen inside the agent process against Solana programs — not through coral-server.

---

## 6. The Message Wire Format

Coral messages are plain strings. The market protocol defines the grammar.

Examples:

```text
WANT round=1 service=txline arg="edge 187" budget=0.001

BID round=1 price=0.00045 by=seller-worldcup note="verified line, 60s"

AWARD round=1 to=seller-worldcup reason="best value at this price"

ESCROW_REQUIRED round=1 reference=0xabc... seller=7xY... amount=0.00045 deadline=300 settlement=arbiter

DEPOSITED round=1 reference=0xabc... buyer=9aB... sig=5Jk... vault=3pQ... arbiter=FJt...

DELIVERED round=1 {"teams":"BRA-ARG","fairLine":"2.05","read":"Brazil slight value"}

VERIFY round=1 sha=0xabc... service=txline arg="edge 187" payload={...}

VERIFIED round=1 verdict=pass by=verifier-agent reason="hash matches, JSON valid"
```

The `round=<n>` tag is the correlation ID. Because Coral threads are shared buses, every agent in the thread sees every message; the round tag lets agents ignore messages from other rounds.

---

## 7. Key Code Paths

### Connecting an agent to Coral

`packages/agent-runtime/src/coral/server.ts`:

```ts
export async function startCoralAgent(
  config: { agentName: string },
  run: (ctx: CoralAgentContext) => Promise<void>
) {
  const url = process.env.CORAL_CONNECTION_URL
  if (!url) throw new Error('CORAL_CONNECTION_URL not set')
  const agent = new CoralMcpAgent(url, config.agentName)
  await agent.connect()
  const ctx = new CoralAgentContext(agent)
  // handle SIGINT/SIGTERM
  await run(ctx)
}
```

### Mention parsing

`packages/agent-runtime/src/coral/mcp.ts`:

```ts
parseMention(raw: unknown): Mention | null {
  // Handles nested messages[], message key, flat text
  // Returns null on timeout
}
```

### Protocol parsing

`packages/agent-runtime/src/market/protocol.ts`:

```ts
export function parseBid(text: string): Bid | null {
  const match = text.match(/^BID round=(\d+) price=([\d.]+) by=(\S+)(?: note=(.+))?$/)
  if (!match) return null
  return { round: Number(match[1]), priceSol: Number(match[2]), by: match[3], note: match[4] }
}
```

### Policy enforcement

`packages/agent-runtime/src/policy/policy.ts`:

```ts
export function enforce(action: FundAction, policy: Policy): PolicyDecision {
  const violations: string[] = []
  // spend-cap-round, spend-cap-session, award-price, payout-binding, verifier-gate, ...
  return { ok: violations.length === 0, violations }
}
```

### Run ledger write

`packages/agent-runtime/src/ledger/run.ts`:

```ts
export function writeRun(baseDir: string, run: RunRecord, transcript: TranscriptEntry[]) {
  const dir = join(baseDir, run.session, `round-${run.round}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2))
  // also writes want.json, bids.json, award.json, escrow.json, delivery.json, verification.json, txs.json, transcript.jsonl
}
```

---

## 8. Configuration Reference

### Root `.env`

Generated by `scripts/setup.js`:

| Variable | Purpose |
|----------|---------|
| `WALLET` / `SELLER_WALLET` | Seller payout address |
| `BUYER_KEYPAIR_B58` | Buyer signing key |
| `ARBITER_KEYPAIR_B58` | Arbiter signing key (for verifier-gated rounds) |
| `SOLANA_RPC_URL` | Defaults to devnet |
| `VENICE_API_KEY` | Kit's default LLM |
| `LLM_PROVIDER` | `venice` / `openai` / `anthropic` |
| `LLM_MODEL` | Override model |
| `TXLINE_API_KEY` | TxODDS free-tier token |
| `TRACE` | `1` logs MCP calls + on-chain links |
| `POLICY_MAX_SOL_PER_ROUND` | Spend cap |
| `POLICY_SERVICES` | Comma-separated service allowlist |

### Per-agent options (`coral-agent.toml`)

| Option | Typical use |
|--------|-------------|
| `FLOOR_SOL` | Minimum bid price |
| `PERSONA` | Seller behavior profile |
| `SERVICES` | Comma-separated service inventory |
| `HARNESS` | `node-llm` / `claude-code` / `cli` |
| `MARKUP` | Broker markup ratio |
| `CONFIDENCE` | Seller self-rated quality |

---

## 9. Lifecycle Management

### Starting the coordinator

```sh
docker compose up -d coral
```

### Building agent images

```sh
bash build-agents.sh        # all
bash build-agents.sh seller # seller only
bash build-agents.sh buyer  # buyer only
bash build-agents.sh claude # Claude Code seller variant
```

### Launching a round

```sh
npm run marketplace           # examples/marketplace/start.ts
npm run demo:coral            # examples/txodds/coral/round.ts
npm run agent-economy         # examples/agent-economy/autonomous/start.ts
npm run agent-economy:bridge  # human bridge
```

### Observing a round

```sh
npm run marketplace:web       # React visualizer on :5173
```

### Stopping

```sh
docker compose down
```

Sessions are per-launch. coral-server tears down the containers when the session ends or the launcher exits.

---

## 10. Security & Custody Model

1. **coral-server holds no keys.** It is an MCP coordinator only.
2. **Agents hold their own keys** inside their containers, loaded from env vars injected by docker-compose / launcher options.
3. **Harnesses never hold keys.** The seller agent calls the harness adapter for work, but only the seller process signs Solana transactions.
4. **Policy is a choke point** in the buyer agent before every deposit and release.
5. **Escrow references are bound to deliveries** via `sha256`, making every on-chain settlement provably match the work paid for.
6. **Devnet-only by default** — `assertDevnet()` in `solanaConnection()` blocks mainnet RPC unless explicitly allowed.

---

## 11. Why This Separation Matters

Without CoralOS, the repo would have to build:

- A container orchestrator
- A service registry
- A message broker with routing
- Server-side blocking coordination / presence
- Request/response correlation over pub/sub
- A polyglot agent contract
- A human-in-the-loop proxy

With CoralOS, all of that is one MCP endpoint. The repo's own code focuses on:

- **Value:** what the agent sells (`deliverService()`)
- **Market:** how buyers and sellers agree (`market/protocol.ts`)
- **Settlement:** how money moves trust-minimized (`solana/`, escrow programs)
- **Trust:** how deliveries are verified and recorded (`verifier-agent`, `ledger/`, `policy/`)

That is the whole thesis of the integration: **Coral coordinates, Solana settles, the repo owns the economy.**
