// SPDX-License-Identifier: CC0-1.0
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../registry/IdentityRegistry.sol";

/**
 * @title ModelRegistry
 * @author Jeju Network
 * @notice Decentralized model hub (like HuggingFace) with on-chain provenance
 * @dev Features:
 *      - Model registration with IPFS storage
 *      - Version management
 *      - Training provenance (dataset links, training config)
 *      - Inference integration with compute marketplace
 *      - Download/usage tracking for monetization
 *      - License management
 *      - Data encryption hooks for future monetization
 */
contract ModelRegistry is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum ModelType {
        LLM,                // Large Language Model
        VISION,             // Computer Vision
        AUDIO,              // Audio/Speech
        MULTIMODAL,         // Multi-modal
        EMBEDDING,          // Embedding model
        CLASSIFIER,         // Classification
        REGRESSION,         // Regression
        RL,                 // Reinforcement Learning
        OTHER
    }

    enum LicenseType {
        MIT,
        APACHE_2,
        GPL_3,
        CC_BY_4,
        CC_BY_NC_4,         // Non-commercial
        LLAMA_2,            // Meta's Llama license
        CUSTOM,
        PROPRIETARY
    }

    enum AccessLevel {
        PUBLIC,             // Fully public
        GATED,              // Requires approval
        ENCRYPTED           // Encrypted, requires payment/key
    }

    // ============ Structs ============

    struct Model {
        bytes32 modelId;
        string name;
        string organization;        // Organization or username
        address owner;
        uint256 ownerAgentId;       // ERC-8004 agent ID
        ModelType modelType;
        LicenseType license;
        string licenseUri;          // Custom license URI if CUSTOM
        AccessLevel accessLevel;
        string description;
        string[] tags;
        uint256 createdAt;
        uint256 updatedAt;
        bool isPublic;
        bool isVerified;            // Verified by guardians
    }

    struct ModelVersion {
        bytes32 versionId;
        bytes32 modelId;
        string version;             // Semver string
        string weightsUri;          // IPFS CID for weights
        bytes32 weightsHash;        // SHA256 of weights file
        uint256 weightsSize;        // Size in bytes
        string configUri;           // IPFS CID for config.json
        string tokenizerUri;        // IPFS CID for tokenizer
        uint256 parameterCount;     // Number of parameters
        string precision;           // "fp32", "fp16", "int8", "int4"
        uint256 publishedAt;
        bool isLatest;
    }

    struct TrainingProvenance {
        bytes32 modelId;
        bytes32 versionId;
        string[] datasetIds;        // References to dataset registry
        string trainingConfigUri;   // IPFS CID for training config
        bytes32 trainingConfigHash;
        uint256 trainingStarted;
        uint256 trainingCompleted;
        string computeProviderUri;  // Reference to compute job
        bytes32 computeJobId;       // Compute marketplace job ID
        string frameworkVersion;    // "pytorch-2.0", "jax-0.4", etc.
        string[] baseModels;        // Base models used (for fine-tuning)
        address trainer;            // Who trained this
        bool verified;              // Verified by guardian review
    }

    struct ModelMetrics {
        bytes32 modelId;
        uint256 totalDownloads;
        uint256 totalInferences;
        uint256 totalStars;
        uint256 totalForks;
        uint256 weeklyDownloads;
        uint256 lastUpdated;
    }

    struct InferenceEndpoint {
        bytes32 endpointId;
        bytes32 modelId;
        bytes32 versionId;
        address provider;           // Compute provider
        string endpointUrl;
        uint256 pricePerRequest;    // In wei
        address paymentToken;       // address(0) for ETH
        bool isActive;
        uint256 createdAt;
    }

    // ============ State ============

    IdentityRegistry public immutable identityRegistry;
    address public computeRegistry;         // For inference integration
    address public datasetRegistry;         // For dataset references
    address public treasury;

    mapping(bytes32 => Model) public models;
    mapping(bytes32 => ModelVersion[]) public modelVersions;
    mapping(bytes32 => TrainingProvenance) public provenance;
    mapping(bytes32 => ModelMetrics) public metrics;
    mapping(bytes32 => InferenceEndpoint[]) public endpoints;
    
    // Organization models
    mapping(string => bytes32[]) public organizationModels;
    
    // User downloads (for gated models)
    mapping(bytes32 => mapping(address => bool)) public hasAccess;
    mapping(bytes32 => mapping(address => uint256)) public downloadCount;
    
    // Stars/likes
    mapping(bytes32 => mapping(address => bool)) public hasStarred;
    
    // Model name uniqueness
    mapping(bytes32 => bool) public modelNameTaken; // keccak256(org/name) => taken
    
    bytes32[] public allModels;
    uint256 private _nextModelId = 1;
    uint256 private _nextVersionId = 1;
    uint256 private _nextEndpointId = 1;

    // Fees
    uint256 public uploadFee = 0;               // Can be set for spam prevention
    uint256 public inferenceFeePercentage = 500; // 5% fee on inference

    // ============ Events ============

    event ModelCreated(
        bytes32 indexed modelId,
        string indexed organization,
        string name,
        address indexed owner,
        ModelType modelType
    );
    event ModelUpdated(bytes32 indexed modelId, string description);
    event VersionPublished(
        bytes32 indexed modelId,
        bytes32 indexed versionId,
        string version,
        string weightsUri
    );
    event ProvenanceRecorded(
        bytes32 indexed modelId,
        bytes32 indexed versionId,
        bytes32 indexed computeJobId
    );
    event ModelDownloaded(bytes32 indexed modelId, address indexed user);
    event ModelStarred(bytes32 indexed modelId, address indexed user, bool starred);
    event InferenceEndpointCreated(
        bytes32 indexed endpointId,
        bytes32 indexed modelId,
        address indexed provider
    );
    event InferenceRequest(
        bytes32 indexed endpointId,
        address indexed requester,
        uint256 price
    );
    event AccessGranted(bytes32 indexed modelId, address indexed user);
    event ModelVerified(bytes32 indexed modelId, address indexed verifier);

    // ============ Errors ============

    error ModelNotFound();
    error NotModelOwner();
    error ModelNameTaken();
    error VersionNotFound();
    error AccessDenied();
    error InvalidLicense();
    error EndpointNotFound();
    error InsufficientPayment();
    error EndpointInactive();

    // ============ Modifiers ============

    modifier modelExists(bytes32 modelId) {
        if (models[modelId].createdAt == 0) revert ModelNotFound();
        _;
    }

    modifier onlyModelOwner(bytes32 modelId) {
        if (models[modelId].owner != msg.sender) revert NotModelOwner();
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

    // ============ Model Management ============

    /**
     * @notice Create a new model entry
     * @param name Model name (must be unique within organization)
     * @param organization Organization or username
     * @param modelType Type of model
     * @param license License type
     * @param licenseUri Custom license URI (for CUSTOM license)
     * @param accessLevel Access level
     * @param description Model description
     * @param tags Array of tags
     */
    function createModel(
        string calldata name,
        string calldata organization,
        ModelType modelType,
        LicenseType license,
        string calldata licenseUri,
        AccessLevel accessLevel,
        string calldata description,
        string[] calldata tags
    ) external payable nonReentrant whenNotPaused returns (bytes32 modelId) {
        // Check uniqueness
        bytes32 nameHash = keccak256(abi.encodePacked(organization, "/", name));
        if (modelNameTaken[nameHash]) revert ModelNameTaken();

        // Collect upload fee if set
        if (uploadFee > 0 && msg.value < uploadFee) revert InsufficientPayment();

        modelId = keccak256(abi.encodePacked(_nextModelId++, msg.sender, name, block.timestamp));

        // Get agent ID if available
        uint256 agentId = _getAgentIdForAddress(msg.sender);

        Model storage model = models[modelId];
        model.modelId = modelId;
        model.name = name;
        model.organization = organization;
        model.owner = msg.sender;
        model.ownerAgentId = agentId;
        model.modelType = modelType;
        model.license = license;
        model.licenseUri = licenseUri;
        model.accessLevel = accessLevel;
        model.description = description;
        model.tags = tags;
        model.createdAt = block.timestamp;
        model.updatedAt = block.timestamp;
        model.isPublic = accessLevel == AccessLevel.PUBLIC;

        modelNameTaken[nameHash] = true;
        allModels.push(modelId);
        organizationModels[organization].push(modelId);

        // Initialize metrics
        metrics[modelId].modelId = modelId;

        emit ModelCreated(modelId, organization, name, msg.sender, modelType);
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
    ) external nonReentrant modelExists(modelId) onlyModelOwner(modelId) returns (bytes32 versionId) {
        versionId = keccak256(abi.encodePacked(_nextVersionId++, modelId, version, block.timestamp));

        // Mark previous latest as not latest
        ModelVersion[] storage versions = modelVersions[modelId];
        for (uint256 i = 0; i < versions.length; i++) {
            versions[i].isLatest = false;
        }

        versions.push(ModelVersion({
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
            isLatest: true
        }));

        models[modelId].updatedAt = block.timestamp;

        emit VersionPublished(modelId, versionId, version, weightsUri);
    }

    /**
     * @notice Record training provenance for a version
     */
    function recordProvenance(
        bytes32 modelId,
        bytes32 versionId,
        string[] calldata datasetIds,
        string calldata trainingConfigUri,
        bytes32 trainingConfigHash,
        uint256 trainingStarted,
        uint256 trainingCompleted,
        string calldata computeProviderUri,
        bytes32 computeJobId,
        string calldata frameworkVersion,
        string[] calldata baseModels
    ) external nonReentrant modelExists(modelId) onlyModelOwner(modelId) {
        provenance[versionId] = TrainingProvenance({
            modelId: modelId,
            versionId: versionId,
            datasetIds: datasetIds,
            trainingConfigUri: trainingConfigUri,
            trainingConfigHash: trainingConfigHash,
            trainingStarted: trainingStarted,
            trainingCompleted: trainingCompleted,
            computeProviderUri: computeProviderUri,
            computeJobId: computeJobId,
            frameworkVersion: frameworkVersion,
            baseModels: baseModels,
            trainer: msg.sender,
            verified: false
        });

        emit ProvenanceRecorded(modelId, versionId, computeJobId);
    }

    // ============ Access & Downloads ============

    /**
     * @notice Download/access a model (tracks downloads)
     */
    function downloadModel(bytes32 modelId) external nonReentrant modelExists(modelId) {
        Model storage model = models[modelId];

        // Check access
        if (model.accessLevel == AccessLevel.GATED && !hasAccess[modelId][msg.sender]) {
            revert AccessDenied();
        }
        if (model.accessLevel == AccessLevel.ENCRYPTED && !hasAccess[modelId][msg.sender]) {
            revert AccessDenied();
        }

        // Track download
        downloadCount[modelId][msg.sender]++;
        metrics[modelId].totalDownloads++;
        metrics[modelId].weeklyDownloads++;
        metrics[modelId].lastUpdated = block.timestamp;

        emit ModelDownloaded(modelId, msg.sender);
    }

    /**
     * @notice Grant access to a gated model
     */
    function grantAccess(bytes32 modelId, address user) 
        external 
        modelExists(modelId) 
        onlyModelOwner(modelId) 
    {
        hasAccess[modelId][user] = true;
        emit AccessGranted(modelId, user);
    }

    /**
     * @notice Star/unstar a model
     */
    function toggleStar(bytes32 modelId) external nonReentrant modelExists(modelId) {
        bool starred = !hasStarred[modelId][msg.sender];
        hasStarred[modelId][msg.sender] = starred;

        if (starred) {
            metrics[modelId].totalStars++;
        } else {
            if (metrics[modelId].totalStars > 0) {
                metrics[modelId].totalStars--;
            }
        }

        emit ModelStarred(modelId, msg.sender, starred);
    }

    // ============ Inference Endpoints ============

    /**
     * @notice Register an inference endpoint for a model
     */
    function createInferenceEndpoint(
        bytes32 modelId,
        bytes32 versionId,
        string calldata endpointUrl,
        uint256 pricePerRequest,
        address paymentToken
    ) external nonReentrant modelExists(modelId) returns (bytes32 endpointId) {
        endpointId = keccak256(abi.encodePacked(_nextEndpointId++, modelId, msg.sender, block.timestamp));

        endpoints[modelId].push(InferenceEndpoint({
            endpointId: endpointId,
            modelId: modelId,
            versionId: versionId,
            provider: msg.sender,
            endpointUrl: endpointUrl,
            pricePerRequest: pricePerRequest,
            paymentToken: paymentToken,
            isActive: true,
            createdAt: block.timestamp
        }));

        emit InferenceEndpointCreated(endpointId, modelId, msg.sender);
    }

    /**
     * @notice Request inference (pay and track)
     */
    function requestInference(bytes32 modelId, uint256 endpointIndex) 
        external 
        payable 
        nonReentrant 
        modelExists(modelId) 
    {
        InferenceEndpoint[] storage modelEndpoints = endpoints[modelId];
        if (endpointIndex >= modelEndpoints.length) revert EndpointNotFound();

        InferenceEndpoint storage endpoint = modelEndpoints[endpointIndex];
        if (!endpoint.isActive) revert EndpointInactive();

        // Check payment
        if (endpoint.paymentToken == address(0)) {
            if (msg.value < endpoint.pricePerRequest) revert InsufficientPayment();

            // Split payment
            uint256 protocolFee = (msg.value * inferenceFeePercentage) / 10000;
            uint256 providerPayment = msg.value - protocolFee;

            (bool success1,) = endpoint.provider.call{value: providerPayment}("");
            require(success1, "Provider payment failed");

            if (protocolFee > 0) {
                (bool success2,) = treasury.call{value: protocolFee}("");
                require(success2, "Treasury payment failed");
            }
        } else {
            IERC20 token = IERC20(endpoint.paymentToken);
            uint256 protocolFee = (endpoint.pricePerRequest * inferenceFeePercentage) / 10000;
            uint256 providerPayment = endpoint.pricePerRequest - protocolFee;

            token.safeTransferFrom(msg.sender, endpoint.provider, providerPayment);
            if (protocolFee > 0) {
                token.safeTransferFrom(msg.sender, treasury, protocolFee);
            }
        }

        metrics[modelId].totalInferences++;

        emit InferenceRequest(endpoint.endpointId, msg.sender, endpoint.pricePerRequest);
    }

    // ============ View Functions ============

    function _getAgentIdForAddress(address addr) internal view returns (uint256) {
        // Would query indexer or iterate in production
        return 0;
    }

    function getModel(bytes32 modelId) external view returns (Model memory) {
        return models[modelId];
    }

    function getModelVersions(bytes32 modelId) external view returns (ModelVersion[] memory) {
        return modelVersions[modelId];
    }

    function getLatestVersion(bytes32 modelId) external view returns (ModelVersion memory) {
        ModelVersion[] storage versions = modelVersions[modelId];
        for (uint256 i = versions.length; i > 0; i--) {
            if (versions[i - 1].isLatest) {
                return versions[i - 1];
            }
        }
        revert VersionNotFound();
    }

    function getProvenance(bytes32 versionId) external view returns (TrainingProvenance memory) {
        return provenance[versionId];
    }

    function getMetrics(bytes32 modelId) external view returns (ModelMetrics memory) {
        return metrics[modelId];
    }

    function getEndpoints(bytes32 modelId) external view returns (InferenceEndpoint[] memory) {
        return endpoints[modelId];
    }

    function getOrganizationModels(string calldata org) external view returns (bytes32[] memory) {
        return organizationModels[org];
    }

    function getTotalModels() external view returns (uint256) {
        return allModels.length;
    }

    function getAllModelIds(uint256 offset, uint256 limit) external view returns (bytes32[] memory) {
        uint256 end = offset + limit;
        if (end > allModels.length) end = allModels.length;
        if (offset >= end) return new bytes32[](0);

        bytes32[] memory result = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = allModels[i];
        }
        return result;
    }

    // ============ Admin ============

    function setComputeRegistry(address _computeRegistry) external onlyOwner {
        computeRegistry = _computeRegistry;
    }

    function setDatasetRegistry(address _datasetRegistry) external onlyOwner {
        datasetRegistry = _datasetRegistry;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setUploadFee(uint256 _fee) external onlyOwner {
        uploadFee = _fee;
    }

    function setInferenceFeePercentage(uint256 _percentage) external onlyOwner {
        require(_percentage <= 2000, "Max 20%");
        inferenceFeePercentage = _percentage;
    }

    function verifyModel(bytes32 modelId) external onlyOwner modelExists(modelId) {
        models[modelId].isVerified = true;
        emit ModelVerified(modelId, msg.sender);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    receive() external payable {}
}

