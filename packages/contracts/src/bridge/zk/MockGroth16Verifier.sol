// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "./interfaces/IZKVerifier.sol";

/**
 * @title MockGroth16Verifier
 * @notice Mock verifier for localnet/testing - accepts all valid-looking proofs
 * @dev DO NOT USE IN PRODUCTION - this accepts any non-zero proof
 * 
 * For production, replace with the actual Groth16 verifier generated from:
 * - SP1 circuit compilation for Solana consensus verification
 * - Generates proper verification key from trusted setup
 */
contract MockGroth16Verifier is IZKVerifier {
    bool public immutable isLocalnet;

    constructor() {
        isLocalnet = true;
    }

    /**
     * @notice Verify a Groth16 proof (mock implementation)
     * @dev In production, this performs actual pairing checks
     * @param proof The 8-element proof array
     * @param publicInputs The public inputs to the circuit
     * @return True if proof looks valid (non-zero), always true in mock
     */
    function verifyProof(
        uint256[8] calldata proof,
        uint256[] calldata publicInputs
    ) external pure override returns (bool) {
        // Basic sanity checks even for mock
        // Proof should have non-zero elements
        bool hasNonZeroProof = false;
        for (uint256 i = 0; i < 8; i++) {
            if (proof[i] != 0) {
                hasNonZeroProof = true;
                break;
            }
        }

        // Must have at least some public inputs
        bool hasInputs = publicInputs.length > 0;

        return hasNonZeroProof && hasInputs;
    }

    /**
     * @notice Check if this is a mock verifier
     * @return True (this is always a mock)
     */
    function isMock() external pure returns (bool) {
        return true;
    }
}

