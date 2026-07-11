# Escrow Programs

This Anchor workspace contains the SOL escrow and arbiter programs used by the devnet examples.

| Program | Devnet ID | Role |
|---|---|---|
| Escrow | `R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet` | Per-order SOL escrow PDA. |
| Arbiter | `FJtuVXsyXuRKqgJBEPAXmktkd13CqStapgevzGwYktXd` | Vault-as-buyer wrapper for neutral release/refund. |

The TypeScript examples call the deployed devnet programs by default. Rebuild or redeploy only when changing program behavior.

## Workspace

```text
escrow/
  Cargo.toml
  Anchor.toml
  programs/escrow/src/lib.rs
  programs/arbiter/src/lib.rs
  client/escrow.ts
  tests/escrow.ts
  package.json
```

The arbiter TypeScript client used by the TxODDS proxy lives at `../agent/arbiter.ts` and uses the bundled IDL `../agent/arbiter_idl.json`.

## Base Escrow Interface

| Instruction | Signer | Effect |
|---|---|---|
| `initialize(amount, reference, deadline)` | `buyer` | Creates the escrow PDA and deposits `amount` lamports. |
| `release()` | `buyer` | Transfers the escrowed amount to `seller` and closes the account. |
| `refund()` | `buyer` after `deadline` | Returns the escrow balance to `buyer`. |

Escrow PDA seed:

```text
[b"escrow", buyer, reference]
```

The `reference` is the order/delivery binding used by the TypeScript clients and Solana Pay paths.

## Arbiter Wrapper

The arbiter program applies the vault-as-buyer pattern:

1. The payer funds a system-owned vault PDA controlled by the arbiter program.
2. The vault PDA becomes the `buyer` in the base escrow.
3. The configured arbiter signer calls `arbitrate_release` or `arbitrate_refund`.

This prevents the original payer from directly releasing or refunding the base escrow after the arbiter order is opened.

## Security Properties

Program checks include:

- `init`, not `init_if_needed`;
- per-order PDA seeds;
- `Signer` requirements;
- `has_one` constraints for bound buyer and seller roles;
- `close = buyer`;
- checked arithmetic on lamport movement;
- explicit deadline check for refunds.

The arbiter is a trusted single-key authority in this demo implementation.

## Build, Test, Deploy

Prerequisites:

- Rust;
- Solana CLI;
- Anchor 0.32.x.

```sh
cd examples/txodds/escrow
anchor build
```

**Do not run `anchor keys sync`** against this workspace. The programs above are already deployed at fixed devnet addresses (`declare_id!` in each `lib.rs` matches them); the original deploy keypairs were never committed (`target/deploy/*-keypair.json` is gitignored, and a fresh `anchor build` generates *new random* keypairs there since none exist locally). `anchor keys sync` would rewrite `declare_id!` to match those new, wrong local keypairs — pointing the code at addresses that were never deployed. This bit us once already: after a fresh `anchor build`, `target/deploy/escrow-keypair.json` derived to a different pubkey than the live `R5NW...Xet` program (the arbiter one happened to still match).

Upgrading the already-deployed programs only needs the **upgrade authority** keypair (not the original program keypair — that's not required for upgrades under `BPFLoaderUpgradeable`) and the program's public address, both already known:

```sh
solana program deploy --program-id R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet \
  target/deploy/escrow.so --url https://api.devnet.solana.com --keypair ~/.config/solana/id.json

solana program deploy --program-id FJtuVXsyXuRKqgJBEPAXmktkd13CqStapgevzGwYktXd \
  target/deploy/arbiter.so --url https://api.devnet.solana.com --keypair ~/.config/solana/id.json
```

`~/.config/solana/id.json` (the wallet this workspace's `Anchor.toml` `[provider]` section names) is the confirmed upgrade authority for both programs — check with `solana program show <id> --url https://api.devnet.solana.com` before deploying if unsure.

If a client fetches the escrow program's IDL live from chain (`agent/escrow.ts`'s `Program.fetchIdl`), refresh the on-chain IDL account after an upgrade too — it is a separate account from the program binary:

```sh
anchor idl upgrade R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet \
  --filepath target/idl/escrow.json --provider.cluster devnet --provider.wallet ~/.config/solana/id.json
```

The arbiter client (`agent/arbiter.ts`) uses a bundled `arbiter_idl.json` instead of fetching on-chain — no on-chain IDL account exists for it, so `anchor idl upgrade` doesn't apply there; just copy the fresh `target/idl/arbiter.json` over `agent/arbiter_idl.json` after a rebuild.

Integration tests against the deployed programs:

```sh
npm install
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=$HOME/.config/solana/id.json \
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/escrow.ts
```

Windows note: `anchor build` has produced a clean `.so` + IDL for both programs in this environment. If it ever emits IDL output but not the `.so`, run `cargo build-sbf` from the program folder and copy the artifact into `target/deploy/` before deploying.

## TypeScript Client Pattern

```ts
import { deposit, release } from './client/escrow'

await deposit(program, buyer, sellerPubkey, reference, amountSol, 600)
await release(program, buyer, sellerPubkey, reference)
```

SPL-token escrow (a separate `EscrowSpl` account under an `escrow_spl` PDA, `transfer_checked` settlement) uses the same lifecycle:

```ts
import { depositSpl, releaseSpl } from './client/escrow'

await depositSpl(program, buyer, sellerPubkey, mint, reference, amount, 600)
await releaseSpl(program, buyer, sellerPubkey, mint, reference)
```

Seller-side delivery should wait until the funded escrow exists, names the seller payout address, and holds at least the awarded amount (`isFunded`/`isFundedSpl`).

## Extension Notes

- For program-controlled settlement, make the escrow `buyer` a PDA controlled by the wrapper program.
- Keep vault PDAs system-owned if they need to fund the base escrow through system transfers.
- SPL token settlement (`initialize_spl`/`release_spl`/`refund_spl`, plus the arbiter's `open_spl`/`arbitrate_release_spl`/`arbitrate_refund_spl`) is implemented via `anchor-spl`'s `transfer_checked`, deployed to both live devnet programs, and passing the `escrow spl (devnet)` suite in `tests/escrow.ts` against them (deposit→release, wrong-seller rejection, timed refund).
- New program IDs require client and test updates. Do **not** run `anchor keys sync` against the already-deployed programs above — see the Build/Deploy section.

See `contract_extension.md` for CPI patterns.
