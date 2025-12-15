// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IGroth16Verifier
 * @notice Interface for Groth16 ZK proof verification
 * @dev Used for verifying SP1 proofs of Solana/Ethereum consensus
 */
interface IGroth16Verifier {
    /**
     * @notice Verify a Groth16 proof
     * @param a First proof element (G1 point)
     * @param b Second proof element (G2 point)
     * @param c Third proof element (G1 point)
     * @param publicInputs Array of public inputs
     * @return valid True if proof is valid
     */
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[] calldata publicInputs
    ) external view returns (bool valid);

    /**
     * @notice Get the verification key hash for this verifier
     * @return vkeyHash Hash of the verification key
     */
    function getVerificationKeyHash() external view returns (bytes32 vkeyHash);
}
