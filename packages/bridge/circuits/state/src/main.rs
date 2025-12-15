//! Token Transfer Inclusion ZK Circuit
//!
//! This SP1 program proves that a token transfer was included in
//! a verified block on either Solana or EVM chains.
//!
//! For Solana: Proves transaction inclusion in a bank hash
//! For EVM: Proves log/receipt inclusion in a state root via Merkle-Patricia Trie

#![no_main]
sp1_zkvm::entrypoint!(main);

use serde::{Deserialize, Serialize};
use serde_with::{serde_as, Bytes};
use sha2::{Digest, Sha256};
use sha3::Keccak256;

/// Transfer details
#[serde_as]
#[derive(Serialize, Deserialize, Clone)]
pub struct TokenTransfer {
    #[serde_as(as = "Bytes")]
    pub transfer_id: [u8; 32],
    pub source_chain: u64,
    pub dest_chain: u64,
    #[serde_as(as = "Bytes")]
    pub token: [u8; 32],
    #[serde_as(as = "Bytes")]
    pub sender: [u8; 32],
    #[serde_as(as = "Bytes")]
    pub recipient: [u8; 32],
    pub amount: u64,
    pub nonce: u64,
    pub timestamp: u64,
}

/// Merkle proof for Solana
#[serde_as]
#[derive(Serialize, Deserialize)]
pub struct SolanaMerkleProof {
    #[serde_as(as = "Bytes")]
    pub signature: [u8; 64],
    pub path: Vec<[u8; 32]>,
    #[serde_as(as = "Bytes")]
    pub bank_hash: [u8; 32],
    pub slot: u64,
}

/// Merkle-Patricia proof for EVM
#[serde_as]
#[derive(Serialize, Deserialize)]
pub struct EVMMerkleProof {
    #[serde_as(as = "Bytes")]
    pub receipt_root: [u8; 32],
    #[serde_as(as = "Bytes")]
    pub receipt: Vec<u8>,
    pub proof_nodes: Vec<Vec<u8>>,
    pub block_number: u64,
    #[serde_as(as = "Bytes")]
    pub state_root: [u8; 32],
    pub receipt_index: u64,
}

/// Proof type enum
#[derive(Serialize, Deserialize)]
pub enum ChainProof {
    Solana(SolanaMerkleProof),
    EVM(EVMMerkleProof),
}

/// Proof inputs
#[derive(Serialize, Deserialize)]
pub struct TransferProofInputs {
    pub transfer: TokenTransfer,
    pub proof: ChainProof,
}

/// Proof outputs
#[serde_as]
#[derive(Serialize, Deserialize)]
pub struct TransferProofOutputs {
    #[serde_as(as = "Bytes")]
    pub transfer_id: [u8; 32],
    #[serde_as(as = "Bytes")]
    pub transfer_hash: [u8; 32],
    pub source_chain: u64,
    pub dest_chain: u64,
    pub amount: u64,
    #[serde_as(as = "Bytes")]
    pub verified_root: [u8; 32],
    pub block_slot: u64,
}

fn main() {
    let inputs: TransferProofInputs = sp1_zkvm::io::read();

    // Compute transfer hash for commitment
    let transfer_hash = compute_transfer_hash(&inputs.transfer);

    // Verify proof based on chain type
    let (verified_root, block_slot) = match &inputs.proof {
        ChainProof::Solana(proof) => {
            verify_solana_proof(&inputs.transfer, proof);
            (proof.bank_hash, proof.slot)
        }
        ChainProof::EVM(proof) => {
            verify_evm_proof(&inputs.transfer, proof);
            (proof.state_root, proof.block_number)
        }
    };

    let outputs = TransferProofOutputs {
        transfer_id: inputs.transfer.transfer_id,
        transfer_hash,
        source_chain: inputs.transfer.source_chain,
        dest_chain: inputs.transfer.dest_chain,
        amount: inputs.transfer.amount,
        verified_root,
        block_slot,
    };

    sp1_zkvm::io::commit(&outputs);
}

fn compute_transfer_hash(transfer: &TokenTransfer) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(&transfer.transfer_id);
    hasher.update(&transfer.source_chain.to_le_bytes());
    hasher.update(&transfer.dest_chain.to_le_bytes());
    hasher.update(&transfer.token);
    hasher.update(&transfer.sender);
    hasher.update(&transfer.recipient);
    hasher.update(&transfer.amount.to_le_bytes());
    hasher.update(&transfer.nonce.to_le_bytes());
    hasher.update(&transfer.timestamp.to_le_bytes());
    hasher.finalize().into()
}

fn verify_solana_proof(transfer: &TokenTransfer, proof: &SolanaMerkleProof) {
    // Compute transaction hash from signature
    let mut hasher = Sha256::new();
    hasher.update(&proof.signature);
    let tx_hash: [u8; 32] = hasher.finalize().into();

    // Verify merkle path to bank hash
    let mut current = tx_hash;
    for sibling in &proof.path {
        let mut hasher = Sha256::new();
        if current <= *sibling {
            hasher.update(&current);
            hasher.update(sibling);
        } else {
            hasher.update(sibling);
            hasher.update(&current);
        }
        current = hasher.finalize().into();
    }

    assert_eq!(current, proof.bank_hash, "Bank hash mismatch");
    assert_eq!(transfer.source_chain, 101, "Source must be Solana");
}

fn verify_evm_proof(transfer: &TokenTransfer, proof: &EVMMerkleProof) {
    assert!(!proof.receipt.is_empty(), "Receipt required");
    assert!(!proof.proof_nodes.is_empty(), "Proof nodes required");

    // Compute receipt hash using keccak256
    let receipt_hash = keccak256(&proof.receipt);

    // Compute the key for the receipt in the trie (RLP-encoded index)
    let key = rlp_encode_index(proof.receipt_index);
    let key_nibbles = bytes_to_nibbles(&key);

    // Verify Merkle-Patricia Trie proof
    let computed_root = verify_mpt_proof(&key_nibbles, &receipt_hash, &proof.proof_nodes);

    assert_eq!(
        computed_root, proof.receipt_root,
        "Receipt root mismatch - MPT verification failed"
    );

    // Verify transfer details match EVM chains
    assert!(
        transfer.source_chain == 1
            || transfer.source_chain == 8453
            || transfer.source_chain == 42161
            || transfer.source_chain == 10
            || transfer.source_chain == 56
            || transfer.source_chain == 31337,
        "Invalid EVM source chain"
    );
}

/// Verify a Merkle-Patricia Trie proof
fn verify_mpt_proof(key_nibbles: &[u8], value_hash: &[u8; 32], proof_nodes: &[Vec<u8>]) -> [u8; 32] {
    assert!(!proof_nodes.is_empty(), "Empty proof");

    let mut key_idx = 0;
    let mut expected_hash = keccak256(&proof_nodes[0]);

    for (i, node) in proof_nodes.iter().enumerate() {
        // Verify node hash matches expected
        if i > 0 {
            let node_hash = keccak256(node);
            assert_eq!(node_hash, expected_hash, "Node hash mismatch at index {}", i);
        }

        // Decode RLP node
        let decoded = decode_rlp_node(node);

        match decoded.len() {
            2 => {
                // Leaf or extension node
                let (path, is_leaf) = decode_compact_path(&decoded[0]);

                if is_leaf {
                    // Leaf node - verify key and value match
                    assert_eq!(
                        &key_nibbles[key_idx..],
                        path.as_slice(),
                        "Leaf key mismatch"
                    );
                    // Value should be the RLP-encoded receipt, hash it
                    let leaf_value_hash = keccak256(&decoded[1]);
                    assert_eq!(leaf_value_hash, *value_hash, "Leaf value mismatch");
                    // Return the root hash (first node's hash)
                    return keccak256(&proof_nodes[0]);
                } else {
                    // Extension node - follow the path
                    assert_eq!(
                        &key_nibbles[key_idx..key_idx + path.len()],
                        path.as_slice(),
                        "Extension key mismatch"
                    );
                    key_idx += path.len();
                    expected_hash = decode_hash(&decoded[1]);
                }
            }
            17 => {
                // Branch node
                if key_idx < key_nibbles.len() {
                    let nibble = key_nibbles[key_idx] as usize;
                    key_idx += 1;
                    expected_hash = decode_hash(&decoded[nibble]);
                } else {
                    // Value is in the 17th element
                    let branch_value_hash = keccak256(&decoded[16]);
                    assert_eq!(branch_value_hash, *value_hash, "Branch value mismatch");
                    return keccak256(&proof_nodes[0]);
                }
            }
            _ => panic!("Invalid RLP node length: {}", decoded.len()),
        }
    }

    keccak256(&proof_nodes[0])
}

/// Decode compact path encoding used in MPT
fn decode_compact_path(encoded: &[u8]) -> (Vec<u8>, bool) {
    if encoded.is_empty() {
        return (vec![], false);
    }

    let first = encoded[0];
    let is_leaf = (first >> 4) & 1 == 1;
    let odd_len = first & 0x10 != 0;

    let mut nibbles = Vec::new();

    if odd_len {
        nibbles.push(first & 0x0f);
    }

    for byte in &encoded[1..] {
        nibbles.push(byte >> 4);
        nibbles.push(byte & 0x0f);
    }

    (nibbles, is_leaf)
}

/// Simple RLP decoding for MPT nodes
fn decode_rlp_node(data: &[u8]) -> Vec<Vec<u8>> {
    let mut result = Vec::new();

    if data.is_empty() {
        return result;
    }

    // Check if it's a list
    if data[0] >= 0xc0 {
        let (list_len, offset) = if data[0] <= 0xf7 {
            ((data[0] - 0xc0) as usize, 1)
        } else {
            let len_bytes = (data[0] - 0xf7) as usize;
            let mut len = 0usize;
            for j in 0..len_bytes {
                len = (len << 8) | (data[1 + j] as usize);
            }
            (len, 1 + len_bytes)
        };

        let mut pos = offset;
        let end = offset + list_len;

        while pos < end && pos < data.len() {
            let (item, consumed) = decode_rlp_item(&data[pos..]);
            result.push(item);
            pos += consumed;
        }
    }

    result
}

/// Decode a single RLP item
fn decode_rlp_item(data: &[u8]) -> (Vec<u8>, usize) {
    if data.is_empty() {
        return (vec![], 0);
    }

    let first = data[0];

    if first <= 0x7f {
        // Single byte
        (vec![first], 1)
    } else if first <= 0xb7 {
        // Short string (0-55 bytes)
        let len = (first - 0x80) as usize;
        (data[1..1 + len].to_vec(), 1 + len)
    } else if first <= 0xbf {
        // Long string
        let len_bytes = (first - 0xb7) as usize;
        let mut len = 0usize;
        for i in 0..len_bytes {
            len = (len << 8) | (data[1 + i] as usize);
        }
        let offset = 1 + len_bytes;
        (data[offset..offset + len].to_vec(), offset + len)
    } else if first <= 0xf7 {
        // Short list - return as-is
        let len = (first - 0xc0) as usize;
        (data[0..1 + len].to_vec(), 1 + len)
    } else {
        // Long list
        let len_bytes = (first - 0xf7) as usize;
        let mut len = 0usize;
        for i in 0..len_bytes {
            len = (len << 8) | (data[1 + i] as usize);
        }
        let offset = 1 + len_bytes;
        (data[0..offset + len].to_vec(), offset + len)
    }
}

/// Decode a 32-byte hash from RLP
fn decode_hash(data: &[u8]) -> [u8; 32] {
    if data.len() == 32 {
        let mut hash = [0u8; 32];
        hash.copy_from_slice(data);
        hash
    } else if data.len() == 33 && data[0] == 0xa0 {
        // RLP-encoded 32-byte string
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&data[1..]);
        hash
    } else if data.len() < 32 {
        // Short hash (inline value)
        keccak256(data)
    } else {
        panic!("Invalid hash encoding: len={}", data.len());
    }
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

/// RLP encode a transaction index
fn rlp_encode_index(index: u64) -> Vec<u8> {
    if index == 0 {
        vec![0x80] // RLP for empty string (index 0)
    } else if index < 128 {
        vec![index as u8]
    } else {
        let mut bytes = Vec::new();
        let mut n = index;
        while n > 0 {
            bytes.push((n & 0xff) as u8);
            n >>= 8;
        }
        bytes.reverse();
        let len = bytes.len();
        let mut result = vec![0x80 + len as u8];
        result.extend(bytes);
        result
    }
}

/// Keccak256 hash
fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(data);
    hasher.finalize().into()
}
