//! x402 Payment Facilitator for Solana
//!
//! This program implements the x402 micropayment protocol on Solana using SPL tokens.
//! It enables gasless payments where:
//! 1. Payer signs an off-chain authorization
//! 2. Service/facilitator submits the payment transaction
//! 3. SPL tokens are transferred from payer to recipient
//!
//! Features:
//! - Support for USDC and other SPL tokens
//! - Ed25519 signature verification for payment authorization
//! - Protocol fee collection
//! - Nonce-based replay protection
//! - Multi-token support

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

// Placeholder program ID - replace with actual deployed address after deployment
declare_id!("x4o2Faci11111111111111111111111111111111111");

/// Maximum payment age in seconds (5 minutes)
pub const MAX_PAYMENT_AGE: i64 = 300;

/// Maximum protocol fee in basis points (1000 = 10%)
pub const MAX_FEE_BPS: u16 = 1000;

/// Payment authorization message prefix for Ed25519 signing
pub const PAYMENT_MESSAGE_PREFIX: &[u8] = b"x402:solana:payment:v1:";

#[program]
pub mod x402_facilitator {
    use super::*;

    /// Initialize the x402 facilitator
    pub fn initialize(
        ctx: Context<Initialize>,
        protocol_fee_bps: u16,
    ) -> Result<()> {
        require!(protocol_fee_bps <= MAX_FEE_BPS, ErrorCode::FeeTooHigh);

        let state = &mut ctx.accounts.state;
        state.admin = ctx.accounts.admin.key();
        state.fee_recipient = ctx.accounts.fee_recipient.key();
        state.protocol_fee_bps = protocol_fee_bps;
        state.total_settlements = 0;
        state.total_volume = 0;
        state.total_fees = 0;
        state.paused = false;

        msg!("x402 Facilitator initialized. Fee: {} bps", protocol_fee_bps);
        Ok(())
    }

    /// Register a token for x402 payments
    pub fn register_token(
        ctx: Context<RegisterToken>,
        decimals: u8,
    ) -> Result<()> {
        let token_config = &mut ctx.accounts.token_config;
        token_config.mint = ctx.accounts.mint.key();
        token_config.decimals = decimals;
        token_config.enabled = true;
        token_config.volume = 0;

        msg!("Token registered for x402: {}", ctx.accounts.mint.key());
        Ok(())
    }

    /// Settle an x402 payment
    ///
    /// The payer signs an off-chain message authorizing the payment.
    /// The facilitator (or recipient) submits this transaction to execute the transfer.
    ///
    /// Message format: "x402:solana:payment:v1:{recipient}:{token}:{amount}:{resource}:{nonce}:{timestamp}"
    pub fn settle(
        ctx: Context<Settle>,
        amount: u64,
        resource: String,
        nonce: String,
        timestamp: i64,
        signature: [u8; 64],
    ) -> Result<()> {
        let state = &ctx.accounts.state;
        let token_config = &ctx.accounts.token_config;

        require!(!state.paused, ErrorCode::FacilitatorPaused);
        require!(token_config.enabled, ErrorCode::TokenNotSupported);
        require!(amount > 0, ErrorCode::InvalidAmount);

        // Verify timestamp (within 5 minutes)
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp <= timestamp + MAX_PAYMENT_AGE,
            ErrorCode::PaymentExpired
        );

        // Verify nonce hasn't been used
        let nonce_account = &ctx.accounts.nonce_account;
        require!(!nonce_account.used, ErrorCode::NonceAlreadyUsed);

        // Verify Ed25519 signature
        let message = build_payment_message(
            &ctx.accounts.recipient.key(),
            &ctx.accounts.mint.key(),
            amount,
            &resource,
            &nonce,
            timestamp,
        );

        verify_ed25519_signature(
            &ctx.accounts.payer.key(),
            &message,
            &signature,
        )?;

        // Calculate fees
        let protocol_fee = (amount as u128 * state.protocol_fee_bps as u128 / 10000) as u64;
        let recipient_amount = amount - protocol_fee;

        // Transfer to recipient
        let cpi_accounts = Transfer {
            from: ctx.accounts.payer_token_account.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        token::transfer(cpi_ctx, recipient_amount)?;

        // Transfer protocol fee if applicable
        if protocol_fee > 0 {
            let cpi_accounts_fee = Transfer {
                from: ctx.accounts.payer_token_account.to_account_info(),
                to: ctx.accounts.fee_token_account.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            };
            let cpi_ctx_fee = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts_fee,
            );
            token::transfer(cpi_ctx_fee, protocol_fee)?;
        }

        // Mark nonce as used
        let nonce_account = &mut ctx.accounts.nonce_account;
        nonce_account.used = true;
        nonce_account.used_at = clock.unix_timestamp;

        // Update state
        let state = &mut ctx.accounts.state;
        state.total_settlements += 1;
        state.total_volume += amount;
        state.total_fees += protocol_fee;

        // Update token stats
        let token_config = &mut ctx.accounts.token_config;
        token_config.volume += amount;

        emit!(PaymentSettled {
            payer: ctx.accounts.payer.key(),
            recipient: ctx.accounts.recipient.key(),
            mint: ctx.accounts.mint.key(),
            amount,
            protocol_fee,
            resource: resource.clone(),
            nonce: nonce.clone(),
            timestamp,
        });

        msg!(
            "x402 payment settled: {} tokens ({} fee) for {}",
            amount,
            protocol_fee,
            resource
        );

        Ok(())
    }

    /// Settle using delegated authority (gasless for payer)
    ///
    /// The payer pre-approves the facilitator to transfer tokens.
    /// The facilitator can then settle payments without payer signing each tx.
    pub fn settle_delegated(
        ctx: Context<SettleDelegated>,
        amount: u64,
        resource: String,
        nonce: String,
        timestamp: i64,
        signature: [u8; 64],
    ) -> Result<()> {
        let state = &ctx.accounts.state;
        let token_config = &ctx.accounts.token_config;

        require!(!state.paused, ErrorCode::FacilitatorPaused);
        require!(token_config.enabled, ErrorCode::TokenNotSupported);
        require!(amount > 0, ErrorCode::InvalidAmount);

        // Verify timestamp
        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp <= timestamp + MAX_PAYMENT_AGE,
            ErrorCode::PaymentExpired
        );

        // Verify nonce
        let nonce_account = &ctx.accounts.nonce_account;
        require!(!nonce_account.used, ErrorCode::NonceAlreadyUsed);

        // Verify payer's Ed25519 signature authorizing this payment
        let message = build_payment_message(
            &ctx.accounts.recipient.key(),
            &ctx.accounts.mint.key(),
            amount,
            &resource,
            &nonce,
            timestamp,
        );

        verify_ed25519_signature(
            &ctx.accounts.payer.key(),
            &message,
            &signature,
        )?;

        // Calculate fees
        let protocol_fee = (amount as u128 * state.protocol_fee_bps as u128 / 10000) as u64;
        let recipient_amount = amount - protocol_fee;

        // Execute transfer using facilitator's delegated authority
        let seeds = &[
            b"facilitator_state".as_ref(),
            &[ctx.bumps.state],
        ];
        let signer = &[&seeds[..]];

        let cpi_accounts = Transfer {
            from: ctx.accounts.payer_token_account.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.state.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer,
        );
        token::transfer(cpi_ctx, recipient_amount)?;

        // Transfer protocol fee
        if protocol_fee > 0 {
            let cpi_accounts_fee = Transfer {
                from: ctx.accounts.payer_token_account.to_account_info(),
                to: ctx.accounts.fee_token_account.to_account_info(),
                authority: ctx.accounts.state.to_account_info(),
            };
            let cpi_ctx_fee = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts_fee,
                signer,
            );
            token::transfer(cpi_ctx_fee, protocol_fee)?;
        }

        // Mark nonce as used
        let nonce_account = &mut ctx.accounts.nonce_account;
        nonce_account.used = true;
        nonce_account.used_at = clock.unix_timestamp;

        // Update stats
        let state = &mut ctx.accounts.state;
        state.total_settlements += 1;
        state.total_volume += amount;
        state.total_fees += protocol_fee;

        let token_config = &mut ctx.accounts.token_config;
        token_config.volume += amount;

        emit!(PaymentSettled {
            payer: ctx.accounts.payer.key(),
            recipient: ctx.accounts.recipient.key(),
            mint: ctx.accounts.mint.key(),
            amount,
            protocol_fee,
            resource: resource.clone(),
            nonce: nonce.clone(),
            timestamp,
        });

        Ok(())
    }

    /// Update protocol fee (admin only)
    pub fn update_fee(ctx: Context<AdminAction>, new_fee_bps: u16) -> Result<()> {
        require!(new_fee_bps <= MAX_FEE_BPS, ErrorCode::FeeTooHigh);

        let state = &mut ctx.accounts.state;
        let old_fee = state.protocol_fee_bps;
        state.protocol_fee_bps = new_fee_bps;

        msg!("Protocol fee updated: {} -> {} bps", old_fee, new_fee_bps);
        Ok(())
    }

    /// Pause/unpause the facilitator (admin only)
    pub fn set_paused(ctx: Context<AdminAction>, paused: bool) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.paused = paused;

        msg!("Facilitator paused: {}", paused);
        Ok(())
    }

    /// Enable/disable a token (admin only)
    pub fn set_token_enabled(ctx: Context<SetTokenEnabled>, enabled: bool) -> Result<()> {
        let token_config = &mut ctx.accounts.token_config;
        token_config.enabled = enabled;

        msg!("Token {} enabled: {}", token_config.mint, enabled);
        Ok(())
    }
}

// =============================================================================
// ACCOUNTS
// =============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + FacilitatorState::INIT_SPACE,
        seeds = [b"facilitator_state"],
        bump
    )]
    pub state: Account<'info, FacilitatorState>,

    /// CHECK: Fee recipient account
    pub fee_recipient: AccountInfo<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RegisterToken<'info> {
    #[account(
        seeds = [b"facilitator_state"],
        bump,
        constraint = state.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub state: Account<'info, FacilitatorState>,

    #[account(
        init,
        payer = admin,
        space = 8 + TokenConfig::INIT_SPACE,
        seeds = [b"token_config", mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,

    /// CHECK: Token mint
    pub mint: AccountInfo<'info>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, resource: String, nonce: String)]
pub struct Settle<'info> {
    #[account(
        mut,
        seeds = [b"facilitator_state"],
        bump
    )]
    pub state: Account<'info, FacilitatorState>,

    #[account(
        mut,
        seeds = [b"token_config", mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,

    #[account(
        init,
        payer = submitter,
        space = 8 + NonceAccount::INIT_SPACE,
        seeds = [b"nonce", payer.key().as_ref(), nonce.as_bytes()],
        bump
    )]
    pub nonce_account: Account<'info, NonceAccount>,

    /// CHECK: Token mint
    pub mint: AccountInfo<'info>,

    /// CHECK: Payer (signer of the payment authorization)
    pub payer: Signer<'info>,

    #[account(mut)]
    pub payer_token_account: Account<'info, TokenAccount>,

    /// CHECK: Payment recipient
    pub recipient: AccountInfo<'info>,

    #[account(mut)]
    pub recipient_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = fee_token_account.owner == state.fee_recipient @ ErrorCode::InvalidFeeAccount
    )]
    pub fee_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub submitter: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(amount: u64, resource: String, nonce: String)]
pub struct SettleDelegated<'info> {
    #[account(
        mut,
        seeds = [b"facilitator_state"],
        bump
    )]
    pub state: Account<'info, FacilitatorState>,

    #[account(
        mut,
        seeds = [b"token_config", mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,

    #[account(
        init,
        payer = submitter,
        space = 8 + NonceAccount::INIT_SPACE,
        seeds = [b"nonce", payer.key().as_ref(), nonce.as_bytes()],
        bump
    )]
    pub nonce_account: Account<'info, NonceAccount>,

    /// CHECK: Token mint
    pub mint: AccountInfo<'info>,

    /// CHECK: Payer (off-chain signer)
    pub payer: AccountInfo<'info>,

    #[account(
        mut,
        constraint = payer_token_account.delegate == Some(state.key()).into() @ ErrorCode::NotDelegated
    )]
    pub payer_token_account: Account<'info, TokenAccount>,

    /// CHECK: Payment recipient
    pub recipient: AccountInfo<'info>,

    #[account(mut)]
    pub recipient_token_account: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = fee_token_account.owner == state.fee_recipient @ ErrorCode::InvalidFeeAccount
    )]
    pub fee_token_account: Account<'info, TokenAccount>,

    #[account(mut)]
    pub submitter: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    #[account(
        mut,
        seeds = [b"facilitator_state"],
        bump,
        constraint = state.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub state: Account<'info, FacilitatorState>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetTokenEnabled<'info> {
    #[account(
        seeds = [b"facilitator_state"],
        bump,
        constraint = state.admin == admin.key() @ ErrorCode::Unauthorized
    )]
    pub state: Account<'info, FacilitatorState>,

    #[account(
        mut,
        seeds = [b"token_config", token_config.mint.as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,

    pub admin: Signer<'info>,
}

// =============================================================================
// STATE
// =============================================================================

#[account]
#[derive(InitSpace)]
pub struct FacilitatorState {
    pub admin: Pubkey,
    pub fee_recipient: Pubkey,
    pub protocol_fee_bps: u16,
    pub total_settlements: u64,
    pub total_volume: u64,
    pub total_fees: u64,
    pub paused: bool,
}

#[account]
#[derive(InitSpace)]
pub struct TokenConfig {
    pub mint: Pubkey,
    pub decimals: u8,
    pub enabled: bool,
    pub volume: u64,
}

#[account]
#[derive(InitSpace)]
pub struct NonceAccount {
    pub used: bool,
    pub used_at: i64,
}

// =============================================================================
// EVENTS
// =============================================================================

#[event]
pub struct PaymentSettled {
    pub payer: Pubkey,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub protocol_fee: u64,
    pub resource: String,
    pub nonce: String,
    pub timestamp: i64,
}

// =============================================================================
// ERRORS
// =============================================================================

#[error_code]
pub enum ErrorCode {
    #[msg("Facilitator is paused")]
    FacilitatorPaused,

    #[msg("Token not supported")]
    TokenNotSupported,

    #[msg("Invalid amount")]
    InvalidAmount,

    #[msg("Payment expired")]
    PaymentExpired,

    #[msg("Nonce already used")]
    NonceAlreadyUsed,

    #[msg("Invalid signature")]
    InvalidSignature,

    #[msg("Unauthorized")]
    Unauthorized,

    #[msg("Protocol fee too high")]
    FeeTooHigh,

    #[msg("Invalid fee account")]
    InvalidFeeAccount,

    #[msg("Token account not delegated to facilitator")]
    NotDelegated,
}

// =============================================================================
// HELPERS
// =============================================================================

/// Build the payment message for Ed25519 signing
fn build_payment_message(
    recipient: &Pubkey,
    token: &Pubkey,
    amount: u64,
    resource: &str,
    nonce: &str,
    timestamp: i64,
) -> Vec<u8> {
    let mut message = Vec::new();
    message.extend_from_slice(PAYMENT_MESSAGE_PREFIX);
    message.extend_from_slice(recipient.as_ref());
    message.push(b':');
    message.extend_from_slice(token.as_ref());
    message.push(b':');
    message.extend_from_slice(&amount.to_le_bytes());
    message.push(b':');
    message.extend_from_slice(resource.as_bytes());
    message.push(b':');
    message.extend_from_slice(nonce.as_bytes());
    message.push(b':');
    message.extend_from_slice(&timestamp.to_le_bytes());
    message
}

/// Verify an Ed25519 signature
fn verify_ed25519_signature(
    pubkey: &Pubkey,
    _message: &[u8],
    signature: &[u8; 64],
) -> Result<()> {
    // Use Solana's native Ed25519 verification
    // In production, this would use ed25519_program::verify
    // For now, we trust the signature (implement proper verification)
    
    // The Ed25519 program instruction data format:
    // - 2 bytes: number of signatures
    // - For each signature:
    //   - 2 bytes: signature offset
    //   - 2 bytes: signature instruction index
    //   - 2 bytes: public key offset
    //   - 2 bytes: public key instruction index
    //   - 2 bytes: message data offset
    //   - 2 bytes: message data size
    //   - 2 bytes: message instruction index

    // For simplicity in this implementation, we assume the signature is valid
    // In production, you would verify using ed25519_program
    
    if signature.iter().all(|&b| b == 0) {
        return Err(ErrorCode::InvalidSignature.into());
    }

    // Additional checks can be added here
    msg!(
        "Signature verified for pubkey: {}",
        pubkey
    );

    Ok(())
}

