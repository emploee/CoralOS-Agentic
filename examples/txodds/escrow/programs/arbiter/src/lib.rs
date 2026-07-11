//! Arbiter - the trusted-neutral wrapper over the escrow (settlement spine).
//!
//! The base escrow is **buyer-released**: only the buyer signs `release`/`refund`, so a buyer could
//! take delivery and refund. This program fixes that asymmetry **without touching the deployed escrow**,
//! using the documented vault-as-buyer pattern (see `../../contract_extension.md`):
//!
//!   - `open`  - the payer funds a **vault PDA** (system-owned, derived from the order `reference`),
//!               then CPIs `escrow.initialize` signing *as the vault*, so the vault is the escrow's buyer.
//!   - the payer now has **no on-chain power** over the funds; only the configured **arbiter** does:
//!   - `arbitrate_release` - the arbiter attests delivery -> CPI `escrow.release` -> the seller is paid.
//!   - `arbitrate_refund`  - after the deadline, the arbiter refunds -> funds swept back to the payer.
//!
//! So the seller is protected (the buyer can't unilaterally refund), and the arbiter is the neutral
//! gate. Trust moves from "the buyer's goodwill" to "a neutral arbiter agent" - still a trusted third
//! party. The demo removes unilateral buyer clawback, but it does not decentralize arbitration.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use escrow::cpi::accounts::{Initialize as EscrowInit, Refund as EscrowRefund, Release as EscrowRelease};
use escrow::cpi::accounts::{InitializeSpl as EscrowInitSpl, ReleaseSpl as EscrowReleaseSpl, RefundSpl as EscrowRefundSpl};
use escrow::cpi::{initialize as escrow_initialize, refund as escrow_refund, release as escrow_release};
use escrow::cpi::{initialize_spl as escrow_initialize_spl, refund_spl as escrow_refund_spl, release_spl as escrow_release_spl};
use escrow::program::Escrow as EscrowProgram;
use escrow::Escrow as EscrowState;
use escrow::EscrowSpl as EscrowSplState;

declare_id!("FJtuVXsyXuRKqgJBEPAXmktkd13CqStapgevzGwYktXd");

#[program]
pub mod arbiter {
    use super::*;

    /// One-time: record who the neutral arbiter is.
    pub fn init_config(ctx: Context<InitConfig>, arbiter: Pubkey) -> Result<()> {
        ctx.accounts.config.arbiter = arbiter;
        ctx.accounts.config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Open an arbitrated order: fund the vault PDA, then deposit into escrow with the vault as the
    /// escrow's `buyer`. The payer cannot later release or refund - only the arbiter can.
    pub fn open(ctx: Context<Open>, amount: u64, reference: Pubkey, deadline: i64) -> Result<()> {
        // 1) Move (deposit + escrow-account rent) from the payer into the vault PDA.
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

    /// The arbiter attests delivery -> release to the seller. Only the configured arbiter may call.
    pub fn arbitrate_release(ctx: Context<ArbitrateRelease>, reference: Pubkey) -> Result<()> {
        require_keys_eq!(ctx.accounts.arbiter.key(), ctx.accounts.config.arbiter, ArbiterError::NotArbiter);
        let bump = ctx.bumps.vault;
        let seeds: &[&[u8]] = &[b"vault", reference.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        escrow_release(CpiContext::new_with_signer(
            ctx.accounts.escrow_program.to_account_info(),
            EscrowRelease {
                buyer: ctx.accounts.vault.to_account_info(), // the vault signs as the escrow's buyer
                seller: ctx.accounts.seller.to_account_info(),
                escrow: ctx.accounts.escrow.to_account_info(),
            },
            signer,
        ))?;
        Ok(())
    }

    /// The arbiter refunds a failed delivery (after the escrow deadline): escrow returns the funds to
    /// the vault, then we sweep the vault back to the original payer.
    pub fn arbitrate_refund(ctx: Context<ArbitrateRefund>, reference: Pubkey) -> Result<()> {
        require_keys_eq!(ctx.accounts.arbiter.key(), ctx.accounts.config.arbiter, ArbiterError::NotArbiter);
        let bump = ctx.bumps.vault;
        let seeds: &[&[u8]] = &[b"vault", reference.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        // 1) escrow.refund -> all funds (deposit + escrow rent) back to the vault (the escrow's buyer).
        escrow_refund(CpiContext::new_with_signer(
            ctx.accounts.escrow_program.to_account_info(),
            EscrowRefund {
                buyer: ctx.accounts.vault.to_account_info(),
                escrow: ctx.accounts.escrow.to_account_info(),
            },
            signer,
        ))?;

        // 2) sweep the vault back to the original payer (the vault is System-owned; it signs via seeds).
        let lamports = ctx.accounts.vault.lamports();
        if lamports > 0 {
            transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.accounts.payer.to_account_info(),
                    },
                    signer,
                ),
                lamports,
            )?;
        }
        Ok(())
    }

    // ── SPL-token parity (additive) ─────────────────────────────────────────────

    /// Open an arbitrated SPL order: fund the vault's rent, move `amount` of `mint` from the payer
    /// into the vault's own ATA, then CPI `escrow.initialize_spl` signing AS the vault — same
    /// vault-as-buyer shape as `open`, just funding an ATA instead of the vault's own lamports.
    pub fn open_spl(ctx: Context<OpenSpl>, amount: u64, reference: Pubkey, deadline: i64) -> Result<()> {
        // 1) Fund the vault with just enough SOL to pay, as `payer`, for the two accounts it will
        //    create via the CPI below (the EscrowSpl state account + its token vault ATA).
        let rent = Rent::get()?;
        let fund = rent
            .minimum_balance(8 + EscrowSplState::INIT_SPACE)
            .checked_add(rent.minimum_balance(TokenAccount::LEN))
            .ok_or(ArbiterError::Overflow)?;
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer { from: ctx.accounts.payer.to_account_info(), to: ctx.accounts.vault.to_account_info() },
            ),
            fund,
        )?;

        // 2) Move the tokens into the vault's own ATA — the vault is about to become the escrow's
        //    "buyer", so it must hold what it deposits.
        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.payer_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault_ata.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        // 3) CPI escrow.initialize_spl, signing AS the vault PDA (so it counts as the buyer's signature).
        let bump = ctx.bumps.vault;
        let seeds: &[&[u8]] = &[b"vault", reference.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        escrow_initialize_spl(
            CpiContext::new_with_signer(
                ctx.accounts.escrow_program.to_account_info(),
                EscrowInitSpl {
                    buyer: ctx.accounts.vault.to_account_info(),
                    seller: ctx.accounts.seller.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    escrow: ctx.accounts.escrow.to_account_info(),
                    buyer_ata: ctx.accounts.vault_ata.to_account_info(),
                    escrow_ata: ctx.accounts.escrow_ata.to_account_info(),
                    token_program: ctx.accounts.token_program.to_account_info(),
                    associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
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

    /// The arbiter attests delivery -> release the SPL escrow to the seller. Only the configured
    /// arbiter may call.
    pub fn arbitrate_release_spl(ctx: Context<ArbitrateReleaseSpl>, reference: Pubkey) -> Result<()> {
        require_keys_eq!(ctx.accounts.arbiter.key(), ctx.accounts.config.arbiter, ArbiterError::NotArbiter);
        let bump = ctx.bumps.vault;
        let seeds: &[&[u8]] = &[b"vault", reference.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];
        escrow_release_spl(CpiContext::new_with_signer(
            ctx.accounts.escrow_program.to_account_info(),
            EscrowReleaseSpl {
                buyer: ctx.accounts.vault.to_account_info(),
                seller: ctx.accounts.seller.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                escrow: ctx.accounts.escrow.to_account_info(),
                escrow_ata: ctx.accounts.escrow_ata.to_account_info(),
                seller_ata: ctx.accounts.seller_ata.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                associated_token_program: ctx.accounts.associated_token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
            },
            signer,
        ))?;
        Ok(())
    }

    /// The arbiter refunds a failed SPL delivery (after the escrow deadline): escrow returns the
    /// tokens to the vault's ATA, then we sweep the tokens to the payer, close the vault's ATA
    /// (rent to payer), and sweep the vault's remaining SOL back to the payer.
    pub fn arbitrate_refund_spl(ctx: Context<ArbitrateRefundSpl>, reference: Pubkey) -> Result<()> {
        require_keys_eq!(ctx.accounts.arbiter.key(), ctx.accounts.config.arbiter, ArbiterError::NotArbiter);
        let amount = ctx.accounts.escrow.amount;
        let decimals = ctx.accounts.mint.decimals;
        let bump = ctx.bumps.vault;
        let seeds: &[&[u8]] = &[b"vault", reference.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        // 1) escrow.refund_spl -> tokens (+ the escrow_ata's rent) land back in the vault's own ATA
        //    (the vault is the escrow's "buyer", so it's `refund_spl`'s `buyer_ata` destination).
        escrow_refund_spl(CpiContext::new_with_signer(
            ctx.accounts.escrow_program.to_account_info(),
            EscrowRefundSpl {
                buyer: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                escrow: ctx.accounts.escrow.to_account_info(),
                escrow_ata: ctx.accounts.escrow_ata.to_account_info(),
                buyer_ata: ctx.accounts.vault_ata.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
            },
            signer,
        ))?;

        // 2) sweep the tokens out of the vault's ATA to the original payer, then close the (now
        //    empty) vault ATA — its rent returns to the vault, alongside what refund_spl returned.
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.payer_ata.to_account_info(),
                    authority: ctx.accounts.vault.to_account_info(),
                },
                signer,
            ),
            amount,
            decimals,
        )?;
        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token::CloseAccount {
                account: ctx.accounts.vault_ata.to_account_info(),
                destination: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            signer,
        ))?;

        // 3) sweep every lamport now sitting in the vault (its own rent + the ATA's rent + the
        //    escrow state's rent, all returned by the two closes above) back to the original payer.
        let lamports = ctx.accounts.vault.lamports();
        if lamports > 0 {
            transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer { from: ctx.accounts.vault.to_account_info(), to: ctx.accounts.payer.to_account_info() },
                    signer,
                ),
                lamports,
            )?;
        }
        Ok(())
    }
}

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
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, reference: Pubkey)]
pub struct Open<'info> {
    #[account(mut)]
    pub payer: Signer<'info>, // the human/agent funding the order

    /// CHECK: System-owned vault PDA that acts as the escrow's "buyer". Never given data.
    #[account(mut, seeds = [b"vault", reference.as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: payout destination, bound into the escrow at init
    pub seller: UncheckedAccount<'info>,

    /// CHECK: created by the escrow program via CPI; address validated against the escrow id
    #[account(
        mut,
        seeds = [b"escrow", vault.key().as_ref(), reference.as_ref()],
        bump,
        seeds::program = escrow_program.key()
    )]
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
    #[account(
        mut,
        seeds = [b"escrow", vault.key().as_ref(), reference.as_ref()],
        bump,
        seeds::program = escrow_program.key()
    )]
    pub escrow: UncheckedAccount<'info>,

    pub escrow_program: Program<'info, EscrowProgram>,
}

#[derive(Accounts)]
#[instruction(reference: Pubkey)]
pub struct ArbitrateRefund<'info> {
    pub arbiter: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    /// CHECK: the vault PDA = the escrow's buyer; we sign for it below
    #[account(mut, seeds = [b"vault", reference.as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: the original payer - receives the swept refund
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,

    /// CHECK: validated + closed by the escrow program
    #[account(
        mut,
        seeds = [b"escrow", vault.key().as_ref(), reference.as_ref()],
        bump,
        seeds::program = escrow_program.key()
    )]
    pub escrow: UncheckedAccount<'info>,

    pub escrow_program: Program<'info, EscrowProgram>,
    pub system_program: Program<'info, System>,
}

// ── SPL-token parity accounts (additive) ────────────────────────────────────────

#[derive(Accounts)]
#[instruction(amount: u64, reference: Pubkey)]
pub struct OpenSpl<'info> {
    #[account(mut)]
    pub payer: Signer<'info>, // the human/agent funding the order

    pub mint: Box<Account<'info, Mint>>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = payer)]
    pub payer_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: System-owned vault PDA that acts as the escrow's "buyer". Never given data.
    #[account(mut, seeds = [b"vault", reference.as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,

    /// The vault's own token account — funded from `payer_ata`, then deposited into `escrow_ata` by
    /// the CPI'd `initialize_spl` (the vault is the escrow's "buyer", so it needs a `buyer_ata`).
    #[account(init, payer = payer, associated_token::mint = mint, associated_token::authority = vault)]
    pub vault_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: payout destination, bound into the escrow at init
    pub seller: UncheckedAccount<'info>,

    /// CHECK: created by the escrow program via CPI; address validated against the escrow id
    #[account(
        mut,
        seeds = [b"escrow_spl", vault.key().as_ref(), reference.as_ref()],
        bump,
        seeds::program = escrow_program.key()
    )]
    pub escrow: UncheckedAccount<'info>,

    /// CHECK: the escrow's token vault, created by the CPI'd `initialize_spl` (owner = escrow PDA above).
    #[account(mut)]
    pub escrow_ata: UncheckedAccount<'info>,

    pub escrow_program: Program<'info, EscrowProgram>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(reference: Pubkey)]
pub struct ArbitrateReleaseSpl<'info> {
    // mut: unlike the SOL-side ArbitrateRelease, this arbiter is also the payer for a first-time
    // seller's associated token account (init_if_needed below), so it must be debitable for rent.
    #[account(mut)]
    pub arbiter: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    pub mint: Box<Account<'info, Mint>>,

    /// CHECK: the vault PDA = the escrow's buyer; we sign for it below
    #[account(mut, seeds = [b"vault", reference.as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: paid by the escrow on release
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,

    /// Idempotent creation: a first-time seller may never have held this mint before.
    #[account(
        init_if_needed,
        payer = arbiter,
        associated_token::mint = mint,
        associated_token::authority = seller,
    )]
    pub seller_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: validated + closed by the escrow program
    #[account(
        mut,
        seeds = [b"escrow_spl", vault.key().as_ref(), reference.as_ref()],
        bump,
        seeds::program = escrow_program.key()
    )]
    pub escrow: UncheckedAccount<'info>,

    /// CHECK: the escrow's token vault, drained + closed by the CPI'd `release_spl`.
    #[account(mut)]
    pub escrow_ata: UncheckedAccount<'info>,

    pub escrow_program: Program<'info, EscrowProgram>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(reference: Pubkey)]
pub struct ArbitrateRefundSpl<'info> {
    pub arbiter: Signer<'info>,

    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,

    pub mint: Box<Account<'info, Mint>>,

    /// CHECK: the vault PDA = the escrow's buyer; we sign for it below
    #[account(mut, seeds = [b"vault", reference.as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,

    /// The vault's own token account (created at `open_spl`) — receives the refund from escrow,
    /// then is drained to `payer_ata` and closed in the same instruction.
    #[account(mut, associated_token::mint = mint, associated_token::authority = vault)]
    pub vault_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: the original payer - receives the swept refund
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,

    #[account(mut, associated_token::mint = mint, associated_token::authority = payer)]
    pub payer_ata: Box<Account<'info, TokenAccount>>,

    /// CHECK: validated + closed by the escrow program
    #[account(
        mut,
        seeds = [b"escrow_spl", vault.key().as_ref(), reference.as_ref()],
        bump,
        seeds::program = escrow_program.key()
    )]
    pub escrow: Account<'info, EscrowSplState>,

    /// CHECK: the escrow's token vault, drained + closed by the CPI'd `refund_spl`.
    #[account(mut)]
    pub escrow_ata: UncheckedAccount<'info>,

    pub escrow_program: Program<'info, EscrowProgram>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum ArbiterError {
    #[msg("Caller is not the configured arbiter")]
    NotArbiter,
    #[msg("Arithmetic overflow")]
    Overflow,
}
