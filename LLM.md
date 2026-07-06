# LLM Provider Configuration

The shared LLM integration lives in `packages/agent-runtime/src/llm/complete.ts`. It exposes one SDK-free `complete()` function over `fetch` and supports Venice, OpenAI, and Anthropic through environment configuration.

LLM calls are used for seller delivery, bid pricing, buyer award reasoning, verifier acceptance checks, and small example-specific summaries. Several paths have deterministic fallbacks so the demos can still run when no provider key is configured.

## Environment Variables

Store provider keys in the repo-root `.env`, which is gitignored.

| Variable | Description |
|---|---|
| `LLM_PROVIDER` | `venice`, `openai`, or `anthropic`. Set explicitly when more than one provider key exists. |
| `VENICE_API_KEY` | Venice API key. Venice uses an OpenAI-compatible chat completion shape. |
| `OPENAI_API_KEY` | OpenAI API key. |
| `ANTHROPIC_API_KEY` | Anthropic API key. |
| `LLM_MODEL` | Optional model override. |
| `TRACE` | Set to `1` to log provider/model selection and raw replies. |

Recommended explicit configuration:

```ini
LLM_PROVIDER=venice
VENICE_API_KEY=...
# LLM_MODEL=llama-3.3-70b
```

Alternative providers:

```ini
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

```ini
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

## Provider Selection

`pickProvider()` resolves the provider in this order:

1. If `LLM_PROVIDER` is set to `venice`, `openai`, or `anthropic`, use it.
2. Otherwise, if `OPENAI_API_KEY` exists, use OpenAI.
3. Otherwise, if `VENICE_API_KEY` exists, use Venice.
4. Otherwise, use Anthropic and let the call fail if no Anthropic key is configured.

If multiple keys are set, configure `LLM_PROVIDER` explicitly.

## Default Models

| Provider | Default model |
|---|---|
| Venice | `llama-3.3-70b` |
| OpenAI | `gpt-4o-mini` |
| Anthropic | `claude-haiku-4-5-20251001` |

`LLM_MODEL` overrides the default. Venice code/reasoning models such as `kimi-k2-7-code` are supported:

```ini
LLM_PROVIDER=venice
VENICE_API_KEY=...
LLM_MODEL=kimi-k2-7-code
```

For Venice Kimi models, the runtime raises very small `maxTokens` requests to `1024` because those models may spend part of the budget before emitting `message.content`. Other providers and non-Kimi Venice models keep the caller's requested budget.

## Call Site Example

```ts
import { complete } from '@pay/agent-runtime'

const text = await complete({
  system: 'Return one concise technical sentence.',
  user: 'Summarize this paid API result.',
  model: 'llama-3.3-70b',
  maxTokens: 256,
})
```

A per-call `model` value wins over `LLM_MODEL` and provider defaults.

## Adding a Provider

All provider wiring is in `packages/agent-runtime/src/llm/complete.ts`:

1. Add the provider to `LlmProvider`.
2. Add a default model.
3. Update `pickProvider()`.
4. Add a `complete*()` implementation and dispatch from `complete()`.

For OpenAI-compatible providers, reuse the shared request helper:

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

After runtime edits:

```sh
cd packages/agent-runtime
npm run build
```

Local `file:` dependents read the built `dist/` output.

## Restart Requirements

Restart processes after changing `.env`:

| Process | Restart |
|---|---|
| TxODDS web demo | Restart `npm run dev`. |
| CoralOS round | Re-run the launcher; it forwards `.env` values to agent options. |
| Agent-economy bridge | Restart the bridge container/process. |

## Fallback Behavior

When a provider key is absent, invalid, rate-limited, or exhausted, callers either surface the error or use a deterministic fallback depending on the flow. TxODDS UI output labels deterministic reads separately from live LLM reads.

Use `TRACE=1` when diagnosing provider/model selection.

## Security

Provider keys must stay in `.env` or deployment secrets. Do not commit provider keys, log them in full, or pass them to harness processes unless a specific harness requires model access and the risk is reviewed.
