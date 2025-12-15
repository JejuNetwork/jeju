//! Verification Key for Ethereum Sync Committee ZK Circuit
//!
//! # PRODUCTION REQUIREMENT
//!
//! These verification key values are PLACEHOLDER ZEROS and MUST be replaced
//! with actual values generated from the SP1 circuit compilation before
//! deploying to production.
//!
//! ## How to Generate Real Verification Keys
//!
//! 1. Build the SP1 circuit:
//!    ```bash
//!    cd circuits/ethereum
//!    SP1_DEV=1 cargo build --release
//!    ```
//!
//! 2. Generate and export the verification key:
//!    ```bash
//!    cd target/release
//!    ./ethereum_consensus --prove --vk-export rust
//!    ```
//!
//! 3. Copy the generated values into this file, replacing the zeros.
//!
//! 4. Run the test to verify keys are non-zero:
//!    ```bash
//!    cargo test verification_key_not_placeholder
//!    ```
//!
//! ## Security Warning
//!
//! Deploying with zero verification keys will cause:
//! - All proofs to fail verification
//! - The light client to be non-functional
//! - Bridge transfers to be impossible
//!
//! This is a CRITICAL SECURITY COMPONENT. Do not deploy to mainnet
//! without proper verification keys.

/// Alpha point (G1) - first element of the verification key
/// This is part of the trusted setup and unique to the circuit
///
/// PLACEHOLDER: Replace with actual value from SP1 circuit compilation
pub const ALPHA_G1: [u8; 64] = [
    // x coordinate (32 bytes)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    // y coordinate (32 bytes)
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];

/// Beta point (G2) - second element of the verification key
/// PLACEHOLDER: Replace with actual value from SP1 circuit compilation
pub const BETA_G2: [u8; 128] = [0u8; 128];

/// Gamma point (G2) - used in the pairing equation
/// PLACEHOLDER: Replace with actual value from SP1 circuit compilation
pub const GAMMA_G2: [u8; 128] = [0u8; 128];

/// Delta point (G2) - used in the pairing equation
/// PLACEHOLDER: Replace with actual value from SP1 circuit compilation
pub const DELTA_G2: [u8; 128] = [0u8; 128];

/// IC points (G1) - one for each public input plus one base point
///
/// For our Ethereum sync committee circuit, we have 7 public inputs:
/// 0. prev_slot - Previous verified slot
/// 1. prev_root - Previous block root  
/// 2. new_slot - New slot being verified
/// 3. new_root - New block root
/// 4. committee_root - Sync committee root
/// 5. total_stake - Total stake in sync committee
/// 6. voting_stake - Stake that voted for this block
///
/// IC[0] is the base point, IC[1..8] are the input-specific points
///
/// PLACEHOLDER: Replace with actual values from SP1 circuit compilation
pub const IC_LENGTH: usize = 8;
pub const IC: [[u8; 64]; IC_LENGTH] = [[0u8; 64]; IC_LENGTH];

/// Returns true if verification keys are still placeholders (all zeros)
pub fn is_placeholder() -> bool {
    ALPHA_G1.iter().all(|&b| b == 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_verification_key_sizes() {
        assert_eq!(ALPHA_G1.len(), 64, "Alpha G1 must be 64 bytes");
        assert_eq!(BETA_G2.len(), 128, "Beta G2 must be 128 bytes");
        assert_eq!(GAMMA_G2.len(), 128, "Gamma G2 must be 128 bytes");
        assert_eq!(DELTA_G2.len(), 128, "Delta G2 must be 128 bytes");
        assert_eq!(IC.len(), IC_LENGTH, "IC array length mismatch");
        for (i, ic) in IC.iter().enumerate() {
            assert_eq!(ic.len(), 64, "IC[{}] must be 64 bytes", i);
        }
    }

    /// This test will FAIL until real verification keys are provided.
    /// Comment out for development, but MUST pass before mainnet deployment.
    #[test]
    #[ignore = "Enable this test before mainnet deployment"]
    fn verification_key_not_placeholder() {
        assert!(
            !is_placeholder(),
            "CRITICAL: Verification keys are still placeholders. \
             Generate real keys from SP1 circuit compilation before deployment."
        );
    }
}
