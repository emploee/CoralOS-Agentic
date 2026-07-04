# verifier-agent — the independent delivery check

The market's neutral 3rd party, surfaced into the conversation: after a seller DELIVERs, the buyer
hands the payload to this agent (`VERIFY round=<n> sha=<hash> service=<s> arg=<a> payload=<raw>`)
and **gates escrow release on the reply** (`VERIFIED round=<n> verdict=pass|fail reason="…"`). It
holds no keys and moves no funds — it is the arbiter program's 3rd-signer role expressed as an
agent verdict.

Deterministic checks decide first (they cannot be prompt-injected):

1. **content hash** — the payload must hash to the sha the buyer received; payment binds to *that*
   artifact (the same sha256 convention as the run ledger and the escrow `reference`).
2. **structure** — the payload must be JSON and not a top-level `{"error": …}` report.

Only then does the optional LLM acceptance judge get a say (does the payload plausibly fulfil
`service`/`arg`?); if the model is unavailable, the deterministic checks stand. Same
propose-vs-enforce split as the seller's bidder.

## Files

| File | Role |
|---|---|
| `src/index.ts` | Coral loop: VERIFY in → VERIFIED out |
| `src/verify.ts` | `checkDelivery()` — pure, LLM-injectable, unit-tested |

## Env

`AGENT_NAME` (default `verifier-agent`), plus an LLM key for the acceptance judge — the kit's LLM
is **Venice AI** (`VENICE_API_KEY`; `LLM_PROVIDER` also accepts `openai`/`anthropic`, see
[/LLM.md](../../LLM.md)). Works with no key at all (deterministic checks only).

Buyer-side: set `VERIFIER_AGENT=verifier-agent` so the buyer includes it in the session thread and
gates release on its verdict (no verdict in time → funds stay in escrow, refundable after the
deadline). CoralOS manifest docs: [/CORAL.md](../../CORAL.md).
