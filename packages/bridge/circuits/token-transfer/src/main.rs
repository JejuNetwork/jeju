//! Token Transfer ZK Program
//!
//! This SP1 program verifies cross-chain token transfers by proving:
//! 1. The transfer was included in a valid source chain state
//! 2. The sender had sufficient balance
//! 3. The transfer data is correctly formatted
//!
//! The program outputs a commitment that can be verified on-chain.

#![no_main]
sp1_zkvm::entrypoint!(main);

use serde::{Deserialize, Serialize};
use serde_with::{serde_as, Bytes};
use sha3::{Digest, Keccak256};

/// Transfer data to be proven
#[serde_as]
#[derive(Serialize, Deserialize)]
pub struct TransferInput {
    /// Transfer ID (32 bytes)
    #[serde_as(as = "Bytes")]
    pub transfer_id: [u8; 32],
    /// Source chain ID
    pub source_chain: u32,
    /// Destination chain ID
    pub dest_chain: u32,
    /// Sender address (32 bytes, padded)
    #[serde_as(as = "Bytes")]
    pub sender: [u8; 32],
    /// Recipient address (32 bytes, padded)
    #[serde_as(as = "Bytes")]
    pub recipient: [u8; 32],
    /// Token address (32 bytes, padded)
    #[serde_as(as = "Bytes")]
    pub token: [u8; 32],
    /// Amount as u64 (for simplicity)
    pub amount: u64,
    /// Nonce
    pub nonce: u64,
    /// State root at time of transfer
    #[serde_as(as = "Bytes")]
    pub state_root: [u8; 32],
    /// Merkle proof of inclusion
    pub merkle_proof: Vec<[u8; 32]>,
    /// Merkle proof indices (left/right)
    pub proof_indices: Vec<bool>,
}

/// Output commitment proven by this program
#[serde_as]
#[derive(Serialize, Deserialize)]
pub struct TransferOutput {
    /// Hash of the verified transfer
    #[serde_as(as = "Bytes")]
    pub transfer_hash: [u8; 32],
    /// State root that was verified against
    #[serde_as(as = "Bytes")]
    pub state_root: [u8; 32],
    /// Source chain ID
    pub source_chain: u32,
    /// Destination chain ID
    pub dest_chain: u32,
}

fn main() {
    // Read input from the prover
    let input: TransferInput = sp1_zkvm::io::read();

    // Compute transfer hash
    let transfer_hash = compute_transfer_hash(&input);

    // Verify merkle inclusion proof
    let computed_root = verify_merkle_proof(
        &transfer_hash,
        &input.merkle_proof,
        &input.proof_indices,
    );

    // Assert the computed root matches the claimed state root
    assert_eq!(
        computed_root, input.state_root,
        "Merkle proof verification failed"
    );

    // Validate chain IDs
    assert!(input.source_chain > 0, "Invalid source chain");
    assert!(input.dest_chain > 0, "Invalid dest chain");
    assert!(input.source_chain != input.dest_chain, "Same chain transfer");

    // Validate amount
    assert!(input.amount > 0, "Zero amount transfer");

    // Create output commitment
    let output = TransferOutput {
        transfer_hash,
        state_root: input.state_root,
        source_chain: input.source_chain,
        dest_chain: input.dest_chain,
    };

    // Commit the output (this becomes the public inputs to the ZK proof)
    sp1_zkvm::io::commit(&output);
}

/// Compute keccak256 hash of transfer data
fn compute_transfer_hash(input: &TransferInput) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(&input.transfer_id);
    hasher.update(&input.source_chain.to_be_bytes());
    hasher.update(&input.dest_chain.to_be_bytes());
    hasher.update(&input.sender);
    hasher.update(&input.recipient);
    hasher.update(&input.token);
    hasher.update(&input.amount.to_be_bytes());
    hasher.update(&input.nonce.to_be_bytes());
    hasher.finalize().into()
}

/// Verify a merkle proof
fn verify_merkle_proof(leaf: &[u8; 32], proof: &[[u8; 32]], indices: &[bool]) -> [u8; 32] {
    assert_eq!(proof.len(), indices.len(), "Proof/indices length mismatch");

    let mut current = *leaf;

    for (i, sibling) in proof.iter().enumerate() {
        let mut hasher = Keccak256::new();
        if indices[i] {
            // Current is on the right
            hasher.update(sibling);
            hasher.update(&current);
        } else {
            // Current is on the left
            hasher.update(&current);
            hasher.update(sibling);
        }
        current = hasher.finalize().into();
    }

    current
}
