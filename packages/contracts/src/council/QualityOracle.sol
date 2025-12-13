// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IQualityOracle} from "./IQualityOracle.sol";

/// @title QualityOracle
/// @notice On-chain verification of proposal quality attestations
contract QualityOracle is IQualityOracle, Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    mapping(address => bool) public isAssessor;
    uint256 public assessorCount;
    uint256 public minScore = 90;
    uint256 public attestationTTL = 1 hours;

    event AssessorAdded(address indexed assessor);
    event AssessorRemoved(address indexed assessor);

    error NotAssessor();
    error AttestationExpired();
    error InvalidSignature();
    error ScoreBelowMinimum(uint256 score, uint256 minimum);
    error ZeroAddress();

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @inheritdoc IQualityOracle
    function verifyScore(
        bytes32 contentHash,
        uint256 qualityScore,
        uint256 attestationTimestamp,
        address proposer,
        bytes calldata attestationSignature
    ) external view override {
        if (qualityScore < minScore) {
            revert ScoreBelowMinimum(qualityScore, minScore);
        }
        if (block.timestamp > attestationTimestamp + attestationTTL) {
            revert AttestationExpired();
        }

        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "JejuQualityAttestation", contentHash, qualityScore, attestationTimestamp, proposer, block.chainid
            )
        );

        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        address assessor = ethSignedHash.recover(attestationSignature);

        if (!isAssessor[assessor]) {
            revert InvalidSignature();
        }
    }

    /// @notice Build message hash for off-chain signing
    function getMessageHash(bytes32 contentHash, uint256 qualityScore, uint256 timestamp, address proposer)
        external
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked("JejuQualityAttestation", contentHash, qualityScore, timestamp, proposer, block.chainid)
        );
    }

    function addAssessor(address assessor) external onlyOwner {
        if (assessor == address(0)) revert ZeroAddress();
        if (!isAssessor[assessor]) {
            isAssessor[assessor] = true;
            assessorCount++;
            emit AssessorAdded(assessor);
        }
    }

    function removeAssessor(address assessor) external onlyOwner {
        if (isAssessor[assessor]) {
            isAssessor[assessor] = false;
            assessorCount--;
            emit AssessorRemoved(assessor);
        }
    }

    function setMinScore(uint256 _minScore) external onlyOwner {
        minScore = _minScore;
    }

    function setAttestationTTL(uint256 _ttl) external onlyOwner {
        attestationTTL = _ttl;
    }
}
