# seller-agent

The seller agent bids on supported `WANT` messages, requests escrow funding after an award, verifies the funded escrow, runs a harness adapter, and posts a delivered payload.

## Flow

```text
WANT service=<service> arg=<arg>
  -> BID price=<sol> by=<agent>
  -> AWARD to=<agent>
  -> ESCROW_REQUIRED settlement=arbiter reference=<bound order>
  -> funded escrow verification
  -> optional PAYMENT_REQUIRED / PAYMENT_PROOF / PAYMENT_CONFIRMED
  -> DELIVERED payload=<json>
```

In arbiter mode, the seller verifies the escrow buyer as the vault PDA from `DEPOSITED`, not the original payer wallet.

## Files

| File | Role |
|---|---|
| `src/index.ts` | Coral market loop and funding verification. |
| `src/escrow.ts` | Read-only escrow funding check. |
| `src/service.ts` | Service delivery for `txline` and `freelance`. |

## Harness Adapter

Bidding and delivery use `@pay/harness-runtime`.

| Harness | Description |
|---|---|
| `node-llm` | In-process default around seller service logic. |
| `claude-code` | Headless Claude Code in an isolated workdir. |
| `cli` | Generic subprocess harness defined by `HARNESS_CMD`. |

Harnesses produce quotes, events, and hash-bound delivery artifacts. The seller process keeps wallet and escrow authority.

## Bid Decision Loop

`decideBid()` (`@pay/harness-runtime`'s `quote.ts`) runs ONE bounded tool-calling loop
(`runToolLoop`, capped at 4 rounds, 6 when `REPUTATION_URL` is set — see below) instead of a single
LLM call: the model calls `clamp_price` to see its proposed price clamped into `[floor, budget]`,
then must call `submit_bid_decision` to terminate — declining is just `{"bid": false, ...}` on that
same call, not a separate step. Code re-clamps the final price into `[floor, budget]` regardless of
what the loop reports — the tool call is an auditable step, not the enforcement itself. If the loop
errors or exhausts its rounds without deciding, the seller falls back to a floor bid, same as an LLM
outage.

The floor itself is derived, not one flat number for every service (`cost.ts`'s `deriveFloorSol()`).
`FLOOR_SOL` is the base business floor for a deterministic (cache-hit) service; for a service listed
in `LLM_DELIVERY_TOKENS`, the real estimated cost of the LLM call the delivery code will actually
make (from the configured provider/model's per-token price — see `@pay/agent-runtime`'s
`llm/pricing.ts`) is added on top, so a heavier LLM-backed service prices structurally higher than a
cheap fetch, the same way it costs more to deliver.

When `REPUTATION_URL` is set, the same loop gains two more tools: `fetch_own_reputation` (this
seller's own track record — is this round worth pursuing at all?) and `fetch_clearing_prices` (what
`want.service` has actually cleared for recently across all sellers, so pricing isn't a blind guess
between floor and budget). Whether to bid and at what price used to be two separate LLM round-trips;
they're folded into one now, since it's the same seller reasoning sequentially with no reason to keep
them apart. `STRATEGY` shapes how the model is told to use the clearing data: `undercut` (price
at/below the recent median to win volume), `premium` (price near the top of the range or near
budget), or `balanced` (default — track the median). All of this is a no-op without
`REPUTATION_URL` — there's no reputation or clearing data to act on, and it fails open (bids anyway)
on any fetch error.

Set `BID_REVIEW_ENABLED=1` to add a second, independently-prompted adversarial loop
(`reviewBid()` in `bid-review.ts`) that reviews the proposed bid — with no access to the first
loop's transcript — and can veto it before it's posted. This one *does* stay a separate call: its
whole point is judging the first loop's output with no visibility into its reasoning, which the
merge above doesn't apply to. Off by default: it doubles the LLM calls per bid decision. See `API.md`
for the harness-runtime environment reference.

## Optional Upstream Procurement

Set `PROCURE_RAIL=x402` to have the seller buy an upstream resource for real, paid over x402, after
escrow is funded and before delivery — the seller is a buyer too, in the same round it's getting paid
in (see `API.md`'s x402 section for the full picture). The seller posts:

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
| `SERVICES` | Comma-separated supported services. Current coded services are `txline` and `freelance`. |
| `FLOOR_SOL` | Base business floor in SOL for a deterministic service; the real floor for an `LLM_DELIVERY_TOKENS`-listed service adds a derived surcharge on top — see Bid Decision Loop above. |
| `LLM_DELIVERY_TOKENS` | JSON map of service → max_tokens, e.g. `{"txline":260}` — services this seller's delivery code actually calls an LLM for, so that service's floor is derived from real cost instead of `FLOOR_SOL` alone. |
| `PERSONA` | Persona label/config. |
| `STRATEGY` | Pricing posture once `REPUTATION_URL` clearing data is available: `undercut` \| `premium` \| `balanced` (default). No-op without `REPUTATION_URL`. |
| `BID_REVIEW_ENABLED` | Set to `1` to run a second, adversarial review loop before posting a bid — see above. |
| `REPUTATION_URL` | The feed's `/api/reputation` — when set, gates whether this seller bids at all based on its own track record, and feeds clearing-price awareness into pricing. See Bid Decision Loop above. |
| `SETTLEMENT_MODE` | `arbiter` or `direct`. |
| `ESCROW_DEADLINE_SECS` | Escrow deadline. |
| `SOLANA_RPC_URL` | Devnet by default. |
| `TXLINE_API_KEY` | TxODDS token for TxLINE service. |
| `PROCURE_RAIL` | Set to `x402` to enable optional upstream procurement — see above. |
| `HARNESS` | Harness adapter, default `node-llm`. |
| `HARNESS_CMD` | CLI harness command when `HARNESS=cli`. |
| `LLM_PROVIDER` and provider key | Optional analysis/pricing. |

Without a live LLM provider, `service.ts` can return deterministic analysis output where supported.

## Tests

```sh
npm install
npm run typecheck
npm test
```
