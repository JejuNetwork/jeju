// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IDATypes} from "./IDATypes.sol";
import {DAOperatorRegistry} from "./DAOperatorRegistry.sol";

/**
 * @title DABlobRegistry
 * @notice On-chain registry for blob commitments and availability attestations
 * 
 * Tracks blob lifecycle:
 * - Submission with commitment
 * - Dispersal confirmation
 * - Availability attestations
 * - Expiration
 */
contract DABlobRegistry is IDATypes, ReentrancyGuard, Ownable, Pausable {
    // ============ State ============

    DAOperatorRegistry public immutable operatorRegistry;
    
    mapping(bytes32 => BlobMetadata) private _blobs;
    mapping(bytes32 => AvailabilityAttestation) private _attestations;
    mapping(bytes32 => mapping(address => bool)) private _operatorAttested;
    mapping(address => bytes32[]) private _submitterBlobs;
    mapping(bytes32 => bytes32[]) private _namespaceBlobs;
    
    bytes32[] private _allBlobIds;
    
    uint256 public constant DEFAULT_RETENTION_PERIOD = 7 days;
    uint256 public constant MIN_QUORUM_PERCENT = 67;
    uint256 public submissionFee;
    uint256 public totalFeesCollected;
    
    // ============ Constructor ============

    constructor(
        address _operatorRegistry,
        uint256 _submissionFee,
        address initialOwner
    ) Ownable(initialOwner) {
        operatorRegistry = DAOperatorRegistry(_operatorRegistry);
        submissionFee = _submissionFee;
    }

    // ============ Blob Submission ============

    /**
     * @notice Submit a new blob
     */
    function submitBlob(
        bytes32 blobId,
        uint256 size,
        BlobCommitment calldata commitment,
        bytes32 namespace,
        uint256 retentionPeriod
    ) external payable nonReentrant whenNotPaused returns (bool) {
        if (_blobs[blobId].submittedAt != 0) revert BlobAlreadyExists();
        if (msg.value < submissionFee) revert DAInsufficientStake(msg.value, submissionFee);
        
        uint256 retention = retentionPeriod > 0 ? retentionPeriod : DEFAULT_RETENTION_PERIOD;
        
        _blobs[blobId] = BlobMetadata({
            blobId: blobId,
            status: BlobStatus.PENDING,
            size: size,
            commitment: commitment,
            submitter: msg.sender,
            submittedAt: block.timestamp,
            confirmedAt: 0,
            expiresAt: block.timestamp + retention,
            namespace: namespace
        });
        
        _allBlobIds.push(blobId);
        _submitterBlobs[msg.sender].push(blobId);
        
        if (namespace != bytes32(0)) {
            _namespaceBlobs[namespace].push(blobId);
        }
        
        totalFeesCollected += msg.value;
        
        emit BlobSubmitted(blobId, msg.sender, size, commitment.commitment);
        
        return true;
    }

    /**
     * @notice Confirm blob dispersal
     */
    function confirmDispersal(
        bytes32 blobId,
        address[] calldata /* operators */
    ) external onlyOwner {
        BlobMetadata storage blob = _blobs[blobId];
        if (blob.submittedAt == 0) revert BlobNotFound();
        if (blob.status != BlobStatus.PENDING) revert Unauthorized();
        
        blob.status = BlobStatus.DISPERSING;
    }

    // ============ Attestations ============

    /**
     * @notice Submit availability attestation from operator
     */
    function attestAvailability(
        bytes32 blobId,
        uint256[] calldata chunkIndices,
        bytes calldata /* signature */
    ) external whenNotPaused {
        BlobMetadata storage blob = _blobs[blobId];
        if (blob.submittedAt == 0) revert BlobNotFound();
        if (blob.expiresAt < block.timestamp) revert BlobExpiredError();
        
        // Verify operator is registered and active
        if (!operatorRegistry.isActive(msg.sender)) revert OperatorNotActive();
        
        // Check not already attested
        if (_operatorAttested[blobId][msg.sender]) revert InvalidAttestation();
        
        // Record attestation
        _operatorAttested[blobId][msg.sender] = true;
        
        AvailabilityAttestation storage attest = _attestations[blobId];
        if (attest.blobId == bytes32(0)) {
            attest.blobId = blobId;
            attest.commitment = blob.commitment.commitment;
            attest.timestamp = block.timestamp;
        }
        
        attest.signatureCount++;
        
        // Check quorum
        uint256 totalOperators = operatorRegistry.getActiveOperatorCount();
        uint256 requiredAttestations = (totalOperators * MIN_QUORUM_PERCENT) / 100;
        
        if (attest.signatureCount >= requiredAttestations && !attest.quorumReached) {
            attest.quorumReached = true;
            blob.status = BlobStatus.AVAILABLE;
            blob.confirmedAt = block.timestamp;
            
            emit BlobConfirmed(blobId, attest.signatureCount, keccak256(abi.encode(attest)));
        }
        
        emit AttestationSubmitted(blobId, msg.sender, chunkIndices.length);
    }

    /**
     * @notice Submit batch attestation (for aggregated signatures)
     */
    function attestBatch(
        bytes32 blobId,
        address[] calldata operators,
        bytes calldata aggregateSignature
    ) external onlyOwner {
        BlobMetadata storage blob = _blobs[blobId];
        if (blob.submittedAt == 0) revert BlobNotFound();
        
        AvailabilityAttestation storage attest = _attestations[blobId];
        if (attest.blobId == bytes32(0)) {
            attest.blobId = blobId;
            attest.commitment = blob.commitment.commitment;
            attest.timestamp = block.timestamp;
        }
        
        for (uint256 i = 0; i < operators.length; i++) {
            if (!_operatorAttested[blobId][operators[i]]) {
                _operatorAttested[blobId][operators[i]] = true;
                attest.signatureCount++;
            }
        }
        
        attest.aggregateSignature = aggregateSignature;
        
        // Check quorum
        uint256 totalOperators = operatorRegistry.getActiveOperatorCount();
        uint256 requiredAttestations = (totalOperators * MIN_QUORUM_PERCENT) / 100;
        
        if (attest.signatureCount >= requiredAttestations && !attest.quorumReached) {
            attest.quorumReached = true;
            blob.status = BlobStatus.AVAILABLE;
            blob.confirmedAt = block.timestamp;
            
            emit BlobConfirmed(blobId, attest.signatureCount, keccak256(abi.encode(attest)));
        }
    }

    // ============ Expiration ============

    /**
     * @notice Mark blob as expired
     */
    function expireBlob(bytes32 blobId) external {
        BlobMetadata storage blob = _blobs[blobId];
        if (blob.submittedAt == 0) revert BlobNotFound();
        if (blob.expiresAt > block.timestamp) revert Unauthorized();
        
        if (blob.status != BlobStatus.EXPIRED) {
            blob.status = BlobStatus.EXPIRED;
            emit BlobExpired(blobId);
        }
    }

    /**
     * @notice Batch expire blobs
     */
    function expireBlobsBatch(bytes32[] calldata blobIds) external {
        for (uint256 i = 0; i < blobIds.length; i++) {
            BlobMetadata storage blob = _blobs[blobIds[i]];
            if (blob.submittedAt != 0 && blob.expiresAt <= block.timestamp && blob.status != BlobStatus.EXPIRED) {
                blob.status = BlobStatus.EXPIRED;
                emit BlobExpired(blobIds[i]);
            }
        }
    }

    // ============ View Functions ============

    function getBlob(bytes32 blobId) external view returns (BlobMetadata memory) {
        return _blobs[blobId];
    }

    function getCommitment(bytes32 blobId) external view returns (BlobCommitment memory) {
        return _blobs[blobId].commitment;
    }

    function getAttestation(bytes32 blobId) external view returns (AvailabilityAttestation memory) {
        return _attestations[blobId];
    }

    function isAvailable(bytes32 blobId) external view returns (bool) {
        BlobMetadata storage blob = _blobs[blobId];
        return blob.status == BlobStatus.AVAILABLE && blob.expiresAt > block.timestamp;
    }

    function isQuorumReached(bytes32 blobId) external view returns (bool) {
        return _attestations[blobId].quorumReached;
    }

    function hasOperatorAttested(bytes32 blobId, address operator) external view returns (bool) {
        return _operatorAttested[blobId][operator];
    }

    function getBlobsBySubmitter(address submitter) external view returns (bytes32[] memory) {
        return _submitterBlobs[submitter];
    }

    function getBlobsByNamespace(bytes32 namespace) external view returns (bytes32[] memory) {
        return _namespaceBlobs[namespace];
    }

    function getAllBlobIds() external view returns (bytes32[] memory) {
        return _allBlobIds;
    }

    function getBlobCount() external view returns (uint256) {
        return _allBlobIds.length;
    }

    function getActiveBlobs() external view returns (bytes32[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < _allBlobIds.length; i++) {
            BlobMetadata storage blob = _blobs[_allBlobIds[i]];
            if (blob.status == BlobStatus.AVAILABLE && blob.expiresAt > block.timestamp) {
                activeCount++;
            }
        }
        
        bytes32[] memory active = new bytes32[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < _allBlobIds.length; i++) {
            BlobMetadata storage blob = _blobs[_allBlobIds[i]];
            if (blob.status == BlobStatus.AVAILABLE && blob.expiresAt > block.timestamp) {
                active[j++] = _allBlobIds[i];
            }
        }
        
        return active;
    }

    // ============ Verification ============

    /**
     * @notice Verify a blob commitment on-chain
     */
    function verifyCommitment(
        bytes32 blobId,
        bytes32 expectedCommitment
    ) external view returns (bool) {
        BlobMetadata storage blob = _blobs[blobId];
        if (blob.submittedAt == 0) return false;
        
        return blob.commitment.commitment == expectedCommitment;
    }

    /**
     * @notice Verify blob is available with sufficient attestations
     */
    function verifyAvailability(bytes32 blobId) external view returns (bool, uint256, uint256) {
        BlobMetadata storage blob = _blobs[blobId];
        if (blob.submittedAt == 0) return (false, 0, 0);
        if (blob.expiresAt <= block.timestamp) return (false, 0, 0);
        
        AvailabilityAttestation storage attest = _attestations[blobId];
        uint256 totalOperators = operatorRegistry.getActiveOperatorCount();
        uint256 requiredAttestations = (totalOperators * MIN_QUORUM_PERCENT) / 100;
        
        return (
            attest.quorumReached,
            attest.signatureCount,
            requiredAttestations
        );
    }

    // ============ Admin ============

    function setSubmissionFee(uint256 newFee) external onlyOwner {
        submissionFee = newFee;
    }

    function withdrawFees(address to, uint256 amount) external onlyOwner {
        if (amount > address(this).balance) {
            amount = address(this).balance;
        }
        (bool success,) = to.call{value: amount}("");
        require(success, "Transfer failed");
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}

