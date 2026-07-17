# Examples

`examples/txodds` is the repo's one first-class, actively maintained example — put new example code
here unless there's a strong reason for a new top-level example directory. It covers both the
single-agent web flow (no CoralOS required, `agent/service.ts`'s `deliverService()`) and the
multi-agent CoralOS round (`coral/round.ts`, `feed/` for the live session reader/run ledger,
`escrow/` for the Anchor programs).

For the multi-agent round, `coral/README.md` documents the exact wire trace for a live run (buyer
and seller bidding on `service=txline`, through award, x402 payment, delivery, and verification) —
read it alongside `SKILL.md`'s end-to-end walkthrough before changing round behavior; the two should
always describe the same sequence.

Run it: `docker compose up -d coral && bash build-agents.sh` from the repo root, then
`npm run coral` from `examples/txodds`. `round.ts` reads a live fixture id from the proxy's
`/api/board` when available.

Suggested extensions:

- x402 research seller: seller pays an upstream x402 API before delivering, verifier checks the report.
- x402 service seller: external HTTP caller receives `402`, pays, retries with proof, receives `deliverService` output.
- USDC settlement: same round lifecycle using stablecoin payment instead of native SOL.
- Escrow-backed round: swap the primary settlement leg back to the deployed escrow/arbiter programs (`examples/txodds/escrow`) for conditional/delayed release instead of x402's direct-and-final payment.

Every example should include a README, a runnable command, and at least one focused test when practical.
