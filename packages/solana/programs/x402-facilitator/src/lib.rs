//! x402 Payment Facilitator for Solana
//! Gasless micropayments using SPL tokens with Ed25519 authorization.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    ed25519_program,
    sysvar::instructions::{self, load_current_index_checked, load_instruction_at_checked},
};
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

declare_id!("FEsMtN2PfdzMPYCFLDLth3VxjfrozuzHodV24znt22B7");

pub const MAX_PAYMENT_AGE: i64 = 300;
pub const MAX_FEE_BPS: u16 = 1000;
pub const PAYMENT_MESSAGE_PREFIX: &[u8] = b"x402:solana:payment:v1:";

// Ed25519 instruction data offsets (from Solana's ed25519 program spec)
const ED25519_PUBKEY_OFFSET: usize = 16;
const ED25519_MESSAGE_DATA_OFFSET: usize = 112;

#[program]
pub mod x402_facilitator {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, protocol_fee_bps: u16) -> Result<()> {
        require!(protocol_fee_bps <= MAX_FEE_BPS, ErrorCode::FeeTooHigh);

        let state = &mut ctx.accounts.state;
        state.admin = ctx.accounts.admin.key();
        state.fee_recipient = ctx.accounts.fee_recipient.key();
        state.protocol_fee_bps = protocol_fee_bps;
        state.total_settlements = 0;
        state.total_volume = 0;
        state.total_fees = 0;
        state.paused = false;
        Ok(())
    }

    pub fn register_token(ctx: Context<RegisterToken>, decimals: u8) -> Result<()> {
        let token_config = &mut ctx.accounts.token_config;
        token_config.mint = ctx.accounts.mint.key();
        token_config.decimals = decimals;
        token_config.enabled = true;
        token_config.volume = 0;
        Ok(())
    }

    pub fn settle(
        ctx: Context<Settle>,
        amount: u64,
        resource: String,
        nonce: String,
        timestamp: i64,
        _signature: [u8; 64], // Signature is verified via Ed25519 instruction, kept for message construction
    ) -> Result<()> {
        let state = &ctx.accounts.state;
        let token_config = &ctx.accounts.token_config;

        require!(!state.paused, ErrorCode::FacilitatorPaused);
        require!(token_config.enabled, ErrorCode::TokenNotSupported);
        require!(amount > 0, ErrorCode::InvalidAmount);

        let clock = Clock::get()?;
        // SECURITY: Prevent future timestamps that could keep payments valid indefinitely
        require!(timestamp <= clock.unix_timestamp, ErrorCode::FutureTimestamp);
        require!(clock.unix_timestamp <= timestamp + MAX_PAYMENT_AGE, ErrorCode::PaymentExpired);
        require!(!ctx.accounts.nonce_account.used, ErrorCode::NonceAlreadyUsed);

        // Build expected message for verification
        let expected_message = build_payment_message(
            &ctx.accounts.recipient.key(),
            &ctx.accounts.mint.key(),
            amount,
            &resource,
            &nonce,
            timestamp,
        );

        // Verify Ed25519 signature via instructions sysvar
        verify_ed25519_via_sysvar(
            &ctx.accounts.instructions_sysvar,
            &ctx.accounts.payer.key(),
            &expected_message,
        )?;

        let protocol_fee = (amount as u128 * state.protocol_fee_bps as u128 / 10000) as u64;
        let recipient_amount = amount - protocol_fee;

        // Transfer to recipient
        let cpi_accounts = Transfer {
            from: ctx.accounts.payer_token_account.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            recipient_amount,
        )?;

        // Transfer protocol fee
        if protocol_fee > 0 {
            let cpi_accounts_fee = Transfer {
                from: ctx.accounts.payer_token_account.to_account_info(),
                to: ctx.accounts.fee_token_account.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            };
            token::transfer(
                CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts_fee),
                protocol_fee,
            )?;
        }

        // Mark nonce used
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
            resource,
            nonce,
            timestamp,
        });

        Ok(())
    }

    pub fn update_fee(ctx: Context<AdminAction>, new_fee_bps: u16) -> Result<()> {
        require!(new_fee_bps <= MAX_FEE_BPS, ErrorCode::FeeTooHigh);
        ctx.accounts.state.protocol_fee_bps = new_fee_bps;
        Ok(())
    }

    pub fn set_paused(ctx: Context<AdminAction>, paused: bool) -> Result<()> {
        ctx.accounts.state.paused = paused;
        Ok(())
    }

    pub fn set_token_enabled(ctx: Context<SetTokenEnabled>, enabled: bool) -> Result<()> {
        ctx.accounts.token_config.enabled = enabled;
        Ok(())
    }
}

// Accounts

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
    /// CHECK: Fee recipient
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
    #[account(mut, seeds = [b"facilitator_state"], bump)]
    pub state: Account<'info, FacilitatorState>,
    #[account(mut, seeds = [b"token_config", mint.key().as_ref()], bump)]
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
    /// CHECK: Payer who signed the authorization (verified via Ed25519 instruction)
    pub payer: AccountInfo<'info>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = payer
    )]
    pub payer_token_account: Account<'info, TokenAccount>,
    /// CHECK: Recipient
    pub recipient: AccountInfo<'info>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = recipient
    )]
    pub recipient_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        token::mint = mint,
        constraint = fee_token_account.owner == state.fee_recipient @ ErrorCode::InvalidFeeAccount
    )]
    pub fee_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub submitter: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    /// CHECK: Instructions sysvar for Ed25519 signature verification
    #[account(address = instructions::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
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
    #[account(mut, seeds = [b"token_config", token_config.mint.as_ref()], bump)]
    pub token_config: Account<'info, TokenConfig>,
    pub admin: Signer<'info>,
}

// State

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

// Events

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

// Errors

#[error_code]
pub enum ErrorCode {
    #[msg("Facilitator paused")]
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
    #[msg("Fee too high")]
    FeeTooHigh,
    #[msg("Invalid fee account")]
    InvalidFeeAccount,
    #[msg("Timestamp cannot be in the future")]
    FutureTimestamp,
    #[msg("Math overflow")]
    MathOverflow,
}

// Helpers

fn build_payment_message(
    recipient: &Pubkey,
    token: &Pubkey,
    amount: u64,
    resource: &str,
    nonce: &str,
    timestamp: i64,
) -> Vec<u8> {
    let mut msg = Vec::with_capacity(200);
    msg.extend_from_slice(PAYMENT_MESSAGE_PREFIX);
    msg.extend_from_slice(recipient.as_ref());
    msg.push(b':');
    msg.extend_from_slice(token.as_ref());
    msg.push(b':');
    msg.extend_from_slice(&amount.to_le_bytes());
    msg.push(b':');
    msg.extend_from_slice(resource.as_bytes());
    msg.push(b':');
    msg.extend_from_slice(nonce.as_bytes());
    msg.push(b':');
    msg.extend_from_slice(&timestamp.to_le_bytes());
    msg
}

/// Verify Ed25519 signature via the instructions sysvar
/// 
/// Solana's Ed25519 program must be called BEFORE this instruction in the same transaction.
/// The Ed25519 instruction contains: pubkey, message, signature
/// We verify that a valid Ed25519 instruction exists with matching pubkey and message.
fn verify_ed25519_via_sysvar(
    instructions_sysvar: &AccountInfo,
    expected_pubkey: &Pubkey,
    expected_message: &[u8],
) -> Result<()> {
    // Get current instruction index
    let current_ix_index = load_current_index_checked(instructions_sysvar)
        .map_err(|_| ErrorCode::InvalidSignature)?;
    
    // Ed25519 instruction must come before our instruction
    if current_ix_index == 0 {
        msg!("Ed25519 instruction must precede settle instruction");
        return Err(ErrorCode::InvalidSignature.into());
    }

    // Check all preceding instructions for a valid Ed25519 verification
    for ix_index in 0..current_ix_index {
        let ix = load_instruction_at_checked(ix_index as usize, instructions_sysvar)
            .map_err(|_| ErrorCode::InvalidSignature)?;

        // Must be from the Ed25519 program
        if ix.program_id != ed25519_program::ID {
            continue;
        }

        // Ed25519 instruction data format (from Solana ed25519 program spec):
        // [0]: num_signatures (1 byte)
        // [1]: padding (1 byte)  
        // [2-3]: signature_offset (2 bytes LE)
        // [4-5]: signature_instruction_index (2 bytes LE)
        // [6-7]: public_key_offset (2 bytes LE)
        // [8-9]: public_key_instruction_index (2 bytes LE)
        // [10-11]: message_data_offset (2 bytes LE)
        // [12-13]: message_data_size (2 bytes LE)
        // [14-15]: message_instruction_index (2 bytes LE)
        // [16-47]: public_key (32 bytes)
        // [48-111]: signature (64 bytes)
        // [112+]: message data
        
        if ix.data.len() < ED25519_MESSAGE_DATA_OFFSET {
            continue;
        }

        // Extract public key from instruction data
        let pubkey_bytes = &ix.data[ED25519_PUBKEY_OFFSET..ED25519_PUBKEY_OFFSET + 32];
        let ix_pubkey = Pubkey::try_from(pubkey_bytes)
            .map_err(|_| ErrorCode::InvalidSignature)?;

        // Check pubkey matches
        if ix_pubkey != *expected_pubkey {
            continue;
        }

        // Extract message size from instruction data
        let msg_size = u16::from_le_bytes([ix.data[12], ix.data[13]]) as usize;
        
        // Extract message from instruction data
        if ix.data.len() < ED25519_MESSAGE_DATA_OFFSET + msg_size {
            continue;
        }
        let ix_message = &ix.data[ED25519_MESSAGE_DATA_OFFSET..ED25519_MESSAGE_DATA_OFFSET + msg_size];

        // Check message matches
        if ix_message == expected_message {
            msg!("Ed25519 signature verified for pubkey: {}", expected_pubkey);
            return Ok(());
        }
    }

    msg!("No valid Ed25519 instruction found for pubkey: {}", expected_pubkey);
    Err(ErrorCode::InvalidSignature.into())
}
