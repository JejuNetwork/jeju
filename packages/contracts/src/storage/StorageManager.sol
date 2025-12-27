// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.33;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../registry/IdentityRegistry.sol";

/**
 * @title StorageManager
 * @author Jeju Network
 * @notice Unified storage management for DWS
 * @dev Manages storage providers, uploads, and permanent storage
 *
 * Features:
 * - Multi-backend storage (IPFS, Arweave, WebTorrent)
 * - Upload tracking and verification
 * - Permanent storage options
 * - Provider management
 * - Storage quotas and pricing
 */
contract StorageManager is ReentrancyGuard, Pausable, Ownable {
    // ============ Enums ============

    enum StorageBackend {
        IPFS,
        ARWEAVE,
        WEBTORRENT,
        FILECOIN
    }

    enum UploadStatus {
        PENDING,
        PINNED,
        PERMANENT,
        EXPIRED,
        DELETED
    }

    // ============ Structs ============

    struct StorageProvider {
        bytes32 providerId;
        address operator;
        uint256 agentId;
        StorageBackend backend;
        string endpoint;
        uint256 capacityGB;
        uint256 usedGB;
        uint256 pricePerGBMonth;
        uint256 registeredAt;
        bool isActive;
        uint256 totalUploads;
        uint256 totalBytes;
    }

    struct Upload {
        bytes32 uploadId;
        address uploader;
        string cid;
        bytes32 contentHash;
        uint256 size;
        StorageBackend backend;
        UploadStatus status;
        bool isPermanent;
        uint256 uploadedAt;
        uint256 expiresAt;
        bytes32 providerId;
    }

    struct StorageQuota {
        uint256 maxBytes;
        uint256 usedBytes;
        uint256 maxUploads;
        uint256 uploadCount;
    }

    // ============ State ============

    IdentityRegistry public immutable identityRegistry;
    address public treasury;

    mapping(bytes32 => StorageProvider) public providers;
    mapping(bytes32 => Upload) public uploads;
    mapping(string => bytes32) public cidToUploadId;
    mapping(address => StorageQuota) public quotas;
    mapping(address => bytes32[]) public userUploads;

    bytes32[] public allProviders;
    bytes32[] public allUploads;

    uint256 private _nextProviderId = 1;
    uint256 private _nextUploadId = 1;

    // Configuration
    uint256 public defaultQuotaBytes = 10 * 1024 * 1024 * 1024; // 10 GB
    uint256 public defaultQuotaUploads = 10000;
    uint256 public permanentStorageFee = 0.001 ether; // per MB
    uint256 public minPinDuration = 30 days;

    // ============ Events ============

    event ProviderRegistered(
        bytes32 indexed providerId, address indexed operator, StorageBackend backend, string endpoint
    );

    event ProviderUpdated(bytes32 indexed providerId);
    event ProviderDeactivated(bytes32 indexed providerId);

    event FileUploaded(
        bytes32 indexed uploadId, address indexed uploader, string cid, uint256 size, StorageBackend backend
    );

    event FilePinned(bytes32 indexed uploadId, bytes32 indexed providerId);
    event FileMadePermanent(bytes32 indexed uploadId);
    event FileDeleted(bytes32 indexed uploadId);

    event QuotaUpdated(address indexed user, uint256 maxBytes, uint256 maxUploads);

    // ============ Errors ============

    error ProviderNotFound();
    error ProviderNotActive();
    error NotProviderOperator();
    error UploadNotFound();
    error QuotaExceeded();
    error InsufficientPayment();
    error CIDAlreadyExists();
    error InvalidCID();
    error InvalidSize();

    // ============ Modifiers ============

    modifier providerExists(bytes32 providerId) {
        if (providers[providerId].registeredAt == 0) revert ProviderNotFound();
        _;
    }

    modifier onlyProviderOperator(bytes32 providerId) {
        if (providers[providerId].operator != msg.sender) revert NotProviderOperator();
        _;
    }

    // ============ Constructor ============

    constructor(address _identityRegistry, address _treasury, address initialOwner) Ownable(initialOwner) {
        identityRegistry = IdentityRegistry(payable(_identityRegistry));
        treasury = _treasury;
    }

    // ============ Provider Management ============

    /**
     * @notice Register as a storage provider
     */
    function registerProvider(
        StorageBackend backend,
        string calldata endpoint,
        uint256 capacityGB,
        uint256 pricePerGBMonth
    ) external nonReentrant whenNotPaused returns (bytes32 providerId) {
        providerId = keccak256(abi.encodePacked(_nextProviderId++, msg.sender, backend, block.timestamp));

        uint256 agentId = _getAgentIdForAddress(msg.sender);

        StorageProvider storage provider = providers[providerId];
        provider.providerId = providerId;
        provider.operator = msg.sender;
        provider.agentId = agentId;
        provider.backend = backend;
        provider.endpoint = endpoint;
        provider.capacityGB = capacityGB;
        provider.pricePerGBMonth = pricePerGBMonth;
        provider.registeredAt = block.timestamp;
        provider.isActive = true;

        allProviders.push(providerId);

        emit ProviderRegistered(providerId, msg.sender, backend, endpoint);
    }

    /**
     * @notice Update provider settings
     */
    function updateProvider(bytes32 providerId, string calldata endpoint, uint256 capacityGB, uint256 pricePerGBMonth)
        external
        providerExists(providerId)
        onlyProviderOperator(providerId)
    {
        StorageProvider storage provider = providers[providerId];
        provider.endpoint = endpoint;
        provider.capacityGB = capacityGB;
        provider.pricePerGBMonth = pricePerGBMonth;

        emit ProviderUpdated(providerId);
    }

    /**
     * @notice Deactivate provider
     */
    function deactivateProvider(bytes32 providerId)
        external
        providerExists(providerId)
        onlyProviderOperator(providerId)
    {
        providers[providerId].isActive = false;
        emit ProviderDeactivated(providerId);
    }

    // ============ Upload Management ============

    /**
     * @notice Record a file upload
     */
    function recordUpload(
        string calldata cid,
        bytes32 contentHash,
        uint256 size,
        StorageBackend backend,
        bool permanent
    ) external payable nonReentrant whenNotPaused returns (bytes32 uploadId) {
        if (bytes(cid).length == 0) revert InvalidCID();
        if (size == 0) revert InvalidSize();
        if (cidToUploadId[cid] != bytes32(0)) revert CIDAlreadyExists();

        // Check quota
        StorageQuota storage quota = quotas[msg.sender];
        if (quota.maxBytes == 0) {
            // Initialize default quota
            quota.maxBytes = defaultQuotaBytes;
            quota.maxUploads = defaultQuotaUploads;
        }

        if (quota.usedBytes + size > quota.maxBytes) revert QuotaExceeded();
        if (quota.uploadCount >= quota.maxUploads) revert QuotaExceeded();

        // Handle permanent storage fee
        if (permanent) {
            uint256 feeMB = (size + 1024 * 1024 - 1) / (1024 * 1024); // Round up to MB
            uint256 requiredFee = feeMB * permanentStorageFee;
            if (msg.value < requiredFee) revert InsufficientPayment();
        }

        uploadId = keccak256(abi.encodePacked(_nextUploadId++, msg.sender, cid, block.timestamp));

        Upload storage upload = uploads[uploadId];
        upload.uploadId = uploadId;
        upload.uploader = msg.sender;
        upload.cid = cid;
        upload.contentHash = contentHash;
        upload.size = size;
        upload.backend = backend;
        upload.status = permanent ? UploadStatus.PERMANENT : UploadStatus.PENDING;
        upload.isPermanent = permanent;
        upload.uploadedAt = block.timestamp;
        upload.expiresAt = permanent ? 0 : block.timestamp + minPinDuration;

        cidToUploadId[cid] = uploadId;
        userUploads[msg.sender].push(uploadId);
        allUploads.push(uploadId);

        // Update quota
        quota.usedBytes += size;
        quota.uploadCount++;

        emit FileUploaded(uploadId, msg.sender, cid, size, backend);

        if (permanent) {
            emit FileMadePermanent(uploadId);
        }
    }

    /**
     * @notice Record that a file was pinned by a provider
     */
    function recordPin(bytes32 uploadId, bytes32 providerId)
        external
        providerExists(providerId)
        onlyProviderOperator(providerId)
    {
        Upload storage upload = uploads[uploadId];
        if (upload.uploadedAt == 0) revert UploadNotFound();

        upload.status = UploadStatus.PINNED;
        upload.providerId = providerId;

        StorageProvider storage provider = providers[providerId];
        provider.totalUploads++;
        provider.totalBytes += upload.size;
        provider.usedGB += upload.size / (1024 * 1024 * 1024);

        emit FilePinned(uploadId, providerId);
    }

    /**
     * @notice Make an upload permanent
     */
    function makePermanent(bytes32 uploadId) external payable nonReentrant {
        Upload storage upload = uploads[uploadId];
        if (upload.uploadedAt == 0) revert UploadNotFound();
        if (upload.uploader != msg.sender) revert UploadNotFound();
        if (upload.isPermanent) return;

        uint256 feeMB = (upload.size + 1024 * 1024 - 1) / (1024 * 1024);
        uint256 requiredFee = feeMB * permanentStorageFee;
        if (msg.value < requiredFee) revert InsufficientPayment();

        upload.isPermanent = true;
        upload.status = UploadStatus.PERMANENT;
        upload.expiresAt = 0;

        emit FileMadePermanent(uploadId);
    }

    /**
     * @notice Delete an upload (only by uploader)
     */
    function deleteUpload(bytes32 uploadId) external nonReentrant {
        Upload storage upload = uploads[uploadId];
        if (upload.uploadedAt == 0) revert UploadNotFound();
        if (upload.uploader != msg.sender) revert UploadNotFound();

        // Free quota
        StorageQuota storage quota = quotas[msg.sender];
        if (quota.usedBytes >= upload.size) {
            quota.usedBytes -= upload.size;
        }
        if (quota.uploadCount > 0) {
            quota.uploadCount--;
        }

        // Clear CID mapping
        delete cidToUploadId[upload.cid];

        upload.status = UploadStatus.DELETED;

        emit FileDeleted(uploadId);
    }

    // ============ View Functions ============

    function _getAgentIdForAddress(address addr) internal view returns (uint256) {
        return 0; // Would query indexer in production
    }

    function getProvider(bytes32 providerId) external view returns (StorageProvider memory) {
        return providers[providerId];
    }

    function getUpload(bytes32 uploadId) external view returns (Upload memory) {
        return uploads[uploadId];
    }

    function getUploadByCID(string calldata cid) external view returns (Upload memory) {
        bytes32 uploadId = cidToUploadId[cid];
        return uploads[uploadId];
    }

    function getUserUploads(address user) external view returns (bytes32[] memory) {
        return userUploads[user];
    }

    function getUserQuota(address user) external view returns (StorageQuota memory) {
        StorageQuota memory quota = quotas[user];
        if (quota.maxBytes == 0) {
            quota.maxBytes = defaultQuotaBytes;
            quota.maxUploads = defaultQuotaUploads;
        }
        return quota;
    }

    function getTotalProviders() external view returns (uint256) {
        return allProviders.length;
    }

    function getTotalUploads() external view returns (uint256) {
        return allUploads.length;
    }

    function getActiveProviders(StorageBackend backend) external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allProviders.length; i++) {
            StorageProvider storage p = providers[allProviders[i]];
            if (p.isActive && p.backend == backend) {
                count++;
            }
        }

        bytes32[] memory result = new bytes32[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < allProviders.length; i++) {
            StorageProvider storage p = providers[allProviders[i]];
            if (p.isActive && p.backend == backend) {
                result[j++] = allProviders[i];
            }
        }

        return result;
    }

    // ============ Admin Functions ============

    function setDefaultQuota(uint256 maxBytes, uint256 maxUploads) external onlyOwner {
        defaultQuotaBytes = maxBytes;
        defaultQuotaUploads = maxUploads;
    }

    function setUserQuota(address user, uint256 maxBytes, uint256 maxUploads) external onlyOwner {
        quotas[user].maxBytes = maxBytes;
        quotas[user].maxUploads = maxUploads;
        emit QuotaUpdated(user, maxBytes, maxUploads);
    }

    function setPermanentStorageFee(uint256 fee) external onlyOwner {
        permanentStorageFee = fee;
    }

    function setMinPinDuration(uint256 duration) external onlyOwner {
        minPinDuration = duration;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function withdrawFees() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success,) = treasury.call{value: balance}("");
            require(success, "Transfer failed");
        }
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}
