// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title CalldataFallback
 * @notice Fallback storage for when Jeju DA is unavailable
 *
 * When the DA layer is down or unresponsive, batch data can be posted
 * directly to L1 calldata through this contract. This ensures liveness
 * at the cost of higher gas fees.
 */
contract CalldataFallback is ReentrancyGuard, Ownable {
    // ============ Types ============

    struct CalldataBlob {
        bytes32 blobId;
        uint256 size;
        bytes32 dataHash;
        address submitter;
        uint256 submittedAt;
        uint256 blockNumber;
    }

    // ============ State ============

    mapping(bytes32 => CalldataBlob) private _blobs;
    mapping(bytes32 => bytes) private _blobData;
    bytes32[] private _allBlobIds;

    uint256 public submissionFee;
    uint256 public maxBlobSize;
    uint256 public totalBlobsStored;
    uint256 public totalBytesStored;

    // Authorized submitters (proposers/sequencers)
    mapping(address => bool) public authorizedSubmitters;

    // ============ Events ============

    event CalldataPosted(bytes32 indexed blobId, address indexed submitter, uint256 size, bytes32 dataHash);

    event CalldataRetrieved(bytes32 indexed blobId, address indexed retriever);

    event SubmitterAuthorized(address indexed submitter, bool authorized);
    event SubmissionFeeUpdated(uint256 newFee);
    event MaxBlobSizeUpdated(uint256 newSize);

    // ============ Errors ============

    error BlobAlreadyExists();
    error BlobNotFound();
    error BlobTooLarge();
    error InsufficientFee();
    error UnauthorizedSubmitter();
    error DataHashMismatch();
    error InvalidData();

    // ============ Constructor ============

    constructor(uint256 _submissionFee, uint256 _maxBlobSize, address initialOwner) Ownable(initialOwner) {
        submissionFee = _submissionFee;
        maxBlobSize = _maxBlobSize > 0 ? _maxBlobSize : 128 * 1024; // Default 128KB
    }

    // ============ Blob Submission ============

    /**
     * @notice Post blob data to L1 calldata
     * @param data The blob data to store
     * @return blobId The unique identifier for the blob
     */
    function postCalldata(bytes calldata data) external payable nonReentrant returns (bytes32) {
        if (!authorizedSubmitters[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedSubmitter();
        }
        if (data.length == 0) {
            revert InvalidData();
        }
        if (data.length > maxBlobSize) {
            revert BlobTooLarge();
        }
        if (msg.value < submissionFee) {
            revert InsufficientFee();
        }

        bytes32 dataHash = keccak256(data);
        bytes32 blobId = keccak256(abi.encodePacked(dataHash, msg.sender, block.timestamp, block.number));

        if (_blobs[blobId].submittedAt != 0) {
            revert BlobAlreadyExists();
        }

        _blobs[blobId] = CalldataBlob({
            blobId: blobId,
            size: data.length,
            dataHash: dataHash,
            submitter: msg.sender,
            submittedAt: block.timestamp,
            blockNumber: block.number
        });

        _blobData[blobId] = data;
        _allBlobIds.push(blobId);
        totalBlobsStored++;
        totalBytesStored += data.length;

        emit CalldataPosted(blobId, msg.sender, data.length, dataHash);

        return blobId;
    }

    /**
     * @notice Post blob data with a specific blob ID
     * @param blobId The blob ID to use
     * @param data The blob data to store
     */
    function postCalldataWithId(bytes32 blobId, bytes calldata data) external payable nonReentrant {
        if (!authorizedSubmitters[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedSubmitter();
        }
        if (data.length == 0) {
            revert InvalidData();
        }
        if (data.length > maxBlobSize) {
            revert BlobTooLarge();
        }
        if (msg.value < submissionFee) {
            revert InsufficientFee();
        }
        if (_blobs[blobId].submittedAt != 0) {
            revert BlobAlreadyExists();
        }

        bytes32 dataHash = keccak256(data);

        _blobs[blobId] = CalldataBlob({
            blobId: blobId,
            size: data.length,
            dataHash: dataHash,
            submitter: msg.sender,
            submittedAt: block.timestamp,
            blockNumber: block.number
        });

        _blobData[blobId] = data;
        _allBlobIds.push(blobId);
        totalBlobsStored++;
        totalBytesStored += data.length;

        emit CalldataPosted(blobId, msg.sender, data.length, dataHash);
    }

    // ============ Verification ============

    /**
     * @notice Verify calldata matches stored blob
     * @param blobId The blob ID to verify
     * @param data The data to verify against
     * @return True if data matches stored blob
     */
    function verifyCalldata(bytes32 blobId, bytes calldata data) external view returns (bool) {
        CalldataBlob storage blob = _blobs[blobId];
        if (blob.submittedAt == 0) {
            return false;
        }
        return keccak256(data) == blob.dataHash;
    }

    /**
     * @notice Verify blob exists and get its hash
     * @param blobId The blob ID to check
     * @return exists Whether the blob exists
     * @return dataHash The hash of the stored data
     */
    function verifyBlobExists(bytes32 blobId) external view returns (bool exists, bytes32 dataHash) {
        CalldataBlob storage blob = _blobs[blobId];
        exists = blob.submittedAt != 0;
        dataHash = blob.dataHash;
    }

    // ============ Retrieval ============

    /**
     * @notice Retrieve stored blob data
     * @param blobId The blob ID to retrieve
     * @return data The stored blob data
     */
    function retrieveCalldata(bytes32 blobId) external view returns (bytes memory) {
        if (_blobs[blobId].submittedAt == 0) {
            revert BlobNotFound();
        }
        return _blobData[blobId];
    }

    /**
     * @notice Get blob metadata
     * @param blobId The blob ID to query
     * @return The blob metadata
     */
    function getBlob(bytes32 blobId) external view returns (CalldataBlob memory) {
        if (_blobs[blobId].submittedAt == 0) {
            revert BlobNotFound();
        }
        return _blobs[blobId];
    }

    /**
     * @notice Get all blob IDs
     */
    function getAllBlobIds() external view returns (bytes32[] memory) {
        return _allBlobIds;
    }

    /**
     * @notice Get blob count
     */
    function getBlobCount() external view returns (uint256) {
        return _allBlobIds.length;
    }

    /**
     * @notice Check if blob exists
     */
    function blobExists(bytes32 blobId) external view returns (bool) {
        return _blobs[blobId].submittedAt != 0;
    }

    // ============ Admin ============

    /**
     * @notice Authorize or deauthorize a submitter
     */
    function setAuthorizedSubmitter(address submitter, bool authorized) external onlyOwner {
        authorizedSubmitters[submitter] = authorized;
        emit SubmitterAuthorized(submitter, authorized);
    }

    /**
     * @notice Batch authorize submitters
     */
    function setAuthorizedSubmitters(address[] calldata submitters, bool authorized) external onlyOwner {
        for (uint256 i = 0; i < submitters.length; i++) {
            authorizedSubmitters[submitters[i]] = authorized;
            emit SubmitterAuthorized(submitters[i], authorized);
        }
    }

    /**
     * @notice Update submission fee
     */
    function setSubmissionFee(uint256 newFee) external onlyOwner {
        submissionFee = newFee;
        emit SubmissionFeeUpdated(newFee);
    }

    /**
     * @notice Update max blob size
     */
    function setMaxBlobSize(uint256 newSize) external onlyOwner {
        maxBlobSize = newSize;
        emit MaxBlobSizeUpdated(newSize);
    }

    /**
     * @notice Withdraw collected fees
     */
    function withdrawFees(address to, uint256 amount) external onlyOwner {
        if (amount > address(this).balance) {
            amount = address(this).balance;
        }
        (bool success,) = to.call{value: amount}("");
        require(success, "Transfer failed");
    }

    /**
     * @notice Get contract balance
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
