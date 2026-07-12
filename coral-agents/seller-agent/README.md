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
| `src/service.ts` | Service delivery for `txline`, `risk-policy`, `fan-card`, and `freelance`. |

## Harness Adapter

Bidding and delivery use `@pay/harness-runtime`.

| Harness | Description |
|---|---|
| `node-llm` | In-process default around seller service logic. |
| `claude-code` | Headless Claude Code in an isolated workdir. |
| `cli` | Generic subprocess harness defined by `HARNESS_CMD`. |

Harnesses produce quotes, events, and hash-bound delivery artifacts. The seller process keeps wallet and escrow authority.

## Bid Decision Loop

`decideBid()` (`@pay/harness-runtime`'s `quote.ts`) runs a bounded tool-calling loop
(`runToolLoop`, capped at 4 rounds) instead of a single LLM call: the model calls `clamp_price` to
see its proposed price clamped into `[floor, budget]`, then must call `submit_bid_decision` to
terminate. Code re-clamps the final price into `[floor, budget]` regardless of what the loop
reports — the tool call is an auditable step, not the enforcement itself. If the loop errors or
exhausts its rounds without deciding, the seller falls back to a floor bid, same as an LLM outage.

Before pricing even runs, `decideBidGate()` (`bid-gate.ts`) decides *whether to bid at all* — not
just the capability/floor guards `decideBid()` already has, but a strategic pass over the seller's
own track record via `REPUTATION_URL`. It's a genuine no-op (no LLM/fetch call) until
`REPUTATION_URL` is configured, and fails open (bids anyway) on any error, same philosophy as the
adversarial reviewer below. Set `REPUTATION_URL` to enable it.

Set `BID_REVIEW_ENABLED=1` to add a second, independently-prompted adversarial loop
(`reviewBid()` in `bid-review.ts`) that reviews the proposed bid — with no access to the first
loop's transcript — and can veto it before it's posted. Off by default: it doubles the LLM calls
per bid decision. See `docs/AGENT_DEPTH_PLAN.md` for the full design rationale.

## Optional Upstream Procurement

Set `PROCURE_RAIL=x402` to have the seller buy an upstream resource for real, paid over x402, after
escrow is funded and before delivery — the seller is a buyer too, in the same round it's getting paid
in (see `docs/PAYMENT_RAIL_INTEGRATION.md` for the full picture). The seller posts:

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
| `SERVICES` | Comma-separated supported services. Current coded services are `txline`, `risk-policy`, `fan-card`, and `freelance`. |
| `FLOOR_SOL` | Minimum bid. |
| `PERSONA` | Persona label/config. |
| `BID_REVIEW_ENABLED` | Set to `1` to run a second, adversarial review loop before posting a bid — see above. |
| `REPUTATION_URL` | The feed's `/api/reputation` — when set, gates whether this seller bids at all based on its own track record. See Bid Decision Loop above. |
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
