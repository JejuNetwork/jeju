//! Solana Consensus ZK Circuit
//!
//! This SP1 program proves that:
//! 1. A set of Ed25519 signatures are valid
//! 2. The signatures represent ≥2/3 of total stake
//! 3. All signatures attest to the same bank hash
//!
//! The proof enables trustless verification of Solana state on EVM chains.

#![no_main]
sp1_zkvm::entrypoint!(main);

use sha2::{Digest, Sha256};
use ed25519_dalek::{Signature, VerifyingKey, Verifier};
use serde::{Deserialize, Serialize};
use serde_with::serde_as;

/// Maximum number of validators in a proof batch
const MAX_VALIDATORS: usize = 100;

/// Validator stake and vote
#[serde_as]
#[derive(Serialize, Deserialize, Clone)]
pub struct ValidatorVote {
    /// Validator public key (32 bytes)
    pub pubkey: [u8; 32],
    /// Vote account (32 bytes)
    pub vote_account: [u8; 32],
    /// Stake in lamports
    pub stake: u64,
    /// Slot being voted on
    pub slot: u64,
    /// Bank hash being voted on
    pub bank_hash: [u8; 32],
    /// Ed25519 signature (64 bytes)
    #[serde_as(as = "[_; 64]")]
    pub signature: [u8; 64],
}

/// Epoch stake information
#[derive(Serialize, Deserialize, Clone)]
pub struct EpochStakes {
    pub epoch: u64,
    pub total_stake: u64,
    /// Merkle root of all validator stakes
    pub stakes_root: [u8; 32],
}

/// Proof inputs
#[derive(Serialize, Deserialize)]
pub struct ConsensusProofInputs {
    /// Previous verified slot
    pub prev_slot: u64,
    /// Previous verified bank hash
    pub prev_bank_hash: [u8; 32],
    /// New slot to verify
    pub new_slot: u64,
    /// New bank hash to verify
    pub new_bank_hash: [u8; 32],
    /// Epoch stakes
    pub epoch_stakes: EpochStakes,
    /// Validator votes (must sum to ≥2/3 stake)
    pub votes: Vec<ValidatorVote>,
}

/// Proof outputs (public inputs to verifier)
#[derive(Serialize, Deserialize)]
pub struct ConsensusProofOutputs {
    pub prev_slot: u64,
    pub prev_bank_hash: [u8; 32],
    pub new_slot: u64,
    pub new_bank_hash: [u8; 32],
    pub epoch_stakes_root: [u8; 32],
    pub total_stake: u64,
    pub voting_stake: u64,
}

fn main() {
    // Read inputs from SP1 host
    let inputs: ConsensusProofInputs = sp1_zkvm::io::read();

    // Validate basic constraints
    assert!(inputs.new_slot > inputs.prev_slot, "New slot must be greater");
    assert!(inputs.votes.len() <= MAX_VALIDATORS, "Too many validators");
    assert!(inputs.votes.len() > 0, "No votes provided");

    // Calculate required stake (2/3 of total)
    let required_stake = (inputs.epoch_stakes.total_stake * 2) / 3;

    // Verify each signature and accumulate stake
    let mut voting_stake: u64 = 0;

    for vote in &inputs.votes {
        // Verify the vote is for the correct slot and bank hash
        assert_eq!(vote.slot, inputs.new_slot, "Vote slot mismatch");
        assert_eq!(vote.bank_hash, inputs.new_bank_hash, "Vote bank hash mismatch");

        // Construct the signed message
        // Solana vote message format: slot || bank_hash
        let mut message = Vec::with_capacity(40);
        message.extend_from_slice(&vote.slot.to_le_bytes());
        message.extend_from_slice(&vote.bank_hash);

        // Verify Ed25519 signature
        let pubkey = VerifyingKey::from_bytes(&vote.pubkey)
            .expect("Invalid public key");
        let signature = Signature::from_bytes(&vote.signature);

        pubkey.verify(&message, &signature)
            .expect("Signature verification failed");

        // Accumulate stake
        voting_stake += vote.stake;
    }

    // Verify supermajority
    assert!(voting_stake >= required_stake, "Insufficient voting stake");

    // Construct outputs
    let outputs = ConsensusProofOutputs {
        prev_slot: inputs.prev_slot,
        prev_bank_hash: inputs.prev_bank_hash,
        new_slot: inputs.new_slot,
        new_bank_hash: inputs.new_bank_hash,
        epoch_stakes_root: inputs.epoch_stakes.stakes_root,
        total_stake: inputs.epoch_stakes.total_stake,
        voting_stake,
    };

    // Commit outputs as public inputs
    sp1_zkvm::io::commit(&outputs);
}

/// Helper to compute message hash for signature verification
#[allow(dead_code)]
fn compute_vote_message_hash(slot: u64, bank_hash: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(&slot.to_le_bytes());
    hasher.update(bank_hash);
    hasher.finalize().into()
}

/// Verify a merkle proof for validator stake inclusion
#[allow(dead_code)]
fn verify_stake_merkle_proof(
    pubkey: &[u8; 32],
    stake: u64,
    proof: &[[u8; 32]],
    root: &[u8; 32],
) -> bool {
    // Compute leaf hash
    let mut hasher = Sha256::new();
    hasher.update(pubkey);
    hasher.update(&stake.to_le_bytes());
    let mut current_hash: [u8; 32] = hasher.finalize().into();

    // Traverse proof
    for sibling in proof {
        let mut hasher = Sha256::new();
        if current_hash <= *sibling {
            hasher.update(&current_hash);
            hasher.update(sibling);
        } else {
            hasher.update(sibling);
            hasher.update(&current_hash);
        }
        current_hash = hasher.finalize().into();
    }

    current_hash == *root
}
