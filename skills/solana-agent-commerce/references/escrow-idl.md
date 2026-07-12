# Escrow IDL and Client

Two Anchor programs, both deployed to devnet, both under `examples/txodds/escrow/`:

| Program | Path | Devnet ID | Role |
|---|---|---|---|
| Escrow | `programs/escrow/src/lib.rs` | `R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet` | Per-order SOL/SPL escrow PDA — `initialize`/`release`/`refund` (+ `_spl` variants). |
| Arbiter | `programs/arbiter/src/lib.rs` | `FJtuVXsyXuRKqgJBEPAXmktkd13CqStapgevzGwYktXd` | Vault-as-buyer wrapper — makes a neutral arbiter key the only signer able to release/refund. |

Client: `examples/txodds/escrow/client/escrow.ts` (`deposit`/`release`/`refund`, `depositSpl`/`releaseSpl`/`refundSpl`). Tests: `examples/txodds/escrow/tests/escrow.ts`, run against the live devnet programs (not a local validator).

The arbiter's TypeScript client actually used by the CoralOS round and the TxODDS proxy lives separately at `examples/txodds/agent/arbiter.ts`, backed by a bundled `examples/txodds/agent/arbiter_idl.json` — the arbiter program has no on-chain IDL account, so it can't `Program.fetchIdl` the way the escrow client does.

## Two settlement modes

- **`direct`** (`SETTLEMENT_MODE=direct`) — the buyer's own key opens and releases/refunds the base escrow directly. Simplest path, no arbiter dependency, but nothing on-chain stops the buyer from releasing without a verifier passing — the verifier gate is a policy-layer check (`references/verifier-gate.md`), not a program constraint, in this mode.
- **`arbiter`** (default) — the payer funds a system-owned vault PDA controlled by the arbiter program; that vault PDA becomes the base escrow's `buyer`. Only the configured `ARBITER_KEYPAIR_B58` can call `arbitrate_release`/`arbitrate_refund`, which prevents the original payer from unilaterally releasing or refunding once the order is open. This is what CoralOS rounds use by default, and it's the on-chain backing for the verifier gate.

Escrow PDA seed: `[b"escrow", buyer, reference]`. `reference` is the same value carried in the market's `ESCROW_REQUIRED`/`DEPOSITED` messages (`references/market-protocol.md`) — it binds one specific order/delivery to one specific escrow account, and the seller derives its expected reference deterministically (`boundReference()` in `coral-agents/seller-agent/src/index.ts`) so it can't be replayed across rounds.

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
