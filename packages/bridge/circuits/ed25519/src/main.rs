//! Ed25519 Batch Signature Verification ZK Circuit
//!
//! This SP1 program proves the validity of multiple Ed25519 signatures
//! in a single ZK proof. This is critical for Solana consensus verification
//! where thousands of validator signatures need to be verified on EVM.
//!
//! The proof aggregates signatures, outputting:
//! - Hash of all verified messages
//! - Count of valid signatures
//! - Aggregated public key commitment

#![no_main]
sp1_zkvm::entrypoint!(main);

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_with::{serde_as, Bytes};
use sha2::{Digest, Sha256};

/// Maximum signatures per batch
const MAX_SIGNATURES: usize = 64;

/// Single signature entry
#[serde_as]
#[derive(Serialize, Deserialize, Clone)]
pub struct SignatureEntry {
    /// Public key (32 bytes)
    #[serde_as(as = "Bytes")]
    pub pubkey: [u8; 32],
    /// Message being signed
    #[serde_as(as = "Bytes")]
    pub message: Vec<u8>,
    /// Signature (64 bytes)
    #[serde_as(as = "Bytes")]
    pub signature: [u8; 64],
}

/// Batch inputs
#[derive(Serialize, Deserialize)]
pub struct BatchInputs {
    pub entries: Vec<SignatureEntry>,
}

/// Batch outputs (public inputs)
#[serde_as]
#[derive(Serialize, Deserialize)]
pub struct BatchOutputs {
    /// Hash of all verified messages
    #[serde_as(as = "Bytes")]
    pub messages_hash: [u8; 32],
    /// Hash of all public keys
    #[serde_as(as = "Bytes")]
    pub pubkeys_hash: [u8; 32],
    /// Number of valid signatures
    pub count: u32,
}

fn main() {
    // Read inputs
    let inputs: BatchInputs = sp1_zkvm::io::read();

    assert!(inputs.entries.len() <= MAX_SIGNATURES, "Too many signatures");
    assert!(!inputs.entries.is_empty(), "No signatures");

    // Hashers for aggregation
    let mut messages_hasher = Sha256::new();
    let mut pubkeys_hasher = Sha256::new();
    let mut count: u32 = 0;

    for entry in &inputs.entries {
        // Verify signature
        let pubkey = VerifyingKey::from_bytes(&entry.pubkey).expect("Invalid public key");
        let signature = Signature::from_bytes(&entry.signature);

        pubkey
            .verify(&entry.message, &signature)
            .expect("Signature verification failed");

        // Accumulate hashes
        messages_hasher.update(&entry.message);
        pubkeys_hasher.update(&entry.pubkey);
        count += 1;
    }

    // Finalize outputs
    let outputs = BatchOutputs {
        messages_hash: messages_hasher.finalize().into(),
        pubkeys_hash: pubkeys_hasher.finalize().into(),
        count,
    };

    sp1_zkvm::io::commit(&outputs);
}
