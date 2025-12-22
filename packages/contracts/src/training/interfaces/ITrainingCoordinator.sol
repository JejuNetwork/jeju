// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title ITrainingCoordinator
 * @notice Interface for the decentralized training coordinator
 * @dev Ported from Psyche's Solana coordinator to EVM
 */
interface ITrainingCoordinator {
    // ============ Enums ============

    enum RunState {
        Uninitialized,
        WaitingForMembers,
        Warmup,
        RoundTrain,
        RoundWitness,
        Cooldown,
        Finished,
        Paused
    }

    enum ClientState {
        Healthy,
        Dropped,
        Withdrawn,
        Ejected
    }

    enum PrivacyMode {
        Public,
        Private
    }

    // ============ Structs ============

    struct CoordinatorConfig {
        uint64 warmupTime;
        uint64 cooldownTime;
        uint64 maxRoundTrainTime;
        uint64 roundWitnessTime;
        uint64 epochTime;
        uint64 globalBatchSizeWarmupTokens;
        uint32 totalSteps;
        uint16 initMinClients;
        uint16 minClients;
        uint16 witnessNodes;
        uint16 globalBatchSizeStart;
        uint16 globalBatchSizeEnd;
        uint8 verificationPercent;
        uint8 waitingForMembersExtraTime;
    }

    struct ModelConfig {
        bytes32 modelHash;
        string hfRepo;
        uint32 maxSeqLen;
        uint32 coldStartWarmupSteps;
    }

    struct Client {
        address addr;
        bytes32 p2pEndpointId;
        ClientState state;
        uint32 exitedHeight;
        uint64 joinedAt;
    }

    struct Round {
        bytes32[] witnessProofs;
        bytes32 participantBloom;
        bytes32 broadcastMerkle;
        uint64 dataIndex;
        uint64 randomSeed;
        uint32 height;
        uint16 clientsLen;
        uint16 tieBreaker;
    }

    struct WitnessSubmission {
        bytes32 participantBloom;
        bytes32 broadcastBloom;
        bytes32 broadcastMerkle;
        uint32 step;
        uint64 tokensPerSec;
        uint64 bandwidthPerSec;
        uint32 loss;
    }

    // ============ Events ============

    event RunCreated(
        bytes32 indexed runId,
        address indexed creator,
        string hfRepo,
        PrivacyMode privacyMode
    );

    event RunConfigured(bytes32 indexed runId, CoordinatorConfig config);

    event ClientJoined(
        bytes32 indexed runId,
        address indexed client,
        bytes32 p2pEndpointId,
        uint16 clientIndex
    );

    event ClientExited(
        bytes32 indexed runId,
        address indexed client,
        ClientState exitState
    );

    event StateTransition(
        bytes32 indexed runId,
        RunState oldState,
        RunState newState,
        uint64 timestamp
    );

    event RoundStarted(
        bytes32 indexed runId,
        uint32 roundHeight,
        uint64 dataIndex,
        uint64 randomSeed
    );

    event WitnessSubmitted(
        bytes32 indexed runId,
        address indexed witness,
        uint32 roundHeight,
        bytes32 participantBloom
    );

    event EpochCompleted(
        bytes32 indexed runId,
        uint16 epoch,
        uint32 stepsCompleted
    );

    event CheckpointSubmitted(
        bytes32 indexed runId,
        bytes32 modelHash,
        string hfRepo,
        address submitter
    );

    event RunPaused(bytes32 indexed runId, address pauser);
    event RunResumed(bytes32 indexed runId, address resumer);
    event RunFinished(bytes32 indexed runId, uint32 totalSteps);

    // ============ Core Functions ============

    function createRun(
        bytes32 runId,
        CoordinatorConfig calldata config,
        ModelConfig calldata model,
        PrivacyMode privacyMode,
        bytes32 mpcKeyId
    ) external payable;

    function joinRun(bytes32 runId, bytes32 p2pEndpointId) external;

    function tick(bytes32 runId) external;

    function submitWitness(
        bytes32 runId,
        WitnessSubmission calldata submission,
        bytes calldata proof
    ) external;

    function submitWarmupWitness(
        bytes32 runId,
        WitnessSubmission calldata submission
    ) external;

    function submitHealthCheck(
        bytes32 runId,
        uint16[] calldata unhealthyIndices,
        bytes32[] calldata committeeProofs
    ) external;

    function submitCheckpoint(
        bytes32 runId,
        bytes32 modelHash,
        string calldata hfRepo
    ) external;

    function withdrawFromRun(bytes32 runId) external;

    function pauseRun(bytes32 runId) external;

    function resumeRun(bytes32 runId) external;

    // ============ View Functions ============

    function getRunState(bytes32 runId) external view returns (RunState);

    function getRunConfig(bytes32 runId) external view returns (CoordinatorConfig memory);

    function getRunModel(bytes32 runId) external view returns (ModelConfig memory);

    function getClients(bytes32 runId) external view returns (Client[] memory);

    function getClientCount(bytes32 runId) external view returns (uint16);

    function getCurrentRound(bytes32 runId) external view returns (Round memory);

    function getEpoch(bytes32 runId) external view returns (uint16);

    function getStep(bytes32 runId) external view returns (uint32);

    function isClientInRun(bytes32 runId, address client) external view returns (bool);

    function getWitnessQuorum(bytes32 runId) external view returns (uint16);
}

