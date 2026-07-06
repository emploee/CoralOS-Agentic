# Building contracts on top of the escrow

This explains, with code, how to extend the agent-economy escrow with **other Solana programs** —
either independent ones that share the workspace, programs that **read** escrow state, or programs
that **control settlement** via CPI (the real "build on top").

It assumes the escrow implementation in [`programs/escrow/src/lib.rs`](programs/escrow/src/lib.rs).

---

## The escrow surface you're building against

Before extending it, know exactly what the program exposes.

**Account (the order):**

```rust
#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub buyer: Pubkey,     // who deposited, who can release/refund, who gets rent back
    pub seller: Pubkey,    // payout destination on release
    pub amount: u64,       // lamports held
    pub reference: Pubkey, // the Solana Pay reference — also the PDA seed
    pub deadline: i64,     // unix ts; refund allowed at/after this
    pub bump: u8,
}
```

**PDA address:** `seeds = [b"escrow", buyer, reference]`, owned by the escrow program.

**Instructions and who must sign:**

| Instruction | Signer required | Effect |
|-------------|-----------------|--------|
| `initialize(amount, reference, deadline)` | `buyer` | creates the PDA, moves `amount` from buyer into it |
| `release()` | `buyer` | pays `seller`, closes the PDA, rent back to buyer |
| `refund()` | `buyer` (and now ≥ `deadline`) | returns everything to buyer |

The single most important fact for extension: **only `buyer` can move the money.** That one rule
shapes every "control it from another contract" design below.

It's also **CPI-ready** — [`programs/escrow/Cargo.toml`](programs/escrow/Cargo.toml) declares
`crate-type = ["cdylib", "lib"]` and a `cpi` feature, so other Rust programs can depend on it and call
its instructions.

---

## Approach 1 — A standalone program in the same workspace

The loosest option: a brand-new program that shares the build/deploy/test tooling but doesn't touch
the escrow. Today this folder is a **single-program** setup (there's no root `Cargo.toml`), so first
turn it into a Cargo workspace.

**`Cargo.toml` (new, at the escrow root):**

```toml
[workspace]
members = ["programs/*"]
resolver = "2"
```

**Add the program folder** `programs/reputation/` with its own `Cargo.toml` + `src/lib.rs`, then
register it in [`Anchor.toml`](Anchor.toml):

```toml
[programs.devnet]
escrow     = "R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet"
reputation = "Rep1111111111111111111111111111111111111111"   # placeholder until `anchor keys sync`
```

```sh
anchor build           # builds every program under programs/*
anchor keys sync       # writes each program's real id into lib.rs + Anchor.toml
anchor deploy --provider.cluster devnet
```

That's it — `anchor build/deploy/test` now operate on both programs. They share the harness, not state.

---

## Approach 2 — Read escrow state (loose coupling)

Any program can read an escrow account, because the fields are public and the address is derivable.
Depend on the escrow crate just to reuse its `Escrow` type (no `cpi` feature needed for reading):

**`programs/reputation/Cargo.toml`:**

```toml
[dependencies]
anchor-lang = "0.32.1"
escrow = { path = "../escrow" }
```

**Reading it in an instruction** — `Account<'info, Escrow>` verifies the account is really owned by
the escrow program, and `seeds::program` checks the address was derived from the escrow's id:

```rust
use anchor_lang::prelude::*;
use escrow::Escrow;
use escrow::program::Escrow as EscrowProgram;

#[derive(Accounts)]
#[instruction(reference: Pubkey)]
pub struct Observe<'info> {
    /// CHECK: the original buyer, only used to derive the escrow PDA
    pub buyer: UncheckedAccount<'info>,

    #[account(
        seeds = [b"escrow", buyer.key().as_ref(), reference.as_ref()],
        bump = order.bump,
        seeds::program = escrow_program.key(),
    )]
    pub order: Account<'info, Escrow>,        // ← deserialized escrow state, read-only

    pub escrow_program: Program<'info, EscrowProgram>,
}
```

Now `order.amount`, `order.deadline`, `order.seller` are yours to score against. A reputation or
analytics program never needs to sign anything.

---

## Approach 3 — Control settlement via CPI (the real extension)

This is how you make a **new contract decide when the seller gets paid** — e.g. an arbiter that
releases only on verified delivery, instead of the buyer just trusting it.

### The constraint, and the pattern that solves it

`release()` requires the **buyer's signature**. A program can't forge a human's signature — but it
*can* sign for a **PDA it owns**. So the trick is:

> Make the escrow's `buyer` a PDA of your controller program. Then your program — and only your
> program, under whatever rules you write — can release or refund, by signing for that PDA.

The end user funds the PDA; the PDA is the escrow's buyer; your program holds the keys to settlement.

> ⚠️ **The vault PDA must stay System-owned.** `initialize` pays rent and moves the deposit with
> System-program transfers, which only work when the source account is owned by the System Program.
> So derive the vault PDA but **never** `init`/`assign` it (don't give it data). It's a pure "SOL
> holding" PDA your program signs for. This is the standard vault pattern.

### Wire up the CPI dependency

**`programs/arbiter/Cargo.toml`:**

```toml
[dependencies]
anchor-lang = "0.32.1"
escrow = { path = "../escrow", features = ["cpi"] }   # ← cpi feature exposes escrow::cpi::*
```

### The controller program

```rust
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

// CPI bindings generated by the escrow crate's `cpi` feature:
use escrow::cpi::accounts::{Initialize as EscrowInit, Release as EscrowRelease};
use escrow::cpi::{initialize as escrow_initialize, release as escrow_release};
use escrow::program::Escrow as EscrowProgram;
use escrow::Escrow as EscrowState;

declare_id!("Arb1ter11111111111111111111111111111111111");

#[program]
pub mod arbiter {
    use super::*;

    /// One-time: record who the arbiter is.
    pub fn init_config(ctx: Context<InitConfig>, arbiter: Pubkey) -> Result<()> {
        ctx.accounts.config.arbiter = arbiter;
        ctx.accounts.config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Open an arbitrated order: fund the vault PDA, then deposit into escrow with the
    /// vault as the escrow's `buyer`.
    pub fn open(ctx: Context<Open>, amount: u64, reference: Pubkey, deadline: i64) -> Result<()> {
        // 1) Move (deposit + escrow rent) from the human payer into the vault PDA.
        let rent = Rent::get()?.minimum_balance(8 + EscrowState::INIT_SPACE);
        let fund = amount.checked_add(rent).ok_or(ArbiterError::Overflow)?;
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                },
            ),
            fund,
        )?;

        // 2) CPI escrow.initialize, signing AS the vault PDA (so it counts as the buyer's signature).
        let bump = ctx.bumps.vault;
        let seeds: &[&[u8]] = &[b"vault", reference.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        escrow_initialize(
            CpiContext::new_with_signer(
                ctx.accounts.escrow_program.to_account_info(),
                EscrowInit {
                    buyer: ctx.accounts.vault.to_account_info(),
                    seller: ctx.accounts.seller.to_account_info(),
                    escrow: ctx.accounts.escrow.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
                signer,
            ),
            amount,
            reference,
            deadline,
        )?;
        Ok(())
    }

    /// The arbiter attests delivery → release to the seller. Only the configured arbiter may call.
    pub fn arbitrate_release(ctx: Context<ArbitrateRelease>, reference: Pubkey) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.arbiter.key(),
            ctx.accounts.config.arbiter,
            ArbiterError::NotArbiter
        );

        let bump = ctx.bumps.vault;
        let seeds: &[&[u8]] = &[b"vault", reference.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        escrow_release(CpiContext::new_with_signer(
            ctx.accounts.escrow_program.to_account_info(),
            EscrowRelease {
                buyer: ctx.accounts.vault.to_account_info(),   // the vault signs as buyer
                seller: ctx.accounts.seller.to_account_info(),
                escrow: ctx.accounts.escrow.to_account_info(),
            },
            signer,
        ))?;
        Ok(())
    }
}
```

### The accounts

```rust
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub arbiter: Pubkey,
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE,
              seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, reference: Pubkey)]
pub struct Open<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,                 // the human/agent funding the order

    /// CHECK: System-owned vault PDA that acts as the escrow's "buyer". Never given data.
    #[account(mut, seeds = [b"vault", reference.as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: payout destination, bound into the escrow at init
    pub seller: UncheckedAccount<'info>,

    /// CHECK: created by the escrow program via CPI; address validated against the escrow id
    #[account(mut,
        seeds = [b"escrow", vault.key().as_ref(), reference.as_ref()],
        bump,
        seeds::program = escrow_program.key())]
    pub escrow: UncheckedAccount<'info>,

    pub escrow_program: Program<'info, EscrowProgram>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(reference: Pubkey)]
pub struct ArbitrateRelease<'info> {
    pub arbiter: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: the vault PDA = the escrow's buyer; we sign for it below
    #[account(mut, seeds = [b"vault", reference.as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: paid by the escrow on release
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,

    /// CHECK: validated + closed by the escrow program
    #[account(mut,
        seeds = [b"escrow", vault.key().as_ref(), reference.as_ref()],
        bump,
        seeds::program = escrow_program.key())]
    pub escrow: UncheckedAccount<'info>,

    pub escrow_program: Program<'info, EscrowProgram>,
}

#[error_code]
pub enum ArbiterError {
    #[msg("Caller is not the configured arbiter")]
    NotArbiter,
    #[msg("Arithmetic overflow")]
    Overflow,
}
```

> **Why this is safe:** signer privileges propagate through CPI. When `open`/`arbitrate_release` call
> the escrow with `new_with_signer`, the escrow program receives the vault **as a signer** and can
> therefore move lamports from it and satisfy the `has_one = buyer` check. No human key is ever needed
> after funding — your rules in `arbitrate_release` are the gate.

Note `arbitrate_release` only adds a *gate*; refund is still possible by having the controller expose
a similar `arbitrate_refund` that CPIs `escrow::cpi::refund` after the deadline. Same vault-signs
pattern.

### Alternative: no source dependency (`declare_program!`)

If you don't want a path dependency on the escrow crate, Anchor can generate the same CPI bindings
from the on-chain IDL. Drop the escrow IDL into `idls/escrow.json` and:

```rust
use anchor_lang::prelude::*;
declare_program!(escrow);            // generates escrow::cpi::*, escrow::accounts::*, escrow::program::*
use escrow::cpi::accounts::Release;  // …then use exactly as above
```

---

## Calling it from TypeScript

Derive both PDAs the same way the programs do, then call your controller:

```ts
import { PublicKey } from '@solana/web3.js'

const ARBITER_ID = new PublicKey('Arb1ter11111111111111111111111111111111111')
const ESCROW_ID  = new PublicKey('R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet')

const [vault]  = PublicKey.findProgramAddressSync(
  [Buffer.from('vault'), reference.toBuffer()], ARBITER_ID)
const [escrow] = PublicKey.findProgramAddressSync(
  [Buffer.from('escrow'), vault.toBuffer(), reference.toBuffer()], ESCROW_ID)

await arbiter.methods.open(new BN(amount), reference, new BN(deadline))
  .accounts({ payer: payer.publicKey, vault, seller, escrow,
              escrowProgram: ESCROW_ID, systemProgram: SystemProgram.programId })
  .signers([payer]).rpc()

// later, the arbiter (off-chain agent) verifies delivery, then:
await arbiter.methods.arbitrateRelease(reference)
  .accounts({ arbiter: arbiterKp.publicKey, config, vault, seller, escrow, escrowProgram: ESCROW_ID })
  .signers([arbiterKp]).rpc()
```

This is also how a marketplace agent would wire it: the buyer-agent deposits through the controller
instead of the escrow directly, and an **arbiter agent** calls `arbitrateRelease` once it confirms the
`DELIVERED` payload actually satisfied the `WANT`.

---

## Gotchas, in one place

1. **Only `buyer` can settle.** To control settlement from a program, the escrow's `buyer` must be a
   PDA your program signs for. There's no other hook.
2. **Keep the vault PDA System-owned** — derive it, fund it, sign for it, but never `init`/`assign`
   it, or the System transfers in `initialize` fail.
3. **The escrow PDA seed uses your vault as the buyer:** `[b"escrow", vault, reference]`. Derive it
   accordingly on both sides.
4. **The deployed escrow's rules are fixed.** You can't add an arbiter to the *existing* program — you
   either wrap it (this doc) or fork/extend `programs/escrow` and redeploy under a new id.
5. **SOL only.** The escrow holds native lamports, not SPL tokens. A token-settled version is a new
   program, not a config change.
6. **Program ids:** new programs get their own ids — run `anchor keys sync` after the first build and
   update `Anchor.toml` + any TS client.

---

## What this unlocks

With the vault-as-buyer pattern you can layer on, without touching the live escrow:

- **Arbiter / oracle release** — pay only on verified delivery (the example above).
- **2-of-3 / multisig release** — require N approvals before `release`.
- **Seller staking + slashing** — sellers bond SOL; the controller slashes on non-delivery.
- **Milestone / streaming payouts** — release in tranches against multiple references.
- **Fee splitter / treasury** — take a protocol cut on the way through.

See [`README.md`](README.md) for the base program and the marketplace's settlement flow.
