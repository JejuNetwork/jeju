use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Mint, Token, TokenAccount, Transfer},
};

declare_id!("JejuOIF1111111111111111111111111111111111111");

// ============================================================================
// Constants
// ============================================================================

pub const INTENT_SEED: &[u8] = b"intent";
pub const ESCROW_SEED: &[u8] = b"escrow";
pub const SOLVER_SEED: &[u8] = b"solver";
pub const CONFIG_SEED: &[u8] = b"config";

// Intent expiry: 24 hours default
pub const DEFAULT_INTENT_EXPIRY: i64 = 86400;

// Maximum fill operations per intent
pub const MAX_FILLS: usize = 10;

// Minimum solver stake: 1 SOL
pub const MIN_SOLVER_STAKE: u64 = 1_000_000_000;

#[program]
pub mod oif_solver {
    use super::*;

    // ============================================================================
    // Admin Instructions
    // ============================================================================

    /// Initialize the OIF configuration
    pub fn initialize(
        ctx: Context<Initialize>,
        protocol_fee_bps: u16,
        min_solver_stake: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.protocol_fee_bps = protocol_fee_bps;
        config.min_solver_stake = if min_solver_stake > 0 {
            min_solver_stake
        } else {
            MIN_SOLVER_STAKE
        };
        config.total_intents = 0;
        config.total_filled = 0;
        config.total_volume = 0;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Register a solver
    pub fn register_solver(
        ctx: Context<RegisterSolver>,
        supported_chains: Vec<u32>,
    ) -> Result<()> {
        require!(
            ctx.accounts.stake_amount.lamports() >= ctx.accounts.config.min_solver_stake,
            OIFError::InsufficientStake
        );
        require!(supported_chains.len() <= 20, OIFError::TooManyChains);

        let solver = &mut ctx.accounts.solver;
        solver.owner = ctx.accounts.owner.key();
        solver.stake = ctx.accounts.stake_amount.lamports();
        solver.supported_chains = supported_chains;
        solver.intents_filled = 0;
        solver.total_volume = 0;
        solver.reputation_score = 1000; // Start with 1000 reputation
        solver.active = true;
        solver.registered_at = Clock::get()?.unix_timestamp;
        solver.bump = ctx.bumps.solver;

        // Transfer stake
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.stake_vault.to_account_info(),
                },
            ),
            ctx.accounts.stake_amount.lamports(),
        )?;

        emit!(SolverRegistered {
            solver: solver.key(),
            owner: ctx.accounts.owner.key(),
            stake: solver.stake,
            supported_chains: solver.supported_chains.clone(),
        });

        Ok(())
    }

    // ============================================================================
    // Intent Instructions
    // ============================================================================

    /// Create a cross-chain swap intent
    pub fn create_intent(
        ctx: Context<CreateIntent>,
        intent_id: [u8; 32],
        source_chain: u32,
        destination_chain: u32,
        source_token: Pubkey,
        destination_token: [u8; 32], // Can be non-Solana address
        source_amount: u64,
        min_destination_amount: u64,
        recipient: [u8; 32], // Can be non-Solana address
        expiry: i64,
        partial_fill_allowed: bool,
    ) -> Result<()> {
        let clock = Clock::get()?;
        
        let intent_expiry = if expiry > 0 {
            expiry
        } else {
            clock.unix_timestamp + DEFAULT_INTENT_EXPIRY
        };
        
        require!(intent_expiry > clock.unix_timestamp, OIFError::InvalidExpiry);
        require!(source_amount > 0, OIFError::InvalidAmount);
        require!(min_destination_amount > 0, OIFError::InvalidAmount);

        let intent = &mut ctx.accounts.intent;
        intent.creator = ctx.accounts.creator.key();
        intent.intent_id = intent_id;
        intent.source_chain = source_chain;
        intent.destination_chain = destination_chain;
        intent.source_token = source_token;
        intent.destination_token = destination_token;
        intent.source_amount = source_amount;
        intent.min_destination_amount = min_destination_amount;
        intent.recipient = recipient;
        intent.expiry = intent_expiry;
        intent.partial_fill_allowed = partial_fill_allowed;
        intent.amount_filled = 0;
        intent.status = IntentStatus::Open;
        intent.created_at = clock.unix_timestamp;
        intent.bump = ctx.bumps.intent;

        // Transfer source tokens to escrow
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator_token_account.to_account_info(),
                    to: ctx.accounts.escrow_token_account.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            source_amount,
        )?;

        // Update config stats
        let config = &mut ctx.accounts.config;
        config.total_intents += 1;

        emit!(IntentCreated {
            intent: intent.key(),
            creator: ctx.accounts.creator.key(),
            intent_id,
            source_chain,
            destination_chain,
            source_amount,
            min_destination_amount,
            expiry: intent_expiry,
        });

        Ok(())
    }

    /// Fill an intent (solver executes the cross-chain swap)
    pub fn fill_intent(
        ctx: Context<FillIntent>,
        fill_amount: u64,
        destination_tx_hash: [u8; 32], // Proof of destination chain execution
    ) -> Result<()> {
        let clock = Clock::get()?;
        let intent = &mut ctx.accounts.intent;

        require!(intent.status == IntentStatus::Open, OIFError::IntentNotOpen);
        require!(clock.unix_timestamp < intent.expiry, OIFError::IntentExpired);
        require!(fill_amount > 0, OIFError::InvalidAmount);
        
        // Check if solver supports the chains
        let solver = &ctx.accounts.solver;
        require!(solver.active, OIFError::SolverInactive);
        require!(
            solver.supported_chains.contains(&intent.source_chain) &&
            solver.supported_chains.contains(&intent.destination_chain),
            OIFError::SolverUnsupportedChain
        );

        // Check fill amount
        let remaining = intent.source_amount.checked_sub(intent.amount_filled)
            .ok_or(OIFError::MathOverflow)?;
        
        if !intent.partial_fill_allowed {
            require!(fill_amount == remaining, OIFError::PartialFillNotAllowed);
        }
        
        let actual_fill = fill_amount.min(remaining);
        require!(actual_fill > 0, OIFError::NothingToFill);

        // Calculate fee
        let fee = actual_fill
            .checked_mul(ctx.accounts.config.protocol_fee_bps as u64)
            .ok_or(OIFError::MathOverflow)?
            .checked_div(10000)
            .ok_or(OIFError::MathOverflow)?;

        let solver_receives = actual_fill.checked_sub(fee).ok_or(OIFError::MathOverflow)?;

        // Transfer tokens from escrow to solver
        let intent_seeds = &[
            INTENT_SEED,
            intent.intent_id.as_ref(),
            &[intent.bump],
        ];
        let signer = &[&intent_seeds[..]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.escrow_token_account.to_account_info(),
                    to: ctx.accounts.solver_token_account.to_account_info(),
                    authority: ctx.accounts.intent.to_account_info(),
                },
                signer,
            ),
            solver_receives,
        )?;

        // Transfer fee to protocol
        if fee > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.fee_account.to_account_info(),
                        authority: ctx.accounts.intent.to_account_info(),
                    },
                    signer,
                ),
                fee,
            )?;
        }

        // Update intent
        intent.amount_filled = intent.amount_filled.checked_add(actual_fill)
            .ok_or(OIFError::MathOverflow)?;
        
        if intent.amount_filled >= intent.source_amount {
            intent.status = IntentStatus::Filled;
            intent.filled_at = clock.unix_timestamp;
        }

        // Update solver stats
        let solver = &mut ctx.accounts.solver;
        solver.intents_filled += 1;
        solver.total_volume = solver.total_volume.checked_add(actual_fill as u128)
            .ok_or(OIFError::MathOverflow)?;
        solver.reputation_score = solver.reputation_score.saturating_add(10);

        // Update config stats
        let config = &mut ctx.accounts.config;
        config.total_filled += 1;
        config.total_volume = config.total_volume.checked_add(actual_fill as u128)
            .ok_or(OIFError::MathOverflow)?;

        emit!(IntentFilled {
            intent: intent.key(),
            solver: solver.key(),
            fill_amount: actual_fill,
            destination_tx_hash,
            remaining: intent.source_amount.saturating_sub(intent.amount_filled),
        });

        Ok(())
    }

    /// Cancel an intent (creator only, if not filled)
    pub fn cancel_intent(ctx: Context<CancelIntent>) -> Result<()> {
        let intent = &mut ctx.accounts.intent;
        
        require!(
            intent.status == IntentStatus::Open,
            OIFError::IntentNotOpen
        );

        let remaining = intent.source_amount.checked_sub(intent.amount_filled)
            .ok_or(OIFError::MathOverflow)?;

        // Return remaining tokens to creator
        if remaining > 0 {
            let intent_seeds = &[
                INTENT_SEED,
                intent.intent_id.as_ref(),
                &[intent.bump],
            ];
            let signer = &[&intent_seeds[..]];

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.creator_token_account.to_account_info(),
                        authority: intent.to_account_info(),
                    },
                    signer,
                ),
                remaining,
            )?;
        }

        intent.status = IntentStatus::Cancelled;

        emit!(IntentCancelled {
            intent: intent.key(),
            refunded: remaining,
        });

        Ok(())
    }

    /// Expire an intent (anyone can call after expiry)
    pub fn expire_intent(ctx: Context<ExpireIntent>) -> Result<()> {
        let clock = Clock::get()?;
        let intent = &mut ctx.accounts.intent;

        require!(intent.status == IntentStatus::Open, OIFError::IntentNotOpen);
        require!(clock.unix_timestamp >= intent.expiry, OIFError::IntentNotExpired);

        let remaining = intent.source_amount.checked_sub(intent.amount_filled)
            .ok_or(OIFError::MathOverflow)?;

        // Return remaining tokens to creator
        if remaining > 0 {
            let intent_seeds = &[
                INTENT_SEED,
                intent.intent_id.as_ref(),
                &[intent.bump],
            ];
            let signer = &[&intent_seeds[..]];

            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.escrow_token_account.to_account_info(),
                        to: ctx.accounts.creator_token_account.to_account_info(),
                        authority: intent.to_account_info(),
                    },
                    signer,
                ),
                remaining,
            )?;
        }

        intent.status = IntentStatus::Expired;

        emit!(IntentExpired {
            intent: intent.key(),
            refunded: remaining,
        });

        Ok(())
    }

    // ============================================================================
    // Solver Management
    // ============================================================================

    /// Slash solver stake for misbehavior
    pub fn slash_solver(
        ctx: Context<SlashSolver>,
        slash_amount: u64,
        reason: String,
    ) -> Result<()> {
        require!(reason.len() <= 200, OIFError::ReasonTooLong);

        let solver = &mut ctx.accounts.solver;
        
        let actual_slash = slash_amount.min(solver.stake);
        solver.stake = solver.stake.saturating_sub(actual_slash);
        solver.reputation_score = solver.reputation_score.saturating_sub(100);

        // If stake falls below minimum, deactivate solver
        if solver.stake < ctx.accounts.config.min_solver_stake {
            solver.active = false;
        }

        // Transfer slashed amount to protocol
        let solver_seeds = &[
            SOLVER_SEED,
            solver.owner.as_ref(),
            &[solver.bump],
        ];
        let signer = &[&solver_seeds[..]];

        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.stake_vault.to_account_info(),
                    to: ctx.accounts.authority.to_account_info(),
                },
                signer,
            ),
            actual_slash,
        )?;

        emit!(SolverSlashed {
            solver: solver.key(),
            amount: actual_slash,
            reason,
            remaining_stake: solver.stake,
        });

        Ok(())
    }

    /// Withdraw solver stake (deactivates solver)
    pub fn withdraw_stake(ctx: Context<WithdrawStake>) -> Result<()> {
        let solver = &mut ctx.accounts.solver;

        require!(solver.owner == ctx.accounts.owner.key(), OIFError::Unauthorized);

        let amount = solver.stake;
        solver.stake = 0;
        solver.active = false;

        // Transfer stake back
        let solver_seeds = &[
            SOLVER_SEED,
            solver.owner.as_ref(),
            &[solver.bump],
        ];
        let signer = &[&solver_seeds[..]];

        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.stake_vault.to_account_info(),
                    to: ctx.accounts.owner.to_account_info(),
                },
                signer,
            ),
            amount,
        )?;

        emit!(SolverWithdrawn {
            solver: solver.key(),
            amount,
        });

        Ok(())
    }
}

// ============================================================================
// Enums
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum IntentStatus {
    Open,
    Filled,
    Cancelled,
    Expired,
}

// ============================================================================
// Account Structures
// ============================================================================

#[account]
pub struct OIFConfig {
    pub authority: Pubkey,
    pub protocol_fee_bps: u16,
    pub min_solver_stake: u64,
    pub total_intents: u64,
    pub total_filled: u64,
    pub total_volume: u128,
    pub bump: u8,
}

#[account]
pub struct Intent {
    pub creator: Pubkey,
    pub intent_id: [u8; 32],
    pub source_chain: u32,
    pub destination_chain: u32,
    pub source_token: Pubkey,
    pub destination_token: [u8; 32],
    pub source_amount: u64,
    pub min_destination_amount: u64,
    pub recipient: [u8; 32],
    pub expiry: i64,
    pub partial_fill_allowed: bool,
    pub amount_filled: u64,
    pub status: IntentStatus,
    pub created_at: i64,
    pub filled_at: i64,
    pub bump: u8,
}

#[account]
pub struct Solver {
    pub owner: Pubkey,
    pub stake: u64,
    pub supported_chains: Vec<u32>,
    pub intents_filled: u64,
    pub total_volume: u128,
    pub reputation_score: u64,
    pub active: bool,
    pub registered_at: i64,
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
        space = 8 + 32 + 2 + 8 + 8 + 8 + 16 + 1,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, OIFConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterSolver<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, OIFConfig>,

    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 8 + 4 + (4 * 20) + 8 + 16 + 8 + 1 + 8 + 1,
        seeds = [SOLVER_SEED, owner.key().as_ref()],
        bump
    )]
    pub solver: Account<'info, Solver>,

    /// CHECK: Stake amount account
    #[account(mut)]
    pub stake_amount: SystemAccount<'info>,

    /// CHECK: Stake vault PDA
    #[account(
        mut,
        seeds = [b"stake-vault"],
        bump
    )]
    pub stake_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(intent_id: [u8; 32])]
pub struct CreateIntent<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, OIFConfig>,

    pub source_token: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        space = 8 + 32 + 32 + 4 + 4 + 32 + 32 + 8 + 8 + 32 + 8 + 1 + 8 + 1 + 8 + 8 + 1,
        seeds = [INTENT_SEED, intent_id.as_ref()],
        bump
    )]
    pub intent: Account<'info, Intent>,

    #[account(
        mut,
        associated_token::mint = source_token,
        associated_token::authority = creator,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = source_token,
        associated_token::authority = intent,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FillIntent<'info> {
    #[account(mut)]
    pub solver_owner: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, OIFConfig>,

    #[account(
        mut,
        seeds = [INTENT_SEED, intent.intent_id.as_ref()],
        bump = intent.bump
    )]
    pub intent: Account<'info, Intent>,

    #[account(
        mut,
        seeds = [SOLVER_SEED, solver_owner.key().as_ref()],
        bump = solver.bump
    )]
    pub solver: Account<'info, Solver>,

    #[account(
        mut,
        associated_token::mint = intent.source_token,
        associated_token::authority = intent,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = solver_owner,
        associated_token::mint = intent.source_token,
        associated_token::authority = solver_owner,
    )]
    pub solver_token_account: Account<'info, TokenAccount>,

    /// CHECK: Fee recipient from config
    #[account(mut)]
    pub fee_account: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelIntent<'info> {
    #[account(address = intent.creator)]
    pub creator: Signer<'info>,

    #[account(
        mut,
        seeds = [INTENT_SEED, intent.intent_id.as_ref()],
        bump = intent.bump
    )]
    pub intent: Account<'info, Intent>,

    #[account(
        mut,
        associated_token::mint = intent.source_token,
        associated_token::authority = intent,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = intent.source_token,
        associated_token::authority = creator,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ExpireIntent<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [INTENT_SEED, intent.intent_id.as_ref()],
        bump = intent.bump
    )]
    pub intent: Account<'info, Intent>,

    #[account(
        mut,
        associated_token::mint = intent.source_token,
        associated_token::authority = intent,
    )]
    pub escrow_token_account: Account<'info, TokenAccount>,

    /// CHECK: Intent creator
    #[account(mut, address = intent.creator)]
    pub creator: AccountInfo<'info>,

    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = intent.source_token,
        associated_token::authority = creator,
    )]
    pub creator_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SlashSolver<'info> {
    #[account(address = config.authority)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, OIFConfig>,

    #[account(
        mut,
        seeds = [SOLVER_SEED, solver.owner.as_ref()],
        bump = solver.bump
    )]
    pub solver: Account<'info, Solver>,

    /// CHECK: Stake vault
    #[account(
        mut,
        seeds = [b"stake-vault"],
        bump
    )]
    pub stake_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawStake<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [SOLVER_SEED, owner.key().as_ref()],
        bump = solver.bump
    )]
    pub solver: Account<'info, Solver>,

    /// CHECK: Stake vault
    #[account(
        mut,
        seeds = [b"stake-vault"],
        bump
    )]
    pub stake_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct SolverRegistered {
    pub solver: Pubkey,
    pub owner: Pubkey,
    pub stake: u64,
    pub supported_chains: Vec<u32>,
}

#[event]
pub struct IntentCreated {
    pub intent: Pubkey,
    pub creator: Pubkey,
    pub intent_id: [u8; 32],
    pub source_chain: u32,
    pub destination_chain: u32,
    pub source_amount: u64,
    pub min_destination_amount: u64,
    pub expiry: i64,
}

#[event]
pub struct IntentFilled {
    pub intent: Pubkey,
    pub solver: Pubkey,
    pub fill_amount: u64,
    pub destination_tx_hash: [u8; 32],
    pub remaining: u64,
}

#[event]
pub struct IntentCancelled {
    pub intent: Pubkey,
    pub refunded: u64,
}

#[event]
pub struct IntentExpired {
    pub intent: Pubkey,
    pub refunded: u64,
}

#[event]
pub struct SolverSlashed {
    pub solver: Pubkey,
    pub amount: u64,
    pub reason: String,
    pub remaining_stake: u64,
}

#[event]
pub struct SolverWithdrawn {
    pub solver: Pubkey,
    pub amount: u64,
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum OIFError {
    #[msg("Insufficient solver stake")]
    InsufficientStake,
    #[msg("Too many supported chains (max 20)")]
    TooManyChains,
    #[msg("Invalid expiry time")]
    InvalidExpiry,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Intent is not open")]
    IntentNotOpen,
    #[msg("Intent has expired")]
    IntentExpired,
    #[msg("Intent has not expired yet")]
    IntentNotExpired,
    #[msg("Solver is inactive")]
    SolverInactive,
    #[msg("Solver does not support this chain")]
    SolverUnsupportedChain,
    #[msg("Partial fill not allowed")]
    PartialFillNotAllowed,
    #[msg("Nothing to fill")]
    NothingToFill,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Reason too long (max 200 characters)")]
    ReasonTooLong,
}

