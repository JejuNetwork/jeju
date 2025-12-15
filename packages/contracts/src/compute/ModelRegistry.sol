// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title ModelRegistry
 * @notice On-chain registry for trained AI models
 * @dev Tracks model versions, IPFS hashes, HuggingFace repos, and TEE attestations
 *
 * Features:
 * - Register trained models with verifiable attestations
 * - Track model lineage (base model → LoRA adapter)
 * - Version management per archetype
 * - IPFS hash and HuggingFace repo linking
 * - TEE attestation for verifiable training
 */
contract ModelRegistry is Ownable, ReentrancyGuard {
    // =========================================================================
    // Types
    // =========================================================================

    enum ModelStatus {
        PENDING, // Uploaded but not verified
        ACTIVE, // Verified and available for use
        DEPRECATED, // Superseded by newer version
        REVOKED // Removed due to issues

    }

    struct Model {
        bytes32 modelId;
        string archetype; // e.g., "trader", "scammer", "degen"
        string baseModel; // e.g., "Qwen/Qwen2.5-7B-Instruct"
        uint256 version;
        bytes32 modelHash; // IPFS CID hash
        string hfRepo; // HuggingFace repository
        bytes32 attestationHash; // TEE attestation proof
        address trainer; // Address that submitted
        uint256 trainedAt;
        uint256 registeredAt;
        ModelStatus status;
        uint256 benchmarkScore; // 0-10000 (basis points)
        bytes32 dataHash; // Hash of training data used
        bytes32 parentModelId; // Previous version (if upgrade)
    }

    struct ArchetypeInfo {
        uint256 latestVersion;
        bytes32 activeModelId;
        uint256 modelCount;
    }

    // =========================================================================
    // State
    // =========================================================================

    /// @notice All registered models
    mapping(bytes32 => Model) public models;

    /// @notice Models by archetype
    mapping(string => bytes32[]) public archetypeModels;

    /// @notice Archetype info
    mapping(string => ArchetypeInfo) public archetypes;

    /// @notice All model IDs
    bytes32[] public allModelIds;

    /// @notice Authorized trainers (TEE operators)
    mapping(address => bool) public authorizedTrainers;

    /// @notice Minimum benchmark score to activate (basis points)
    uint256 public minBenchmarkScore = 6000; // 60%

    /// @notice Whether training is permissionless
    bool public permissionlessTraining = false;

    // =========================================================================
    // Events
    // =========================================================================

    event ModelRegistered(
        bytes32 indexed modelId,
        string archetype,
        uint256 version,
        bytes32 modelHash,
        string hfRepo,
        address indexed trainer
    );

    event ModelActivated(bytes32 indexed modelId, string archetype, uint256 version);
    event ModelDeprecated(bytes32 indexed modelId, bytes32 replacedBy);
    event ModelRevoked(bytes32 indexed modelId, string reason);
    event BenchmarkUpdated(bytes32 indexed modelId, uint256 score);
    event TrainerAuthorized(address indexed trainer, bool authorized);
    event MinBenchmarkUpdated(uint256 oldScore, uint256 newScore);

    // =========================================================================
    // Errors
    // =========================================================================

    error ModelAlreadyExists();
    error ModelNotFound();
    error InvalidArchetype();
    error InvalidModelHash();
    error UnauthorizedTrainer();
    error BenchmarkTooLow(uint256 score, uint256 required);
    error ModelNotPending();
    error ModelNotActive();
    error InvalidAttestation();

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor() Ownable(msg.sender) {}

    // =========================================================================
    // Model Registration
    // =========================================================================

    /**
     * @notice Register a new trained model
     * @param archetype Model archetype (e.g., "trader")
     * @param baseModel Base model identifier
     * @param modelHash IPFS CID of the model weights
     * @param hfRepo HuggingFace repository URL
     * @param attestationHash TEE attestation proof
     * @param dataHash Hash of training data
     * @param benchmarkScore Initial benchmark score (0-10000)
     */
    function registerModel(
        string calldata archetype,
        string calldata baseModel,
        bytes32 modelHash,
        string calldata hfRepo,
        bytes32 attestationHash,
        bytes32 dataHash,
        uint256 benchmarkScore
    ) external nonReentrant returns (bytes32) {
        // Validate trainer authorization
        if (!permissionlessTraining && !authorizedTrainers[msg.sender]) {
            revert UnauthorizedTrainer();
        }

        if (bytes(archetype).length == 0) revert InvalidArchetype();
        if (modelHash == bytes32(0)) revert InvalidModelHash();

        // Generate model ID
        bytes32 modelId = keccak256(abi.encodePacked(archetype, modelHash, block.timestamp, msg.sender));

        if (models[modelId].registeredAt != 0) revert ModelAlreadyExists();

        // Increment version
        ArchetypeInfo storage info = archetypes[archetype];
        uint256 newVersion = info.latestVersion + 1;

        // Get parent model if upgrading
        bytes32 parentId = info.activeModelId;

        // Create model record
        Model storage model = models[modelId];
        model.modelId = modelId;
        model.archetype = archetype;
        model.baseModel = baseModel;
        model.version = newVersion;
        model.modelHash = modelHash;
        model.hfRepo = hfRepo;
        model.attestationHash = attestationHash;
        model.trainer = msg.sender;
        model.trainedAt = block.timestamp;
        model.registeredAt = block.timestamp;
        model.status = ModelStatus.PENDING;
        model.benchmarkScore = benchmarkScore;
        model.dataHash = dataHash;
        model.parentModelId = parentId;

        // Update indices
        archetypeModels[archetype].push(modelId);
        allModelIds.push(modelId);
        info.latestVersion = newVersion;
        info.modelCount++;

        emit ModelRegistered(modelId, archetype, newVersion, modelHash, hfRepo, msg.sender);

        // Auto-activate if benchmark meets threshold
        if (benchmarkScore >= minBenchmarkScore) {
            _activateModel(modelId);
        }

        return modelId;
    }

    /**
     * @notice Activate a pending model after verification
     * @param modelId Model to activate
     */
    function activateModel(bytes32 modelId) external {
        Model storage model = models[modelId];
        if (model.registeredAt == 0) revert ModelNotFound();
        if (model.status != ModelStatus.PENDING) revert ModelNotPending();

        // Only trainer or owner can activate
        if (msg.sender != model.trainer && msg.sender != owner()) {
            revert UnauthorizedTrainer();
        }

        if (model.benchmarkScore < minBenchmarkScore) {
            revert BenchmarkTooLow(model.benchmarkScore, minBenchmarkScore);
        }

        _activateModel(modelId);
    }

    /**
     * @dev Internal activation logic
     */
    function _activateModel(bytes32 modelId) internal {
        Model storage model = models[modelId];

        // Deprecate previous active model
        ArchetypeInfo storage info = archetypes[model.archetype];
        if (info.activeModelId != bytes32(0)) {
            Model storage oldModel = models[info.activeModelId];
            oldModel.status = ModelStatus.DEPRECATED;
            emit ModelDeprecated(info.activeModelId, modelId);
        }

        // Activate new model
        model.status = ModelStatus.ACTIVE;
        info.activeModelId = modelId;

        emit ModelActivated(modelId, model.archetype, model.version);
    }

    /**
     * @notice Update benchmark score for a model
     * @param modelId Model to update
     * @param score New benchmark score (0-10000)
     */
    function updateBenchmark(bytes32 modelId, uint256 score) external {
        Model storage model = models[modelId];
        if (model.registeredAt == 0) revert ModelNotFound();

        // Only trainer or owner can update
        if (msg.sender != model.trainer && msg.sender != owner()) {
            revert UnauthorizedTrainer();
        }

        model.benchmarkScore = score;
        emit BenchmarkUpdated(modelId, score);
    }

    /**
     * @notice Revoke a model (remove from active use)
     * @param modelId Model to revoke
     * @param reason Reason for revocation
     */
    function revokeModel(bytes32 modelId, string calldata reason) external onlyOwner {
        Model storage model = models[modelId];
        if (model.registeredAt == 0) revert ModelNotFound();

        model.status = ModelStatus.REVOKED;

        // If this was the active model, clear it
        ArchetypeInfo storage info = archetypes[model.archetype];
        if (info.activeModelId == modelId) {
            info.activeModelId = bytes32(0);
        }

        emit ModelRevoked(modelId, reason);
    }

    // =========================================================================
    // View Functions
    // =========================================================================

    /**
     * @notice Get the active model for an archetype
     */
    function getActiveModel(string calldata archetype) external view returns (bytes32 modelId, Model memory model) {
        modelId = archetypes[archetype].activeModelId;
        if (modelId != bytes32(0)) {
            model = models[modelId];
        }
    }

    /**
     * @notice Get model by ID
     */
    function getModel(bytes32 modelId) external view returns (Model memory) {
        return models[modelId];
    }

    /**
     * @notice Get all models for an archetype
     */
    function getArchetypeModels(string calldata archetype) external view returns (bytes32[] memory) {
        return archetypeModels[archetype];
    }

    /**
     * @notice Get archetype info
     */
    function getArchetypeInfo(string calldata archetype) external view returns (ArchetypeInfo memory) {
        return archetypes[archetype];
    }

    /**
     * @notice Get total model count
     */
    function getModelCount() external view returns (uint256) {
        return allModelIds.length;
    }

    /**
     * @notice Check if a model hash exists
     */
    function modelHashExists(bytes32 modelHash) external view returns (bool) {
        for (uint256 i = 0; i < allModelIds.length; i++) {
            if (models[allModelIds[i]].modelHash == modelHash) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Verify model attestation (placeholder for real verification)
     */
    function verifyAttestation(bytes32 modelId) external view returns (bool) {
        Model storage model = models[modelId];
        if (model.registeredAt == 0) return false;
        // In production, this would verify the TEE attestation
        return model.attestationHash != bytes32(0);
    }

    // =========================================================================
    // Admin Functions
    // =========================================================================

    /**
     * @notice Authorize or revoke a trainer
     */
    function setTrainerAuthorized(address trainer, bool authorized) external onlyOwner {
        authorizedTrainers[trainer] = authorized;
        emit TrainerAuthorized(trainer, authorized);
    }

    /**
     * @notice Set minimum benchmark score for activation
     */
    function setMinBenchmarkScore(uint256 score) external onlyOwner {
        uint256 oldScore = minBenchmarkScore;
        minBenchmarkScore = score;
        emit MinBenchmarkUpdated(oldScore, score);
    }

    /**
     * @notice Enable/disable permissionless training
     */
    function setPermissionlessTraining(bool enabled) external onlyOwner {
        permissionlessTraining = enabled;
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
