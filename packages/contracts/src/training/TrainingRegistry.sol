// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITrainingCoordinator} from "./interfaces/ITrainingCoordinator.sol";
import {MPCKeyRegistry} from "../kms/MPCKeyRegistry.sol";

/**
 * @title TrainingRegistry
 * @notice Central registry for training runs, models, and TEE configuration
 */
contract TrainingRegistry is Ownable, ReentrancyGuard {
    enum ModelStatus {
        Draft,
        Training,
        Checkpoint,
        Completed,
        Deprecated,
        Revoked
    }

    enum TEEProvider {
        None,
        Phala,
        Azure,
        AWS,
        Intel,
        Other
    }


    struct TrainingRunMetadata {
        bytes32 runId;
        address creator;
        string name;
        string description;
        string baseModelHfRepo;
        bytes32 baseModelHash;
        uint64 createdAt;
        uint64 completedAt;
        ModelStatus status;
        bool isPrivate;
    }

    struct ModelCheckpoint {
        bytes32 runId;
        uint32 step;
        uint16 epoch;
        string hfRepo;
        bytes32 modelHash;
        string ipfsCid;
        uint64 timestamp;
        address submitter;
        uint256 benchmarkScore;
        bool verified;
    }

    struct TEEConfig {
        TEEProvider provider;
        bytes32 requiredEnclaveId;
        uint64 minAttestationTimestamp;
        bytes32[] authorizedEnclaves;
        bool requireFreshAttestation;
    }

    struct PrivateRunConfig {
        bytes32 mpcKeyId;
        bytes32 dataKeyId;
        TEEConfig teeConfig;
        address[] authorizedParticipants;
        bool participantAllowlistEnabled;
    }

    struct TrainingDataset {
        string name;
        string description;
        bytes32 encryptedMetadataHash;
        string ipfsCid;
        uint64 recordCount;
        address owner;
        bool isPublic;
    }

    ITrainingCoordinator public coordinator;
    MPCKeyRegistry public mpcKeyRegistry;
    mapping(bytes32 => TrainingRunMetadata) public runMetadata;
    mapping(bytes32 => ModelCheckpoint[]) public runCheckpoints;
    mapping(bytes32 => PrivateRunConfig) public privateRunConfigs;
    mapping(bytes32 => mapping(address => bool)) public participantAllowlist;
    bytes32[] public allRuns;
    mapping(address => bytes32[]) public runsByCreator;
    mapping(address => TrainingDataset[]) public datasetsByOwner;
    bytes32[] public allDatasetIds;
    mapping(bytes32 => TrainingDataset) public datasets;
    mapping(TEEProvider => bytes32[]) public approvedEnclaves;
    mapping(bytes32 => bytes32) public latestCheckpointHash;
    mapping(address => bool) public benchmarkVerifiers;

    event TrainingRunRegistered(
        bytes32 indexed runId,
        address indexed creator,
        string name,
        string baseModelHfRepo,
        bool isPrivate
    );

    event ModelCheckpointSubmitted(
        bytes32 indexed runId,
        uint32 step,
        bytes32 modelHash,
        string hfRepo,
        address submitter
    );

    event CheckpointVerified(
        bytes32 indexed runId,
        bytes32 modelHash,
        uint256 benchmarkScore,
        address verifier
    );

    event RunStatusUpdated(bytes32 indexed runId, ModelStatus oldStatus, ModelStatus newStatus);

    event PrivateRunConfigured(
        bytes32 indexed runId,
        bytes32 mpcKeyId,
        TEEProvider teeProvider,
        bytes32 requiredEnclaveId
    );

    event ParticipantAuthorized(bytes32 indexed runId, address participant);
    event ParticipantRevoked(bytes32 indexed runId, address participant);

    event DatasetRegistered(
        bytes32 indexed datasetId,
        address indexed owner,
        string name,
        bool isPublic
    );

    event EnclaveApproved(TEEProvider provider, bytes32 enclaveId);
    event EnclaveRevoked(TEEProvider provider, bytes32 enclaveId);

    // ============ Errors ============

    error RunNotFound();
    error RunAlreadyExists();
    error NotRunCreator();
    error InvalidStatus();
    error NotAuthorizedParticipant();
    error InvalidCheckpoint();
    error DatasetNotFound();
    error NotBenchmarkVerifier();
    error EnclaveNotApproved();
    error InvalidMPCKey();
    error TEERequired();

    // ============ Modifiers ============

    modifier runExists(bytes32 runId) {
        if (runMetadata[runId].createdAt == 0) revert RunNotFound();
        _;
    }

    modifier onlyRunCreator(bytes32 runId) {
        if (runMetadata[runId].creator != msg.sender && msg.sender != owner()) {
            revert NotRunCreator();
        }
        _;
    }

    modifier onlyVerifier() {
        if (!benchmarkVerifiers[msg.sender] && msg.sender != owner()) {
            revert NotBenchmarkVerifier();
        }
        _;
    }

    // ============ Constructor ============

    constructor(
        address _coordinator,
        address _mpcKeyRegistry,
        address initialOwner
    ) Ownable(initialOwner) {
        coordinator = ITrainingCoordinator(_coordinator);
        mpcKeyRegistry = MPCKeyRegistry(_mpcKeyRegistry);
        benchmarkVerifiers[initialOwner] = true;
    }

    // ============ Run Registration ============

    /**
     * @notice Register a new training run (public)
     * @param runId Unique run identifier
     * @param name Human-readable name
     * @param description Run description
     * @param baseModelHfRepo Base model HuggingFace repo
     * @param baseModelHash Base model hash
     */
    function registerRun(
        bytes32 runId,
        string calldata name,
        string calldata description,
        string calldata baseModelHfRepo,
        bytes32 baseModelHash
    ) external nonReentrant {
        if (runMetadata[runId].createdAt != 0) revert RunAlreadyExists();

        runMetadata[runId] = TrainingRunMetadata({
            runId: runId,
            creator: msg.sender,
            name: name,
            description: description,
            baseModelHfRepo: baseModelHfRepo,
            baseModelHash: baseModelHash,
            createdAt: uint64(block.timestamp),
            completedAt: 0,
            status: ModelStatus.Draft,
            isPrivate: false
        });

        allRuns.push(runId);
        runsByCreator[msg.sender].push(runId);

        emit TrainingRunRegistered(runId, msg.sender, name, baseModelHfRepo, false);
    }

    /**
     * @notice Register a private training run with TEE requirements
     * @param runId Unique run identifier
     * @param name Human-readable name
     * @param description Run description
     * @param baseModelHfRepo Base model HuggingFace repo
     * @param baseModelHash Base model hash
     * @param privateConfig Private run configuration
     */
    function registerPrivateRun(
        bytes32 runId,
        string calldata name,
        string calldata description,
        string calldata baseModelHfRepo,
        bytes32 baseModelHash,
        PrivateRunConfig calldata privateConfig
    ) external nonReentrant {
        if (runMetadata[runId].createdAt != 0) revert RunAlreadyExists();

        // Validate MPC key
        if (privateConfig.mpcKeyId != bytes32(0)) {
            MPCKeyRegistry.KeyMetadata memory key = mpcKeyRegistry.getKey(privateConfig.mpcKeyId);
            if (key.createdAt == 0 || key.status != MPCKeyRegistry.KeyStatus.ACTIVE) {
                revert InvalidMPCKey();
            }
        }

        // Validate TEE config
        if (privateConfig.teeConfig.provider != TEEProvider.None) {
            if (privateConfig.teeConfig.requiredEnclaveId != bytes32(0)) {
                if (!_isEnclaveApproved(
                    privateConfig.teeConfig.provider,
                    privateConfig.teeConfig.requiredEnclaveId
                )) {
                    revert EnclaveNotApproved();
                }
            }
        }

        runMetadata[runId] = TrainingRunMetadata({
            runId: runId,
            creator: msg.sender,
            name: name,
            description: description,
            baseModelHfRepo: baseModelHfRepo,
            baseModelHash: baseModelHash,
            createdAt: uint64(block.timestamp),
            completedAt: 0,
            status: ModelStatus.Draft,
            isPrivate: true
        });

        privateRunConfigs[runId] = privateConfig;

        // Set up participant allowlist
        if (privateConfig.participantAllowlistEnabled) {
            for (uint256 i = 0; i < privateConfig.authorizedParticipants.length; i++) {
                participantAllowlist[runId][privateConfig.authorizedParticipants[i]] = true;
                emit ParticipantAuthorized(runId, privateConfig.authorizedParticipants[i]);
            }
        }

        allRuns.push(runId);
        runsByCreator[msg.sender].push(runId);

        emit TrainingRunRegistered(runId, msg.sender, name, baseModelHfRepo, true);
        emit PrivateRunConfigured(
            runId,
            privateConfig.mpcKeyId,
            privateConfig.teeConfig.provider,
            privateConfig.teeConfig.requiredEnclaveId
        );
    }

    // ============ Checkpoint Management ============

    /**
     * @notice Submit a model checkpoint
     * @param runId Run ID
     * @param step Training step
     * @param epoch Training epoch
     * @param hfRepo HuggingFace repo URL
     * @param modelHash Model hash (IPFS)
     * @param ipfsCid IPFS CID of model
     */
    function submitCheckpoint(
        bytes32 runId,
        uint32 step,
        uint16 epoch,
        string calldata hfRepo,
        bytes32 modelHash,
        string calldata ipfsCid
    ) external nonReentrant runExists(runId) {
        TrainingRunMetadata storage meta = runMetadata[runId];

        // For private runs, verify participant is authorized
        if (meta.isPrivate) {
            PrivateRunConfig storage config = privateRunConfigs[runId];
            if (config.participantAllowlistEnabled && !participantAllowlist[runId][msg.sender]) {
                revert NotAuthorizedParticipant();
            }
        }

        ModelCheckpoint memory checkpoint = ModelCheckpoint({
            runId: runId,
            step: step,
            epoch: epoch,
            hfRepo: hfRepo,
            modelHash: modelHash,
            ipfsCid: ipfsCid,
            timestamp: uint64(block.timestamp),
            submitter: msg.sender,
            benchmarkScore: 0,
            verified: false
        });

        runCheckpoints[runId].push(checkpoint);
        latestCheckpointHash[runId] = modelHash;

        // Update status to checkpoint if training
        if (meta.status == ModelStatus.Training || meta.status == ModelStatus.Draft) {
            ModelStatus oldStatus = meta.status;
            meta.status = ModelStatus.Checkpoint;
            emit RunStatusUpdated(runId, oldStatus, ModelStatus.Checkpoint);
        }

        emit ModelCheckpointSubmitted(runId, step, modelHash, hfRepo, msg.sender);
    }

    /**
     * @notice Verify a checkpoint with benchmark score
     * @param runId Run ID
     * @param checkpointIndex Index of checkpoint to verify
     * @param benchmarkScore Benchmark score (0-10000 basis points)
     */
    function verifyCheckpoint(
        bytes32 runId,
        uint256 checkpointIndex,
        uint256 benchmarkScore
    ) external onlyVerifier runExists(runId) {
        if (checkpointIndex >= runCheckpoints[runId].length) revert InvalidCheckpoint();

        ModelCheckpoint storage checkpoint = runCheckpoints[runId][checkpointIndex];
        checkpoint.verified = true;
        checkpoint.benchmarkScore = benchmarkScore;

        emit CheckpointVerified(runId, checkpoint.modelHash, benchmarkScore, msg.sender);
    }

    // ============ Status Management ============

    /**
     * @notice Update run status
     * @param runId Run ID
     * @param newStatus New status
     */
    function updateStatus(bytes32 runId, ModelStatus newStatus) external runExists(runId) onlyRunCreator(runId) {
        TrainingRunMetadata storage meta = runMetadata[runId];
        ModelStatus oldStatus = meta.status;

        // Validate status transitions
        if (newStatus == ModelStatus.Completed) {
            meta.completedAt = uint64(block.timestamp);
        }

        meta.status = newStatus;
        emit RunStatusUpdated(runId, oldStatus, newStatus);
    }

    // ============ Participant Management ============

    /**
     * @notice Authorize a participant for a private run
     * @param runId Run ID
     * @param participant Address to authorize
     */
    function authorizeParticipant(bytes32 runId, address participant) external runExists(runId) onlyRunCreator(runId) {
        if (!runMetadata[runId].isPrivate) revert InvalidStatus();

        participantAllowlist[runId][participant] = true;
        emit ParticipantAuthorized(runId, participant);
    }

    /**
     * @notice Revoke a participant from a private run
     * @param runId Run ID
     * @param participant Address to revoke
     */
    function revokeParticipant(bytes32 runId, address participant) external runExists(runId) onlyRunCreator(runId) {
        participantAllowlist[runId][participant] = false;
        emit ParticipantRevoked(runId, participant);
    }

    /**
     * @notice Check if participant is authorized for a run
     * @param runId Run ID
     * @param participant Address to check
     */
    function isAuthorizedParticipant(bytes32 runId, address participant) external view returns (bool) {
        TrainingRunMetadata storage meta = runMetadata[runId];

        // Public runs allow anyone
        if (!meta.isPrivate) return true;

        // Check allowlist
        PrivateRunConfig storage config = privateRunConfigs[runId];
        if (!config.participantAllowlistEnabled) return true;

        return participantAllowlist[runId][participant];
    }

    // ============ Dataset Management ============

    /**
     * @notice Register a training dataset
     * @param datasetId Unique dataset identifier
     * @param name Dataset name
     * @param description Dataset description
     * @param encryptedMetadataHash Hash of encrypted metadata
     * @param ipfsCid IPFS CID of dataset
     * @param recordCount Number of records
     * @param isPublic Whether dataset is publicly accessible
     */
    function registerDataset(
        bytes32 datasetId,
        string calldata name,
        string calldata description,
        bytes32 encryptedMetadataHash,
        string calldata ipfsCid,
        uint64 recordCount,
        bool isPublic
    ) external nonReentrant {
        if (datasets[datasetId].owner != address(0)) revert RunAlreadyExists();

        TrainingDataset memory dataset = TrainingDataset({
            name: name,
            description: description,
            encryptedMetadataHash: encryptedMetadataHash,
            ipfsCid: ipfsCid,
            recordCount: recordCount,
            owner: msg.sender,
            isPublic: isPublic
        });

        datasets[datasetId] = dataset;
        datasetsByOwner[msg.sender].push(dataset);
        allDatasetIds.push(datasetId);

        emit DatasetRegistered(datasetId, msg.sender, name, isPublic);
    }

    // ============ View Functions ============

    /**
     * @notice Get run metadata
     */
    function getRunMetadata(bytes32 runId) external view returns (TrainingRunMetadata memory) {
        return runMetadata[runId];
    }

    /**
     * @notice Get run checkpoints
     */
    function getRunCheckpoints(bytes32 runId) external view returns (ModelCheckpoint[] memory) {
        return runCheckpoints[runId];
    }

    /**
     * @notice Get latest checkpoint for a run
     */
    function getLatestCheckpoint(bytes32 runId) external view returns (ModelCheckpoint memory) {
        ModelCheckpoint[] storage checkpoints = runCheckpoints[runId];
        if (checkpoints.length == 0) revert InvalidCheckpoint();
        return checkpoints[checkpoints.length - 1];
    }

    /**
     * @notice Get checkpoint count for a run
     */
    function getCheckpointCount(bytes32 runId) external view returns (uint256) {
        return runCheckpoints[runId].length;
    }

    /**
     * @notice Get private run configuration
     */
    function getPrivateRunConfig(bytes32 runId) external view returns (PrivateRunConfig memory) {
        return privateRunConfigs[runId];
    }

    /**
     * @notice Get TEE config for a private run
     */
    function getTEEConfig(bytes32 runId) external view returns (TEEConfig memory) {
        return privateRunConfigs[runId].teeConfig;
    }

    /**
     * @notice Get runs by creator
     */
    function getRunsByCreator(address creator) external view returns (bytes32[] memory) {
        return runsByCreator[creator];
    }

    /**
     * @notice Get all run count
     */
    function getRunCount() external view returns (uint256) {
        return allRuns.length;
    }

    /**
     * @notice Get approved enclaves for a TEE provider
     */
    function getApprovedEnclaves(TEEProvider provider) external view returns (bytes32[] memory) {
        return approvedEnclaves[provider];
    }

    /**
     * @notice Get dataset info
     */
    function getDataset(bytes32 datasetId) external view returns (TrainingDataset memory) {
        return datasets[datasetId];
    }

    /**
     * @notice Get datasets by owner
     */
    function getDatasetsByOwner(address datasetOwner) external view returns (TrainingDataset[] memory) {
        return datasetsByOwner[datasetOwner];
    }

    // ============ Internal Functions ============

    function _isEnclaveApproved(TEEProvider provider, bytes32 enclaveId) internal view returns (bool) {
        bytes32[] storage enclaves = approvedEnclaves[provider];
        for (uint256 i = 0; i < enclaves.length; i++) {
            if (enclaves[i] == enclaveId) return true;
        }
        return false;
    }

    // ============ Admin Functions ============

    /**
     * @notice Approve a TEE enclave
     */
    function approveEnclave(TEEProvider provider, bytes32 enclaveId) external onlyOwner {
        approvedEnclaves[provider].push(enclaveId);
        emit EnclaveApproved(provider, enclaveId);
    }

    /**
     * @notice Revoke a TEE enclave
     */
    function revokeEnclave(TEEProvider provider, bytes32 enclaveId) external onlyOwner {
        bytes32[] storage enclaves = approvedEnclaves[provider];
        for (uint256 i = 0; i < enclaves.length; i++) {
            if (enclaves[i] == enclaveId) {
                enclaves[i] = enclaves[enclaves.length - 1];
                enclaves.pop();
                emit EnclaveRevoked(provider, enclaveId);
                break;
            }
        }
    }

    /**
     * @notice Set benchmark verifier
     */
    function setBenchmarkVerifier(address verifier, bool authorized) external onlyOwner {
        benchmarkVerifiers[verifier] = authorized;
    }

    /**
     * @notice Update coordinator
     */
    function setCoordinator(address _coordinator) external onlyOwner {
        coordinator = ITrainingCoordinator(_coordinator);
    }

    /**
     * @notice Update MPC key registry
     */
    function setMPCKeyRegistry(address _mpcKeyRegistry) external onlyOwner {
        mpcKeyRegistry = MPCKeyRegistry(_mpcKeyRegistry);
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

