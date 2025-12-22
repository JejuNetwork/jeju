// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

/**
 * @title IDATypes
 * @notice Types for the Jeju Data Availability Layer
 */
interface IDATypes {
    // ============ Operator Types ============

    enum OperatorStatus {
        PENDING,
        ACTIVE,
        INACTIVE,
        SLASHED,
        EXITING
    }

    struct DAOperator {
        address operator;
        uint256 agentId;
        uint256 stake;
        string endpoint;
        bytes32 teeAttestation;
        string region;
        uint256 capacityGB;
        uint256 usedGB;
        OperatorStatus status;
        uint256 registeredAt;
        uint256 lastHeartbeat;
        uint256 samplesResponded;
        uint256 samplesFailed;
    }

    // ============ Blob Types ============

    enum BlobStatus {
        PENDING,
        DISPERSING,
        AVAILABLE,
        EXPIRED,
        UNAVAILABLE
    }

    struct BlobCommitment {
        bytes32 commitment;
        uint32 dataChunkCount;
        uint32 parityChunkCount;
        uint32 totalChunkCount;
        uint32 chunkSize;
        bytes32 merkleRoot;
        uint256 timestamp;
    }

    struct BlobMetadata {
        bytes32 blobId;
        BlobStatus status;
        uint256 size;
        BlobCommitment commitment;
        address submitter;
        uint256 submittedAt;
        uint256 confirmedAt;
        uint256 expiresAt;
        bytes32 namespace;
    }

    // ============ Attestation Types ============

    struct OperatorSignature {
        address operator;
        bytes signature;
        uint256[] chunkIndices;
    }

    struct AvailabilityAttestation {
        bytes32 blobId;
        bytes32 commitment;
        uint256 signatureCount;
        bytes aggregateSignature;
        bool quorumReached;
        uint256 timestamp;
    }

    // ============ Chunk Types ============

    struct ChunkAssignment {
        uint256 chunkIndex;
        address[] operators;
    }

    // ============ Events ============

    event OperatorRegistered(
        address indexed operator,
        uint256 indexed agentId,
        uint256 stake,
        string endpoint
    );

    event OperatorUpdated(address indexed operator);

    event OperatorSlashed(
        address indexed operator,
        uint256 slashAmount,
        string reason
    );

    event OperatorExited(address indexed operator, uint256 unstakeAmount);

    event BlobSubmitted(
        bytes32 indexed blobId,
        address indexed submitter,
        uint256 size,
        bytes32 commitment
    );

    event BlobConfirmed(
        bytes32 indexed blobId,
        uint256 operatorCount,
        bytes32 attestationHash
    );

    event BlobExpired(bytes32 indexed blobId);

    event AttestationSubmitted(
        bytes32 indexed blobId,
        address indexed operator,
        uint256 chunkCount
    );

    // ============ Errors ============

    error OperatorNotRegistered();
    error OperatorAlreadyRegistered();
    error OperatorNotActive();
    error OperatorSlashedError();
    error DAInsufficientStake(uint256 provided, uint256 required);
    error BlobNotFound();
    error BlobAlreadyExists();
    error BlobExpiredError();
    error QuorumNotReached();
    error InvalidAttestation();
    error InvalidProof();
    error Unauthorized();
}

