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
anchor keys sync
anchor deploy --provider.cluster devnet
```

Integration tests against a deployed program:

```sh
npm install
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=$HOME/.config/solana/id.json \
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/escrow.ts
```

Windows note: if `anchor build` emits IDL output but does not produce the `.so`, run `cargo build-sbf` from the program folder and copy the artifact into `target/deploy/` before deploy.

## TypeScript Client Pattern

```ts
import { deposit, release } from './client/escrow'

await deposit(program, buyer, sellerPubkey, reference, amountSol, 600)
await release(program, buyer, sellerPubkey, reference)
```

Seller-side delivery should wait until the funded escrow exists, names the seller payout address, and holds at least the awarded amount.

## Extension Notes

- For program-controlled settlement, make the escrow `buyer` a PDA controlled by the wrapper program.
- Keep vault PDAs system-owned if they need to fund the base escrow through system transfers.
- SPL token settlement requires a token-aware program; the current base escrow holds native SOL only.
- New program IDs require `anchor keys sync`, client updates, and test updates.

See `contract_extension.md` for CPI patterns.
