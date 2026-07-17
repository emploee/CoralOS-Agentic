# seller-agent

The seller agent bids on supported `WANT` messages, requests payment after an award, submits and
verifies the buyer's x402 payment, runs a harness adapter, and posts a delivered payload.

## Flow

```text
WANT service=<service> arg=<arg>
  -> BID price=<sol> by=<agent>
  -> AWARD to=<agent>
  -> PAYMENT_REQUIRED rail=x402 reference=<ref> seller=<addr>
  -> PAYMENT_PROOF (buyer's signed-but-unsubmitted transfer)
  -> submit + verify on-chain
  -> PAYMENT_CONFIRMED
  -> optional upstream procurement (PAYMENT_REQUIRED / PAYMENT_PROOF / PAYMENT_CONFIRMED again, x402)
  -> DELIVERED payload=<json>
```

Payment is direct and final: the seller submits the buyer's signed transfer and re-verifies it
on-chain (recipient/amount/reference) before delivering — a submitted transaction is never trusted
on landing alone. There is no escrow to check funding against.

## Files

| File | Role |
|---|---|
| `src/index.ts` | Coral market loop, x402 payment submit/verify, and delivery. |
| `src/service.ts` | Service delivery for `txline` and `sharp-movement`, fully deterministic. |

## Harness Adapter

Bidding and delivery use `@pay/harness-runtime`.

| Harness | Description |
|---|---|
| `in-process` | Default — wraps the seller's `deliverService()` fork point, in this process. |
| `claude-code` | Headless Claude Code in an isolated workdir. |
| `cli` | Generic subprocess harness defined by `HARNESS_CMD`. |

Harnesses produce quotes, events, and hash-bound delivery artifacts. The seller process keeps wallet authority.

## Bid Decision

`decideBid()` (`@pay/harness-runtime`'s `quote.ts`) is fully deterministic: never bid on a service
not carried, never below the persona's cost floor (`FLOOR_SOL`), never above the buyer's budget.

When `REPUTATION_URL` is set, pricing also weighs what `want.service` has actually cleared for
recently across all sellers, instead of always bidding at the floor. `STRATEGY` shapes how that
clearing data is used: `undercut` (price just below the recent median to win volume), `premium`
(price near the top of the recent range), or `balanced` (default — track the median). A no-op
without `REPUTATION_URL` — there's no clearing data to act on, and it falls back to the floor on any
fetch error.

## Sharp-Movement Analysis (opt-in)

Set `SERVICES=txline,sharp-movement` to let this seller also bid on `sharp-movement` WANTs — a report
on a fixture's *current* market state (magnitude/confidence from the leading outcome's spread, plus a
deterministic plain-language read) sold in response to a WANT the research watcher raised because a
real odds move already happened. The seller doesn't re-detect the move itself — by the time the WANT
exists, `examples/txodds/research/watcher.ts` already confirmed one — it just delivers a rich
analysis of the fixture as it stands now. Delivered payload:
`{service, fixtureId, magnitude, confidence, spreadPct, leadingLabel, market, analysis}`.
`leadingLabel` (`part1` | `x` | `part2`) is what `examples/txodds/research/grade.ts` later grades
against the real final score — see `research/GRADING.md`.

Normally paired with `examples/txodds/coral/round.ts`'s `SHARP_MOVEMENT_ENABLED=1`, which sets this
`SERVICES` value automatically and points the buyer's `WANT_FEED_URL` at the watcher's queue instead
of a fixed rotating arg.

## Optional Upstream Procurement

Set `PROCURE_RAIL=x402` to have the seller buy an upstream resource for real, paid over x402, after
it's been paid by the buyer and before delivering — the seller is a buyer too, in the same round it's
getting paid in (see `PAY.md`'s x402 section for the full picture). The seller posts a *second*,
independent x402 leg:

```text
PAYMENT_REQUIRED
PAYMENT_PROOF
PAYMENT_CONFIRMED
```

The txodds feed folds these messages into `proofReceipts` and writes `proof_receipts.json`. This
leg settles for real — no `simulated` flag — so a procurement failure is a genuine failure, not a demo
gap; it never blocks delivery though (the harness has its own fallbacks), it just leaves no receipt.

Variables:

| Variable | Default | Notes |
|---|---|---|
| `PROCURE_X402_URL` | `http://host.docker.internal:8801/api/edge-x402` | The x402-protected resource to buy. Default assumes the txodds proxy (`npm run dev`) is running on the host and reachable from the agent's Docker container via `host.docker.internal`. |
| `SELLER_KEYPAIR_B58` | — | The seller's own *spend* key for this leg — distinct from `SELLER_WALLET`, which only ever receives. Needs devnet SOL funding. Required only when `PROCURE_RAIL=x402`. |

## Environment

| Variable | Description |
|---|---|
| `SELLER_WALLET` | Payout address. |
| `AGENT_NAME` | Agent/persona name. |
| `SERVICES` | Comma-separated supported services. Current coded services are `txline` and `sharp-movement`. |
| `FLOOR_SOL` | Cost floor in SOL — never bid below it. |
| `PERSONA` | Persona label/config. |
| `STRATEGY` | Pricing posture once `REPUTATION_URL` clearing data is available: `undercut` \| `premium` \| `balanced` (default). No-op without `REPUTATION_URL`. |
| `REPUTATION_URL` | The feed's `/api/reputation` — when set, prices against the service's real recent clearing data instead of always bidding at the floor. |
| `SOLANA_RPC_URL` | Devnet by default. |
| `TXLINE_API_KEY` | TxODDS token for TxLINE service. |
| `PROCURE_RAIL` | Set to `x402` to enable optional upstream procurement — see above. |
| `HARNESS` | Harness adapter, default `in-process`. |
| `HARNESS_CMD` | CLI harness command when `HARNESS=cli`. |

## Tests

```sh
npm install
npm run typecheck
npm test
```
