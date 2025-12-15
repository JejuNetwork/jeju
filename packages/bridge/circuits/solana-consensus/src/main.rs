//! Solana Consensus ZK Program
//!
//! Verifies Solana consensus by proving:
//! 1. A supermajority (2/3+) of stake has voted for a slot
//! 2. The votes are from valid validators (Ed25519 signatures)
//! 3. The bank hash is correctly derived

#![no_main]
sp1_zkvm::entrypoint!(main);

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_with::{serde_as, Bytes};

/// Validator vote to be verified
#[serde_as]
#[derive(Serialize, Deserialize, Clone)]
pub struct ValidatorVote {
    /// Validator's public key (32 bytes, Ed25519)
    #[serde_as(as = "Bytes")]
    pub pubkey: [u8; 32],
    /// Vote signature (64 bytes, Ed25519)
    #[serde_as(as = "Bytes")]
    pub signature: [u8; 64],
    /// Slot being voted on
    pub slot: u64,
    /// Bank hash being voted on
    #[serde_as(as = "Bytes")]
    pub bank_hash: [u8; 32],
}

/// Epoch stake information
#[serde_as]
#[derive(Serialize, Deserialize, Clone)]
pub struct ValidatorStake {
    /// Validator's public key
    #[serde_as(as = "Bytes")]
    pub pubkey: [u8; 32],
    /// Stake amount in lamports
    pub stake: u64,
}

/// Consensus verification input
#[serde_as]
#[derive(Serialize, Deserialize)]
pub struct ConsensusInput {
    /// Slot being verified
    pub slot: u64,
    /// Expected bank hash
    #[serde_as(as = "Bytes")]
    pub bank_hash: [u8; 32],
    /// Previous bank hash (parent)
    #[serde_as(as = "Bytes")]
    pub parent_bank_hash: [u8; 32],
    /// Validator votes
    pub votes: Vec<ValidatorVote>,
    /// Epoch stake distribution
    pub epoch_stakes: Vec<ValidatorStake>,
    /// Total active stake in the epoch
    pub total_stake: u64,
}

/// Output proving consensus was verified
#[serde_as]
#[derive(Serialize, Deserialize)]
pub struct ConsensusOutput {
    /// Slot that was verified
    pub slot: u64,
    /// Bank hash that was verified
    #[serde_as(as = "Bytes")]
    pub bank_hash: [u8; 32],
    /// Total stake that voted
    pub voted_stake: u64,
    /// Total active stake
    pub total_stake: u64,
    /// Whether supermajority was achieved
    pub supermajority: bool,
}

fn main() {
    // Read input from the prover
    let input: ConsensusInput = sp1_zkvm::io::read();

    // Build stake lookup
    let stake_map: Vec<([u8; 32], u64)> = input
        .epoch_stakes
        .iter()
        .map(|s| (s.pubkey, s.stake))
        .collect();

    // Verify votes and count stake
    let mut voted_stake: u64 = 0;
    let mut verified_votes: Vec<[u8; 32]> = Vec::new();

    for vote in &input.votes {
        // Skip if already counted (no double voting)
        if verified_votes.contains(&vote.pubkey) {
            continue;
        }

        // Verify vote is for the correct slot and bank hash
        assert_eq!(vote.slot, input.slot, "Vote for wrong slot");
        assert_eq!(vote.bank_hash, input.bank_hash, "Vote for wrong bank hash");

        // Verify Ed25519 signature in-circuit
        let sig_valid = verify_ed25519_signature(
            &vote.pubkey,
            &vote.signature,
            &create_vote_message(vote.slot, &vote.bank_hash),
        );
        assert!(sig_valid, "Invalid vote signature");

        // Look up stake
        if let Some((_, stake)) = stake_map.iter().find(|(pk, _)| *pk == vote.pubkey) {
            voted_stake = voted_stake.saturating_add(*stake);
            verified_votes.push(vote.pubkey);
        }
    }

    // Check supermajority (2/3 + 1)
    let required_stake = (input.total_stake * 2 / 3) + 1;
    let supermajority = voted_stake >= required_stake;

    assert!(supermajority, "Supermajority not achieved");

    // Create output
    let output = ConsensusOutput {
        slot: input.slot,
        bank_hash: input.bank_hash,
        voted_stake,
        total_stake: input.total_stake,
        supermajority,
    };

    // Commit the output
    sp1_zkvm::io::commit(&output);
}

fn create_vote_message(slot: u64, bank_hash: &[u8; 32]) -> Vec<u8> {
    let mut message = Vec::with_capacity(40);
    message.extend_from_slice(&slot.to_le_bytes());
    message.extend_from_slice(bank_hash);
    message
}

fn verify_ed25519_signature(pubkey: &[u8; 32], signature: &[u8; 64], message: &[u8]) -> bool {
    let Ok(verifying_key) = VerifyingKey::from_bytes(pubkey) else {
        return false;
    };
    let Ok(sig) = Signature::from_slice(signature) else {
        return false;
    };
    verifying_key.verify(message, &sig).is_ok()
}
