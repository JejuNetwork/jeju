// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title DistributedTrainingCoordinator
 * @notice Coordinates distributed training across Jeju network with Psyche/Solana bridge support
 * @dev Manages training runs, client registration, progress tracking, and reward distribution
 */
contract DistributedTrainingCoordinator is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================================
    // Types
    // ============================================================================

    enum RunState {
        Created,
        WarmingUp,
        Training,
        Checkpointing,
        Paused,
        Finished
    }

    struct TrainingRun {
        bytes32 runId;
        address creator;
        string environmentId;
        string modelCid;
        uint32 maxClients;
        uint32 minClients;
        uint32 currentEpoch;
        uint64 currentStep;
        uint32 targetEpochs;
        RunState state;
        uint256 createdAt;
        uint256 lastUpdatedAt;
        bytes32 latestCheckpointMerkle;
        string latestCheckpointCid;
    }

    struct TrainingClient {
        uint32 clientId;
        address evmAddress;
        bytes32 solanaKey;
        string gpuType;
        uint8 gpuCount;
        uint16 memoryGb;
        uint64 stepsContributed;
        uint256 rewardsClaimed;
        uint256 lastHealthCheck;
        bool active;
    }

    struct TrainingConfig {
        uint64 epochLengthMs;
        uint32 warmupEpochs;
        uint32 checkpointIntervalEpochs;
        uint256 learningRate; // scaled by 1e18
        uint32 batchSize;
        uint32 gradientAccumulationSteps;
        uint32 maxSeqLength;
        uint256 rewardPerStep; // reward per training step in rewardToken
    }

    struct ProgressReport {
        uint32 epoch;
        uint64 step;
        uint32 clientCount;
        bytes32 modelHash;
        bytes solanaSignature;
        uint256 timestamp;
    }

    struct Checkpoint {
        uint32 epoch;
        string cid;
        bytes32 merkleRoot;
        uint256 timestamp;
        address submitter;
    }

    // ============================================================================
    // State
    // ============================================================================

    /// @notice Reward token for training contributions
    IERC20 public rewardToken;

    /// @notice Counter for client IDs
    uint32 public nextClientId;

    /// @notice All training runs by ID
    mapping(bytes32 => TrainingRun) public runs;

    /// @notice Training config per run
    mapping(bytes32 => TrainingConfig) public configs;

    /// @notice Clients by ID
    mapping(uint32 => TrainingClient) public clients;

    /// @notice Client ID by address
    mapping(address => uint32) public clientIdByAddress;

    /// @notice Run participants: runId => clientId => joined
    mapping(bytes32 => mapping(uint32 => bool)) public runParticipants;

    /// @notice Run participant count
    mapping(bytes32 => uint32) public runParticipantCount;

    /// @notice Progress reports per run
    mapping(bytes32 => ProgressReport[]) public progressReports;

    /// @notice Checkpoints per run
    mapping(bytes32 => Checkpoint[]) public checkpoints;

    /// @notice Claimed rewards: runId => epoch => clientId => claimed
    mapping(bytes32 => mapping(uint32 => mapping(uint32 => bool))) public rewardsClaimed;

    /// @notice Reward merkle roots per epoch
    mapping(bytes32 => mapping(uint32 => bytes32)) public rewardMerkleRoots;

    /// @notice Authorized bridges for cross-chain updates
    mapping(address => bool) public authorizedBridges;

    // ============================================================================
    // Events
    // ============================================================================

    event RunCreated(
        bytes32 indexed runId,
        address indexed creator,
        string environmentId,
        string modelCid
    );

    event RunStateChanged(bytes32 indexed runId, RunState oldState, RunState newState);

    event ClientRegistered(
        uint32 indexed clientId,
        address indexed evmAddress,
        bytes32 solanaKey,
        string gpuType
    );

    event ClientJoinedRun(bytes32 indexed runId, uint32 indexed clientId);

    event ClientLeftRun(bytes32 indexed runId, uint32 indexed clientId);

    event ProgressReported(
        bytes32 indexed runId,
        uint32 epoch,
        uint64 step,
        uint32 clientCount
    );

    event CheckpointSubmitted(
        bytes32 indexed runId,
        uint32 epoch,
        string cid,
        bytes32 merkleRoot
    );

    event RewardsDistributed(
        bytes32 indexed runId,
        uint32 epoch,
        uint256 totalAmount
    );

    event RewardClaimed(
        bytes32 indexed runId,
        uint32 indexed clientId,
        uint32 epoch,
        uint256 amount
    );

    // ============================================================================
    // Modifiers
    // ============================================================================

    modifier onlyBridge() {
        require(authorizedBridges[msg.sender], "Not authorized bridge");
        _;
    }

    modifier onlyRunCreator(bytes32 runId) {
        require(runs[runId].creator == msg.sender, "Not run creator");
        _;
    }

    modifier runExists(bytes32 runId) {
        require(runs[runId].createdAt > 0, "Run does not exist");
        _;
    }

    modifier clientExists(uint32 clientId) {
        require(clients[clientId].evmAddress != address(0), "Client does not exist");
        _;
    }

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(address _rewardToken) Ownable(msg.sender) {
        rewardToken = IERC20(_rewardToken);
        nextClientId = 1;
    }

    // ============================================================================
    // Admin Functions
    // ============================================================================

    function setRewardToken(address _rewardToken) external onlyOwner {
        rewardToken = IERC20(_rewardToken);
    }

    function authorizeBridge(address bridge, bool authorized) external onlyOwner {
        authorizedBridges[bridge] = authorized;
    }

    // ============================================================================
    // Run Management
    // ============================================================================

    function createRun(
        bytes32 runId,
        string calldata environmentId,
        string calldata modelCid,
        uint32 targetEpochs,
        TrainingConfig calldata config
    ) external returns (bytes32) {
        require(runs[runId].createdAt == 0, "Run already exists");

        runs[runId] = TrainingRun({
            runId: runId,
            creator: msg.sender,
            environmentId: environmentId,
            modelCid: modelCid,
            maxClients: config.batchSize, // Use batch size as max clients
            minClients: 1,
            currentEpoch: 0,
            currentStep: 0,
            targetEpochs: targetEpochs,
            state: RunState.Created,
            createdAt: block.timestamp,
            lastUpdatedAt: block.timestamp,
            latestCheckpointMerkle: bytes32(0),
            latestCheckpointCid: ""
        });

        configs[runId] = config;

        emit RunCreated(runId, msg.sender, environmentId, modelCid);
        return runId;
    }

    function startRun(bytes32 runId) external onlyRunCreator(runId) runExists(runId) {
        TrainingRun storage run = runs[runId];
        require(run.state == RunState.Created, "Run not in created state");
        require(runParticipantCount[runId] >= run.minClients, "Not enough clients");

        RunState oldState = run.state;
        run.state = RunState.WarmingUp;
        run.lastUpdatedAt = block.timestamp;

        emit RunStateChanged(runId, oldState, RunState.WarmingUp);
    }

    function pauseRun(bytes32 runId) external onlyRunCreator(runId) runExists(runId) {
        TrainingRun storage run = runs[runId];
        require(
            run.state == RunState.WarmingUp || run.state == RunState.Training,
            "Cannot pause"
        );

        RunState oldState = run.state;
        run.state = RunState.Paused;
        run.lastUpdatedAt = block.timestamp;

        emit RunStateChanged(runId, oldState, RunState.Paused);
    }

    function resumeRun(bytes32 runId) external onlyRunCreator(runId) runExists(runId) {
        TrainingRun storage run = runs[runId];
        require(run.state == RunState.Paused, "Not paused");

        RunState oldState = run.state;
        run.state = RunState.Training;
        run.lastUpdatedAt = block.timestamp;

        emit RunStateChanged(runId, oldState, RunState.Training);
    }

    function finishRun(bytes32 runId) external onlyRunCreator(runId) runExists(runId) {
        TrainingRun storage run = runs[runId];

        RunState oldState = run.state;
        run.state = RunState.Finished;
        run.lastUpdatedAt = block.timestamp;

        emit RunStateChanged(runId, oldState, RunState.Finished);
    }

    // ============================================================================
    // Client Management
    // ============================================================================

    function registerClient(
        address evmAddress,
        bytes32 solanaKey,
        string calldata gpuType,
        uint8 gpuCount,
        uint16 memoryGb
    ) external returns (uint32) {
        require(clientIdByAddress[evmAddress] == 0, "Client already registered");

        uint32 clientId = nextClientId++;

        clients[clientId] = TrainingClient({
            clientId: clientId,
            evmAddress: evmAddress,
            solanaKey: solanaKey,
            gpuType: gpuType,
            gpuCount: gpuCount,
            memoryGb: memoryGb,
            stepsContributed: 0,
            rewardsClaimed: 0,
            lastHealthCheck: block.timestamp,
            active: true
        });

        clientIdByAddress[evmAddress] = clientId;

        emit ClientRegistered(clientId, evmAddress, solanaKey, gpuType);
        return clientId;
    }

    function joinRun(bytes32 runId) external runExists(runId) {
        uint32 clientId = clientIdByAddress[msg.sender];
        require(clientId > 0, "Not registered as client");
        require(!runParticipants[runId][clientId], "Already joined");

        TrainingRun storage run = runs[runId];
        require(
            run.state == RunState.Created || run.state == RunState.WarmingUp,
            "Cannot join now"
        );
        require(runParticipantCount[runId] < run.maxClients, "Run is full");

        runParticipants[runId][clientId] = true;
        runParticipantCount[runId]++;

        emit ClientJoinedRun(runId, clientId);
    }

    function leaveRun(bytes32 runId) external runExists(runId) {
        uint32 clientId = clientIdByAddress[msg.sender];
        require(clientId > 0, "Not registered as client");
        require(runParticipants[runId][clientId], "Not in run");

        runParticipants[runId][clientId] = false;
        runParticipantCount[runId]--;

        emit ClientLeftRun(runId, clientId);
    }

    function healthCheck(bytes32 runId, uint32 clientId) external clientExists(clientId) {
        require(clients[clientId].evmAddress == msg.sender, "Not client owner");
        require(runParticipants[runId][clientId], "Not in run");

        clients[clientId].lastHealthCheck = block.timestamp;
    }

    // ============================================================================
    // Progress Tracking (Bridge Interface)
    // ============================================================================

    function reportProgress(
        bytes32 runId,
        uint32 epoch,
        uint64 step,
        uint32 clientCount,
        bytes32 modelHash,
        bytes calldata solanaSignature
    ) external onlyBridge runExists(runId) {
        TrainingRun storage run = runs[runId];

        // Update run state if transitioning
        if (run.state == RunState.WarmingUp && epoch >= configs[runId].warmupEpochs) {
            RunState oldState = run.state;
            run.state = RunState.Training;
            emit RunStateChanged(runId, oldState, RunState.Training);
        }

        run.currentEpoch = epoch;
        run.currentStep = step;
        run.lastUpdatedAt = block.timestamp;

        progressReports[runId].push(ProgressReport({
            epoch: epoch,
            step: step,
            clientCount: clientCount,
            modelHash: modelHash,
            solanaSignature: solanaSignature,
            timestamp: block.timestamp
        }));

        emit ProgressReported(runId, epoch, step, clientCount);

        // Check if finished
        if (epoch >= run.targetEpochs) {
            RunState oldState = run.state;
            run.state = RunState.Finished;
            emit RunStateChanged(runId, oldState, RunState.Finished);
        }
    }

    function submitCheckpoint(
        bytes32 runId,
        string calldata checkpointCid,
        uint32 epoch,
        bytes32 merkleRoot
    ) external onlyBridge runExists(runId) {
        TrainingRun storage run = runs[runId];

        run.latestCheckpointCid = checkpointCid;
        run.latestCheckpointMerkle = merkleRoot;
        run.lastUpdatedAt = block.timestamp;

        checkpoints[runId].push(Checkpoint({
            epoch: epoch,
            cid: checkpointCid,
            merkleRoot: merkleRoot,
            timestamp: block.timestamp,
            submitter: msg.sender
        }));

        emit CheckpointSubmitted(runId, epoch, checkpointCid, merkleRoot);
    }

    // ============================================================================
    // Reward Distribution
    // ============================================================================

    function setRewardMerkleRoot(
        bytes32 runId,
        uint32 epoch,
        bytes32 merkleRoot
    ) external onlyBridge runExists(runId) {
        rewardMerkleRoots[runId][epoch] = merkleRoot;
    }

    function claimReward(
        bytes32 runId,
        uint32 epoch,
        uint256 amount,
        bytes32[] calldata merkleProof
    ) external nonReentrant runExists(runId) {
        uint32 clientId = clientIdByAddress[msg.sender];
        require(clientId > 0, "Not registered");
        require(!rewardsClaimed[runId][epoch][clientId], "Already claimed");

        bytes32 merkleRoot = rewardMerkleRoots[runId][epoch];
        require(merkleRoot != bytes32(0), "No rewards for epoch");

        // Verify merkle proof
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));
        require(MerkleProof.verify(merkleProof, merkleRoot, leaf), "Invalid proof");

        rewardsClaimed[runId][epoch][clientId] = true;
        clients[clientId].rewardsClaimed += amount;

        rewardToken.safeTransfer(msg.sender, amount);

        emit RewardClaimed(runId, clientId, epoch, amount);
    }

    function distributeRewards(
        bytes32 runId,
        uint32 epoch,
        address[] calldata recipients,
        uint256[] calldata amounts,
        bytes32 merkleRoot
    ) external onlyOwner runExists(runId) nonReentrant {
        require(recipients.length == amounts.length, "Length mismatch");

        rewardMerkleRoots[runId][epoch] = merkleRoot;

        uint256 totalAmount = 0;
        for (uint256 i = 0; i < recipients.length; i++) {
            totalAmount += amounts[i];
            rewardToken.safeTransfer(recipients[i], amounts[i]);

            uint32 clientId = clientIdByAddress[recipients[i]];
            if (clientId > 0) {
                clients[clientId].rewardsClaimed += amounts[i];
                rewardsClaimed[runId][epoch][clientId] = true;
            }
        }

        emit RewardsDistributed(runId, epoch, totalAmount);
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    function getRunState(bytes32 runId)
        external
        view
        returns (
            uint32 epoch,
            uint64 step,
            uint32 clientCount,
            uint32 lastCheckpointEpoch,
            uint256 totalRewardsDistributed
        )
    {
        TrainingRun storage run = runs[runId];
        Checkpoint[] storage runCheckpoints = checkpoints[runId];

        return (
            run.currentEpoch,
            run.currentStep,
            runParticipantCount[runId],
            runCheckpoints.length > 0 ? runCheckpoints[runCheckpoints.length - 1].epoch : 0,
            0 // Would need to track total rewards
        );
    }

    function getClientInfo(uint32 clientId)
        external
        view
        returns (
            address evmAddress,
            bytes32 solanaKey,
            string memory gpuType,
            uint8 gpuCount,
            uint16 memoryGb,
            uint64 stepsContributed,
            uint256 _rewardsClaimed
        )
    {
        TrainingClient storage client = clients[clientId];
        return (
            client.evmAddress,
            client.solanaKey,
            client.gpuType,
            client.gpuCount,
            client.memoryGb,
            client.stepsContributed,
            client.rewardsClaimed
        );
    }

    function getProgressReportCount(bytes32 runId) external view returns (uint256) {
        return progressReports[runId].length;
    }

    function getCheckpointCount(bytes32 runId) external view returns (uint256) {
        return checkpoints[runId].length;
    }

    function getLatestCheckpoint(bytes32 runId)
        external
        view
        returns (
            uint32 epoch,
            string memory cid,
            bytes32 merkleRoot,
            uint256 timestamp
        )
    {
        Checkpoint[] storage runCheckpoints = checkpoints[runId];
        require(runCheckpoints.length > 0, "No checkpoints");

        Checkpoint storage latest = runCheckpoints[runCheckpoints.length - 1];
        return (latest.epoch, latest.cid, latest.merkleRoot, latest.timestamp);
    }
}

