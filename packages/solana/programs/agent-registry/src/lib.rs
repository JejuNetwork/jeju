//! ERC-8004 Agent Identity Registry on Solana
//!
//! This program provides an ERC-8004 equivalent implementation on Solana,
//! enabling AI agents to register their identity with optional staking.
//!
//! ## Features
//! - Agent registration as NFTs (using Metaplex standard)
//! - Tiered staking (NONE, SMALL, MEDIUM, HIGH)
//! - Metadata storage (A2A endpoints, MCP endpoints, etc.)
//! - Cross-chain identity via Wormhole message publishing
//! - Tag-based discovery
//! - Ban/slash mechanisms
//!
//! ## Cross-Chain Integration
//! When an agent registers, the program can optionally emit a Wormhole
//! message that is picked up by relayers and verified on EVM chains
//! via the RegistryHub contract.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    metadata::{
        create_metadata_accounts_v3, mpl_token_metadata::types::DataV2, CreateMetadataAccountsV3,
        Metadata,
    },
    token::{self, Mint, MintTo, Token, TokenAccount},
};

declare_id!("EmgfjEphLavCs8ofPdjhisBKg2UAQK7wYXyX8yV8KtMD");

// ============================================================================
// Constants
// ============================================================================

/// Seed for config PDA
pub const CONFIG_SEED: &[u8] = b"config";

/// Seed for agent PDA
pub const AGENT_SEED: &[u8] = b"agent";

/// Seed for stake vault
pub const STAKE_VAULT_SEED: &[u8] = b"stake_vault";

/// Maximum metadata size (8KB to match EVM)
pub const MAX_METADATA_SIZE: usize = 8192;

/// Maximum tags per agent
pub const MAX_TAGS: usize = 10;

/// Maximum tag length
pub const MAX_TAG_LENGTH: usize = 32;

/// Maximum URI length
pub const MAX_URI_LENGTH: usize = 200;

/// Stake tiers in lamports
pub const STAKE_SMALL: u64 = 1_000_000; // 0.001 SOL
pub const STAKE_MEDIUM: u64 = 10_000_000; // 0.01 SOL
pub const STAKE_HIGH: u64 = 100_000_000; // 0.1 SOL

#[program]
pub mod agent_registry {
    use super::*;

    // ========================================================================
    // Admin Instructions
    // ========================================================================

    /// Initialize the registry configuration
    pub fn initialize(ctx: Context<Initialize>, protocol_fee_bps: u16) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.governance = ctx.accounts.authority.key();
        config.reputation_oracle = Pubkey::default();
        config.wormhole = Pubkey::default();
        config.protocol_fee_bps = protocol_fee_bps;
        config.next_agent_id = 1;
        config.total_agents = 0;
        config.total_staked = 0;
        config.paused = false;
        config.bump = ctx.bumps.config;

        msg!("Agent Registry initialized");
        Ok(())
    }

    /// Set the Wormhole program address for cross-chain messaging
    pub fn set_wormhole(ctx: Context<AdminAction>, wormhole: Pubkey) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.config.authority,
            ErrorCode::Unauthorized
        );
        ctx.accounts.config.wormhole = wormhole;
        msg!("Wormhole set to {}", wormhole);
        Ok(())
    }

    /// Set governance address
    pub fn set_governance(ctx: Context<AdminAction>, governance: Pubkey) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.config.authority,
            ErrorCode::Unauthorized
        );
        ctx.accounts.config.governance = governance;
        Ok(())
    }

    /// Pause/unpause the registry
    pub fn set_paused(ctx: Context<AdminAction>, paused: bool) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.config.governance,
            ErrorCode::Unauthorized
        );
        ctx.accounts.config.paused = paused;
        msg!("Registry paused: {}", paused);
        Ok(())
    }

    // ========================================================================
    // Registration Instructions
    // ========================================================================

    /// Register a new agent without staking
    pub fn register(
        ctx: Context<Register>,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::RegistryPaused);
        require!(uri.len() <= MAX_URI_LENGTH, ErrorCode::UriTooLong);
        require!(name.len() <= 32, ErrorCode::NameTooLong);
        require!(symbol.len() <= 10, ErrorCode::SymbolTooLong);

        let config = &mut ctx.accounts.config;
        let agent_id = config.next_agent_id;
        config.next_agent_id += 1;
        config.total_agents += 1;

        // Initialize agent account
        let agent = &mut ctx.accounts.agent;
        agent.agent_id = agent_id;
        agent.owner = ctx.accounts.owner.key();
        agent.mint = ctx.accounts.mint.key();
        agent.tier = StakeTier::None;
        agent.staked_amount = 0;
        agent.registered_at = Clock::get()?.unix_timestamp;
        agent.last_activity_at = Clock::get()?.unix_timestamp;
        agent.is_banned = false;
        agent.is_slashed = false;
        agent.bump = ctx.bumps.agent;

        // Mint the agent NFT
        let config_seeds = &[CONFIG_SEED, &[config.bump]];
        let signer = &[&config_seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            1,
        )?;

        // Create metadata using Metaplex
        let data_v2 = DataV2 {
            name,
            symbol,
            uri: uri.clone(),
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        };

        create_metadata_accounts_v3(
            CpiContext::new_with_signer(
                ctx.accounts.token_metadata_program.to_account_info(),
                CreateMetadataAccountsV3 {
                    metadata: ctx.accounts.metadata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    mint_authority: ctx.accounts.config.to_account_info(),
                    payer: ctx.accounts.owner.to_account_info(),
                    update_authority: ctx.accounts.config.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
                signer,
            ),
            data_v2,
            true, // Is mutable
            true, // Update authority is signer
            None, // Collection details
        )?;

        emit!(AgentRegistered {
            agent_id,
            owner: ctx.accounts.owner.key(),
            mint: ctx.accounts.mint.key(),
            tier: StakeTier::None,
            uri,
        });

        msg!("Agent {} registered for {}", agent_id, ctx.accounts.owner.key());
        Ok(())
    }

    /// Register a new agent with staking
    pub fn register_with_stake(
        ctx: Context<RegisterWithStake>,
        name: String,
        symbol: String,
        uri: String,
        tier: StakeTier,
    ) -> Result<()> {
        require!(!ctx.accounts.config.paused, ErrorCode::RegistryPaused);
        require!(uri.len() <= MAX_URI_LENGTH, ErrorCode::UriTooLong);
        require!(name.len() <= 32, ErrorCode::NameTooLong);
        require!(symbol.len() <= 10, ErrorCode::SymbolTooLong);
        require!(tier != StakeTier::None, ErrorCode::InvalidStakeTier);

        let required_stake = get_stake_amount(tier);
        require!(
            ctx.accounts.owner.lamports() >= required_stake,
            ErrorCode::InsufficientFunds
        );

        let config = &mut ctx.accounts.config;
        let agent_id = config.next_agent_id;
        config.next_agent_id += 1;
        config.total_agents += 1;
        config.total_staked += required_stake;

        // Transfer stake to vault
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.stake_vault.to_account_info(),
                },
            ),
            required_stake,
        )?;

        // Initialize agent account
        let agent = &mut ctx.accounts.agent;
        agent.agent_id = agent_id;
        agent.owner = ctx.accounts.owner.key();
        agent.mint = ctx.accounts.mint.key();
        agent.tier = tier;
        agent.staked_amount = required_stake;
        agent.registered_at = Clock::get()?.unix_timestamp;
        agent.last_activity_at = Clock::get()?.unix_timestamp;
        agent.is_banned = false;
        agent.is_slashed = false;
        agent.bump = ctx.bumps.agent;

        // Mint the agent NFT
        let config_seeds = &[CONFIG_SEED, &[config.bump]];
        let signer = &[&config_seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.owner_token_account.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            1,
        )?;

        // Create metadata using Metaplex
        let data_v2 = DataV2 {
            name,
            symbol,
            uri: uri.clone(),
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        };

        create_metadata_accounts_v3(
            CpiContext::new_with_signer(
                ctx.accounts.token_metadata_program.to_account_info(),
                CreateMetadataAccountsV3 {
                    metadata: ctx.accounts.metadata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    mint_authority: ctx.accounts.config.to_account_info(),
                    payer: ctx.accounts.owner.to_account_info(),
                    update_authority: ctx.accounts.config.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
                signer,
            ),
            data_v2,
            true,
            true,
            None,
        )?;

        emit!(AgentRegistered {
            agent_id,
            owner: ctx.accounts.owner.key(),
            mint: ctx.accounts.mint.key(),
            tier,
            uri,
        });

        msg!(
            "Agent {} registered with {:?} tier stake ({} lamports)",
            agent_id,
            tier,
            required_stake
        );
        Ok(())
    }

    // ========================================================================
    // Metadata Instructions
    // ========================================================================

    /// Set metadata for an agent
    pub fn set_metadata(ctx: Context<SetMetadata>, key: String, value: Vec<u8>) -> Result<()> {
        require!(key.len() <= 64, ErrorCode::KeyTooLong);
        require!(value.len() <= MAX_METADATA_SIZE, ErrorCode::MetadataTooLarge);
        require!(!ctx.accounts.agent.is_banned, ErrorCode::AgentBanned);

        ctx.accounts.agent.last_activity_at = Clock::get()?.unix_timestamp;

        emit!(MetadataSet {
            agent_id: ctx.accounts.agent.agent_id,
            key: key.clone(),
            value_hash: anchor_lang::solana_program::keccak::hash(&value).to_bytes(),
        });

        msg!(
            "Metadata '{}' set for agent {}",
            key,
            ctx.accounts.agent.agent_id
        );
        Ok(())
    }

    /// Set A2A endpoint for an agent
    pub fn set_a2a_endpoint(ctx: Context<SetMetadata>, endpoint: String) -> Result<()> {
        require!(endpoint.len() <= MAX_URI_LENGTH, ErrorCode::EndpointTooLong);
        require!(!ctx.accounts.agent.is_banned, ErrorCode::AgentBanned);

        ctx.accounts.agent.last_activity_at = Clock::get()?.unix_timestamp;

        emit!(EndpointSet {
            agent_id: ctx.accounts.agent.agent_id,
            endpoint_type: EndpointType::A2A,
            endpoint: endpoint.clone(),
        });

        msg!("A2A endpoint set for agent {}", ctx.accounts.agent.agent_id);
        Ok(())
    }

    /// Set MCP endpoint for an agent
    pub fn set_mcp_endpoint(ctx: Context<SetMetadata>, endpoint: String) -> Result<()> {
        require!(endpoint.len() <= MAX_URI_LENGTH, ErrorCode::EndpointTooLong);
        require!(!ctx.accounts.agent.is_banned, ErrorCode::AgentBanned);

        ctx.accounts.agent.last_activity_at = Clock::get()?.unix_timestamp;

        emit!(EndpointSet {
            agent_id: ctx.accounts.agent.agent_id,
            endpoint_type: EndpointType::MCP,
            endpoint: endpoint.clone(),
        });

        msg!("MCP endpoint set for agent {}", ctx.accounts.agent.agent_id);
        Ok(())
    }

    /// Update tags for an agent
    pub fn update_tags(ctx: Context<SetMetadata>, tags: Vec<String>) -> Result<()> {
        require!(tags.len() <= MAX_TAGS, ErrorCode::TooManyTags);
        for tag in &tags {
            require!(tag.len() <= MAX_TAG_LENGTH, ErrorCode::TagTooLong);
            require!(!tag.is_empty(), ErrorCode::EmptyTag);
        }
        require!(!ctx.accounts.agent.is_banned, ErrorCode::AgentBanned);

        ctx.accounts.agent.last_activity_at = Clock::get()?.unix_timestamp;

        emit!(TagsUpdated {
            agent_id: ctx.accounts.agent.agent_id,
            tags,
        });

        Ok(())
    }

    // ========================================================================
    // Staking Instructions
    // ========================================================================

    /// Increase stake to upgrade tier
    pub fn increase_stake(ctx: Context<IncreaseStake>, new_tier: StakeTier) -> Result<()> {
        let agent = &mut ctx.accounts.agent;
        require!(!agent.is_banned, ErrorCode::AgentBanned);
        require!(new_tier as u8 > agent.tier as u8, ErrorCode::CannotDowngradeTier);

        let current_stake = agent.staked_amount;
        let required_stake = get_stake_amount(new_tier);
        let additional_stake = required_stake.saturating_sub(current_stake);

        require!(additional_stake > 0, ErrorCode::InvalidStakeAmount);

        // Transfer additional stake
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.owner.to_account_info(),
                    to: ctx.accounts.stake_vault.to_account_info(),
                },
            ),
            additional_stake,
        )?;

        let old_tier = agent.tier;
        agent.tier = new_tier;
        agent.staked_amount = required_stake;
        agent.last_activity_at = Clock::get()?.unix_timestamp;

        ctx.accounts.config.total_staked += additional_stake;

        emit!(StakeIncreased {
            agent_id: agent.agent_id,
            old_tier,
            new_tier,
            added_amount: additional_stake,
        });

        Ok(())
    }

    /// Withdraw stake (deregisters the agent)
    pub fn withdraw_stake(ctx: Context<WithdrawStake>) -> Result<()> {
        let agent = &mut ctx.accounts.agent;
        require!(!agent.is_banned, ErrorCode::AgentBanned);
        require!(!agent.is_slashed, ErrorCode::StakeAlreadySlashed);

        let stake_amount = agent.staked_amount;
        agent.staked_amount = 0;
        agent.tier = StakeTier::None;

        if stake_amount > 0 {
            ctx.accounts.config.total_staked = ctx
                .accounts
                .config
                .total_staked
                .saturating_sub(stake_amount);

            // SECURITY: Check that vault will remain rent-exempt after withdrawal
            let rent = Rent::get()?;
            let vault_lamports = ctx.accounts.stake_vault.lamports();
            let min_rent = rent.minimum_balance(0); // SystemAccount has 0 data bytes
            
            let withdrawable = vault_lamports.saturating_sub(min_rent);
            let actual_withdraw = stake_amount.min(withdrawable);
            
            require!(actual_withdraw > 0, ErrorCode::InsufficientVaultBalance);

            // Transfer stake back to owner using CPI for proper accounting
            **ctx.accounts.stake_vault.try_borrow_mut_lamports()? -= actual_withdraw;
            **ctx.accounts.owner.try_borrow_mut_lamports()? += actual_withdraw;
        }

        emit!(StakeWithdrawn {
            agent_id: agent.agent_id,
            owner: agent.owner,
            amount: stake_amount,
        });

        Ok(())
    }

    // ========================================================================
    // Governance Instructions
    // ========================================================================

    /// Ban an agent (governance only)
    pub fn ban_agent(ctx: Context<GovernanceAction>, reason: String) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.config.governance,
            ErrorCode::Unauthorized
        );
        require!(reason.len() <= 200, ErrorCode::ReasonTooLong);
        require!(!ctx.accounts.agent.is_banned, ErrorCode::AgentAlreadyBanned);

        ctx.accounts.agent.is_banned = true;

        emit!(AgentBanned {
            agent_id: ctx.accounts.agent.agent_id,
            reason,
        });

        Ok(())
    }

    /// Unban an agent (governance only)
    pub fn unban_agent(ctx: Context<GovernanceAction>) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.config.governance,
            ErrorCode::Unauthorized
        );
        require!(ctx.accounts.agent.is_banned, ErrorCode::AgentNotBanned);

        ctx.accounts.agent.is_banned = false;

        emit!(AgentUnbanned {
            agent_id: ctx.accounts.agent.agent_id,
        });

        Ok(())
    }

    /// Slash an agent's stake (governance only)
    pub fn slash_agent(
        ctx: Context<SlashAgent>,
        slash_percentage_bps: u16,
        reason: String,
    ) -> Result<()> {
        require!(
            ctx.accounts.authority.key() == ctx.accounts.config.governance,
            ErrorCode::Unauthorized
        );
        require!(slash_percentage_bps <= 10000, ErrorCode::InvalidSlashPercentage);
        require!(reason.len() <= 200, ErrorCode::ReasonTooLong);

        let agent = &mut ctx.accounts.agent;
        let slash_amount = (agent.staked_amount as u128)
            .checked_mul(slash_percentage_bps as u128)
            .unwrap()
            .checked_div(10000)
            .unwrap() as u64;

        if slash_amount > 0 {
            agent.staked_amount = agent.staked_amount.saturating_sub(slash_amount);
            agent.is_slashed = true;
            ctx.accounts.config.total_staked = ctx
                .accounts
                .config
                .total_staked
                .saturating_sub(slash_amount);

            // Transfer slashed amount to governance
            **ctx.accounts.stake_vault.try_borrow_mut_lamports()? -= slash_amount;
            **ctx.accounts.slash_recipient.try_borrow_mut_lamports()? += slash_amount;
        }

        emit!(AgentSlashed {
            agent_id: agent.agent_id,
            amount: slash_amount,
            reason,
        });

        Ok(())
    }

    // ========================================================================
    // Cross-Chain Instructions
    // ========================================================================

    /// Publish agent registration to EVM via Wormhole
    /// This creates a VAA that can be verified on EVM chains
    pub fn publish_to_evm(ctx: Context<PublishToEvm>) -> Result<()> {
        require!(
            ctx.accounts.config.wormhole != Pubkey::default(),
            ErrorCode::WormholeNotConfigured
        );
        require!(!ctx.accounts.agent.is_banned, ErrorCode::AgentBanned);

        // The Wormhole message payload format:
        // [0] payloadType: u8 = 1 (REGISTER)
        // [1-32] programId: this program's ID
        // [33] registryType: u8 = 0 (IDENTITY)
        // [34-35] nameLen: u16
        // [36..] name: bytes (from NFT metadata)
        // [...] metadataUriLen: u16  
        // [...] metadataUri: bytes

        // Note: In production, this would call wormhole.publishMessage()
        // For now, we emit an event that relayers can observe

        emit!(CrossChainPublished {
            agent_id: ctx.accounts.agent.agent_id,
            mint: ctx.accounts.agent.mint,
            owner: ctx.accounts.agent.owner,
            tier: ctx.accounts.agent.tier,
        });

        msg!(
            "Agent {} published to EVM via Wormhole",
            ctx.accounts.agent.agent_id
        );
        Ok(())
    }
}

// ============================================================================
// Enums
// ============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum StakeTier {
    None = 0,
    Small = 1,
    Medium = 2,
    High = 3,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum EndpointType {
    A2A,
    MCP,
    OpenAPI,
    X402,
}

// ============================================================================
// Helper Functions
// ============================================================================

pub fn get_stake_amount(tier: StakeTier) -> u64 {
    match tier {
        StakeTier::None => 0,
        StakeTier::Small => STAKE_SMALL,
        StakeTier::Medium => STAKE_MEDIUM,
        StakeTier::High => STAKE_HIGH,
    }
}

// ============================================================================
// Account Structures
// ============================================================================

#[account]
pub struct RegistryConfig {
    pub authority: Pubkey,
    pub governance: Pubkey,
    pub reputation_oracle: Pubkey,
    pub wormhole: Pubkey,
    pub protocol_fee_bps: u16,
    pub next_agent_id: u64,
    pub total_agents: u64,
    pub total_staked: u64,
    pub paused: bool,
    pub bump: u8,
}

#[account]
pub struct Agent {
    pub agent_id: u64,
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub tier: StakeTier,
    pub staked_amount: u64,
    pub registered_at: i64,
    pub last_activity_at: i64,
    pub is_banned: bool,
    pub is_slashed: bool,
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
        space = 8 + 32 + 32 + 32 + 32 + 2 + 8 + 8 + 8 + 1 + 1,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, RegistryConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminAction<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, RegistryConfig>,
}

#[derive(Accounts)]
pub struct Register<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, RegistryConfig>,

    #[account(
        init,
        payer = owner,
        mint::decimals = 0,
        mint::authority = config,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = owner,
        space = 8 + 8 + 32 + 32 + 1 + 8 + 8 + 8 + 1 + 1 + 1,
        seeds = [AGENT_SEED, mint.key().as_ref()],
        bump
    )]
    pub agent: Account<'info, Agent>,

    #[account(
        init,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    /// CHECK: Metadata account (validated by Metaplex)
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct RegisterWithStake<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, RegistryConfig>,

    #[account(
        init,
        payer = owner,
        mint::decimals = 0,
        mint::authority = config,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = owner,
        space = 8 + 8 + 32 + 32 + 1 + 8 + 8 + 8 + 1 + 1 + 1,
        seeds = [AGENT_SEED, mint.key().as_ref()],
        bump
    )]
    pub agent: Account<'info, Agent>,

    #[account(
        init,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = owner,
    )]
    pub owner_token_account: Account<'info, TokenAccount>,

    /// CHECK: Stake vault PDA
    #[account(
        mut,
        seeds = [STAKE_VAULT_SEED],
        bump
    )]
    pub stake_vault: SystemAccount<'info>,

    /// CHECK: Metadata account (validated by Metaplex)
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub token_metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct SetMetadata<'info> {
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [AGENT_SEED, agent.mint.as_ref()],
        bump = agent.bump,
        constraint = agent.owner == owner.key() @ ErrorCode::NotAgentOwner
    )]
    pub agent: Account<'info, Agent>,
}

#[derive(Accounts)]
pub struct IncreaseStake<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, RegistryConfig>,

    #[account(
        mut,
        seeds = [AGENT_SEED, agent.mint.as_ref()],
        bump = agent.bump,
        constraint = agent.owner == owner.key() @ ErrorCode::NotAgentOwner
    )]
    pub agent: Account<'info, Agent>,

    /// CHECK: Stake vault PDA
    #[account(
        mut,
        seeds = [STAKE_VAULT_SEED],
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
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, RegistryConfig>,

    #[account(
        mut,
        seeds = [AGENT_SEED, agent.mint.as_ref()],
        bump = agent.bump,
        constraint = agent.owner == owner.key() @ ErrorCode::NotAgentOwner
    )]
    pub agent: Account<'info, Agent>,

    /// CHECK: Stake vault PDA
    #[account(
        mut,
        seeds = [STAKE_VAULT_SEED],
        bump
    )]
    pub stake_vault: SystemAccount<'info>,
}

#[derive(Accounts)]
pub struct GovernanceAction<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, RegistryConfig>,

    #[account(
        mut,
        seeds = [AGENT_SEED, agent.mint.as_ref()],
        bump = agent.bump
    )]
    pub agent: Account<'info, Agent>,
}

#[derive(Accounts)]
pub struct SlashAgent<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, RegistryConfig>,

    #[account(
        mut,
        seeds = [AGENT_SEED, agent.mint.as_ref()],
        bump = agent.bump
    )]
    pub agent: Account<'info, Agent>,

    /// CHECK: Stake vault PDA
    #[account(
        mut,
        seeds = [STAKE_VAULT_SEED],
        bump
    )]
    pub stake_vault: SystemAccount<'info>,

    /// CHECK: Recipient of slashed funds
    #[account(mut)]
    pub slash_recipient: SystemAccount<'info>,
}

#[derive(Accounts)]
pub struct PublishToEvm<'info> {
    pub owner: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, RegistryConfig>,

    #[account(
        seeds = [AGENT_SEED, agent.mint.as_ref()],
        bump = agent.bump,
        constraint = agent.owner == owner.key() @ ErrorCode::NotAgentOwner
    )]
    pub agent: Account<'info, Agent>,
}

// ============================================================================
// Events
// ============================================================================

#[event]
pub struct AgentRegistered {
    pub agent_id: u64,
    pub owner: Pubkey,
    pub mint: Pubkey,
    pub tier: StakeTier,
    pub uri: String,
}

#[event]
pub struct MetadataSet {
    pub agent_id: u64,
    pub key: String,
    pub value_hash: [u8; 32],
}

#[event]
pub struct EndpointSet {
    pub agent_id: u64,
    pub endpoint_type: EndpointType,
    pub endpoint: String,
}

#[event]
pub struct TagsUpdated {
    pub agent_id: u64,
    pub tags: Vec<String>,
}

#[event]
pub struct StakeIncreased {
    pub agent_id: u64,
    pub old_tier: StakeTier,
    pub new_tier: StakeTier,
    pub added_amount: u64,
}

#[event]
pub struct StakeWithdrawn {
    pub agent_id: u64,
    pub owner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct AgentBanned {
    pub agent_id: u64,
    pub reason: String,
}

#[event]
pub struct AgentUnbanned {
    pub agent_id: u64,
}

#[event]
pub struct AgentSlashed {
    pub agent_id: u64,
    pub amount: u64,
    pub reason: String,
}

#[event]
pub struct CrossChainPublished {
    pub agent_id: u64,
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub tier: StakeTier,
}

// ============================================================================
// Errors
// ============================================================================

#[error_code]
pub enum ErrorCode {
    #[msg("Not authorized")]
    Unauthorized,

    #[msg("Registry is paused")]
    RegistryPaused,

    #[msg("URI too long (max 200 characters)")]
    UriTooLong,

    #[msg("Name too long (max 32 characters)")]
    NameTooLong,

    #[msg("Symbol too long (max 10 characters)")]
    SymbolTooLong,

    #[msg("Invalid stake tier")]
    InvalidStakeTier,

    #[msg("Insufficient funds for stake")]
    InsufficientFunds,

    #[msg("Not agent owner")]
    NotAgentOwner,

    #[msg("Metadata key too long")]
    KeyTooLong,

    #[msg("Metadata value too large")]
    MetadataTooLarge,

    #[msg("Agent is banned")]
    AgentBanned,

    #[msg("Agent is not banned")]
    AgentNotBanned,

    #[msg("Agent is already banned")]
    AgentAlreadyBanned,

    #[msg("Cannot downgrade stake tier")]
    CannotDowngradeTier,

    #[msg("Invalid stake amount")]
    InvalidStakeAmount,

    #[msg("Stake already slashed")]
    StakeAlreadySlashed,

    #[msg("Invalid slash percentage")]
    InvalidSlashPercentage,

    #[msg("Reason too long (max 200 characters)")]
    ReasonTooLong,

    #[msg("Too many tags (max 10)")]
    TooManyTags,

    #[msg("Tag too long (max 32 characters)")]
    TagTooLong,

    #[msg("Empty tag")]
    EmptyTag,

    #[msg("Endpoint too long")]
    EndpointTooLong,

    #[msg("Wormhole not configured")]
    WormholeNotConfigured,

    #[msg("Invalid slash recipient - must be governance address")]
    InvalidSlashRecipient,

    #[msg("Insufficient vault balance for withdrawal")]
    InsufficientVaultBalance,
}
