// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IZKVerifier
 * @notice Interface for Groth16 ZK proof verification
 * @dev Implementation should be generated from the SP1/Circom circuit
 */
interface IZKVerifier {
    /**
     * @notice Verify a Groth16 proof
     * @param proof The 8-element proof array [a0, a1, b00, b01, b10, b11, c0, c1]
     * @param publicInputs The public inputs to the circuit
     * @return True if the proof is valid, false otherwise
     */
    function verifyProof(uint256[8] calldata proof, uint256[] calldata publicInputs) external view returns (bool);
}
