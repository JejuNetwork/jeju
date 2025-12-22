// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IDATypes} from "./IDATypes.sol";
import {DAOperatorRegistry} from "./DAOperatorRegistry.sol";
import {DABlobRegistry} from "./DABlobRegistry.sol";

/**
 * @title DAAttestationManager
 * @notice Manages and verifies DA attestations
 * 
 * Handles:
 * - Signature verification
 * - Quorum verification
 * - Challenge and dispute resolution
 * - Slashing triggers
 */
contract DAAttestationManager is IDATypes, ReentrancyGuard, Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ State ============

    DAOperatorRegistry public immutable operatorRegistry;
    DABlobRegistry public immutable blobRegistry;
    
    uint256 public constant CHALLENGE_PERIOD = 1 days;
    uint256 public constant CHALLENGE_BOND = 0.1 ether;
    uint256 public constant QUORUM_PERCENT = 67;
    
    // Challenges
    struct Challenge {
        bytes32 blobId;
        address challenger;
        uint256 bond;
        uint256 createdAt;
        bool resolved;
        bool successful;
    }
    
    mapping(bytes32 => Challenge) private _challenges;
    mapping(bytes32 => bool) private _challengedBlobs;
    
    // ============ Events ============

    event ChallengeCreated(
        bytes32 indexed blobId,
        bytes32 indexed challengeId,
        address indexed challenger
    );
    
    event ChallengeResolved(
        bytes32 indexed challengeId,
        bool successful,
        address winner
    );
    
    event OperatorChallenged(
        address indexed operator,
        bytes32 indexed blobId,
        uint256 chunkIndex
    );

    // ============ Constructor ============

    constructor(
        address _operatorRegistry,
        address _blobRegistry,
        address initialOwner
    ) Ownable(initialOwner) {
        operatorRegistry = DAOperatorRegistry(_operatorRegistry);
        blobRegistry = DABlobRegistry(_blobRegistry);
    }

    // ============ Attestation Verification ============

    /**
     * @notice Verify operator signature on attestation
     */
    function verifyOperatorSignature(
        bytes32 blobId,
        bytes32 commitment,
        uint256[] calldata chunkIndices,
        address operator,
        bytes calldata signature
    ) external view returns (bool) {
        // Construct message
        bytes32 message = keccak256(abi.encodePacked(
            "DA_ATTESTATION",
            blobId,
            commitment,
            keccak256(abi.encodePacked(chunkIndices)),
            block.chainid
        ));
        
        bytes32 ethSignedMessage = message.toEthSignedMessageHash();
        address signer = ethSignedMessage.recover(signature);
        
        return signer == operator && operatorRegistry.isActive(operator);
    }

    /**
     * @notice Verify quorum is reached for a blob
     */
    function verifyQuorum(bytes32 blobId) external view returns (
        bool reached,
        uint256 attestations,
        uint256 required
    ) {
        return blobRegistry.verifyAvailability(blobId);
    }

    /**
     * @notice Check if attestation is valid and not challenged
     */
    function isAttestationValid(bytes32 blobId) external view returns (bool) {
        if (_challengedBlobs[blobId]) {
            return false;
        }
        
        (bool available,,) = blobRegistry.verifyAvailability(blobId);
        return available;
    }

    // ============ Challenges ============

    /**
     * @notice Create a challenge for blob unavailability
     */
    function createChallenge(bytes32 blobId) external payable nonReentrant returns (bytes32) {
        if (msg.value < CHALLENGE_BOND) {
            revert DAInsufficientStake(msg.value, CHALLENGE_BOND);
        }
        
        // Verify blob exists
        IDATypes.BlobMetadata memory blob = blobRegistry.getBlob(blobId);
        if (blob.submittedAt == 0) revert BlobNotFound();
        if (blob.status != BlobStatus.AVAILABLE) revert Unauthorized();
        
        bytes32 challengeId = keccak256(abi.encodePacked(
            blobId,
            msg.sender,
            block.timestamp,
            block.number
        ));
        
        _challenges[challengeId] = Challenge({
            blobId: blobId,
            challenger: msg.sender,
            bond: msg.value,
            createdAt: block.timestamp,
            resolved: false,
            successful: false
        });
        
        _challengedBlobs[blobId] = true;
        
        emit ChallengeCreated(blobId, challengeId, msg.sender);
        
        return challengeId;
    }

    /**
     * @notice Respond to challenge by providing data proof
     */
    function respondToChallenge(
        bytes32 challengeId,
        bytes32[] calldata chunkHashes,
        bytes[] calldata proofs
    ) external {
        Challenge storage challenge = _challenges[challengeId];
        if (challenge.createdAt == 0) revert Unauthorized();
        if (challenge.resolved) revert Unauthorized();
        
        // Verify at least minimum chunks can be provided
        IDATypes.BlobMetadata memory blob = blobRegistry.getBlob(challenge.blobId);
        uint256 minChunks = blob.commitment.dataChunkCount; // Need all data chunks
        
        if (chunkHashes.length >= minChunks && _verifyChunkProofs(challenge.blobId, chunkHashes, proofs)) {
            // Challenge failed - data is available
            challenge.resolved = true;
            challenge.successful = false;
            _challengedBlobs[challenge.blobId] = false;
            
            // Challenger loses bond (goes to responder/treasury)
            (bool success,) = owner().call{value: challenge.bond}("");
            require(success, "Transfer failed");
            
            emit ChallengeResolved(challengeId, false, msg.sender);
        }
    }

    /**
     * @notice Finalize challenge after timeout (no valid response)
     */
    function finalizeChallenge(bytes32 challengeId) external nonReentrant {
        Challenge storage challenge = _challenges[challengeId];
        if (challenge.createdAt == 0) revert Unauthorized();
        if (challenge.resolved) revert Unauthorized();
        if (block.timestamp < challenge.createdAt + CHALLENGE_PERIOD) revert Unauthorized();
        
        // Challenge succeeded - data is unavailable
        challenge.resolved = true;
        challenge.successful = true;
        
        // Return bond to challenger
        (bool success,) = challenge.challenger.call{value: challenge.bond}("");
        require(success, "Transfer failed");
        
        // Mark blob as unavailable
        // Note: In production, would call blobRegistry to update status
        
        emit ChallengeResolved(challengeId, true, challenge.challenger);
    }

    /**
     * @notice Challenge specific operator for chunk unavailability
     */
    function challengeOperator(
        address operator,
        bytes32 blobId,
        uint256 chunkIndex
    ) external {
        if (!operatorRegistry.isActive(operator)) revert OperatorNotActive();
        
        IDATypes.BlobMetadata memory blob = blobRegistry.getBlob(blobId);
        if (blob.submittedAt == 0) revert BlobNotFound();
        
        emit OperatorChallenged(operator, blobId, chunkIndex);
        
        // In production, this would:
        // 1. Start a challenge period
        // 2. Request the chunk from the operator
        // 3. Slash if not provided within timeout
    }

    // ============ Proof Verification ============

    function _verifyChunkProofs(
        bytes32 blobId,
        bytes32[] calldata chunkHashes,
        bytes[] calldata proofs
    ) internal view returns (bool) {
        IDATypes.BlobMetadata memory blob = blobRegistry.getBlob(blobId);
        
        // Verify each chunk hash against merkle root
        for (uint256 i = 0; i < chunkHashes.length; i++) {
            if (!_verifyMerkleProof(chunkHashes[i], proofs[i], blob.commitment.merkleRoot, i)) {
                return false;
            }
        }
        
        return true;
    }

    function _verifyMerkleProof(
        bytes32 leaf,
        bytes memory proof,
        bytes32 root,
        uint256 index
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        uint256 proofLength = proof.length / 32;
        
        for (uint256 i = 0; i < proofLength; i++) {
            bytes32 proofElement;
            assembly {
                proofElement := mload(add(proof, add(32, mul(i, 32))))
            }
            
            if (index % 2 == 0) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
            
            index = index / 2;
        }
        
        return computedHash == root;
    }

    // ============ View Functions ============

    function getChallenge(bytes32 challengeId) external view returns (Challenge memory) {
        return _challenges[challengeId];
    }

    function isBlobChallenged(bytes32 blobId) external view returns (bool) {
        return _challengedBlobs[blobId];
    }

    /**
     * @notice Calculate required attestations for quorum
     */
    function getRequiredAttestations() external view returns (uint256) {
        uint256 totalOperators = operatorRegistry.getActiveOperatorCount();
        return (totalOperators * QUORUM_PERCENT) / 100;
    }

    /**
     * @notice Get aggregated attestation info
     */
    function getAttestationInfo(bytes32 blobId) external view returns (
        bool quorumReached,
        uint256 attestationCount,
        uint256 requiredCount,
        bool challenged
    ) {
        (quorumReached, attestationCount, requiredCount) = blobRegistry.verifyAvailability(blobId);
        challenged = _challengedBlobs[blobId];
    }
}

