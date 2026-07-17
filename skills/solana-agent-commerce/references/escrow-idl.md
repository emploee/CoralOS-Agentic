# Escrow IDL and Client

**Not used by the default coral-agents flow** — `buyer-agent`/`seller-agent` settle over x402
directly (see `references/market-protocol.md`). These programs remain deployed to devnet and are a
real, working building block for a fork that wants conditional/delayed release instead of x402's
direct-and-final payment.

Two Anchor programs, both deployed to devnet, both under `examples/txodds/escrow/`:

| Program | Path | Devnet ID | Role |
|---|---|---|---|
| Escrow | `programs/escrow/src/lib.rs` | `R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet` | Per-order SOL/SPL escrow PDA — `initialize`/`release`/`refund` (+ `_spl` variants). |
| Arbiter | `programs/arbiter/src/lib.rs` | `FJtuVXsyXuRKqgJBEPAXmktkd13CqStapgevzGwYktXd` | Vault-as-buyer wrapper — makes a neutral arbiter key the only signer able to release/refund. |

Client: `examples/txodds/escrow/client/escrow.ts` (`deposit`/`release`/`refund`, `depositSpl`/`releaseSpl`/`refundSpl`). Tests: `examples/txodds/escrow/tests/escrow.ts`, run against the live devnet programs (not a local validator).

An arbiter TypeScript client (IDL-backed, since the arbiter program has no on-chain IDL account and
can't `Program.fetchIdl` the way the escrow client does) would need to be hand-rolled from
`programs/arbiter/src/lib.rs`'s instruction shapes if you're re-enabling this path — the client that
used to live at `examples/txodds/agent/arbiter.ts` was removed once nothing in the active codebase
called it (the CoralOS round settles over x402 now, not escrow).

## Two settlement modes (if you re-enable this path)

- **`direct`** — the buyer's own key opens and releases/refunds the base escrow directly. Simplest path, no arbiter dependency, but nothing on-chain stops the buyer from releasing without a verifier passing — a verifier gate here would need to be a policy-layer check (`references/verifier-gate.md` describes the verifier's current, informational role), not a program constraint.
- **`arbiter`** — the payer funds a system-owned vault PDA controlled by the arbiter program; that vault PDA becomes the base escrow's `buyer`. Only the configured arbiter keypair can call `arbitrate_release`/`arbitrate_refund`, which prevents the original payer from unilaterally releasing or refunding once the order is open.

Escrow PDA seed: `[b"escrow", buyer, reference]`. `reference` binds one specific order/delivery to
one specific escrow account — mirror the same non-replayable-reference discipline the current x402
flow uses (`generateReference()`, see `references/market-protocol.md`) if you wire this back in.

## Base escrow interface

| Instruction | Signer | Effect |
|---|---|---|
| `initialize(amount, reference, deadline)` | buyer | Creates the PDA, deposits `amount`. |
| `release()` | buyer (or the vault PDA, under arbiter mode) | Transfers to `seller`, closes the account. |
| `refund()` | buyer, only after `deadline` | Returns the balance to `buyer`. |

Program-side security properties worth preserving in any change: `init` (never `init_if_needed`), per-order PDA seeds, `Signer` requirements, `has_one` constraints binding buyer/seller roles, `close = buyer`, checked arithmetic on lamport movement, and an explicit deadline check for refunds. The arbiter is a trusted single-key authority in this demo — it is not itself a multisig or a DAO.

SPL settlement (`initialize_spl`/`release_spl`/`refund_spl`, plus the arbiter's `open_spl`/`arbitrate_release_spl`/`arbitrate_refund_spl`, via `anchor-spl`'s `transfer_checked`) is deployed to both live devnet programs and passing the `escrow spl (devnet)` suite in `tests/escrow.ts`. It is **not yet** folded into `packages/payment-runtime/src/rails/escrow.ts` — that `PaymentRail`-shaped wrapper still only wires the SOL client into the interface; the SPL client functions are called directly by whoever needs them today. Promoting SPL escrow into the `PaymentRail` interface means extending that wrapper, not the Anchor program (the program side is already done).

## When changing escrow behavior

- Update the program and the TypeScript client together — `client/escrow.ts`'s account/instruction shapes must track `lib.rs`.
- Add tests under `examples/txodds/escrow/tests`, and run them against the deployed devnet programs, not a local validator: `declare_id!` in each `lib.rs` is fixed to the addresses above, and the original deploy keypairs were never committed.
- **Never run `anchor keys sync`** against this workspace. A fresh `anchor build` generates *new random* keypairs under `target/deploy/` (gitignored, none exist locally), and `anchor keys sync` would rewrite `declare_id!` to match those — pointing the code at addresses that were never deployed. This has bitten the repo before. Upgrades use the **upgrade authority** keypair plus `solana program deploy --program-id <fixed-id>` (`BPFLoaderUpgradeable` doesn't need the original program keypair for upgrades).
- If the escrow program's on-chain IDL changes, refresh it separately from the binary (`anchor idl upgrade ... --filepath target/idl/escrow.json`) — it's a distinct account from the program binary. The arbiter's bundled `arbiter_idl.json` has no on-chain equivalent, so it just needs a manual copy from `target/idl/arbiter.json` after a rebuild.
- Keep buyer, seller, reference, vault, and arbiter roles explicit in both the program's `has_one` constraints and the client's function signatures.
- Preserve devnet/localnet defaults for examples; never point at mainnet without explicit user approval (`packages/agent-runtime/src/solana/connection.ts`'s devnet guard, `ALLOW_MAINNET=1` to override).

See `examples/txodds/escrow/contract_extension.md` for CPI extension patterns, and `examples/txodds/escrow/README.md` for the full build/deploy runbook.
