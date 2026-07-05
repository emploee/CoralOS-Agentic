# Escrow IDL

Escrow program and client references:

- `examples/txodds/escrow/programs/escrow/src/lib.rs`
- `examples/txodds/escrow/client/escrow.ts`
- `examples/txodds/agent/arbiter_idl.json`

When changing escrow behavior:

- Update the program and client together.
- Add tests under `examples/txodds/escrow/tests`.
- Keep buyer, seller, reference, vault, and arbiter roles explicit.
- Preserve devnet/localnet defaults for examples.
