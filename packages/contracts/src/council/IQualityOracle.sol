// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IQualityOracle
 * @notice Interface for verifying quality attestations on Council proposals
 */
interface IQualityOracle {
    /**
     * @notice Verify a quality score attestation
     * @param contentHash Hash of the proposal content
     * @param qualityScore Score from 0-100
     * @param attestationTimestamp When the attestation was made
     * @param proposer Address of the proposal submitter
     * @param attestationSignature Signature proving the attestation
     */
    function verifyScore(
        bytes32 contentHash,
        uint256 qualityScore,
        uint256 attestationTimestamp,
        address proposer,
        bytes calldata attestationSignature
    ) external view;
}
