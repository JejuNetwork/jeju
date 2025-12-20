// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../registry/IdentityRegistry.sol";

/**
 * @title ModelRegistry
 * @author Jeju Network
 * @notice Decentralized ML model registry - HuggingFace Hub on-chain
 * @dev Stores model metadata on-chain, weights in IPFS/Arweave
 *
 * Features:
 * - HuggingFace Hub compatible API (via DWS)
 * - Multi-version model management
 * - Access control (public/gated/private)
 * - Model licensing on-chain
 * - Download/inference tracking
 * - Model verification and signing
 * - Organization management
 */
contract ModelRegistry is ReentrancyGuard, Pausable, Ownable {

    enum ModelType {
        LLM,
        VISION,
        AUDIO,
        MULTIMODAL,
        EMBEDDING,
        CLASSIFIER,
        REGRESSION,
        RL,
        OTHER
    }

    enum LicenseType {
        MIT,
        APACHE_2,
        GPL_3,
        CC_BY_4,
        CC_BY_NC_4,
        LLAMA_2,
        CUSTOM,
        PROPRIETARY
    }

    enum AccessLevel {
        PUBLIC,
        GATED,
        ENCRYPTED
    }

    struct Model {
        bytes32 modelId;
        string name;
        string organization;
        address owner;
        uint256 ownerAgentId;
        ModelType modelType;
        LicenseType license;
        string licenseUri;
        AccessLevel accessLevel;
        string description;
        string[] tags;
        uint256 createdAt;
        uint256 updatedAt;
        uint256 downloadCount;
        uint256 starCount;
        bool isVerified;
        bool isActive;
    }

    struct ModelVersion {
        bytes32 versionId;
        bytes32 modelId;
        string version;
        string weightsUri;           // IPFS/Arweave CID
        bytes32 weightsHash;         // SHA256 of weights
        uint256 weightsSize;
        string configUri;            // config.json CID
        string tokenizerUri;         // tokenizer CID
        uint256 parameterCount;
        string precision;            // fp16, bf16, fp32, int8, int4
        uint256 publishedAt;
        address publisher;
        bool isLatest;
    }

    struct ModelFile {
        string filename;
        string cid;
        uint256 size;
        bytes32 sha256Hash;
        string fileType;             // weights, config, tokenizer, other
    }

    struct GateRequest {
        bytes32 requestId;
        bytes32 modelId;
        address requester;
        uint256 requestedAt;
        bool approved;
        bool rejected;
        string reason;
    }

    IdentityRegistry public immutable identityRegistry;
    address public treasury;

    mapping(bytes32 => Model) public models;
    mapping(bytes32 => ModelVersion[]) public versions;
    mapping(bytes32 => mapping(string => uint256)) public versionIndex; // modelId => version => index
    mapping(bytes32 => ModelFile[]) public files;
    mapping(bytes32 => GateRequest[]) public gateRequests;
    
    // Access control
    mapping(bytes32 => mapping(address => bool)) public hasAccess;
    mapping(bytes32 => mapping(address => bool)) public isCollaborator;
    
    // Stars
    mapping(bytes32 => mapping(address => bool)) public hasStarred;
    
    // Organization ownership
    mapping(string => address) public organizationOwner;
    
    // Name uniqueness: keccak256(org/name)
    mapping(bytes32 => bool) public modelNameTaken;
    
    bytes32[] public allModels;
    uint256 private _nextModelId = 1;
    uint256 private _nextVersionId = 1;
    uint256 private _nextRequestId = 1;

    // Fees
    uint256 public publishFee = 0;
    uint256 public storageFeePerGB = 0;

    event ModelCreated(
        bytes32 indexed modelId,
        string indexed organization,
        string name,
        address indexed owner,
        ModelType modelType
    );

    event ModelUpdated(bytes32 indexed modelId);

    event VersionPublished(
        bytes32 indexed modelId,
        bytes32 indexed versionId,
        string version,
        address indexed publisher
    );

    event FileUploaded(
        bytes32 indexed modelId,
        string filename,
        string cid,
        uint256 size
    );

    event ModelDownloaded(bytes32 indexed modelId, address indexed downloader);
    event ModelStarred(bytes32 indexed modelId, address indexed user, bool starred);
    event AccessGranted(bytes32 indexed modelId, address indexed user);
    event AccessRevoked(bytes32 indexed modelId, address indexed user);
    event GateRequestCreated(bytes32 indexed modelId, bytes32 indexed requestId, address indexed requester);
    event GateRequestApproved(bytes32 indexed modelId, bytes32 indexed requestId);
    event GateRequestRejected(bytes32 indexed modelId, bytes32 indexed requestId, string reason);
    event OrganizationClaimed(string indexed organization, address indexed owner);

    // ============ Errors ============

    error ModelNotFound();
    error NotModelOwner();
    error ModelNameTaken();
    error OrganizationNotOwned();
    error VersionNotFound();
    error AccessDenied();
    error InsufficientPayment();
    error InvalidVersion();
    error RequestNotFound();
    error RequestAlreadyProcessed();

    modifier modelExists(bytes32 modelId) {
        if (models[modelId].createdAt == 0) revert ModelNotFound();
        _;
    }

    modifier onlyModelOwner(bytes32 modelId) {
        if (models[modelId].owner != msg.sender) revert NotModelOwner();
        _;
    }

    modifier canPublish(bytes32 modelId) {
        Model storage model = models[modelId];
        if (model.owner != msg.sender && !isCollaborator[modelId][msg.sender]) {
            revert AccessDenied();
        }
        _;
    }

    // ============ Constructor ============

    constructor(
        address _identityRegistry,
        address _treasury,
        address initialOwner
    ) Ownable(initialOwner) {
        identityRegistry = IdentityRegistry(payable(_identityRegistry));
        treasury = _treasury;
    }

    // ============ Organization Management ============

    /**
     * @notice Claim an organization namespace
     */
    function claimOrganization(string calldata organization) external {
        if (organizationOwner[organization] != address(0)) revert OrganizationNotOwned();
        organizationOwner[organization] = msg.sender;
        emit OrganizationClaimed(organization, msg.sender);
    }

    /**
     * @notice Transfer organization ownership
     */
    function transferOrganization(string calldata organization, address newOwner) external {
        if (organizationOwner[organization] != msg.sender) revert OrganizationNotOwned();
        organizationOwner[organization] = newOwner;
    }

    // ============ Model Management ============

    /**
     * @notice Create a new model
     * @param name Model name (e.g., "llama-3-70b")
     * @param organization Organization namespace (e.g., "jeju")
     * @param modelType Type of model
     * @param license License type
     * @param accessLevel Access control level
     * @param description Model description
     * @param tags Search tags
     * @return modelId The unique model identifier
     */
    function createModel(
        string calldata name,
        string calldata organization,
        ModelType modelType,
        LicenseType license,
        AccessLevel accessLevel,
        string calldata description,
        string[] calldata tags
    ) external payable nonReentrant whenNotPaused returns (bytes32 modelId) {
        // Check organization ownership
        if (organizationOwner[organization] != address(0) && organizationOwner[organization] != msg.sender) {
            revert OrganizationNotOwned();
        }

        // Check uniqueness
        bytes32 nameHash = keccak256(abi.encodePacked(organization, "/", name));
        if (modelNameTaken[nameHash]) revert ModelNameTaken();

        // Collect fee if set
        if (publishFee > 0 && msg.value < publishFee) revert InsufficientPayment();

        modelId = keccak256(abi.encodePacked(_nextModelId++, msg.sender, organization, name, block.timestamp));

        uint256 agentId = _getAgentIdForAddress(msg.sender);

        Model storage model = models[modelId];
        model.modelId = modelId;
        model.name = name;
        model.organization = organization;
        model.owner = msg.sender;
        model.ownerAgentId = agentId;
        model.modelType = modelType;
        model.license = license;
        model.accessLevel = accessLevel;
        model.description = description;
        model.tags = tags;
        model.createdAt = block.timestamp;
        model.updatedAt = block.timestamp;
        model.isActive = true;

        modelNameTaken[nameHash] = true;
        allModels.push(modelId);

        // Auto-claim organization if not claimed
        if (organizationOwner[organization] == address(0)) {
            organizationOwner[organization] = msg.sender;
        }

        emit ModelCreated(modelId, organization, name, msg.sender, modelType);
    }

    /**
     * @notice Update model metadata
     */
    function updateModel(
        bytes32 modelId,
        string calldata description,
        string[] calldata tags,
        AccessLevel accessLevel
    ) external modelExists(modelId) onlyModelOwner(modelId) {
        Model storage model = models[modelId];
        model.description = description;
        model.tags = tags;
        model.accessLevel = accessLevel;
        model.updatedAt = block.timestamp;

        emit ModelUpdated(modelId);
    }

    /**
     * @notice Publish a new version of a model
     */
    function publishVersion(
        bytes32 modelId,
        string calldata version,
        string calldata weightsUri,
        bytes32 weightsHash,
        uint256 weightsSize,
        string calldata configUri,
        string calldata tokenizerUri,
        uint256 parameterCount,
        string calldata precision
    ) external payable nonReentrant modelExists(modelId) canPublish(modelId) returns (bytes32 versionId) {
        // Validate version format (simple check)
        if (bytes(version).length == 0) revert InvalidVersion();

        // Collect fee if set
        if (publishFee > 0 && msg.value < publishFee) revert InsufficientPayment();

        versionId = keccak256(abi.encodePacked(_nextVersionId++, modelId, version, block.timestamp));

        // Mark previous versions as not latest
        ModelVersion[] storage modelVersions = versions[modelId];
        for (uint256 i = 0; i < modelVersions.length; i++) {
            modelVersions[i].isLatest = false;
        }

        // Check if version already exists
        uint256 existingIndex = versionIndex[modelId][version];
        bool versionExists = modelVersions.length > 0 && 
            existingIndex < modelVersions.length &&
            keccak256(bytes(modelVersions[existingIndex].version)) == keccak256(bytes(version));

        ModelVersion memory newVersion = ModelVersion({
            versionId: versionId,
            modelId: modelId,
            version: version,
            weightsUri: weightsUri,
            weightsHash: weightsHash,
            weightsSize: weightsSize,
            configUri: configUri,
            tokenizerUri: tokenizerUri,
            parameterCount: parameterCount,
            precision: precision,
            publishedAt: block.timestamp,
            publisher: msg.sender,
            isLatest: true
        });

        if (versionExists) {
            modelVersions[existingIndex] = newVersion;
        } else {
            versionIndex[modelId][version] = modelVersions.length;
            modelVersions.push(newVersion);
        }

        models[modelId].updatedAt = block.timestamp;

        emit VersionPublished(modelId, versionId, version, msg.sender);
    }

    /**
     * @notice Upload a file associated with a model
     */
    function uploadFile(
        bytes32 modelId,
        string calldata filename,
        string calldata cid,
        uint256 size,
        bytes32 sha256Hash,
        string calldata fileType
    ) external nonReentrant modelExists(modelId) canPublish(modelId) {
        files[modelId].push(ModelFile({
            filename: filename,
            cid: cid,
            size: size,
            sha256Hash: sha256Hash,
            fileType: fileType
        }));

        models[modelId].updatedAt = block.timestamp;

        emit FileUploaded(modelId, filename, cid, size);
    }

    /**
     * @notice Record a download (called by DWS nodes)
     */
    function recordDownload(bytes32 modelId) external nonReentrant modelExists(modelId) {
        Model storage model = models[modelId];

        // Check access for gated/private models
        if (model.accessLevel == AccessLevel.GATED || model.accessLevel == AccessLevel.ENCRYPTED) {
            if (!hasAccess[modelId][msg.sender] && model.owner != msg.sender) {
                revert AccessDenied();
            }
        }

        model.downloadCount++;
        emit ModelDownloaded(modelId, msg.sender);
    }

    // ============ Access Control ============

    /**
     * @notice Request access to a gated model
     */
    function requestAccess(bytes32 modelId) external nonReentrant modelExists(modelId) returns (bytes32 requestId) {
        Model storage model = models[modelId];
        if (model.accessLevel != AccessLevel.GATED) revert AccessDenied();
        if (hasAccess[modelId][msg.sender]) revert AccessDenied(); // Already has access

        requestId = keccak256(abi.encodePacked(_nextRequestId++, modelId, msg.sender, block.timestamp));

        gateRequests[modelId].push(GateRequest({
            requestId: requestId,
            modelId: modelId,
            requester: msg.sender,
            requestedAt: block.timestamp,
            approved: false,
            rejected: false,
            reason: ""
        }));

        emit GateRequestCreated(modelId, requestId, msg.sender);
    }

    /**
     * @notice Approve access request
     */
    function approveAccess(bytes32 modelId, bytes32 requestId) 
        external 
        modelExists(modelId) 
        onlyModelOwner(modelId) 
    {
        GateRequest[] storage requests = gateRequests[modelId];
        
        for (uint256 i = 0; i < requests.length; i++) {
            if (requests[i].requestId == requestId) {
                if (requests[i].approved || requests[i].rejected) revert RequestAlreadyProcessed();
                
                requests[i].approved = true;
                hasAccess[modelId][requests[i].requester] = true;
                
                emit GateRequestApproved(modelId, requestId);
                emit AccessGranted(modelId, requests[i].requester);
                return;
            }
        }
        
        revert RequestNotFound();
    }

    /**
     * @notice Reject access request
     */
    function rejectAccess(bytes32 modelId, bytes32 requestId, string calldata reason) 
        external 
        modelExists(modelId) 
        onlyModelOwner(modelId) 
    {
        GateRequest[] storage requests = gateRequests[modelId];
        
        for (uint256 i = 0; i < requests.length; i++) {
            if (requests[i].requestId == requestId) {
                if (requests[i].approved || requests[i].rejected) revert RequestAlreadyProcessed();
                
                requests[i].rejected = true;
                requests[i].reason = reason;
                
                emit GateRequestRejected(modelId, requestId, reason);
                return;
            }
        }
        
        revert RequestNotFound();
    }

    /**
     * @notice Grant access directly
     */
    function grantAccess(bytes32 modelId, address user) external modelExists(modelId) onlyModelOwner(modelId) {
        hasAccess[modelId][user] = true;
        emit AccessGranted(modelId, user);
    }

    /**
     * @notice Revoke access
     */
    function revokeAccess(bytes32 modelId, address user) external modelExists(modelId) onlyModelOwner(modelId) {
        hasAccess[modelId][user] = false;
        emit AccessRevoked(modelId, user);
    }

    /**
     * @notice Add collaborator
     */
    function addCollaborator(bytes32 modelId, address user) external modelExists(modelId) onlyModelOwner(modelId) {
        isCollaborator[modelId][user] = true;
        hasAccess[modelId][user] = true;
    }

    /**
     * @notice Remove collaborator
     */
    function removeCollaborator(bytes32 modelId, address user) external modelExists(modelId) onlyModelOwner(modelId) {
        isCollaborator[modelId][user] = false;
    }

    /**
     * @notice Star/unstar model
     */
    function toggleStar(bytes32 modelId) external nonReentrant modelExists(modelId) {
        bool starred = !hasStarred[modelId][msg.sender];
        hasStarred[modelId][msg.sender] = starred;

        Model storage model = models[modelId];
        if (starred) {
            model.starCount++;
        } else if (model.starCount > 0) {
            model.starCount--;
        }

        emit ModelStarred(modelId, msg.sender, starred);
    }

    // ============ View Functions ============

    function _getAgentIdForAddress(address addr) internal view returns (uint256) {
        return 0; // Would query indexer in production
    }

    function getModel(bytes32 modelId) external view returns (Model memory) {
        return models[modelId];
    }

    function getVersions(bytes32 modelId) external view returns (ModelVersion[] memory) {
        return versions[modelId];
    }

    function getLatestVersion(bytes32 modelId) external view returns (ModelVersion memory) {
        ModelVersion[] storage modelVersions = versions[modelId];
        for (uint256 i = modelVersions.length; i > 0; i--) {
            if (modelVersions[i - 1].isLatest) {
                return modelVersions[i - 1];
            }
        }
        revert VersionNotFound();
    }

    function getVersion(bytes32 modelId, string calldata version) external view returns (ModelVersion memory) {
        uint256 idx = versionIndex[modelId][version];
        ModelVersion[] storage modelVersions = versions[modelId];
        if (idx >= modelVersions.length) revert VersionNotFound();
        return modelVersions[idx];
    }

    function getFiles(bytes32 modelId) external view returns (ModelFile[] memory) {
        return files[modelId];
    }

    function getGateRequests(bytes32 modelId) external view returns (GateRequest[] memory) {
        return gateRequests[modelId];
    }

    function getTotalModels() external view returns (uint256) {
        return allModels.length;
    }

    function getModelIds(uint256 offset, uint256 limit) external view returns (bytes32[] memory) {
        uint256 end = offset + limit;
        if (end > allModels.length) end = allModels.length;
        if (offset >= end) return new bytes32[](0);

        bytes32[] memory result = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = allModels[i];
        }
        return result;
    }

    function getModelsByType(ModelType modelType, uint256 offset, uint256 limit) 
        external 
        view 
        returns (bytes32[] memory) 
    {
        // Count matching models
        uint256 count = 0;
        for (uint256 i = 0; i < allModels.length; i++) {
            if (models[allModels[i]].modelType == modelType) {
                count++;
            }
        }

        // Collect matching models
        bytes32[] memory matching = new bytes32[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < allModels.length; i++) {
            if (models[allModels[i]].modelType == modelType) {
                matching[j++] = allModels[i];
            }
        }

        // Apply pagination
        uint256 end = offset + limit;
        if (end > matching.length) end = matching.length;
        if (offset >= end) return new bytes32[](0);

        bytes32[] memory result = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = matching[i];
        }
        return result;
    }

    function checkAccess(bytes32 modelId, address user) external view returns (bool) {
        Model storage model = models[modelId];
        if (model.accessLevel == AccessLevel.PUBLIC) return true;
        if (model.owner == user) return true;
        return hasAccess[modelId][user];
    }

    // ============ Admin ============

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setPublishFee(uint256 _fee) external onlyOwner {
        publishFee = _fee;
    }

    function setStorageFeePerGB(uint256 _fee) external onlyOwner {
        storageFeePerGB = _fee;
    }

    function verifyModel(bytes32 modelId) external onlyOwner modelExists(modelId) {
        models[modelId].isVerified = true;
    }

    function unverifyModel(bytes32 modelId) external onlyOwner modelExists(modelId) {
        models[modelId].isVerified = false;
    }

    function deactivateModel(bytes32 modelId) external onlyOwner modelExists(modelId) {
        models[modelId].isActive = false;
    }

    function activateModel(bytes32 modelId) external onlyOwner modelExists(modelId) {
        models[modelId].isActive = true;
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
            (bool success, ) = treasury.call{value: balance}("");
            require(success, "Transfer failed");
        }
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}
