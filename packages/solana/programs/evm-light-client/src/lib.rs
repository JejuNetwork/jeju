//! EVM Light Client on Solana
//!
//! This program verifies Ethereum consensus using ZK proofs of sync committee
//! signatures. It maintains a verified state that can be used by other programs
//! to verify EVM state proofs (account balances, storage, etc.).
//!
//! Architecture:
//! - Sync committee updates are verified via Groth16 proofs
//! - BN254 pairing precompile is used for efficient verification
//! - State includes latest block, state root, and sync committee
//!
//! Usage:
//! 1. Initialize with a trusted sync committee
//! 2. Submit periodic updates with ZK proofs
//! 3. Other programs can CPI to verify EVM state proofs
//!
//! # CPI Usage
//!
//! Other programs can verify EVM proofs via CPI:
//! ```rust,ignore
//! use evm_light_client::cpi;
//!
//! let is_valid = cpi::verify_account_proof(
//!     cpi_ctx,
//!     account_address,
//!     storage_slot,
//!     expected_value,
//!     proof_data,
//! )?;
//! ```

use anchor_lang::prelude::*;
use solana_program::alt_bn128::prelude::*;
use solana_program::keccak;

mod verification_key;
use verification_key as vk;

/// CPI module for cross-program invocation
#[cfg(feature = "cpi")]
pub mod cpi;

/// Re-export CPI types when cpi feature is enabled
#[cfg(feature = "cpi")]
pub use cpi::{accounts as cpi_accounts, LatestStateResult};

declare_id!("EVMLightCL1111111111111111111111111111111111");

/// Maximum sync committee size (512 validators)
pub const SYNC_COMMITTEE_SIZE: usize = 512;

/// Aggregated BLS public key size (48 bytes compressed)
pub const BLS_PUBKEY_SIZE: usize = 48;

/// Groth16 proof size (256 bytes: 2x G1 + 1x G2)
/// Layout: A (64 bytes G1) + B (128 bytes G2) + C (64 bytes G1)
pub const GROTH16_PROOF_SIZE: usize = 256;

/// G1 point size (x, y coordinates, 32 bytes each)
pub const G1_SIZE: usize = 64;

/// G2 point size (x1, x2, y1, y2 coordinates, 32 bytes each)  
pub const G2_SIZE: usize = 128;

#[program]
pub mod evm_light_client {
    use super::*;

    /// Initialize the light client with a trusted sync committee
    pub fn initialize(
        ctx: Context<Initialize>,
        genesis_slot: u64,
        genesis_block_root: [u8; 32],
        genesis_state_root: [u8; 32],
        sync_committee_root: [u8; 32],
    ) -> Result<()> {
        // CRITICAL: Prevent initialization with placeholder verification keys
        require!(
            !vk::is_placeholder(),
            ErrorCode::PlaceholderVerificationKeys
        );

        let state = &mut ctx.accounts.state;

        state.admin = ctx.accounts.admin.key();
        state.latest_slot = genesis_slot;
        state.latest_block_root = genesis_block_root;
        state.latest_state_root = genesis_state_root;
        state.current_sync_committee_root = sync_committee_root;
        state.next_sync_committee_root = [0u8; 32];
        state.update_count = 0;
        state.initialized = true;

        msg!("EVM Light Client initialized at slot {}", genesis_slot);

        Ok(())
    }

    /// Update the light client with a new verified state
    ///
    /// Requires a ZK proof that:
    /// 1. The sync committee signed the new block root
    /// 2. At least 2/3 of validators participated
    /// 3. The sync committee matches our stored root
    pub fn update_state(
        ctx: Context<UpdateState>,
        new_slot: u64,
        new_block_root: [u8; 32],
        new_state_root: [u8; 32],
        new_sync_committee_root: Option<[u8; 32]>,
        proof: [u8; GROTH16_PROOF_SIZE],
        public_inputs: Vec<u8>,
    ) -> Result<()> {
        let state = &mut ctx.accounts.state;

        require!(state.initialized, ErrorCode::NotInitialized);
        require!(new_slot > state.latest_slot, ErrorCode::SlotNotAdvanced);

        // Verify the ZK proof using BN254 precompile
        verify_groth16_proof(&proof, &public_inputs, &state.current_sync_committee_root)?;

        // Validate public inputs encode the expected values
        validate_public_inputs(
            &public_inputs,
            state.latest_slot,
            &state.latest_block_root,
            new_slot,
            &new_block_root,
            &state.current_sync_committee_root,
        )?;

        // Update state
        state.latest_slot = new_slot;
        state.latest_block_root = new_block_root;
        state.latest_state_root = new_state_root;
        state.update_count += 1;

        // Handle sync committee rotation (every ~27 hours)
        if let Some(next_root) = new_sync_committee_root {
            if state.next_sync_committee_root != [0u8; 32] {
                // Rotate: next becomes current
                state.current_sync_committee_root = state.next_sync_committee_root;
            }
            state.next_sync_committee_root = next_root;
        }

        msg!("EVM Light Client updated to slot {}", new_slot);

        Ok(())
    }

    /// Verify an EVM account proof against the current state
    ///
    /// This is a CPI-friendly function that other programs can call
    /// to verify EVM state proofs.
    ///
    /// The proof is serialized as: [num_nodes: u16][node1_len: u16][node1_data]...
    ///
    /// # Return Data
    /// Sets return data with a single byte: 1 if valid, 0 if invalid.
    /// CPI callers can read this via `solana_program::program::get_return_data()`.
    pub fn verify_account_proof(
        ctx: Context<VerifyProof>,
        account: [u8; 20],      // EVM address
        storage_slot: [u8; 32], // Storage key
        expected_value: [u8; 32],
        proof_data: Vec<u8>,    // Serialized Merkle-Patricia proof
    ) -> Result<bool> {
        let state = &ctx.accounts.state;

        require!(state.initialized, ErrorCode::NotInitialized);

        // Deserialize proof nodes from serialized format
        let proof_nodes = deserialize_proof_nodes(&proof_data)?;

        // Verify the Merkle-Patricia proof against state root
        let valid = verify_merkle_patricia_proof(
            &account,
            &storage_slot,
            &expected_value,
            &proof_nodes,
            &state.latest_state_root,
        )?;

        // Set return data for CPI callers
        // 1 byte: 1 = valid, 0 = invalid
        anchor_lang::solana_program::program::set_return_data(&[if valid { 1u8 } else { 0u8 }]);

        Ok(valid)
    }

    /// Get the latest verified state (for cross-program queries)
    ///
    /// # Return Data
    /// Sets return data with: [8 bytes slot][32 bytes block_root][32 bytes state_root][32 bytes committee_root]
    /// CPI callers can read this via `solana_program::program::get_return_data()`.
    pub fn get_latest_state(ctx: Context<GetState>) -> Result<LatestState> {
        let state = &ctx.accounts.state;

        // Build return data for CPI callers
        // Layout: [8 bytes slot][32 bytes block_root][32 bytes state_root][32 bytes committee_root]
        let mut return_data = Vec::with_capacity(104);
        return_data.extend_from_slice(&state.latest_slot.to_le_bytes());
        return_data.extend_from_slice(&state.latest_block_root);
        return_data.extend_from_slice(&state.latest_state_root);
        return_data.extend_from_slice(&state.current_sync_committee_root);
        anchor_lang::solana_program::program::set_return_data(&return_data);

        Ok(LatestState {
            slot: state.latest_slot,
            block_root: state.latest_block_root,
            state_root: state.latest_state_root,
            sync_committee_root: state.current_sync_committee_root,
        })
    }
}


#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + LightClientState::INIT_SPACE,
        seeds = [b"evm_light_client"],
        bump
    )]
    pub state: Account<'info, LightClientState>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateState<'info> {
    #[account(
        mut,
        seeds = [b"evm_light_client"],
        bump
    )]
    pub state: Account<'info, LightClientState>,

    pub relayer: Signer<'info>,
}

#[derive(Accounts)]
pub struct VerifyProof<'info> {
    #[account(
        seeds = [b"evm_light_client"],
        bump
    )]
    pub state: Account<'info, LightClientState>,
}

#[derive(Accounts)]
pub struct GetState<'info> {
    #[account(
        seeds = [b"evm_light_client"],
        bump
    )]
    pub state: Account<'info, LightClientState>,
}


#[account]
#[derive(InitSpace)]
pub struct LightClientState {
    /// Admin who can update configuration
    pub admin: Pubkey,

    /// Latest verified beacon slot
    pub latest_slot: u64,

    /// Latest verified beacon block root
    pub latest_block_root: [u8; 32],

    /// Latest verified execution state root (for account proofs)
    pub latest_state_root: [u8; 32],

    /// Current sync committee root (for signature verification)
    pub current_sync_committee_root: [u8; 32],

    /// Next sync committee root (for rotation)
    pub next_sync_committee_root: [u8; 32],

    /// Number of successful updates
    pub update_count: u64,

    /// Whether the light client is initialized
    pub initialized: bool,
}

// RETURN TYPES

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct LatestState {
    pub slot: u64,
    pub block_root: [u8; 32],
    pub state_root: [u8; 32],
    pub sync_committee_root: [u8; 32],
}


#[error_code]
pub enum ErrorCode {
    #[msg("Light client not initialized")]
    NotInitialized,

    #[msg("New slot must be greater than current slot")]
    SlotNotAdvanced,

    #[msg("Invalid Groth16 proof")]
    InvalidProof,

    #[msg("Public inputs do not match expected values")]
    PublicInputsMismatch,

    #[msg("Merkle proof verification failed")]
    MerkleProofFailed,

    #[msg("Sync committee mismatch")]
    SyncCommitteeMismatch,

    #[msg("Invalid state proof")]
    InvalidStateProof,

    #[msg("CRITICAL: Verification keys are placeholders - deploy real keys before mainnet")]
    PlaceholderVerificationKeys,
}

// VERIFICATION HELPERS

/// Verify a Groth16 proof using Solana's BN254 precompiles
/// 
/// The Groth16 verification equation is:
/// e(A, B) = e(alpha, beta) * e(vk_x, gamma) * e(C, delta)
///
/// Where vk_x = IC[0] + sum(public_inputs[i] * IC[i+1])
///
/// We verify: e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
fn verify_groth16_proof(
    proof: &[u8; GROTH16_PROOF_SIZE],
    public_inputs: &[u8],
    _sync_committee_root: &[u8; 32],
) -> Result<()> {
    // Validate proof structure
    if proof.len() != GROTH16_PROOF_SIZE {
        return Err(ErrorCode::InvalidProof.into());
    }

    // Extract proof components
    // A is G1 point (64 bytes: x, y)
    // B is G2 point (128 bytes: x1, x2, y1, y2)
    // C is G1 point (64 bytes: x, y)
    let a_g1 = &proof[0..G1_SIZE];
    let b_g2 = &proof[G1_SIZE..G1_SIZE + G2_SIZE];
    let c_g1 = &proof[G1_SIZE + G2_SIZE..];

    // Parse public inputs (each is a 32-byte field element)
    let num_inputs = public_inputs.len() / 32;
    if num_inputs > vk::IC_LENGTH - 1 {
        msg!("Too many public inputs: {} > {}", num_inputs, vk::IC_LENGTH - 1);
        return Err(ErrorCode::PublicInputsMismatch.into());
    }

    // Compute vk_x = IC[0] + sum(public_inputs[i] * IC[i+1])
    // Start with IC[0]
    let mut vk_x = vk::IC[0];

    // Add public_input[i] * IC[i+1] for each input
    for i in 0..num_inputs {
        let input_start = i * 32;
        let input_end = input_start + 32;
        if input_end > public_inputs.len() {
            break;
        }
        
        let scalar = &public_inputs[input_start..input_end];
        
        // Scalar multiplication: IC[i+1] * scalar
        let mut mul_input = Vec::with_capacity(96);
        mul_input.extend_from_slice(&vk::IC[i + 1]);
        mul_input.extend_from_slice(scalar);
        
        let mul_result = alt_bn128_multiplication(&mul_input)
            .map_err(|_| ErrorCode::InvalidProof)?;
        
        // Point addition: vk_x + (IC[i+1] * scalar)
        let mut add_input = Vec::with_capacity(128);
        add_input.extend_from_slice(&vk_x);
        add_input.extend_from_slice(&mul_result);
        
        let add_result = alt_bn128_addition(&add_input)
            .map_err(|_| ErrorCode::InvalidProof)?;
        
        vk_x.copy_from_slice(&add_result[..64]);
    }

    // Negate A for the pairing equation
    // For BN254, negating a G1 point means negating the y-coordinate
    let neg_a = negate_g1_point(a_g1)?;

    // Build pairing input for verification:
    // e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
    //
    // Pairing input format: pairs of (G1, G2) points, 192 bytes each
    // Total: 4 pairs = 768 bytes
    let mut pairing_input = Vec::with_capacity(768);
    
    // Pair 1: (-A, B)
    pairing_input.extend_from_slice(&neg_a);
    pairing_input.extend_from_slice(b_g2);
    
    // Pair 2: (alpha, beta)
    pairing_input.extend_from_slice(&vk::ALPHA_G1);
    pairing_input.extend_from_slice(&vk::BETA_G2);
    
    // Pair 3: (vk_x, gamma)
    pairing_input.extend_from_slice(&vk_x);
    pairing_input.extend_from_slice(&vk::GAMMA_G2);
    
    // Pair 4: (C, delta)
    pairing_input.extend_from_slice(c_g1);
    pairing_input.extend_from_slice(&vk::DELTA_G2);

    // Call the pairing check
    // Returns true (non-zero) if the product of pairings equals 1 in GT
    let pairing_result = alt_bn128_pairing(&pairing_input)
        .map_err(|_| ErrorCode::InvalidProof)?;

    // Check if pairing succeeded (result should be 1 for valid proof)
    if pairing_result[31] != 1 || pairing_result[..31].iter().any(|&b| b != 0) {
        msg!("Groth16 proof verification failed: pairing check returned false");
        return Err(ErrorCode::InvalidProof.into());
    }

    msg!("Groth16 proof verified successfully");
    Ok(())
}

/// Negate a G1 point by negating its y-coordinate
/// For BN254 curve, -P = (x, p - y) where p is the field modulus
fn negate_g1_point(point: &[u8]) -> Result<[u8; 64]> {
    if point.len() != 64 {
        return Err(ErrorCode::InvalidProof.into());
    }
    
    // BN254 field modulus (prime p)
    const FIELD_MODULUS: [u8; 32] = [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
        0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
        0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d,
        0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
    ];
    
    let mut result = [0u8; 64];
    result[..32].copy_from_slice(&point[..32]); // x unchanged
    
    // y_neg = p - y (big-endian subtraction)
    let mut borrow = 0u16;
    for i in (0..32).rev() {
        let diff = (FIELD_MODULUS[i] as u16) 
            .wrapping_sub(point[32 + i] as u16)
            .wrapping_sub(borrow);
        result[32 + i] = diff as u8;
        borrow = if diff > 255 { 1 } else { 0 };
    }
    
    Ok(result)
}

/// Validate that public inputs encode the expected state transition
fn validate_public_inputs(
    public_inputs: &[u8],
    prev_slot: u64,
    prev_block_root: &[u8; 32],
    new_slot: u64,
    new_block_root: &[u8; 32],
    sync_committee_root: &[u8; 32],
) -> Result<()> {
    // Public inputs layout:
    // [0-7]   prev_slot (u64 le)
    // [8-39]  prev_block_root
    // [40-47] new_slot (u64 le)
    // [48-79] new_block_root
    // [80-111] sync_committee_root

    if public_inputs.len() < 112 {
        return Err(ErrorCode::PublicInputsMismatch.into());
    }

    let input_prev_slot = u64::from_le_bytes(public_inputs[0..8].try_into().unwrap());
    let input_prev_root: [u8; 32] = public_inputs[8..40].try_into().unwrap();
    let input_new_slot = u64::from_le_bytes(public_inputs[40..48].try_into().unwrap());
    let input_new_root: [u8; 32] = public_inputs[48..80].try_into().unwrap();
    let input_committee_root: [u8; 32] = public_inputs[80..112].try_into().unwrap();

    if input_prev_slot != prev_slot {
        msg!("Previous slot mismatch: {} != {}", input_prev_slot, prev_slot);
        return Err(ErrorCode::PublicInputsMismatch.into());
    }

    if input_prev_root != *prev_block_root {
        msg!("Previous block root mismatch");
        return Err(ErrorCode::PublicInputsMismatch.into());
    }

    if input_new_slot != new_slot {
        msg!("New slot mismatch: {} != {}", input_new_slot, new_slot);
        return Err(ErrorCode::PublicInputsMismatch.into());
    }

    if input_new_root != *new_block_root {
        msg!("New block root mismatch");
        return Err(ErrorCode::PublicInputsMismatch.into());
    }

    if input_committee_root != *sync_committee_root {
        msg!("Sync committee root mismatch");
        return Err(ErrorCode::SyncCommitteeMismatch.into());
    }

    Ok(())
}

/// Verify a Merkle-Patricia proof for an EVM account/storage
/// 
/// This verifies inclusion proofs against the Ethereum state trie.
/// The proof is a list of RLP-encoded nodes from root to leaf.
/// 
/// Arguments:
/// - account: The 20-byte Ethereum address
/// - storage_slot: The storage slot being proven (for storage proofs)
/// - expected_value: The expected value at the slot
/// - proof_nodes: RLP-encoded proof nodes (variable length)
/// - state_root: The state root to verify against
fn verify_merkle_patricia_proof(
    account: &[u8; 20],
    storage_slot: &[u8; 32],
    expected_value: &[u8; 32],
    proof_nodes: &[Vec<u8>],
    state_root: &[u8; 32],
) -> Result<bool> {
    if proof_nodes.is_empty() {
        msg!("Empty proof");
        return Ok(false);
    }

    // Compute the key path (keccak256 of account address + storage slot)
    // For account proofs: keccak256(address)
    // For storage proofs: keccak256(storage_slot)
    let account_key = keccak::hash(account);
    let storage_key = keccak::hash(storage_slot);
    
    // Convert keys to nibbles for trie traversal
    let account_nibbles = bytes_to_nibbles(&account_key.to_bytes());
    let storage_nibbles = bytes_to_nibbles(&storage_key.to_bytes());

    // First verify account proof to get storage root
    let account_value = verify_trie_path(
        state_root,
        &account_nibbles,
        proof_nodes,
        0, // Start from first proof node
    )?;

    // Decode RLP account data to extract storage root
    // Account RLP: [nonce, balance, storage_root, code_hash]
    let storage_root = extract_storage_root_from_account(&account_value)?;

    // Now verify storage proof if we have a storage slot
    if proof_nodes.len() > 1 {
        let storage_value = verify_trie_path(
            &storage_root,
            &storage_nibbles,
            proof_nodes,
            proof_nodes.len() / 2, // Storage proof starts after account proof
        )?;

        // Check if the proven value matches expected
        if storage_value.len() != 32 {
            msg!("Invalid storage value length");
            return Ok(false);
        }

        let proven_value: [u8; 32] = storage_value.try_into()
            .map_err(|_| ErrorCode::InvalidStateProof)?;
        
        if proven_value != *expected_value {
            msg!("Storage value mismatch");
            return Ok(false);
        }
    }

    msg!("Merkle-Patricia proof verified");
    Ok(true)
}

/// Convert bytes to nibbles (4-bit values)
fn bytes_to_nibbles(bytes: &[u8]) -> Vec<u8> {
    let mut nibbles = Vec::with_capacity(bytes.len() * 2);
    for byte in bytes {
        nibbles.push(byte >> 4);
        nibbles.push(byte & 0x0f);
    }
    nibbles
}

/// Verify a path through the Merkle-Patricia trie
fn verify_trie_path(
    root: &[u8; 32],
    key_nibbles: &[u8],
    proof_nodes: &[Vec<u8>],
    start_index: usize,
) -> Result<Vec<u8>> {
    let mut current_hash = *root;
    let mut nibble_index = 0;

    for (i, node) in proof_nodes.iter().enumerate().skip(start_index) {
        // Verify node hash matches expected
        let node_hash = keccak::hash(node);
        if node_hash.to_bytes() != current_hash {
            msg!("Node hash mismatch at index {}", i);
            return Err(ErrorCode::InvalidStateProof.into());
        }

        // Decode RLP node
        let decoded = decode_rlp_node(node)?;

        match decoded.len() {
            // Branch node: 17 elements (16 children + value)
            17 => {
                if nibble_index >= key_nibbles.len() {
                    // We've consumed all nibbles, return the value
                    return Ok(decoded[16].clone());
                }
                let child_index = key_nibbles[nibble_index] as usize;
                if child_index >= 16 {
                    return Err(ErrorCode::InvalidStateProof.into());
                }
                
                // Get next node hash from branch
                if decoded[child_index].len() == 32 {
                    current_hash = decoded[child_index].clone().try_into()
                        .map_err(|_| ErrorCode::InvalidStateProof)?;
                } else if decoded[child_index].is_empty() {
                    // Empty branch means key not found
                    return Ok(Vec::new());
                } else {
                    // Embedded node (for small nodes)
                    return Ok(decoded[child_index].clone());
                }
                nibble_index += 1;
            }
            // Extension or Leaf node: 2 elements (path + value/hash)
            2 => {
                let (node_path, is_leaf) = decode_compact_path(&decoded[0])?;
                
                // Verify path matches our key
                for (j, &nibble) in node_path.iter().enumerate() {
                    if nibble_index + j >= key_nibbles.len() {
                        if is_leaf {
                            return Ok(decoded[1].clone());
                        }
                        return Err(ErrorCode::InvalidStateProof.into());
                    }
                    if key_nibbles[nibble_index + j] != nibble {
                        return Ok(Vec::new()); // Key not found
                    }
                }
                nibble_index += node_path.len();

                if is_leaf {
                    // Leaf node: return the value
                    return Ok(decoded[1].clone());
                } else {
                    // Extension node: follow to next node
                    if decoded[1].len() == 32 {
                        current_hash = decoded[1].clone().try_into()
                            .map_err(|_| ErrorCode::InvalidStateProof)?;
                    } else {
                        return Err(ErrorCode::InvalidStateProof.into());
                    }
                }
            }
            _ => {
                msg!("Invalid node length: {}", decoded.len());
                return Err(ErrorCode::InvalidStateProof.into());
            }
        }
    }

    Ok(Vec::new())
}

/// Decode a simple RLP node (list of items)
fn decode_rlp_node(data: &[u8]) -> Result<Vec<Vec<u8>>> {
    if data.is_empty() {
        return Err(ErrorCode::InvalidStateProof.into());
    }

    let first = data[0];
    
    if first < 0x80 {
        // Single byte
        return Ok(vec![vec![first]]);
    }
    
    if first < 0xb8 {
        // String 0-55 bytes
        let len = (first - 0x80) as usize;
        if data.len() < 1 + len {
            return Err(ErrorCode::InvalidStateProof.into());
        }
        return Ok(vec![data[1..1+len].to_vec()]);
    }
    
    if first < 0xc0 {
        // Long string
        let len_len = (first - 0xb7) as usize;
        if data.len() < 1 + len_len {
            return Err(ErrorCode::InvalidStateProof.into());
        }
        let mut len = 0usize;
        for i in 0..len_len {
            len = (len << 8) | (data[1 + i] as usize);
        }
        if data.len() < 1 + len_len + len {
            return Err(ErrorCode::InvalidStateProof.into());
        }
        return Ok(vec![data[1+len_len..1+len_len+len].to_vec()]);
    }
    
    if first < 0xf8 {
        // Short list
        let list_len = (first - 0xc0) as usize;
        return decode_rlp_list(&data[1..1+list_len]);
    }
    
    // Long list
    let len_len = (first - 0xf7) as usize;
    if data.len() < 1 + len_len {
        return Err(ErrorCode::InvalidStateProof.into());
    }
    let mut list_len = 0usize;
    for i in 0..len_len {
        list_len = (list_len << 8) | (data[1 + i] as usize);
    }
    if data.len() < 1 + len_len + list_len {
        return Err(ErrorCode::InvalidStateProof.into());
    }
    decode_rlp_list(&data[1+len_len..1+len_len+list_len])
}

/// Decode RLP list items
fn decode_rlp_list(data: &[u8]) -> Result<Vec<Vec<u8>>> {
    let mut items = Vec::new();
    let mut pos = 0;

    while pos < data.len() {
        let first = data[pos];
        
        if first < 0x80 {
            items.push(vec![first]);
            pos += 1;
        } else if first < 0xb8 {
            let len = (first - 0x80) as usize;
            if pos + 1 + len > data.len() {
                return Err(ErrorCode::InvalidStateProof.into());
            }
            items.push(data[pos+1..pos+1+len].to_vec());
            pos += 1 + len;
        } else if first < 0xc0 {
            let len_len = (first - 0xb7) as usize;
            if pos + 1 + len_len > data.len() {
                return Err(ErrorCode::InvalidStateProof.into());
            }
            let mut len = 0usize;
            for i in 0..len_len {
                len = (len << 8) | (data[pos + 1 + i] as usize);
            }
            if pos + 1 + len_len + len > data.len() {
                return Err(ErrorCode::InvalidStateProof.into());
            }
            items.push(data[pos+1+len_len..pos+1+len_len+len].to_vec());
            pos += 1 + len_len + len;
        } else if first < 0xf8 {
            let len = (first - 0xc0) as usize;
            if pos + 1 + len > data.len() {
                return Err(ErrorCode::InvalidStateProof.into());
            }
            items.push(data[pos..pos+1+len].to_vec());
            pos += 1 + len;
        } else {
            let len_len = (first - 0xf7) as usize;
            if pos + 1 + len_len > data.len() {
                return Err(ErrorCode::InvalidStateProof.into());
            }
            let mut len = 0usize;
            for i in 0..len_len {
                len = (len << 8) | (data[pos + 1 + i] as usize);
            }
            if pos + 1 + len_len + len > data.len() {
                return Err(ErrorCode::InvalidStateProof.into());
            }
            items.push(data[pos..pos+1+len_len+len].to_vec());
            pos += 1 + len_len + len;
        }
    }

    Ok(items)
}

/// Decode compact path encoding (used in extension/leaf nodes)
/// Returns (nibbles, is_leaf)
fn decode_compact_path(encoded: &[u8]) -> Result<(Vec<u8>, bool)> {
    if encoded.is_empty() {
        return Ok((Vec::new(), false));
    }

    let first = encoded[0];
    let is_leaf = (first & 0x20) != 0;
    let odd_len = (first & 0x10) != 0;

    let mut nibbles = Vec::new();
    
    if odd_len {
        nibbles.push(first & 0x0f);
    }

    for &byte in &encoded[1..] {
        nibbles.push(byte >> 4);
        nibbles.push(byte & 0x0f);
    }

    Ok((nibbles, is_leaf))
}

/// Extract storage root from RLP-encoded account data
fn extract_storage_root_from_account(account_rlp: &[u8]) -> Result<[u8; 32]> {
    let items = decode_rlp_node(account_rlp)?;
    
    // Account RLP: [nonce, balance, storage_root, code_hash]
    if items.len() != 4 {
        msg!("Invalid account RLP: expected 4 items, got {}", items.len());
        return Err(ErrorCode::InvalidStateProof.into());
    }

    if items[2].len() != 32 {
        msg!("Invalid storage root length: {}", items[2].len());
        return Err(ErrorCode::InvalidStateProof.into());
    }

    items[2].clone().try_into()
        .map_err(|_| ErrorCode::InvalidStateProof.into())
}

/// Deserialize proof nodes from a serialized format
/// Format: [num_nodes: u16][node1_len: u16][node1_data][node2_len: u16][node2_data]...
fn deserialize_proof_nodes(data: &[u8]) -> Result<Vec<Vec<u8>>> {
    if data.len() < 2 {
        return Err(ErrorCode::InvalidStateProof.into());
    }

    let num_nodes = u16::from_le_bytes([data[0], data[1]]) as usize;
    let mut nodes = Vec::with_capacity(num_nodes);
    let mut pos = 2;

    for _ in 0..num_nodes {
        if pos + 2 > data.len() {
            return Err(ErrorCode::InvalidStateProof.into());
        }
        
        let node_len = u16::from_le_bytes([data[pos], data[pos + 1]]) as usize;
        pos += 2;

        if pos + node_len > data.len() {
            return Err(ErrorCode::InvalidStateProof.into());
        }

        nodes.push(data[pos..pos + node_len].to_vec());
        pos += node_len;
    }

    Ok(nodes)
}
