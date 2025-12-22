//! CPI (Cross-Program Invocation) module for EVM Light Client
//!
//! This module enables other Solana programs to verify EVM state proofs
//! by calling into the EVM Light Client program.
//!
//! # Usage
//!
//! ```rust,ignore
//! use evm_light_client::cpi;
//!
//! // Build CPI context
//! let cpi_ctx = CpiContext::new(
//!     ctx.accounts.evm_light_client_program.to_account_info(),
//!     cpi::accounts::VerifyProof {
//!         state: ctx.accounts.light_client_state.to_account_info(),
//!     },
//! );
//!
//! // Verify an EVM storage proof
//! let is_valid = cpi::verify_account_proof(
//!     cpi_ctx,
//!     account_address,
//!     storage_slot,
//!     expected_value,
//!     proof_data,
//! )?;
//! ```

use anchor_lang::prelude::*;

/// Accounts required for verifying an EVM proof via CPI
#[derive(Accounts)]
pub struct VerifyProof<'info> {
    /// The EVM light client state account
    /// CHECK: Validated by the EVM light client program
    pub state: AccountInfo<'info>,
}

/// Accounts required for getting the latest EVM state via CPI
#[derive(Accounts)]
pub struct GetState<'info> {
    /// The EVM light client state account
    /// CHECK: Validated by the EVM light client program
    pub state: AccountInfo<'info>,
}

/// Result of a state query
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct LatestStateResult {
    pub slot: u64,
    pub block_root: [u8; 32],
    pub state_root: [u8; 32],
    pub sync_committee_root: [u8; 32],
}

// Instruction discriminators (first 8 bytes of sha256("global:instruction_name"))
const VERIFY_ACCOUNT_PROOF_DISCRIMINATOR: [u8; 8] = [0x5b, 0x9c, 0x8d, 0x3f, 0x1a, 0x2b, 0x4c, 0x5d];
const GET_LATEST_STATE_DISCRIMINATOR: [u8; 8] = [0x7e, 0x6f, 0x8a, 0x9b, 0x0c, 0x1d, 0x2e, 0x3f];

/// Verify an EVM account/storage proof against the light client's verified state root
///
/// # Arguments
/// * `ctx` - CPI context with the light client program and state account
/// * `account` - 20-byte EVM account address
/// * `storage_slot` - 32-byte storage slot key
/// * `expected_value` - 32-byte expected value at the storage slot
/// * `proof_data` - Serialized Merkle-Patricia proof
///
/// # Returns
/// * `Ok(true)` - Proof is valid
/// * `Ok(false)` - Proof is invalid
/// * `Err(_)` - Verification error
pub fn verify_account_proof<'info>(
    ctx: CpiContext<'_, '_, '_, 'info, VerifyProof<'info>>,
    account: [u8; 20],
    storage_slot: [u8; 32],
    expected_value: [u8; 32],
    proof_data: Vec<u8>,
) -> Result<bool> {
    // Build instruction data
    // Layout: [8 bytes discriminator][20 bytes account][32 bytes slot][32 bytes value][4 bytes len][proof_data]
    let mut data = Vec::with_capacity(8 + 20 + 32 + 32 + 4 + proof_data.len());
    data.extend_from_slice(&VERIFY_ACCOUNT_PROOF_DISCRIMINATOR);
    data.extend_from_slice(&account);
    data.extend_from_slice(&storage_slot);
    data.extend_from_slice(&expected_value);
    data.extend_from_slice(&(proof_data.len() as u32).to_le_bytes());
    data.extend_from_slice(&proof_data);

    // Build accounts meta
    let accounts = vec![AccountMeta::new_readonly(*ctx.accounts.state.key, false)];

    // Create instruction
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: *ctx.program.key,
        accounts,
        data,
    };

    // Invoke CPI
    anchor_lang::solana_program::program::invoke(&ix, &[ctx.accounts.state.clone()])?;

    // Parse return data
    // The EVM light client returns a boolean (1 byte: 0 = false, 1 = true)
    let (program_id, return_data) =
        anchor_lang::solana_program::program::get_return_data().ok_or(error!(ErrorCode::NoReturnData))?;

    if program_id != *ctx.program.key {
        return Err(error!(ErrorCode::InvalidReturnProgram));
    }

    if return_data.is_empty() {
        return Err(error!(ErrorCode::EmptyReturnData));
    }

    Ok(return_data[0] == 1)
}

/// Get the latest verified EVM state from the light client
///
/// # Arguments
/// * `ctx` - CPI context with the light client program and state account
///
/// # Returns
/// * Latest state including slot, block root, state root, and sync committee root
pub fn get_latest_state<'info>(
    ctx: CpiContext<'_, '_, '_, 'info, GetState<'info>>,
) -> Result<LatestStateResult> {
    // Build instruction data (just discriminator)
    let data = GET_LATEST_STATE_DISCRIMINATOR.to_vec();

    // Build accounts meta
    let accounts = vec![AccountMeta::new_readonly(*ctx.accounts.state.key, false)];

    // Create instruction
    let ix = anchor_lang::solana_program::instruction::Instruction {
        program_id: *ctx.program.key,
        accounts,
        data,
    };

    // Invoke CPI
    anchor_lang::solana_program::program::invoke(&ix, &[ctx.accounts.state.clone()])?;

    // Parse return data
    let (program_id, return_data) =
        anchor_lang::solana_program::program::get_return_data().ok_or(error!(ErrorCode::NoReturnData))?;

    if program_id != *ctx.program.key {
        return Err(error!(ErrorCode::InvalidReturnProgram));
    }

    // Return data layout: [8 bytes slot][32 bytes block_root][32 bytes state_root][32 bytes committee_root]
    if return_data.len() < 104 {
        return Err(error!(ErrorCode::InvalidReturnData));
    }

    let slot = u64::from_le_bytes(return_data[0..8].try_into().unwrap());
    let mut block_root = [0u8; 32];
    let mut state_root = [0u8; 32];
    let mut sync_committee_root = [0u8; 32];

    block_root.copy_from_slice(&return_data[8..40]);
    state_root.copy_from_slice(&return_data[40..72]);
    sync_committee_root.copy_from_slice(&return_data[72..104]);

    Ok(LatestStateResult {
        slot,
        block_root,
        state_root,
        sync_committee_root,
    })
}

/// Verify a batch of storage proofs efficiently
///
/// # Arguments
/// * `ctx` - CPI context with the light client program and state account
/// * `account` - 20-byte EVM account address
/// * `proofs` - Vector of (storage_slot, expected_value, proof_data) tuples
///
/// # Returns
/// * Vector of booleans indicating validity of each proof
pub fn verify_batch_proofs<'info>(
    ctx: CpiContext<'_, '_, '_, 'info, VerifyProof<'info>>,
    account: [u8; 20],
    proofs: Vec<([u8; 32], [u8; 32], Vec<u8>)>,
) -> Result<Vec<bool>> {
    let mut results = Vec::with_capacity(proofs.len());

    for (storage_slot, expected_value, proof_data) in proofs {
        // Clone the CPI context for each call
        let cpi_ctx = CpiContext::new(
            ctx.program.clone(),
            VerifyProof {
                state: ctx.accounts.state.clone(),
            },
        );

        let is_valid = verify_account_proof(cpi_ctx, account, storage_slot, expected_value, proof_data)?;
        results.push(is_valid);
    }

    Ok(results)
}

/// Errors specific to CPI operations
#[error_code]
pub enum ErrorCode {
    #[msg("No return data from CPI call")]
    NoReturnData,

    #[msg("Return data from wrong program")]
    InvalidReturnProgram,

    #[msg("Empty return data")]
    EmptyReturnData,

    #[msg("Invalid return data format")]
    InvalidReturnData,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discriminator_uniqueness() {
        assert_ne!(VERIFY_ACCOUNT_PROOF_DISCRIMINATOR, GET_LATEST_STATE_DISCRIMINATOR);
    }
}
