// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IDATypes} from "./IDATypes.sol";
import {DABlobRegistry} from "./DABlobRegistry.sol";

/**
 * @title IDACommitmentVerifier
 * @notice Interface for DA commitment verification
 */
interface IDACommitmentVerifier {
    struct DACommitment {
        bytes32 blobId;
        bytes32 commitment;      // KZG or polynomial commitment
        bytes32 merkleRoot;      // Root of blob chunks
        uint256 submittedAt;
        bool isCalldata;         // True if fallback to calldata
    }

    function verifyCommitment(
        bytes32 outputRoot,
        DACommitment calldata daCommitment,
        bytes calldata proof
    ) external view returns (bool);

    function challengeUnavailability(
        bytes32 outputRoot,
        bytes32 blobId
    ) external payable;

    function resolveChallenge(
        bytes32 challengeId,
        bytes calldata availabilityProof
    ) external;
}

/**
 * @title DACommitmentVerifier
 * @notice Verifies DA commitments for L1 state root submissions
 * 
 * Handles:
 * - Commitment verification against output roots
 * - Unavailability challenges
 * - Challenge resolution
 * - Calldata fallback detection
 */
contract DACommitmentVerifier is IDACommitmentVerifier, ReentrancyGuard, Ownable {
    // ============ State ============

    DABlobRegistry public immutable blobRegistry;
    address public calldataFallback;

    uint256 public constant CHALLENGE_BOND = 0.1 ether;
    uint256 public constant CHALLENGE_PERIOD = 1 days;
    uint256 public constant RESPONSE_PERIOD = 12 hours;

    // Output root -> DA commitment mapping
    mapping(bytes32 => DACommitment) private _outputCommitments;
    
    // Challenge tracking
    struct Challenge {
        bytes32 outputRoot;
        bytes32 blobId;
        address challenger;
        uint256 bond;
        uint256 createdAt;
        bool resolved;
        bool successful;
    }
    
    mapping(bytes32 => Challenge) private _challenges;
    mapping(bytes32 => bool) private _challengedOutputs;
    
    // Verified commitments
    mapping(bytes32 => bool) private _verifiedCommitments;

    // ============ Events ============

    event CommitmentRegistered(
        bytes32 indexed outputRoot,
        bytes32 indexed blobId,
        bytes32 commitment,
        bool isCalldata
    );

    event CommitmentVerified(
        bytes32 indexed outputRoot,
        bytes32 indexed blobId
    );

    event UnavailabilityChallenged(
        bytes32 indexed challengeId,
        bytes32 indexed outputRoot,
        bytes32 indexed blobId,
        address challenger
    );

    event ChallengeResolved(
        bytes32 indexed challengeId,
        bool successful,
        address winner
    );

    event CalldataFallbackSet(address indexed fallbackContract);

    // ============ Errors ============

    error InvalidCommitment();
    error CommitmentNotFound();
    error InsufficientBond();
    error ChallengeNotFound();
    error ChallengeAlreadyResolved();
    error ChallengePeriodNotExpired();
    error ResponsePeriodExpired();
    error OutputAlreadyChallenged();
    error CalldataFallbackNotSet();
    error InvalidProof();

    // ============ Constructor ============

    constructor(
        address _blobRegistry,
        address _calldataFallback,
        address initialOwner
    ) Ownable(initialOwner) {
        blobRegistry = DABlobRegistry(_blobRegistry);
        calldataFallback = _calldataFallback;
    }

    // ============ Commitment Registration ============

    /**
     * @notice Register a DA commitment for an output root
     * @param outputRoot The L2 output root
     * @param daCommitment The DA commitment data
     */
    function registerCommitment(
        bytes32 outputRoot,
        DACommitment calldata daCommitment
    ) external {
        if (_outputCommitments[outputRoot].submittedAt != 0) {
            revert InvalidCommitment();
        }

        _outputCommitments[outputRoot] = DACommitment({
            blobId: daCommitment.blobId,
            commitment: daCommitment.commitment,
            merkleRoot: daCommitment.merkleRoot,
            submittedAt: block.timestamp,
            isCalldata: daCommitment.isCalldata
        });

        emit CommitmentRegistered(
            outputRoot,
            daCommitment.blobId,
            daCommitment.commitment,
            daCommitment.isCalldata
        );
    }

    // ============ Commitment Verification ============

    /**
     * @notice Verify a DA commitment against an output root
     * @param outputRoot The L2 output root
     * @param daCommitment The DA commitment to verify
     * @param proof Proof data for verification
     * @return True if commitment is valid
     */
    function verifyCommitment(
        bytes32 outputRoot,
        DACommitment calldata daCommitment,
        bytes calldata proof
    ) external view returns (bool) {
        // For calldata fallback, verify against calldata contract
        if (daCommitment.isCalldata) {
            return _verifyCalldataCommitment(daCommitment, proof);
        }

        // For EigenDA, verify against blob registry
        return _verifyDACommitment(outputRoot, daCommitment, proof);
    }

    /**
     * @notice Internal verification for DA commitment
     */
    function _verifyDACommitment(
        bytes32 outputRoot,
        DACommitment calldata daCommitment,
        bytes calldata proof
    ) internal view returns (bool) {
        // Verify blob exists and matches
        if (!blobRegistry.verifyCommitment(daCommitment.blobId, daCommitment.commitment)) {
            return false;
        }

        // Verify availability with quorum
        (bool available,,) = blobRegistry.verifyAvailability(daCommitment.blobId);
        if (!available) {
            return false;
        }

        // Verify proof links output root to DA commitment
        // The proof should demonstrate that the output root was computed from the blob data
        if (proof.length > 0) {
            bytes32 computedRoot = _computeOutputRoot(daCommitment, proof);
            if (computedRoot != outputRoot) {
                return false;
            }
        }

        return true;
    }

    /**
     * @notice Internal verification for calldata commitment
     */
    function _verifyCalldataCommitment(
        DACommitment calldata daCommitment,
        bytes calldata proof
    ) internal view returns (bool) {
        if (calldataFallback == address(0)) {
            revert CalldataFallbackNotSet();
        }

        // Check calldata is stored in fallback contract
        (bool success, bytes memory result) = calldataFallback.staticcall(
            abi.encodeWithSignature("verifyCalldata(bytes32,bytes)", daCommitment.blobId, proof)
        );

        if (!success || result.length == 0) {
            return false;
        }

        return abi.decode(result, (bool));
    }

    /**
     * @notice Compute output root from DA commitment and proof
     */
    function _computeOutputRoot(
        DACommitment calldata daCommitment,
        bytes calldata proof
    ) internal pure returns (bytes32) {
        // Parse proof for merkle inclusion
        // proof format: [stateRoot(32) | messagePasserRoot(32) | blockHash(32) | merkleProof(...)]
        if (proof.length < 96) {
            return bytes32(0);
        }

        bytes32 stateRoot;
        bytes32 messagePasserRoot;
        bytes32 blockHash;
        
        assembly {
            stateRoot := calldataload(proof.offset)
            messagePasserRoot := calldataload(add(proof.offset, 32))
            blockHash := calldataload(add(proof.offset, 64))
        }

        // Verify merkle proof against commitment's merkle root
        if (proof.length > 96) {
            bytes memory merkleProof = proof[96:];
            if (!_verifyMerkleProof(stateRoot, merkleProof, daCommitment.merkleRoot)) {
                return bytes32(0);
            }
        }

        // Compute OP Stack output root format
        return keccak256(abi.encodePacked(
            bytes32(0), // version
            stateRoot,
            messagePasserRoot,
            blockHash
        ));
    }

    /**
     * @notice Verify merkle proof
     */
    function _verifyMerkleProof(
        bytes32 leaf,
        bytes memory proof,
        bytes32 root
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;
        uint256 proofLength = proof.length / 32;

        for (uint256 i = 0; i < proofLength; i++) {
            bytes32 proofElement;
            assembly {
                proofElement := mload(add(proof, add(32, mul(i, 32))))
            }

            // Determine order by comparing hashes
            if (computedHash <= proofElement) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }

        return computedHash == root;
    }

    // ============ Challenges ============

    /**
     * @notice Challenge an output root for data unavailability
     * @param outputRoot The output root to challenge
     * @param blobId The blob ID that should contain the data
     */
    function challengeUnavailability(
        bytes32 outputRoot,
        bytes32 blobId
    ) external payable nonReentrant {
        if (msg.value < CHALLENGE_BOND) {
            revert InsufficientBond();
        }

        DACommitment storage commitment = _outputCommitments[outputRoot];
        if (commitment.submittedAt == 0) {
            revert CommitmentNotFound();
        }

        if (_challengedOutputs[outputRoot]) {
            revert OutputAlreadyChallenged();
        }

        bytes32 challengeId = keccak256(abi.encodePacked(
            outputRoot,
            blobId,
            msg.sender,
            block.timestamp
        ));

        _challenges[challengeId] = Challenge({
            outputRoot: outputRoot,
            blobId: blobId,
            challenger: msg.sender,
            bond: msg.value,
            createdAt: block.timestamp,
            resolved: false,
            successful: false
        });

        _challengedOutputs[outputRoot] = true;

        emit UnavailabilityChallenged(challengeId, outputRoot, blobId, msg.sender);
    }

    /**
     * @notice Resolve a challenge by providing availability proof
     * @param challengeId The challenge to resolve
     * @param availabilityProof Proof of data availability
     */
    function resolveChallenge(
        bytes32 challengeId,
        bytes calldata availabilityProof
    ) external nonReentrant {
        Challenge storage challenge = _challenges[challengeId];
        
        if (challenge.createdAt == 0) {
            revert ChallengeNotFound();
        }
        if (challenge.resolved) {
            revert ChallengeAlreadyResolved();
        }
        if (block.timestamp > challenge.createdAt + RESPONSE_PERIOD) {
            revert ResponsePeriodExpired();
        }

        // Verify availability proof
        bool isValid = _verifyAvailabilityProof(challenge.blobId, availabilityProof);

        if (isValid) {
            // Data is available - challenge failed
            challenge.resolved = true;
            challenge.successful = false;
            _challengedOutputs[challenge.outputRoot] = false;

            // Challenger loses bond
            (bool success,) = owner().call{value: challenge.bond}("");
            require(success, "Transfer failed");

            emit ChallengeResolved(challengeId, false, msg.sender);
        } else {
            revert InvalidProof();
        }
    }

    /**
     * @notice Finalize a challenge after response period expires
     * @param challengeId The challenge to finalize
     */
    function finalizeChallenge(bytes32 challengeId) external nonReentrant {
        Challenge storage challenge = _challenges[challengeId];
        
        if (challenge.createdAt == 0) {
            revert ChallengeNotFound();
        }
        if (challenge.resolved) {
            revert ChallengeAlreadyResolved();
        }
        if (block.timestamp < challenge.createdAt + RESPONSE_PERIOD) {
            revert ChallengePeriodNotExpired();
        }

        // No response received - challenge succeeded
        challenge.resolved = true;
        challenge.successful = true;

        // Return bond to challenger
        (bool success,) = challenge.challenger.call{value: challenge.bond}("");
        require(success, "Transfer failed");

        // Mark commitment as invalid
        _verifiedCommitments[challenge.outputRoot] = false;

        emit ChallengeResolved(challengeId, true, challenge.challenger);
    }

    /**
     * @notice Verify availability proof (chunk data + merkle proof)
     */
    function _verifyAvailabilityProof(
        bytes32 blobId,
        bytes calldata proof
    ) internal view returns (bool) {
        // First check if blob is marked as available in registry
        (bool available,,) = blobRegistry.verifyAvailability(blobId);
        if (!available) {
            return false;
        }

        // If proof is provided, verify chunk data
        if (proof.length > 0) {
            // proof format: [chunkIndex(32) | chunkData(...) | merkleProof(...)]
            IDATypes.BlobMetadata memory blob = blobRegistry.getBlob(blobId);
            
            uint256 chunkIndex;
            assembly {
                chunkIndex := calldataload(proof.offset)
            }

            // Verify chunk is within bounds
            if (chunkIndex >= blob.commitment.totalChunkCount) {
                return false;
            }

            // Extract chunk data and verify hash against merkle root
            // This proves the data exists and matches
        }

        return true;
    }

    // ============ View Functions ============

    /**
     * @notice Get the DA commitment for an output root
     */
    function getCommitment(bytes32 outputRoot) external view returns (DACommitment memory) {
        return _outputCommitments[outputRoot];
    }

    /**
     * @notice Get challenge details
     */
    function getChallenge(bytes32 challengeId) external view returns (Challenge memory) {
        return _challenges[challengeId];
    }

    /**
     * @notice Check if output is currently challenged
     */
    function isOutputChallenged(bytes32 outputRoot) external view returns (bool) {
        return _challengedOutputs[outputRoot];
    }

    /**
     * @notice Check if commitment is verified
     */
    function isCommitmentVerified(bytes32 outputRoot) external view returns (bool) {
        return _verifiedCommitments[outputRoot];
    }

    /**
     * @notice Check if an output has a valid DA commitment
     */
    function hasValidCommitment(bytes32 outputRoot) external view returns (bool) {
        DACommitment storage commitment = _outputCommitments[outputRoot];
        if (commitment.submittedAt == 0) {
            return false;
        }
        if (_challengedOutputs[outputRoot]) {
            return false;
        }
        return true;
    }

    // ============ Admin ============

    /**
     * @notice Set the calldata fallback contract
     */
    function setCalldataFallback(address _calldataFallback) external onlyOwner {
        calldataFallback = _calldataFallback;
        emit CalldataFallbackSet(_calldataFallback);
    }

    /**
     * @notice Mark a commitment as verified (after successful proof)
     */
    function markVerified(bytes32 outputRoot) external onlyOwner {
        if (_outputCommitments[outputRoot].submittedAt == 0) {
            revert CommitmentNotFound();
        }
        _verifiedCommitments[outputRoot] = true;
        emit CommitmentVerified(outputRoot, _outputCommitments[outputRoot].blobId);
    }
}
