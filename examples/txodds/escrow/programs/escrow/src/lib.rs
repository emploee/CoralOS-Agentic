//! Escrow — the **settlement spine** of the demo: escrow-protected, buyer-released settlement.
//!
//! A buyer **deposits** SOL into a per-order escrow PDA; the seller is paid only when the buyer
//! **releases** (confirms delivery), and the buyer can **refund** after a deadline if the seller never
//! delivered. This is the only Rust in the kit, and it is **not optional** — every order settles here.
//!
//! **Asymmetry, stated honestly:** only the **buyer** signs `initialize` / `release` / `refund`. That
//! protects the *buyer* — funds are conditional and refundable — but the **seller has no on-chain
//! recourse** here: a buyer could take delivery and then refund after the deadline. That's fixed by the
//! sibling **arbiter** program (`../arbiter`, deployed) — a neutral 3rd signer gates settlement via the
//! vault-as-buyer pattern; the demo settles through it. See `../../contract_extension.md`.
//!
//! Security posture (from the solana-dev skill checklist):
//! - `init` (never `init_if_needed`) — no reinitialization attacks.
//! - PDA seeds include the buyer **and** the order reference — no shared-PDA "master key".
//! - `Signer` + `has_one` everywhere — only the real buyer/seller can act.
//! - `close = buyer` — secure closure returns rent and prevents account revival.
//! - Checked math on every lamport move.
//!
//! You don't fork this — you **call** it. The fork point is the service being sold
//! (`examples/txodds/agent/service.ts`); the agent deposits / releases / refunds through this
//! program via its TS client. See ../README.md.

use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount, TransferChecked};

// Program id of the live devnet deployment. Forking? Run `anchor keys sync` after your first build
// to repoint this (and Anchor.toml / the TS clients) at your own program keypair.
declare_id!("R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet");

#[program]
pub mod escrow {
    use super::*;

    /// Buyer deposits `amount` lamports into a per-order escrow, with a refund `deadline`.
    /// `reference` is the Solana Pay reference that ties this escrow to one request.
    pub fn initialize(
        ctx: Context<Initialize>,
        amount: u64,
        reference: Pubkey,
        deadline: i64,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);
        require!(deadline > Clock::get()?.unix_timestamp, EscrowError::DeadlineInPast);

        let escrow = &mut ctx.accounts.escrow;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.amount = amount;
        escrow.reference = reference;
        escrow.deadline = deadline;
        escrow.bump = ctx.bumps.escrow;

        // Move the escrowed SOL from the buyer into the escrow account (System CPI — buyer signs).
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            amount,
        )?;
        Ok(())
    }

    /// Buyer confirms delivery → pay the seller. The escrowed `amount` goes to the seller; the
    /// account is closed and its rent returned to the buyer.
    pub fn release(ctx: Context<Release>) -> Result<()> {
        let amount = ctx.accounts.escrow.amount;
        // The escrow account is program-owned, so move its lamports directly (no System CPI needed).
        **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? = ctx
            .accounts
            .escrow
            .to_account_info()
            .lamports()
            .checked_sub(amount)
            .ok_or(EscrowError::Overflow)?;
        **ctx.accounts.seller.try_borrow_mut_lamports()? = ctx
            .accounts
            .seller
            .lamports()
            .checked_add(amount)
            .ok_or(EscrowError::Overflow)?;
        Ok(())
        // `close = buyer` (in the Accounts struct) returns the remaining rent to the buyer.
    }

    /// Buyer reclaims the deposit after the deadline (seller never delivered). The whole balance —
    /// escrowed amount + rent — is returned to the buyer via `close = buyer`.
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        require!(
            Clock::get()?.unix_timestamp >= ctx.accounts.escrow.deadline,
            EscrowError::BeforeDeadline
        );
        Ok(())
    }

    // ── SPL-token escrow (additive — the SOL account layout above is untouched) ────────────────
    //
    // Same lifecycle as the SOL escrow, over an SPL token: `EscrowSpl` is a distinct account under
    // its own seed prefix (`escrow_spl`, not `escrow`), so this is a same-program-id devnet upgrade
    // that existing SOL clients never see. The escrowed tokens live in an Associated Token Account
    // owned by the `EscrowSpl` PDA (not the PDA itself, which can't hold SPL balances) — created at
    // `initialize_spl`, drained and closed at `release_spl`/`refund_spl`.

    /// Buyer deposits `amount` of `mint` into a per-order SPL escrow, with a refund `deadline`.
    pub fn initialize_spl(
        ctx: Context<InitializeSpl>,
        amount: u64,
        reference: Pubkey,
        deadline: i64,
    ) -> Result<()> {
        require!(amount > 0, EscrowError::ZeroAmount);
        require!(deadline > Clock::get()?.unix_timestamp, EscrowError::DeadlineInPast);

        let escrow = &mut ctx.accounts.escrow;
        escrow.buyer = ctx.accounts.buyer.key();
        escrow.seller = ctx.accounts.seller.key();
        escrow.mint = ctx.accounts.mint.key();
        escrow.amount = amount;
        escrow.reference = reference;
        escrow.deadline = deadline;
        escrow.bump = ctx.bumps.escrow;

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.buyer_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.escrow_ata.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        Ok(())
    }

    /// Buyer confirms delivery → pay the seller in `mint`, close the vault ATA (rent to buyer).
    pub fn release_spl(ctx: Context<ReleaseSpl>) -> Result<()> {
        let amount = ctx.accounts.escrow.amount;
        let decimals = ctx.accounts.mint.decimals;
        let buyer_key = ctx.accounts.buyer.key();
        let reference = ctx.accounts.escrow.reference;
        let bump = ctx.accounts.escrow.bump;
        let seeds: &[&[u8]] = &[b"escrow_spl", buyer_key.as_ref(), reference.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.escrow_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.seller_ata.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer,
            ),
            amount,
            decimals,
        )?;

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.escrow_ata.to_account_info(),
                destination: ctx.accounts.buyer.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            },
            signer,
        ))?;
        Ok(())
        // `close = buyer` (in the Accounts struct) returns the EscrowSpl state account's rent.
    }

    /// Buyer reclaims the deposit after the deadline — the whole token balance returns to the
    /// buyer's own ATA (which must already exist; they deposited from it), plus the vault's rent.
    pub fn refund_spl(ctx: Context<RefundSpl>) -> Result<()> {
        require!(
            Clock::get()?.unix_timestamp >= ctx.accounts.escrow.deadline,
            EscrowError::BeforeDeadline
        );
        let amount = ctx.accounts.escrow.amount;
        let decimals = ctx.accounts.mint.decimals;
        let buyer_key = ctx.accounts.buyer.key();
        let reference = ctx.accounts.escrow.reference;
        let bump = ctx.accounts.escrow.bump;
        let seeds: &[&[u8]] = &[b"escrow_spl", buyer_key.as_ref(), reference.as_ref(), &[bump]];
        let signer: &[&[&[u8]]] = &[seeds];

        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.escrow_ata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.buyer_ata.to_account_info(),
                    authority: ctx.accounts.escrow.to_account_info(),
                },
                signer,
            ),
            amount,
            decimals,
        )?;

        token::close_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            CloseAccount {
                account: ctx.accounts.escrow_ata.to_account_info(),
                destination: ctx.accounts.buyer.to_account_info(),
                authority: ctx.accounts.escrow.to_account_info(),
            },
            signer,
        ))?;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(amount: u64, reference: Pubkey)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: only used as the payout destination on release; identity is bound into the escrow.
    pub seller: UncheckedAccount<'info>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Escrow::INIT_SPACE,
        seeds = [b"escrow", buyer.key().as_ref(), reference.as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: must match the seller bound at initialize (enforced by `has_one`).
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
    #[account(
        mut,
        close = buyer,
        has_one = buyer @ EscrowError::WrongBuyer,
        has_one = seller @ EscrowError::WrongSeller,
        seeds = [b"escrow", buyer.key().as_ref(), escrow.reference.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        close = buyer,
        has_one = buyer @ EscrowError::WrongBuyer,
        seeds = [b"escrow", buyer.key().as_ref(), escrow.reference.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
}

#[account]
#[derive(InitSpace)]
pub struct Escrow {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub amount: u64,
    pub reference: Pubkey, // ties the escrow to one Solana Pay request
    pub deadline: i64,     // unix ts; buyer may refund at/after this
    pub bump: u8,
}

// ── SPL-token escrow accounts (additive) ────────────────────────────────────────

#[derive(Accounts)]
#[instruction(amount: u64, reference: Pubkey)]
pub struct InitializeSpl<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: only used as the payout destination on release; identity is bound into the escrow.
    pub seller: UncheckedAccount<'info>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = buyer,
        space = 8 + EscrowSpl::INIT_SPACE,
        seeds = [b"escrow_spl", buyer.key().as_ref(), reference.as_ref()],
        bump
    )]
    pub escrow: Box<Account<'info, EscrowSpl>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = buyer)]
    pub buyer_ata: Box<Account<'info, TokenAccount>>,
    /// The vault the escrowed tokens live in — owned by the `escrow` PDA, not the PDA itself
    /// (a PDA can't hold an SPL balance directly).
    #[account(
        init,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = escrow,
    )]
    pub escrow_ata: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ReleaseSpl<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: must match the seller bound at initialize_spl (enforced by has_one).
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        close = buyer,
        has_one = buyer @ EscrowError::WrongBuyer,
        has_one = seller @ EscrowError::WrongSeller,
        has_one = mint @ EscrowError::WrongMint,
        seeds = [b"escrow_spl", buyer.key().as_ref(), escrow.reference.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Box<Account<'info, EscrowSpl>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = escrow)]
    pub escrow_ata: Box<Account<'info, TokenAccount>>,
    // Idempotent creation: a first-time seller may never have held this mint before, and a
    // release must not fail just because their ATA doesn't exist yet (scoped `init-if-needed`
    // use — see the Cargo.toml feature comment for why this doesn't weaken the no-reinit posture).
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = seller,
    )]
    pub seller_ata: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundSpl<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        close = buyer,
        has_one = buyer @ EscrowError::WrongBuyer,
        has_one = mint @ EscrowError::WrongMint,
        seeds = [b"escrow_spl", buyer.key().as_ref(), escrow.reference.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Box<Account<'info, EscrowSpl>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = escrow)]
    pub escrow_ata: Box<Account<'info, TokenAccount>>,
    #[account(mut, associated_token::mint = mint, associated_token::authority = buyer)]
    pub buyer_ata: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

#[account]
#[derive(InitSpace)]
pub struct EscrowSpl {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub reference: Pubkey,
    pub deadline: i64,
    pub bump: u8,
}

#[error_code]
pub enum EscrowError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Deadline must be in the future")]
    DeadlineInPast,
    #[msg("Refund is only allowed at or after the deadline")]
    BeforeDeadline,
    #[msg("Buyer does not match the escrow")]
    WrongBuyer,
    #[msg("Seller does not match the escrow")]
    WrongSeller,
    #[msg("Mint does not match the escrow")]
    WrongMint,
    #[msg("Arithmetic overflow")]
    Overflow,
}
