# LLM Provider Configuration

`packages/agent-runtime/src/llm/complete.ts` exposes one SDK-free `complete()` function over `fetch`. Supports Venice, OpenAI, Anthropic, and Groq.

## Which Provider to Use

**Groq is the recommended default for this kit.** It's genuinely free — not a one-time credit grant like Venice's signup bonus, but a renewing per-day/per-minute rate limit, so it doesn't run dry the way Venice credits do. Get a key at [console.groq.com/keys](https://console.groq.com/keys), no card required.

Venice, OpenAI, and Anthropic remain fully supported for anyone with existing keys or who wants a different model — nothing about them changed.

## Environment Variables

| Variable | Description |
|---|---|
| `LLM_PROVIDER` | `groq`, `venice`, `openai`, or `anthropic`. Set explicitly when more than one key exists. |
| `GROQ_API_KEY` | Groq API key — free, renewing rate limit. |
| `VENICE_API_KEY` | Venice API key — free signup credits, one-time (can run out). |
| `OPENAI_API_KEY` | OpenAI API key. |
| `ANTHROPIC_API_KEY` | Anthropic API key. |
| `LLM_MODEL` | Optional model override. |
| `TRACE` | Set to `1` to log provider/model selection and raw replies. |

```ini
# .env (gitignored)
LLM_PROVIDER=groq
GROQ_API_KEY=...
```

## Provider Selection

`pickProvider()` resolves in order:

1. `LLM_PROVIDER` set explicitly → use it.
2. `OPENAI_API_KEY` exists → OpenAI.
3. `VENICE_API_KEY` exists → Venice.
4. `GROQ_API_KEY` exists → Groq.
5. Fallback → Anthropic (fails if no key).

Auto-detection is a convenience for having exactly one key set; if you have both `VENICE_API_KEY` and `GROQ_API_KEY` in `.env` (e.g. switching over after Venice ran out), set `LLM_PROVIDER=groq` explicitly rather than relying on priority order.

## Default Models

| Provider | Default Model |
|---|---|
| Groq | `llama-3.3-70b-versatile` |
| Venice | `llama-3.3-70b` |
| OpenAI | `gpt-4o-mini` |
| Anthropic | `claude-haiku-4-5-20251001` |

Override with `LLM_MODEL`:

```ini
LLM_PROVIDER=groq
GROQ_API_KEY=...
LLM_MODEL=llama-3.3-70b-versatile
```

Venice Kimi models: the runtime raises `maxTokens` requests below `1024` to `1024` (Kimi may consume budget on reasoning before emitting content). Groq has no equivalent quirk.

## Usage

```ts
import { complete } from '@pay/agent-runtime'

const text = await complete({
  system: 'Return one concise technical sentence.',
  user: 'Summarize this paid API result.',
  model: 'llama-3.3-70b',    // optional — overrides LLM_MODEL and provider default
  maxTokens: 256,
})
```

## Decision Points

| Decision | File | How LLM Output Is Used |
|---|---|---|
| Seller bid pricing | `packages/harness-runtime/src/quote.ts` | Bounded tool-calling loop (`runToolLoop`, max 4 rounds). Price re-clamped into `[floor, budget]` by code. |
| Buyer award pick | `coral-agents/buyer-agent/src/index.ts` | Single call, falls back to cheapest bid. Must name a seller from the actual bid pool. |
| Verifier acceptance | `coral-agents/verifier-agent/src/verify.ts` | Deterministic checks (hash, structure) run first. LLM only consulted if those pass. |

Every decision follows **propose → enforce**: the model proposes, deterministic code clamps/validates.

### Bid Review (Optional)

Set `BID_REVIEW_ENABLED=1` on the seller to add a second, independently-prompted loop that can veto a proposed bid. The reviewer has no visibility into the first loop's reasoning.

```toml
# coral-agents/seller-agent/coral-agent.toml
[agent.env]
BID_REVIEW_ENABLED = "1"
```

## Safety

| Mechanism | File | Purpose |
|---|---|---|
| `BudgetGuard` | `packages/agent-runtime/src/agent/safety.ts` | Caps tool calls, spend, wall-clock duration per agent process. |
| `StepCounter` | `packages/agent-runtime/src/agent/safety.ts` | Caps consecutive loop iterations. |
| `wrapUntrusted()` | `packages/agent-runtime/src/agent/safety.ts` | Delimits external text before re-entering a prompt. |
| Policy enforcement | `packages/agent-runtime/src/policy/` | Gates fund-moving actions independently of LLM output. |

## Audit Trail

Every LLM-backed decision emits an `LlmUse` record into the run ledger:

```ts
{
  round: 1,
  agent: 'seller-agent',
  purpose: 'bid-decision',
  status: 'ok',
  provider: 'venice',
  model: 'llama-3.3-70b',
  inputHash: 'sha256:...',
  outputHash: 'sha256:...',
  affectedFunds: false,          // always false — fund-moving is policy-gated
}
```

## Fallback Behavior

When a provider key is absent, invalid, rate-limited, or exhausted, callers either surface the error or use a deterministic fallback. TxODDS UI labels deterministic reads separately from LLM reads.

## Groq Free Tier

No credit card, no expiring credit pool — a renewing rate limit instead. Limits vary by model; roughly, at time of writing:

| Model | Requests/day | Tokens/minute |
|---|---|---|
| `llama-3.3-70b-versatile` (default) | 14,400 | 6,000 |
| `groq/compound` | 250 | 70,000 |

Check [console.groq.com](https://console.groq.com) for current limits per model — Groq adjusts these. If you're hitting the per-minute token cap in a tight bid/verify loop, either switch to a lighter-limit model via `LLM_MODEL`, or fall back to another configured provider for that run.

## Adding a Provider

All wiring is in `packages/agent-runtime/src/llm/complete.ts`. `completeGroq()` there is a real, working example of the pattern below — copy it.

1. Add the provider to `LlmProvider`.
2. Add a default model.
3. Update `pickProvider()`.
4. Add a `complete*()` implementation and dispatch from `complete()`.

For OpenAI-compatible providers:

```ts
async function completeCustom(opts: CompleteOpts, model: string, maxTokens: number): Promise<string> {
  const key = process.env.CUSTOM_API_KEY
  if (!key) throw new Error('CUSTOM_API_KEY not set')
  return completeOpenAICompatible(opts, model, maxTokens, {
    url: 'https://api.example.com/v1/chat/completions',
    key,
    label: 'Custom',
  })
}
```

After changes:

```sh
cd packages/agent-runtime && npm run build
```

## Restart Requirements

Restart processes after changing `.env`:

| Process | Restart |
|---|---|
| TxODDS web demo | Restart `npm run dev`. |
| CoralOS round | Re-run the launcher. |

## Security

Provider keys must stay in `.env` or deployment secrets. Do not commit keys, log them, or pass them to harness processes.
