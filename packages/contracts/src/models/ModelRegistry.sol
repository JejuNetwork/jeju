// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.33;

import "../registry/BaseArtifactRegistry.sol";

/**
 * @title ModelRegistry
 * @author Jeju Network
 * @notice Decentralized ML model registry - HuggingFace Hub on-chain
 * @dev Stores model metadata on-chain, weights in IPFS/Arweave
 */
contract ModelRegistry is BaseArtifactRegistry {

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

    struct ModelMetadata {
        ModelType modelType;
        LicenseType license;
        string licenseUri;
        // Other fields like description, tags are in base Artifact
    }

    struct ModelVersionExtended {
        // Base fields in ArtifactVersion
        string weightsUri;           // IPFS/Arweave CID
        bytes32 weightsHash;         // SHA256 of weights
        uint256 weightsSize;
        string configUri;            // config.json CID
        string tokenizerUri;         // tokenizer CID
        uint256 parameterCount;
        string precision;            // fp16, bf16, fp32, int8, int4
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

    mapping(bytes32 => ModelMetadata) public modelMetadata;
    mapping(bytes32 => mapping(uint256 => ModelVersionExtended)) public extendedVersions;
    mapping(bytes32 => ModelFile[]) public files;
    mapping(bytes32 => GateRequest[]) public gateRequests;
    
    uint256 private _nextModelId = 1;
    uint256 private _nextVersionId = 1;
    uint256 private _nextRequestId = 1;

    event ModelCreated(
        bytes32 indexed modelId,
        string indexed organization,
        string name,
        address indexed owner,
        ModelType modelType
    );

    event ModelUpdated(bytes32 indexed modelId);

    event FileUploaded(
        bytes32 indexed modelId,
        string filename,
        string cid,
        uint256 size
    );

    event ModelDownloaded(bytes32 indexed modelId, address indexed downloader);
    event ModelStarred(bytes32 indexed modelId, address indexed user, bool starred);
    event GateRequestCreated(bytes32 indexed modelId, bytes32 indexed requestId, address indexed requester);
    event GateRequestApproved(bytes32 indexed modelId, bytes32 indexed requestId);
    event GateRequestRejected(bytes32 indexed modelId, bytes32 indexed requestId, string reason);

    error ModelNameTaken();
    error RequestNotFound();
    error RequestAlreadyProcessed();

    constructor(
        address _identityRegistry,
        address _treasury,
        address initialOwner
    ) BaseArtifactRegistry(_identityRegistry, _treasury, initialOwner) {}

    /**
     * @notice Create a new model
     */
    function createModel(
        string calldata name,
        string calldata organization,
        ModelType modelType,
        LicenseType license,
        Visibility visibility, // Using Visibility enum from base (matches AccessLevel logic)
        string calldata description,
        string[] calldata tags
    ) external payable nonReentrant whenNotPaused returns (bytes32 modelId) {
        // Collect fee if set
        if (publishFee > 0 && msg.value < publishFee) revert InsufficientPayment();

        modelId = keccak256(abi.encodePacked(_nextModelId++, msg.sender, organization, name, block.timestamp));
        uint256 agentId = _getAgentIdForAddress(msg.sender);

        // Call internal create
        // We catch "AlreadyExists" and revert with ModelNameTaken for compatibility
        // Simulating the check here to avoid try/catch complexity
        bytes32 nameHash = keccak256(abi.encodePacked(organization, "/", name));
        if (nameTaken[nameHash]) revert ModelNameTaken();

        _createArtifact(modelId, name, organization, visibility, description, tags, agentId);

        // Store extended metadata
        modelMetadata[modelId] = ModelMetadata({
            modelType: modelType,
            license: license,
            licenseUri: ""
        });

        emit ModelCreated(modelId, organization, name, msg.sender, modelType);
    }

    /**
     * @notice Update model metadata
     */
    function updateModel(
        bytes32 modelId,
        string calldata description,
        string[] calldata tags,
        Visibility visibility
    ) external exists(modelId) onlyArtifactOwner(modelId) {
        Artifact storage model = artifacts[modelId];
        model.description = description;
        model.tags = tags;
        model.visibility = visibility;
        model.updatedAt = block.timestamp;

        emit ModelUpdated(modelId);
    }

    /**
     * @notice Publish a new version of a model
     */
    function publishVersion(
        bytes32 modelId,
        string calldata versionString,
        string calldata weightsUri,
        bytes32 weightsHash,
        uint256 weightsSize,
        string calldata configUri,
        string calldata tokenizerUri,
        uint256 parameterCount,
        string calldata precision
    ) external payable nonReentrant exists(modelId) canPublish(modelId) returns (bytes32 versionId) {
        // Collect fee if set
        if (publishFee > 0 && msg.value < publishFee) revert InsufficientPayment();

        versionId = keccak256(abi.encodePacked(_nextVersionId++, modelId, versionString, block.timestamp));

        // Use base versioning
        uint256 index = _publishVersion(modelId, versionId, versionString, weightsUri, weightsHash, weightsSize);

        // Store extended version data
        extendedVersions[modelId][index] = ModelVersionExtended({
            weightsUri: weightsUri,
            weightsHash: weightsHash,
            weightsSize: weightsSize,
            configUri: configUri,
            tokenizerUri: tokenizerUri,
            parameterCount: parameterCount,
            precision: precision
        });
        
        // Emitted VersionPublished by base
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
    ) external nonReentrant exists(modelId) canPublish(modelId) {
        files[modelId].push(ModelFile({
            filename: filename,
            cid: cid,
            size: size,
            sha256Hash: sha256Hash,
            fileType: fileType
        }));

        artifacts[modelId].updatedAt = block.timestamp;

        emit FileUploaded(modelId, filename, cid, size);
    }

    /**
     * @notice Record a download (called by DWS nodes)
     */
    function recordDownload(bytes32 modelId) external nonReentrant exists(modelId) {
        // Check access
        if (!checkAccess(modelId, msg.sender)) {
            revert AccessDenied();
        }

        artifacts[modelId].downloadCount++;
        emit ModelDownloaded(modelId, msg.sender);
    }

    // ============ Access Control Requests ============

    /**
     * @notice Request access to a gated model
     */
    function requestAccess(bytes32 modelId) external nonReentrant exists(modelId) returns (bytes32 requestId) {
        Artifact storage model = artifacts[modelId];
        if (model.visibility != Visibility.GATED) revert AccessDenied();
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
        exists(modelId) 
        onlyArtifactOwner(modelId) 
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
        exists(modelId) 
        onlyArtifactOwner(modelId) 
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

    function _getAgentIdForAddress(address /* addr */) internal pure returns (uint256) {
        return 0; // Would query indexer in production
    }

    // View functions to reassemble full structs
    
    struct FullModel {
        Artifact artifact;
        ModelMetadata metadata;
    }

    function getModel(bytes32 modelId) external view returns (FullModel memory) {
        return FullModel({
            artifact: artifacts[modelId],
            metadata: modelMetadata[modelId]
        });
    }

    struct FullVersion {
        ArtifactVersion base;
        ModelVersionExtended extended;
    }

    function getVersions(bytes32 modelId) external view returns (FullVersion[] memory) {
        ArtifactVersion[] memory baseVersions = versions[modelId];
        FullVersion[] memory result = new FullVersion[](baseVersions.length);
        
        for (uint256 i = 0; i < baseVersions.length; i++) {
            result[i] = FullVersion({
                base: baseVersions[i],
                extended: extendedVersions[modelId][i]
            });
        }
        return result;
    }

    function getLatestVersion(bytes32 modelId) external view returns (FullVersion memory) {
        ArtifactVersion[] memory baseVersions = versions[modelId];
        // Versions are pushed, so iterate backwards to find latest
        for (uint256 i = baseVersions.length; i > 0; i--) {
            if (baseVersions[i - 1].isLatest) {
                return FullVersion({
                    base: baseVersions[i - 1],
                    extended: extendedVersions[modelId][i - 1]
                });
            }
        }
        revert InvalidVersion();
    }

    function getFiles(bytes32 modelId) external view returns (ModelFile[] memory) {
        return files[modelId];
    }

    function getGateRequests(bytes32 modelId) external view returns (GateRequest[] memory) {
        return gateRequests[modelId];
    }

    function getTotalModels() external view returns (uint256) {
        return allArtifacts.length;
    }

    function getModelIds(uint256 offset, uint256 limit) external view returns (bytes32[] memory) {
        uint256 end = offset + limit;
        if (end > allArtifacts.length) end = allArtifacts.length;
        if (offset >= end) return new bytes32[](0);

        bytes32[] memory result = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = allArtifacts[i];
        }
        return result;
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }

    receive() external payable {}
}
