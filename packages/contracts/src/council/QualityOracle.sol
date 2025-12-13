// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title QualityOracle
 * @author Jeju Network
 * @notice On-chain verification of proposal quality scores
 * @dev Authorized assessors sign quality assessments off-chain.
 *      The Council contract verifies these signatures before accepting proposals.
 *
 * Flow:
 * 1. User submits draft to Proposal Assistant (off-chain)
 * 2. Assistant evaluates and generates quality score
 * 3. If score >= 90%, assistant signs attestation
 * 4. User submits proposal + signature to Council
 * 5. Council calls QualityOracle.verifyScore()
 * 6. If valid, proposal is accepted
 *
 * @custom:security-contact security@jeju.network
 */
contract QualityOracle is Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============================================================================
    // State Variables
    // ============================================================================

    /// @notice Authorized assessors who can sign quality attestations
    mapping(address => bool) public isAssessor;

    /// @notice Used attestation hashes to prevent replay
    mapping(bytes32 => bool) public usedAttestations;

    /// @notice Total number of assessors
    uint256 public assessorCount;

    /// @notice Minimum score required (configurable)
    uint8 public minScore = 90;

    /// @notice Attestation validity period (signatures expire after this)
    uint256 public attestationTTL = 1 hours;

    // ============================================================================
    // Events
    // ============================================================================

    event AssessorAdded(address indexed assessor);
    event AssessorRemoved(address indexed assessor);
    event AttestationVerified(
        bytes32 indexed contentHash,
        uint8 score,
        address indexed assessor,
        address indexed submitter
    );
    event AttestationRejected(
        bytes32 indexed contentHash,
        string reason
    );

    // ============================================================================
    // Errors
    // ============================================================================

    error NotAssessor();
    error AttestationExpired();
    error AttestationAlreadyUsed();
    error InvalidSignature();
    error ScoreBelowMinimum(uint8 score, uint8 minimum);
    error ZeroAddress();

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(address initialOwner) Ownable(initialOwner) {
        // Owner can add assessors
    }

    // ============================================================================
    // Verification Functions
    // ============================================================================

    /**
     * @notice Verify a quality attestation signature
     * @param contentHash IPFS hash of proposal content
     * @param score Quality score (0-100)
     * @param timestamp When attestation was signed
     * @param submitter Address submitting the proposal
     * @param signature Assessor's signature
     * @return assessor Address of the signing assessor
     */
    function verifyScore(
        bytes32 contentHash,
        uint8 score,
        uint256 timestamp,
        address submitter,
        bytes calldata signature
    ) external returns (address assessor) {
        // Check score meets minimum
        if (score < minScore) {
            emit AttestationRejected(contentHash, "Score below minimum");
            revert ScoreBelowMinimum(score, minScore);
        }

        // Check attestation hasn't expired
        if (block.timestamp > timestamp + attestationTTL) {
            emit AttestationRejected(contentHash, "Attestation expired");
            revert AttestationExpired();
        }

        // Build the message that was signed
        bytes32 messageHash = keccak256(abi.encodePacked(
            "JejuQualityAttestation",
            contentHash,
            score,
            timestamp,
            submitter,
            block.chainid
        ));

        // Prevent replay attacks
        if (usedAttestations[messageHash]) {
            emit AttestationRejected(contentHash, "Attestation already used");
            revert AttestationAlreadyUsed();
        }

        // Recover signer
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        assessor = ethSignedHash.recover(signature);

        // Verify signer is authorized assessor
        if (!isAssessor[assessor]) {
            emit AttestationRejected(contentHash, "Invalid assessor");
            revert InvalidSignature();
        }

        // Mark attestation as used
        usedAttestations[messageHash] = true;

        emit AttestationVerified(contentHash, score, assessor, submitter);

        return assessor;
    }

    /**
     * @notice Check if an attestation would be valid (view function)
     * @dev Use this off-chain before submitting
     */
    function checkAttestation(
        bytes32 contentHash,
        uint8 score,
        uint256 timestamp,
        address submitter,
        bytes calldata signature
    ) external view returns (bool valid, address assessor, string memory reason) {
        if (score < minScore) {
            return (false, address(0), "Score below minimum");
        }

        if (block.timestamp > timestamp + attestationTTL) {
            return (false, address(0), "Attestation expired");
        }

        bytes32 messageHash = keccak256(abi.encodePacked(
            "JejuQualityAttestation",
            contentHash,
            score,
            timestamp,
            submitter,
            block.chainid
        ));

        if (usedAttestations[messageHash]) {
            return (false, address(0), "Attestation already used");
        }

        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        assessor = ethSignedHash.recover(signature);

        if (!isAssessor[assessor]) {
            return (false, assessor, "Signer not authorized assessor");
        }

        return (true, assessor, "Valid");
    }

    /**
     * @notice Build the message hash for signing (helper for off-chain)
     * @dev Assessors use this to create signatures
     */
    function getMessageHash(
        bytes32 contentHash,
        uint8 score,
        uint256 timestamp,
        address submitter
    ) external view returns (bytes32) {
        return keccak256(abi.encodePacked(
            "JejuQualityAttestation",
            contentHash,
            score,
            timestamp,
            submitter,
            block.chainid
        ));
    }

    // ============================================================================
    // Admin Functions
    // ============================================================================

    /**
     * @notice Add an authorized assessor
     * @param assessor Address to authorize
     */
    function addAssessor(address assessor) external onlyOwner {
        if (assessor == address(0)) revert ZeroAddress();
        if (!isAssessor[assessor]) {
            isAssessor[assessor] = true;
            assessorCount++;
            emit AssessorAdded(assessor);
        }
    }

    /**
     * @notice Remove an assessor
     * @param assessor Address to remove
     */
    function removeAssessor(address assessor) external onlyOwner {
        if (isAssessor[assessor]) {
            isAssessor[assessor] = false;
            assessorCount--;
            emit AssessorRemoved(assessor);
        }
    }

    /**
     * @notice Update minimum score requirement
     * @param _minScore New minimum (0-100)
     */
    function setMinScore(uint8 _minScore) external onlyOwner {
        minScore = _minScore;
    }

    /**
     * @notice Update attestation TTL
     * @param _ttl New TTL in seconds
     */
    function setAttestationTTL(uint256 _ttl) external onlyOwner {
        attestationTTL = _ttl;
    }

    /**
     * @notice Check if address is an assessor
     */
    function checkAssessor(address addr) external view returns (bool) {
        return isAssessor[addr];
    }
}
