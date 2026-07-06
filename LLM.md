# The LLM — Venice AI (and how to switch)

**This kit's agents think with [Venice AI](https://venice.ai)** — OpenAI-compatible, with **free
credits** so the hackathon costs nothing. Set `LLM_PROVIDER=venice` + `VENICE_API_KEY` and you're done
(redeem code in [Set it up](#set-it-up--copypaste) below).

Under the hood the shim is **provider-agnostic**: one file —
[`packages/agent-runtime/src/llm/complete.ts`](packages/agent-runtime/src/llm/complete.ts) — makes a
single `fetch` call (no vendor SDK) and also supports **OpenAI** and **Anthropic**. You flip the whole
market between them with **env vars only — no code change** (and [adding a *new* provider](#change-it-in-code)
is a few lines).

## Where the LLM is used

The LLM is the agent's brain across the loop:

| Where                                                                                          | What it does                                                                                           | Falls back to                                                       |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| **Seller — the delivery**: your [`deliverService()`](examples/txodds/agent/service.ts) | turns a paid request into the thing sold (the default demo: a verified odds read via`analyzeEdge()`) | a**deterministic** delivery — so it never breaks with no key |
| **Seller — bidding** ([`coral-agents/seller-agent`](coral-agents/seller-agent))        | prices a WANT and competes on value                                                                    | a floor-price bid                                                   |
| **Buyer — value** ([`coral-agents/buyer-agent`](coral-agents/buyer-agent))             | reasons about bids and picks a winner                                                                  | cheapest-that-clears                                                |

If there's **no key (or the account is out of credits)**, the call throws and the code uses the
deterministic fallback, so everything still runs — the demo UI shows a **`deterministic`** badge instead
of `LLM` so you can tell.

## The env vars

All live in the repo-root **`.env`** (gitignored - never committed). `.env.example` shows the empty fields.

| Var                   | Meaning                                                                                                                                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `VENICE_API_KEY`    | **Venice AI key — the kit's LLM.** Free credits; OpenAI-compatible. From [venice.ai/settings/api](https://venice.ai/settings/api). |
| `LLM_PROVIDER`      | Which provider:`venice` (recommended), `openai`, or `anthropic`.                                                                   |
| `OPENAI_API_KEY`    | OpenAI key (`sk-...`) — alternative provider.                                                                                         |
| `ANTHROPIC_API_KEY` | Anthropic key (`sk-ant-...`) — alternative provider.                                                                                  |
| `LLM_MODEL`         | Override the model id. Optional (sensible per-provider default otherwise).                                                               |
| `TRACE`             | `1` -> log the chosen provider/model + the raw reply.                                                                                  |

## How the provider is chosen

**Recommended: set `LLM_PROVIDER=venice` explicitly** (it's the kit's LLM). Otherwise
[`pickProvider()`](packages/agent-runtime/src/llm/complete.ts) resolves it in this order:

1. **Explicit** — if `LLM_PROVIDER` is `venice`, `openai`, or `anthropic`, use that.
2. **Auto-detect** — else if `OPENAI_API_KEY` is set use **OpenAI**, else if `VENICE_API_KEY` is set use **Venice**.
3. **Default** — else **Anthropic**.

> Auto-detect prefers `OPENAI_API_KEY` over `VENICE_API_KEY` if you happen to set both, so set
> `LLM_PROVIDER=venice` to be unambiguous.

Default models (override with `LLM_MODEL`): Venice `llama-3.3-70b` — OpenAI `gpt-4o-mini` — Anthropic
`claude-haiku-4-5-20251001`.

Venice code/reasoning models such as `kimi-k2-7-code` work too:

```ini
LLM_PROVIDER=venice
VENICE_API_KEY=...
LLM_MODEL=kimi-k2-7-code
```

Kimi may spend a small completion budget on internal reasoning before emitting `message.content`, so
the runtime automatically raises too-low Venice/Kimi `maxTokens` requests to `1024`. Other providers
and non-Kimi Venice models keep the caller's requested budget.

## Set it up — copy/paste

**Venice AI — the kit's LLM (recommended, free credits):**

```ini
LLM_PROVIDER=venice
VENICE_API_KEY=...
# LLM_MODEL=llama-3.3-70b   # optional override
```

Get a key at [venice.ai/settings/api](https://venice.ai/settings/api). New accounts can redeem code
**`IMPERIAL50`** at the bottom of that page for **$50 in free credits**. (It's a public referral code —
may be per-account, rate-limited, or expire.)

**OpenAI (alternative):**

```ini
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

**Anthropic (alternative):**

```ini
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

**Pin a specific model:**

```ini
LLM_PROVIDER=venice
VENICE_API_KEY=...
LLM_MODEL=llama-3.1-405b
```

## Change it in code

Env vars are the fast path, but everything lives in one file -
[`packages/agent-runtime/src/llm/complete.ts`](packages/agent-runtime/src/llm/complete.ts) - so you can
change the provider **in code** too.

**Override the model per call** (wins over `LLM_MODEL` and the per-provider default):

```ts
import { complete } from '@pay/agent-runtime'

const text = await complete({
  system: 'You are a terse odds analyst.',
  user: prompt,
  model: 'llama-3.3-70b',   // explicit model for this one call
  maxTokens: 256,
})
```

**Add a whole new provider** - four small edits in `complete.ts`:

1. Add it to the union: `export type LlmProvider = 'anthropic' | 'openai' | 'venice' | 'yours'`.
2. Give it a default in `DEFAULT_MODEL`.
3. Teach [`pickProvider()`](packages/agent-runtime/src/llm/complete.ts) to accept it (explicit) and
   auto-detect its key.
4. Dispatch to a `complete*()` in `complete()`.

**If it's OpenAI-compatible** (like Venice), step 4 is a one-liner - reuse the shared request shape:

```ts
async function completeYours(opts: CompleteOpts, model: string, maxTokens: number): Promise<string> {
  const key = process.env.YOURS_API_KEY
  if (!key) throw new Error('YOURS_API_KEY not set')
  return completeOpenAICompatible(opts, model, maxTokens, {
    url: 'https://api.yours.example/v1/chat/completions',
    key,
    label: 'Yours',
  })
}
```

That's exactly how `completeVenice()` is built - it just points `completeOpenAICompatible()` at Venice's
base URL. A provider with a different wire format (like Anthropic's) gets its own `complete*()` instead.

After editing the runtime, **rebuild it** so dependents pick up the change: `cd packages/agent-runtime && npm run build` (the `examples/txodds` `file:` dep reads `dist/`).

## Apply a change

Edit `.env`, then **restart** so it's re-read:

- **Web demo:** restart `npm run dev` (the proxy reads `.env` at startup).
- **CoralOS round:** just re-run `npm run coral` - `coral/round.ts` reads `.env` and passes the keys to
  the agents in the session request, so coral-server launches them with the new provider/key.

## "It says `deterministic`, not `LLM`"

The model didn't return. Almost always the key:

- not set / wrong key (check `VENICE_API_KEY`), or
- **out of credits** — the provider returns a quota/credit error. Redeem Venice's free credits (code
  `IMPERIAL50`, above), swap the key, or switch providers. Then restart.

Run with `TRACE=1` in `.env` to see exactly which provider/model was used and the raw reply.

## Security

Keys live only in `.env` (gitignored). They are **never** committed, logged in full, or sent anywhere
but the provider's API. `.env.example` ships with empty fields; `setup.js` never writes an LLM key.
