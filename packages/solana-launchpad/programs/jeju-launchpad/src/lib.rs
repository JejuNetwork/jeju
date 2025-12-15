use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer, MintTo, Burn},
};

declare_id!("JejuLauncher1111111111111111111111111111111");

// ============================================================================
// Constants
// ============================================================================

pub const BONDING_CURVE_SEED: &[u8] = b"bonding-curve";
pub const PRESALE_SEED: &[u8] = b"presale";
pub const VAULT_SEED: &[u8] = b"vault";
pub const LP_LOCK_SEED: &[u8] = b"lp-lock";

// Default bonding curve parameters
pub const DEFAULT_VIRTUAL_SOL_RESERVES: u64 = 30_000_000_000; // 30 SOL
pub const DEFAULT_VIRTUAL_TOKEN_RESERVES: u64 = 1_000_000_000_000_000; // 1B tokens (6 decimals)
pub const DEFAULT_GRADUATION_THRESHOLD: u64 = 85_000_000_000; // 85 SOL

// Fee basis points
pub const PLATFORM_FEE_BPS: u16 = 100; // 1%
pub const MAX_CREATOR_FEE_BPS: u16 = 1000; // 10%

#[program]
pub mod jeju_launchpad {
    use super::*;

    // ============================================================================
    // Bonding Curve Instructions
    // ============================================================================

    /// Initialize the launchpad configuration
    pub fn initialize(
        ctx: Context<Initialize>,
        fee_recipient: Pubkey,
        platform_fee_bps: u16,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.fee_recipient = fee_recipient;
        config.platform_fee_bps = platform_fee_bps;
        config.total_launches = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Create a new token with bonding curve
    pub fn create_bonding_curve(
        ctx: Context<CreateBondingCurve>,
        name: String,
        symbol: String,
        uri: String,
        creator_fee_bps: u16,
        graduation_threshold: u64,
    ) -> Result<()> {
        require!(name.len() <= 32, LaunchpadError::NameTooLong);
        require!(symbol.len() <= 10, LaunchpadError::SymbolTooLong);
        require!(uri.len() <= 200, LaunchpadError::UriTooLong);
        require!(creator_fee_bps <= MAX_CREATOR_FEE_BPS, LaunchpadError::FeeTooHigh);

        let curve = &mut ctx.accounts.bonding_curve;
        curve.creator = ctx.accounts.creator.key();
        curve.token_mint = ctx.accounts.token_mint.key();
        curve.virtual_sol_reserves = DEFAULT_VIRTUAL_SOL_RESERVES;
        curve.virtual_token_reserves = DEFAULT_VIRTUAL_TOKEN_RESERVES;
        curve.real_sol_reserves = 0;
        curve.real_token_reserves = DEFAULT_VIRTUAL_TOKEN_RESERVES;
        curve.tokens_sold = 0;
        curve.graduation_threshold = if graduation_threshold > 0 {
            graduation_threshold
        } else {
            DEFAULT_GRADUATION_THRESHOLD
        };
        curve.creator_fee_bps = creator_fee_bps;
        curve.graduated = false;
        curve.created_at = Clock::get()?.unix_timestamp;
        curve.bump = ctx.bumps.bonding_curve;

        // Mint initial supply to curve vault
        let seeds = &[
            BONDING_CURVE_SEED,
            ctx.accounts.token_mint.key().as_ref(),
            &[curve.bump],
        ];
        let signer = &[&seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.curve_token_account.to_account_info(),
                    authority: ctx.accounts.bonding_curve.to_account_info(),
                },
                signer,
            ),
            DEFAULT_VIRTUAL_TOKEN_RESERVES,
        )?;

        // Update config
        let config = &mut ctx.accounts.config;
        config.total_launches += 1;

        emit!(TokenCreated {
            token_mint: ctx.accounts.token_mint.key(),
            creator: ctx.accounts.creator.key(),
            name,
            symbol,
            graduation_threshold: curve.graduation_threshold,
        });

        Ok(())
    }

    /// Buy tokens on the bonding curve
    pub fn buy(
        ctx: Context<BuyTokens>,
        sol_amount: u64,
        min_tokens_out: u64,
    ) -> Result<()> {
        let curve = &mut ctx.accounts.bonding_curve;
        
        require!(!curve.graduated, LaunchpadError::AlreadyGraduated);
        require!(sol_amount > 0, LaunchpadError::InvalidAmount);

        // Calculate tokens out using constant product formula
        // (virtualSol + solIn) * (virtualToken - tokenOut) = k
        let k = (curve.virtual_sol_reserves as u128)
            .checked_mul(curve.virtual_token_reserves as u128)
            .ok_or(LaunchpadError::MathOverflow)?;

        let new_virtual_sol = curve.virtual_sol_reserves
            .checked_add(sol_amount)
            .ok_or(LaunchpadError::MathOverflow)?;

        let new_virtual_token = k
            .checked_div(new_virtual_sol as u128)
            .ok_or(LaunchpadError::MathOverflow)? as u64;

        let tokens_out = curve.virtual_token_reserves
            .checked_sub(new_virtual_token)
            .ok_or(LaunchpadError::MathOverflow)?;

        // Apply fees
        let platform_fee = sol_amount
            .checked_mul(ctx.accounts.config.platform_fee_bps as u64)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div(10000)
            .ok_or(LaunchpadError::MathOverflow)?;

        let creator_fee = sol_amount
            .checked_mul(curve.creator_fee_bps as u64)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div(10000)
            .ok_or(LaunchpadError::MathOverflow)?;

        let total_fees = platform_fee.checked_add(creator_fee).ok_or(LaunchpadError::MathOverflow)?;
        let net_sol = sol_amount.checked_sub(total_fees).ok_or(LaunchpadError::MathOverflow)?;

        // Apply slippage check on tokens after fee
        let tokens_after_fee = tokens_out
            .checked_mul(10000 - PLATFORM_FEE_BPS as u64)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div(10000)
            .ok_or(LaunchpadError::MathOverflow)?;

        require!(tokens_after_fee >= min_tokens_out, LaunchpadError::SlippageExceeded);

        // Transfer SOL from buyer to vault
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            ),
            net_sol,
        )?;

        // Transfer platform fee
        if platform_fee > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.buyer.to_account_info(),
                        to: ctx.accounts.fee_recipient.to_account_info(),
                    },
                ),
                platform_fee,
            )?;
        }

        // Transfer creator fee
        if creator_fee > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.buyer.to_account_info(),
                        to: ctx.accounts.creator.to_account_info(),
                    },
                ),
                creator_fee,
            )?;
        }

        // Transfer tokens to buyer
        let seeds = &[
            BONDING_CURVE_SEED,
            curve.token_mint.as_ref(),
            &[curve.bump],
        ];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.curve_token_account.to_account_info(),
                    to: ctx.accounts.buyer_token_account.to_account_info(),
                    authority: ctx.accounts.bonding_curve.to_account_info(),
                },
                signer,
            ),
            tokens_after_fee,
        )?;

        // Update curve state
        curve.virtual_sol_reserves = new_virtual_sol;
        curve.virtual_token_reserves = new_virtual_token;
        curve.real_sol_reserves = curve.real_sol_reserves
            .checked_add(net_sol)
            .ok_or(LaunchpadError::MathOverflow)?;
        curve.real_token_reserves = curve.real_token_reserves
            .checked_sub(tokens_after_fee)
            .ok_or(LaunchpadError::MathOverflow)?;
        curve.tokens_sold = curve.tokens_sold
            .checked_add(tokens_after_fee)
            .ok_or(LaunchpadError::MathOverflow)?;

        emit!(TokensBought {
            token_mint: curve.token_mint,
            buyer: ctx.accounts.buyer.key(),
            sol_amount,
            tokens_bought: tokens_after_fee,
            new_price: calculate_price(curve.virtual_sol_reserves, curve.virtual_token_reserves),
        });

        // Check graduation
        if curve.real_sol_reserves >= curve.graduation_threshold {
            curve.graduated = true;
            emit!(TokenGraduated {
                token_mint: curve.token_mint,
                sol_raised: curve.real_sol_reserves,
                tokens_sold: curve.tokens_sold,
            });
        }

        Ok(())
    }

    /// Sell tokens back to the bonding curve
    pub fn sell(
        ctx: Context<SellTokens>,
        token_amount: u64,
        min_sol_out: u64,
    ) -> Result<()> {
        let curve = &mut ctx.accounts.bonding_curve;
        
        require!(!curve.graduated, LaunchpadError::AlreadyGraduated);
        require!(token_amount > 0, LaunchpadError::InvalidAmount);

        // Calculate SOL out using constant product formula
        // (virtualToken + tokenIn) * (virtualSol - solOut) = k
        let k = (curve.virtual_sol_reserves as u128)
            .checked_mul(curve.virtual_token_reserves as u128)
            .ok_or(LaunchpadError::MathOverflow)?;

        let new_virtual_token = curve.virtual_token_reserves
            .checked_add(token_amount)
            .ok_or(LaunchpadError::MathOverflow)?;

        let new_virtual_sol = k
            .checked_div(new_virtual_token as u128)
            .ok_or(LaunchpadError::MathOverflow)? as u64;

        let sol_out = curve.virtual_sol_reserves
            .checked_sub(new_virtual_sol)
            .ok_or(LaunchpadError::MathOverflow)?;

        // Apply fees
        let platform_fee = sol_out
            .checked_mul(ctx.accounts.config.platform_fee_bps as u64)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div(10000)
            .ok_or(LaunchpadError::MathOverflow)?;

        let creator_fee = sol_out
            .checked_mul(curve.creator_fee_bps as u64)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div(10000)
            .ok_or(LaunchpadError::MathOverflow)?;

        let total_fees = platform_fee.checked_add(creator_fee).ok_or(LaunchpadError::MathOverflow)?;
        let net_sol = sol_out.checked_sub(total_fees).ok_or(LaunchpadError::MathOverflow)?;

        require!(net_sol >= min_sol_out, LaunchpadError::SlippageExceeded);
        require!(curve.real_sol_reserves >= net_sol, LaunchpadError::InsufficientLiquidity);

        // Transfer tokens from seller to curve
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.seller_token_account.to_account_info(),
                    to: ctx.accounts.curve_token_account.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            token_amount,
        )?;

        // Transfer SOL to seller
        let vault_seeds = &[
            VAULT_SEED,
            curve.token_mint.as_ref(),
            &[ctx.bumps.sol_vault],
        ];
        let vault_signer = &[&vault_seeds[..]];

        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.sol_vault.to_account_info(),
                    to: ctx.accounts.seller.to_account_info(),
                },
                vault_signer,
            ),
            net_sol,
        )?;

        // Update curve state
        curve.virtual_sol_reserves = new_virtual_sol;
        curve.virtual_token_reserves = new_virtual_token;
        curve.real_sol_reserves = curve.real_sol_reserves
            .checked_sub(sol_out)
            .ok_or(LaunchpadError::MathOverflow)?;
        curve.real_token_reserves = curve.real_token_reserves
            .checked_add(token_amount)
            .ok_or(LaunchpadError::MathOverflow)?;
        curve.tokens_sold = curve.tokens_sold
            .checked_sub(token_amount)
            .ok_or(LaunchpadError::MathOverflow)?;

        emit!(TokensSold {
            token_mint: curve.token_mint,
            seller: ctx.accounts.seller.key(),
            tokens_sold: token_amount,
            sol_received: net_sol,
            new_price: calculate_price(curve.virtual_sol_reserves, curve.virtual_token_reserves),
        });

        Ok(())
    }

    // ============================================================================
    // Presale Instructions
    // ============================================================================

    /// Create a presale for a token
    pub fn create_presale(
        ctx: Context<CreatePresale>,
        soft_cap: u64,
        hard_cap: u64,
        min_contribution: u64,
        max_contribution: u64,
        start_time: i64,
        end_time: i64,
        token_price: u64, // tokens per SOL (with decimals)
        vesting_duration: i64,
    ) -> Result<()> {
        require!(soft_cap > 0, LaunchpadError::InvalidAmount);
        require!(hard_cap >= soft_cap, LaunchpadError::InvalidCaps);
        require!(min_contribution > 0, LaunchpadError::InvalidAmount);
        require!(max_contribution >= min_contribution, LaunchpadError::InvalidContributionLimits);
        require!(end_time > start_time, LaunchpadError::InvalidTimes);
        require!(token_price > 0, LaunchpadError::InvalidPrice);

        let presale = &mut ctx.accounts.presale;
        presale.creator = ctx.accounts.creator.key();
        presale.token_mint = ctx.accounts.token_mint.key();
        presale.soft_cap = soft_cap;
        presale.hard_cap = hard_cap;
        presale.min_contribution = min_contribution;
        presale.max_contribution = max_contribution;
        presale.start_time = start_time;
        presale.end_time = end_time;
        presale.token_price = token_price;
        presale.vesting_duration = vesting_duration;
        presale.total_raised = 0;
        presale.total_contributors = 0;
        presale.finalized = false;
        presale.cancelled = false;
        presale.bump = ctx.bumps.presale;

        emit!(PresaleCreated {
            presale: presale.key(),
            token_mint: ctx.accounts.token_mint.key(),
            creator: ctx.accounts.creator.key(),
            soft_cap,
            hard_cap,
            start_time,
            end_time,
        });

        Ok(())
    }

    /// Contribute to a presale
    pub fn contribute(
        ctx: Context<Contribute>,
        amount: u64,
    ) -> Result<()> {
        let presale = &mut ctx.accounts.presale;
        let clock = Clock::get()?;

        require!(!presale.finalized, LaunchpadError::PresaleFinalized);
        require!(!presale.cancelled, LaunchpadError::PresaleCancelled);
        require!(clock.unix_timestamp >= presale.start_time, LaunchpadError::PresaleNotStarted);
        require!(clock.unix_timestamp <= presale.end_time, LaunchpadError::PresaleEnded);
        require!(amount >= presale.min_contribution, LaunchpadError::BelowMinContribution);
        
        let new_total = presale.total_raised
            .checked_add(amount)
            .ok_or(LaunchpadError::MathOverflow)?;
        require!(new_total <= presale.hard_cap, LaunchpadError::HardCapReached);

        // Check user's total contribution
        let contribution = &mut ctx.accounts.contribution;
        let new_user_total = contribution.amount
            .checked_add(amount)
            .ok_or(LaunchpadError::MathOverflow)?;
        require!(new_user_total <= presale.max_contribution, LaunchpadError::AboveMaxContribution);

        // Transfer SOL
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.contributor.to_account_info(),
                    to: ctx.accounts.presale_vault.to_account_info(),
                },
            ),
            amount,
        )?;

        // Update contribution
        if contribution.amount == 0 {
            presale.total_contributors += 1;
            contribution.contributor = ctx.accounts.contributor.key();
            contribution.presale = presale.key();
            contribution.claimed = false;
            contribution.bump = ctx.bumps.contribution;
        }
        contribution.amount = new_user_total;

        // Update presale
        presale.total_raised = new_total;

        emit!(ContributionMade {
            presale: presale.key(),
            contributor: ctx.accounts.contributor.key(),
            amount,
            total_contribution: new_user_total,
        });

        Ok(())
    }

    /// Finalize presale (creator only)
    pub fn finalize_presale(ctx: Context<FinalizePresale>) -> Result<()> {
        let presale = &mut ctx.accounts.presale;
        let clock = Clock::get()?;

        require!(!presale.finalized, LaunchpadError::PresaleFinalized);
        require!(!presale.cancelled, LaunchpadError::PresaleCancelled);
        require!(
            clock.unix_timestamp > presale.end_time || presale.total_raised >= presale.hard_cap,
            LaunchpadError::PresaleNotEnded
        );
        require!(presale.total_raised >= presale.soft_cap, LaunchpadError::SoftCapNotReached);

        presale.finalized = true;
        presale.finalized_at = clock.unix_timestamp;

        emit!(PresaleFinalized {
            presale: presale.key(),
            total_raised: presale.total_raised,
            total_contributors: presale.total_contributors,
        });

        Ok(())
    }

    /// Claim tokens from presale
    pub fn claim_presale(ctx: Context<ClaimPresale>) -> Result<()> {
        let presale = &ctx.accounts.presale;
        let contribution = &mut ctx.accounts.contribution;
        let clock = Clock::get()?;

        require!(presale.finalized, LaunchpadError::PresaleNotFinalized);
        require!(!contribution.claimed, LaunchpadError::AlreadyClaimed);

        // Calculate vesting
        let vesting_start = presale.finalized_at;
        let vesting_end = vesting_start + presale.vesting_duration;
        let elapsed = clock.unix_timestamp - vesting_start;
        
        let claimable_pct = if presale.vesting_duration == 0 || elapsed >= presale.vesting_duration {
            100u64
        } else {
            (elapsed as u64).checked_mul(100).ok_or(LaunchpadError::MathOverflow)?
                .checked_div(presale.vesting_duration as u64).ok_or(LaunchpadError::MathOverflow)?
        };

        // Calculate tokens
        let total_tokens = contribution.amount
            .checked_mul(presale.token_price)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div(1_000_000_000) // Assuming SOL decimals
            .ok_or(LaunchpadError::MathOverflow)?;

        let claimable_tokens = total_tokens
            .checked_mul(claimable_pct)
            .ok_or(LaunchpadError::MathOverflow)?
            .checked_div(100)
            .ok_or(LaunchpadError::MathOverflow)?;

        let already_claimed = contribution.tokens_claimed;
        let to_claim = claimable_tokens.checked_sub(already_claimed).ok_or(LaunchpadError::MathOverflow)?;

        require!(to_claim > 0, LaunchpadError::NothingToClaim);

        // Transfer tokens
        let seeds = &[
            PRESALE_SEED,
            presale.token_mint.as_ref(),
            &[presale.bump],
        ];
        let signer = &[&seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.presale_token_account.to_account_info(),
                    to: ctx.accounts.contributor_token_account.to_account_info(),
                    authority: ctx.accounts.presale.to_account_info(),
                },
                signer,
            ),
            to_claim,
        )?;

        contribution.tokens_claimed = claimable_tokens;
        if claimable_pct == 100 {
            contribution.claimed = true;
        }

        emit!(TokensClaimed {
            presale: presale.key(),
            contributor: ctx.accounts.contributor.key(),
            amount: to_claim,
        });

        Ok(())
    }

    /// Cancel presale and enable refunds
    pub fn cancel_presale(ctx: Context<CancelPresale>) -> Result<()> {
        let presale = &mut ctx.accounts.presale;

        require!(!presale.finalized, LaunchpadError::PresaleFinalized);
        require!(!presale.cancelled, LaunchpadError::PresaleCancelled);

        presale.cancelled = true;

        emit!(PresaleCancelled {
            presale: presale.key(),
        });

        Ok(())
    }

    /// Claim refund from cancelled presale
    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        let presale = &ctx.accounts.presale;
        let contribution = &mut ctx.accounts.contribution;

        require!(presale.cancelled || (presale.total_raised < presale.soft_cap && Clock::get()?.unix_timestamp > presale.end_time), 
            LaunchpadError::RefundsNotEnabled);
        require!(!contribution.claimed, LaunchpadError::AlreadyClaimed);
        require!(contribution.amount > 0, LaunchpadError::NothingToClaim);

        let refund_amount = contribution.amount;

        // Transfer SOL back
        let seeds = &[
            VAULT_SEED,
            presale.token_mint.as_ref(),
            &[ctx.bumps.presale_vault],
        ];
        let signer = &[&seeds[..]];

        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.presale_vault.to_account_info(),
                    to: ctx.accounts.contributor.to_account_info(),
                },
                signer,
            ),
            refund_amount,
        )?;

        contribution.claimed = true;
        contribution.amount = 0;

        emit!(RefundClaimed {
            presale: presale.key(),
            contributor: ctx.accounts.contributor.key(),
            amount: refund_amount,
        });

        Ok(())
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

fn calculate_price(virtual_sol: u64, virtual_token: u64) -> u64 {
    // Price = virtual_sol / virtual_token (in lamports per token)
    if virtual_token == 0 {
        return 0;
    }
    (virtual_sol as u128)
        .checked_mul(1_000_000) // Scale for precision
        .unwrap_or(0)
        .checked_div(virtual_token as u128)
        .unwrap_or(0) as u64
}

// ============================================================================
// Account Structures
// ============================================================================

#[account]
pub struct LaunchpadConfig {
    pub authority: Pubkey,
    pub fee_recipient: Pubkey,
    pub platform_fee_bps: u16,
    pub total_launches: u64,
    pub bump: u8,
}

#[account]
pub struct BondingCurve {
    pub creator: Pubkey,
    pub token_mint: Pubkey,
    pub virtual_sol_reserves: u64,
    pub virtual_token_reserves: u64,
    pub real_sol_reserves: u64,
    pub real_token_reserves: u64,
    pub tokens_sold: u64,
    pub graduation_threshold: u64,
    pub creator_fee_bps: u16,
    pub graduated: bool,
    pub created_at: i64,
    pub bump: u8,
}

#[account]
pub struct Presale {
    pub creator: Pubkey,
    pub token_mint: Pubkey,
    pub soft_cap: u64,
    pub hard_cap: u64,
    pub min_contribution: u64,
    pub max_contribution: u64,
    pub start_time: i64,
    pub end_time: i64,
    pub token_price: u64,
    pub vesting_duration: i64,
    pub total_raised: u64,
    pub total_contributors: u64,
    pub finalized: bool,
    pub cancelled: bool,
    pub finalized_at: i64,
    pub bump: u8,
}

#[account]
pub struct Contribution {
    pub contributor: Pubkey,
    pub presale: Pubkey,
    pub amount: u64,
    pub tokens_claimed: u64,
    pub claimed: bool,
    pub bump: u8,
}

// ============================================================================
// Context Structures
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 2 + 8 + 1,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, LaunchpadConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(name: String, symbol: String, uri: String)]
pub struct CreateBondingCurve<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, LaunchpadConfig>,

    #[account(
        init,
        payer = creator,
        mint::decimals = 6,
        mint::authority = bonding_curve,
    )]
    pub token_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        space = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 2 + 1 + 8 + 1,
        seeds = [BONDING_CURVE_SEED, token_mint.key().as_ref()],
        bump
    )]
    pub bonding_curve: Account<'info, BondingCurve>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = token_mint,
        associated_token::authority = bonding_curve,
    )]
    pub curve_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct BuyTokens<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, LaunchpadConfig>,

    #[account(
        mut,
        seeds = [BONDING_CURVE_SEED, bonding_curve.token_mint.as_ref()],
        bump = bonding_curve.bump
    )]
    pub bonding_curve: Account<'info, BondingCurve>,

    #[account(
        mut,
        associated_token::mint = bonding_curve.token_mint,
        associated_token::authority = bonding_curve,
    )]
    pub curve_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = bonding_curve.token_mint,
        associated_token::authority = buyer,
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,

    /// CHECK: SOL vault PDA
    #[account(
        mut,
        seeds = [VAULT_SEED, bonding_curve.token_mint.as_ref()],
        bump
    )]
    pub sol_vault: SystemAccount<'info>,

    /// CHECK: Fee recipient from config
    #[account(mut, address = config.fee_recipient)]
    pub fee_recipient: SystemAccount<'info>,

    /// CHECK: Creator address
    #[account(mut, address = bonding_curve.creator)]
    pub creator: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SellTokens<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        seeds = [b"config"],
        bump = config.bump
    )]
    pub config: Account<'info, LaunchpadConfig>,

    #[account(
        mut,
        seeds = [BONDING_CURVE_SEED, bonding_curve.token_mint.as_ref()],
        bump = bonding_curve.bump
    )]
    pub bonding_curve: Account<'info, BondingCurve>,

    #[account(
        mut,
        associated_token::mint = bonding_curve.token_mint,
        associated_token::authority = bonding_curve,
    )]
    pub curve_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = bonding_curve.token_mint,
        associated_token::authority = seller,
    )]
    pub seller_token_account: Account<'info, TokenAccount>,

    /// CHECK: SOL vault PDA
    #[account(
        mut,
        seeds = [VAULT_SEED, bonding_curve.token_mint.as_ref()],
        bump
    )]
    pub sol_vault: SystemAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreatePresale<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    pub token_mint: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        space = 8 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 8 + 1,
        seeds = [PRESALE_SEED, token_mint.key().as_ref()],
        bump
    )]
    pub presale: Account<'info, Presale>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Contribute<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(
        mut,
        seeds = [PRESALE_SEED, presale.token_mint.as_ref()],
        bump = presale.bump
    )]
    pub presale: Account<'info, Presale>,

    #[account(
        init_if_needed,
        payer = contributor,
        space = 8 + 32 + 32 + 8 + 8 + 1 + 1,
        seeds = [b"contribution", presale.key().as_ref(), contributor.key().as_ref()],
        bump
    )]
    pub contribution: Account<'info, Contribution>,

    /// CHECK: Presale vault PDA
    #[account(
        mut,
        seeds = [VAULT_SEED, presale.token_mint.as_ref()],
        bump
    )]
    pub presale_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FinalizePresale<'info> {
    #[account(mut, address = presale.creator)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [PRESALE_SEED, presale.token_mint.as_ref()],
        bump = presale.bump
    )]
    pub presale: Account<'info, Presale>,
}

#[derive(Accounts)]
pub struct ClaimPresale<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(
        seeds = [PRESALE_SEED, presale.token_mint.as_ref()],
        bump = presale.bump
    )]
    pub presale: Account<'info, Presale>,

    #[account(
        mut,
        seeds = [b"contribution", presale.key().as_ref(), contributor.key().as_ref()],
        bump = contribution.bump,
        constraint = contribution.contributor == contributor.key()
    )]
    pub contribution: Account<'info, Contribution>,

    #[account(
        mut,
        associated_token::mint = presale.token_mint,
        associated_token::authority = presale,
    )]
    pub presale_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = contributor,
        associated_token::mint = presale.token_mint,
        associated_token::authority = contributor,
    )]
    pub contributor_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelPresale<'info> {
    #[account(address = presale.creator)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [PRESALE_SEED, presale.token_mint.as_ref()],
        bump = presale.bump
    )]
    pub presale: Account<'info, Presale>,
}

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(
        seeds = [PRESALE_SEED, presale.token_mint.as_ref()],
        bump = presale.bump
    )]
    pub presale: Account<'info, Presale>,

    #[account(
        mut,
        seeds = [b"contribution", presale.key().as_ref(), contributor.key().as_ref()],
        bump = contribution.bump,
        constraint = contribution.contributor == contributor.key()
    )]
    pub contribution: Account<'info, Contribution>,

    /// CHECK: Presale vault PDA
    #[account(
        mut,
        seeds = [VAULT_SEED, presale.token_mint.as_ref()],
        bump
    )]
    pub presale_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct TokenCreated {
    pub token_mint: Pubkey,
    pub creator: Pubkey,
    pub name: String,
    pub symbol: String,
    pub graduation_threshold: u64,
}

#[event]
pub struct TokensBought {
    pub token_mint: Pubkey,
    pub buyer: Pubkey,
    pub sol_amount: u64,
    pub tokens_bought: u64,
    pub new_price: u64,
}

#[event]
pub struct TokensSold {
    pub token_mint: Pubkey,
    pub seller: Pubkey,
    pub tokens_sold: u64,
    pub sol_received: u64,
    pub new_price: u64,
}

#[event]
pub struct TokenGraduated {
    pub token_mint: Pubkey,
    pub sol_raised: u64,
    pub tokens_sold: u64,
}

#[event]
pub struct PresaleCreated {
    pub presale: Pubkey,
    pub token_mint: Pubkey,
    pub creator: Pubkey,
    pub soft_cap: u64,
    pub hard_cap: u64,
    pub start_time: i64,
    pub end_time: i64,
}

#[event]
pub struct ContributionMade {
    pub presale: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
    pub total_contribution: u64,
}

#[event]
pub struct PresaleFinalized {
    pub presale: Pubkey,
    pub total_raised: u64,
    pub total_contributors: u64,
}

#[event]
pub struct PresaleCancelled {
    pub presale: Pubkey,
}

#[event]
pub struct TokensClaimed {
    pub presale: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
}

#[event]
pub struct RefundClaimed {
    pub presale: Pubkey,
    pub contributor: Pubkey,
    pub amount: u64,
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum LaunchpadError {
    #[msg("Name too long (max 32 characters)")]
    NameTooLong,
    #[msg("Symbol too long (max 10 characters)")]
    SymbolTooLong,
    #[msg("URI too long (max 200 characters)")]
    UriTooLong,
    #[msg("Creator fee too high (max 10%)")]
    FeeTooHigh,
    #[msg("Token already graduated to AMM")]
    AlreadyGraduated,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Slippage exceeded")]
    SlippageExceeded,
    #[msg("Insufficient liquidity")]
    InsufficientLiquidity,
    #[msg("Invalid caps configuration")]
    InvalidCaps,
    #[msg("Invalid contribution limits")]
    InvalidContributionLimits,
    #[msg("Invalid times")]
    InvalidTimes,
    #[msg("Invalid price")]
    InvalidPrice,
    #[msg("Presale already finalized")]
    PresaleFinalized,
    #[msg("Presale not finalized")]
    PresaleNotFinalized,
    #[msg("Presale cancelled")]
    PresaleCancelled,
    #[msg("Presale not started")]
    PresaleNotStarted,
    #[msg("Presale ended")]
    PresaleEnded,
    #[msg("Presale not ended")]
    PresaleNotEnded,
    #[msg("Below minimum contribution")]
    BelowMinContribution,
    #[msg("Above maximum contribution")]
    AboveMaxContribution,
    #[msg("Hard cap reached")]
    HardCapReached,
    #[msg("Soft cap not reached")]
    SoftCapNotReached,
    #[msg("Already claimed")]
    AlreadyClaimed,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Refunds not enabled")]
    RefundsNotEnabled,
}

