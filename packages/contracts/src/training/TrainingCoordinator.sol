// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITrainingCoordinator} from "./interfaces/ITrainingCoordinator.sol";
import {ComputeRegistry} from "../compute/ComputeRegistry.sol";
import {MPCKeyRegistry} from "../kms/MPCKeyRegistry.sol";

/**
 * @title TrainingCoordinator
 * @notice Decentralized training run coordinator (EVM port of Psyche)
 */
contract TrainingCoordinator is ITrainingCoordinator, Ownable, ReentrancyGuard {
    uint16 public constant MAX_CLIENTS = 256;
    uint8 public constant MAX_WITNESSES = 32;
    uint8 public constant NUM_STORED_ROUNDS = 4;
    uint8 public constant BLOOM_FALSE_RATE_PERCENT = 1;
    uint8 public constant WITNESS_QUORUM_PERCENT = 67;

    struct EpochState {
        Round[4] rounds;
        uint32 roundsHead;
        uint32 startStep;
        uint32 lastStep;
        uint64 startTimestamp;
        bool firstRound;
        bool coldStartEpoch;
    }

    struct Progress {
        uint16 epoch;
        uint32 step;
        uint64 epochStartDataIndex;
    }

    struct Run {
        bytes32 runId;
        address creator;
        RunState state;
        CoordinatorConfig config;
        ModelConfig model;
        Progress progress;
        EpochState epochState;
        uint64 stateStartTimestamp;
        bool pendingPause;
        PrivacyMode privacyMode;
        bytes32 mpcKeyId;
    }

    mapping(bytes32 => Run) internal runs;
    mapping(bytes32 => Client[]) internal runClients;
    mapping(bytes32 => Client[]) internal exitedClients;
    mapping(bytes32 => Client[]) internal pendingClients;
    mapping(bytes32 => mapping(address => uint16)) internal clientIndices;
    mapping(bytes32 => mapping(uint32 => WitnessSubmission[])) internal roundWitnesses;
    mapping(bytes32 => mapping(uint32 => mapping(address => bool))) internal witnessSubmitted;
    bytes32[] public activeRunIds;
    mapping(bytes32 => uint256) internal activeRunIndex;
    ComputeRegistry public computeRegistry;
    MPCKeyRegistry public mpcKeyRegistry;
    uint256 public minParticipantStake = 0.1 ether;
    uint256 public runCreationFee = 0;

    error RunAlreadyExists();
    error RunNotFound();
    error InvalidConfig();
    error InvalidState(RunState current, RunState expected);
    error NotRunCreator();
    error ClientAlreadyJoined();
    error ClientNotInRun();
    error MaxClientsReached();
    error InsufficientStake();
    error WitnessAlreadySubmitted();
    error InvalidWitnessProof();
    error InvalidCommitteeProof();
    error NotWitnessCommittee();
    error RunHalted();
    error CannotPause();
    error CannotResume();
    error NotRegisteredProvider();
    error MPCKeyRequired();
    error InvalidMPCKey();
    error ETHTransferFailed();

    modifier runExists(bytes32 runId) {
        if (runs[runId].stateStartTimestamp == 0) revert RunNotFound();
        _;
    }

    modifier onlyRunCreator(bytes32 runId) {
        if (runs[runId].creator != msg.sender && msg.sender != owner()) revert NotRunCreator();
        _;
    }

    modifier notHalted(bytes32 runId) {
        RunState state = runs[runId].state;
        if (state == RunState.Uninitialized || state == RunState.Finished || state == RunState.Paused) {
            revert RunHalted();
        }
        _;
    }

    constructor(address _computeRegistry, address _mpcKeyRegistry, address initialOwner) Ownable(initialOwner) {
        computeRegistry = ComputeRegistry(_computeRegistry);
        mpcKeyRegistry = MPCKeyRegistry(_mpcKeyRegistry);
    }

    function createRun(
        bytes32 runId,
        CoordinatorConfig calldata config,
        ModelConfig calldata model,
        PrivacyMode privacyMode,
        bytes32 mpcKeyId
    ) external payable nonReentrant {
        if (runs[runId].stateStartTimestamp != 0) revert RunAlreadyExists();
        if (!_validateConfig(config)) revert InvalidConfig();
        if (msg.value < runCreationFee) revert InsufficientStake();
        if (privacyMode == PrivacyMode.Private) {
            if (mpcKeyId == bytes32(0)) revert MPCKeyRequired();
            MPCKeyRegistry.KeyMetadata memory key = mpcKeyRegistry.getKey(mpcKeyId);
            if (key.createdAt == 0 || key.status != MPCKeyRegistry.KeyStatus.ACTIVE) {
                revert InvalidMPCKey();
            }
        }

        Run storage run = runs[runId];
        run.runId = runId;
        run.creator = msg.sender;
        run.state = RunState.WaitingForMembers;
        run.config = config;
        run.model = model;
        run.progress.epoch = 0;
        run.progress.step = 1;
        run.progress.epochStartDataIndex = 0;
        run.stateStartTimestamp = uint64(block.timestamp);
        run.privacyMode = privacyMode;
        run.mpcKeyId = mpcKeyId;
        run.epochState.firstRound = true;
        run.epochState.coldStartEpoch = false;

        activeRunIds.push(runId);
        activeRunIndex[runId] = activeRunIds.length;

        emit RunCreated(runId, msg.sender, model.hfRepo, privacyMode);
        emit RunConfigured(runId, config);
        emit StateTransition(runId, RunState.Uninitialized, RunState.WaitingForMembers, uint64(block.timestamp));
    }

    function joinRun(bytes32 runId, bytes32 p2pEndpointId) external nonReentrant runExists(runId) {
        Run storage run = runs[runId];

        // Can only join during WaitingForMembers or Warmup
        if (run.state != RunState.WaitingForMembers && run.state != RunState.Warmup) {
            revert InvalidState(run.state, RunState.WaitingForMembers);
        }

        if (clientIndices[runId][msg.sender] != 0) revert ClientAlreadyJoined();
        for (uint256 i = 0; i < pendingClients[runId].length; i++) {
            if (pendingClients[runId][i].addr == msg.sender) revert ClientAlreadyJoined();
        }

        if (!computeRegistry.isActive(msg.sender)) revert NotRegisteredProvider();
        if (run.privacyMode == PrivacyMode.Private) {
            (bool allowed,) = mpcKeyRegistry.checkAccess(run.mpcKeyId, msg.sender);
            if (!allowed) revert InvalidMPCKey();
        }

        pendingClients[runId].push(
            Client({
                addr: msg.sender,
                p2pEndpointId: p2pEndpointId,
                state: ClientState.Healthy,
                exitedHeight: 0,
                joinedAt: uint64(block.timestamp)
            })
        );
    }

    function tick(bytes32 runId) external nonReentrant runExists(runId) notHalted(runId) {
        Run storage run = runs[runId];
        uint64 currentTime = uint64(block.timestamp);

        if (run.state == RunState.WaitingForMembers) {
            _tickWaitingForMembers(runId, run, currentTime);
        } else if (run.state == RunState.Warmup) {
            _tickWarmup(runId, run, currentTime);
        } else if (run.state == RunState.RoundTrain) {
            _tickRoundTrain(runId, run, currentTime);
        } else if (run.state == RunState.RoundWitness) {
            _tickRoundWitness(runId, run, currentTime);
        } else if (run.state == RunState.Cooldown) {
            _tickCooldown(runId, run, currentTime);
        }
    }

    function _tickWaitingForMembers(bytes32 runId, Run storage run, uint64 currentTime) internal {
        Client[] storage pending = pendingClients[runId];
        bool hasEnoughClients = pending.length >= run.config.initMinClients;
        bool extraTimeElapsed =
            _checkTimeout(run.stateStartTimestamp, currentTime, run.config.waitingForMembersExtraTime);

        if (hasEnoughClients && extraTimeElapsed) {
            _moveUnhealthyToExited(runId, 0);
            Client[] storage clients = runClients[runId];
            uint16 clientCount = uint16(pending.length > MAX_CLIENTS ? MAX_CLIENTS : pending.length);

            for (uint16 i = 0; i < clientCount; i++) {
                clients.push(pending[i]);
                clientIndices[runId][pending[i].addr] = i + 1;
            }

            delete pendingClients[runId];
            run.epochState.firstRound = true;
            run.epochState.startStep = run.progress.step;
            run.epochState.startTimestamp = currentTime;
            run.epochState.lastStep = 0;
            run.epochState.roundsHead = 0;
            _changeState(runId, run, RunState.Warmup, currentTime);
        }
    }

    function _tickWarmup(bytes32 runId, Run storage run, uint64 currentTime) internal {
        if (_checkTimeout(run.stateStartTimestamp, currentTime, run.config.warmupTime)) {
            _moveUnhealthyToExited(runId, 0);
            if (runClients[runId].length < run.config.minClients) {
                _changeState(runId, run, RunState.WaitingForMembers, currentTime);
                emit EpochCompleted(runId, run.progress.epoch, run.progress.step - run.epochState.startStep);
                return;
            }

            uint64 randomSeed =
                uint64(uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), block.timestamp, runId))));
            _startRoundTrain(runId, run, currentTime, randomSeed, 0);
        }
    }

    function _tickRoundTrain(bytes32 runId, Run storage run, uint64 currentTime) internal {
        if (_checkTimeout(run.stateStartTimestamp, currentTime, run.config.maxRoundTrainTime)) {
            _changeState(runId, run, RunState.RoundWitness, currentTime);
        }
    }

    function _tickRoundWitness(bytes32 runId, Run storage run, uint64 currentTime) internal {
        if (_checkTimeout(run.stateStartTimestamp, currentTime, run.config.roundWitnessTime)) {
            run.epochState.firstRound = false;
            run.progress.step += 1;

            Round storage currentRound = run.epochState.rounds[run.epochState.roundsHead];
            uint32 height = currentRound.height;
            uint16 numWitnesses = uint16(roundWitnesses[runId][height].length);
            _moveUnhealthyToExited(runId, height);
            if (numWitnesses == 0) {
                _withdrawAll(runId);
                _startCooldown(runId, run, currentTime);
                return;
            }

            if (_checkEpochTimeout(run, currentTime) && run.epochState.lastStep == 0) {
                uint32 lastStep = run.progress.step + 2;
                if (lastStep >= 4) {
                    run.epochState.lastStep = lastStep;
                }
            }

            bool shouldEndEpoch = (run.epochState.lastStep != 0 && run.progress.step == run.epochState.lastStep)
                || (runClients[runId].length < run.config.minClients)
                || (numWitnesses < _getWitnessQuorum(run, numWitnesses)) || (run.progress.step >= run.config.totalSteps)
                || run.pendingPause;

            if (shouldEndEpoch) {
                _startCooldown(runId, run, currentTime);
                return;
            }

            uint64 randomSeed = uint64(
                uint256(
                    keccak256(abi.encodePacked(blockhash(block.number - 1), block.timestamp, runId, run.progress.step))
                )
            );

            _startRoundTrain(runId, run, currentTime, randomSeed, 0);
        }
    }

    function _tickCooldown(bytes32 runId, Run storage run, uint64 currentTime) internal {
        if (_checkTimeout(run.stateStartTimestamp, currentTime, run.config.cooldownTime)) {
            Round storage currentRound = run.epochState.rounds[run.epochState.roundsHead];
            uint16 lastBatchSize = _getTargetGlobalBatchSize(run, currentRound.dataIndex);
            run.progress.epochStartDataIndex = currentRound.dataIndex + lastBatchSize;
            run.progress.epoch += 1;
            _moveUnhealthyToExited(runId, currentRound.height);
            if (run.pendingPause) {
                _withdrawAll(runId);
                _changeState(runId, run, RunState.Paused, currentTime);
                run.pendingPause = false;
                run.epochState.coldStartEpoch = true;
                emit RunPaused(runId, msg.sender);
            } else {
                run.epochState.coldStartEpoch = false;
                if (run.progress.step < run.config.totalSteps) {
                    _changeState(runId, run, RunState.WaitingForMembers, currentTime);
                } else {
                    _changeState(runId, run, RunState.Finished, currentTime);
                    emit RunFinished(runId, run.progress.step);
                    _removeFromActiveRuns(runId);
                }
            }

            emit EpochCompleted(runId, run.progress.epoch - 1, run.progress.step - run.epochState.startStep);
        }
    }

    function submitWitness(bytes32 runId, WitnessSubmission calldata submission, bytes calldata proof)
        external
        nonReentrant
        runExists(runId)
        notHalted(runId)
    {
        Run storage run = runs[runId];

        // Must be in RoundTrain or RoundWitness state
        if (run.state != RunState.RoundTrain && run.state != RunState.RoundWitness) {
            revert InvalidState(run.state, RunState.RoundTrain);
        }

        uint16 clientIdx = clientIndices[runId][msg.sender];
        if (clientIdx == 0) revert ClientNotInRun();

        Round storage currentRound = run.epochState.rounds[run.epochState.roundsHead];

        // Verify not already submitted
        if (witnessSubmitted[runId][currentRound.height][msg.sender]) {
            revert WitnessAlreadySubmitted();
        }

        if (!_verifyWitnessCommittee(run, clientIdx - 1, currentRound.randomSeed, proof)) {
            revert NotWitnessCommittee();
        }

        roundWitnesses[runId][currentRound.height].push(submission);
        witnessSubmitted[runId][currentRound.height][msg.sender] = true;

        emit WitnessSubmitted(runId, msg.sender, currentRound.height, submission.participantBloom);

        uint16 witnessCount = uint16(roundWitnesses[runId][currentRound.height].length);
        uint16 witnessNodes = run.config.witnessNodes == 0
            ? uint16(runClients[runId].length > MAX_WITNESSES ? MAX_WITNESSES : runClients[runId].length)
            : run.config.witnessNodes;

        if (witnessCount == witnessNodes && run.state == RunState.RoundTrain) {
            _changeState(runId, run, RunState.RoundWitness, uint64(block.timestamp));
        }
    }

    function submitWarmupWitness(bytes32 runId, WitnessSubmission calldata submission)
        external
        nonReentrant
        runExists(runId)
        notHalted(runId)
    {
        Run storage run = runs[runId];

        // Must be in Warmup state
        if (run.state != RunState.Warmup) {
            revert InvalidState(run.state, RunState.Warmup);
        }

        uint16 clientIdx = clientIndices[runId][msg.sender];
        if (clientIdx == 0) revert ClientNotInRun();

        Round storage currentRound = run.epochState.rounds[run.epochState.roundsHead];

        // Verify not already submitted
        if (witnessSubmitted[runId][currentRound.height][msg.sender]) {
            revert WitnessAlreadySubmitted();
        }

        roundWitnesses[runId][currentRound.height].push(submission);
        witnessSubmitted[runId][currentRound.height][msg.sender] = true;

        emit WitnessSubmitted(runId, msg.sender, currentRound.height, submission.participantBloom);

        uint16 witnessCount = uint16(roundWitnesses[runId][currentRound.height].length);
        uint16 witnessNodes = run.config.witnessNodes == 0
            ? uint16(runClients[runId].length > MAX_WITNESSES ? MAX_WITNESSES : runClients[runId].length)
            : run.config.witnessNodes;

        if (witnessCount == witnessNodes) {
            uint64 randomSeed =
                uint64(uint256(keccak256(abi.encodePacked(blockhash(block.number - 1), block.timestamp, runId))));
            _startRoundTrain(runId, run, uint64(block.timestamp), randomSeed, 0);
        }
    }

    function submitHealthCheck(
        bytes32 runId,
        uint16[] calldata unhealthyIndices,
        bytes32[] calldata /* committeeProofs - reserved for future committee verification */
    ) external nonReentrant runExists(runId) notHalted(runId) {
        Run storage run = runs[runId];
        Round storage currentRound = run.epochState.rounds[run.epochState.roundsHead];
        if (currentRound.height < 2) revert InvalidCommitteeProof();
        Client[] storage clients = runClients[runId];
        for (uint256 i = 0; i < unhealthyIndices.length; i++) {
            uint16 idx = unhealthyIndices[i];
            if (idx >= clients.length) continue;

            Client storage client = clients[idx];
            if (client.state != ClientState.Healthy) continue;
            if (!_isClientHealthy(runId, run, idx)) {
                client.state = ClientState.Dropped;
                emit ClientExited(runId, client.addr, ClientState.Dropped);
            }
        }
    }

    function submitCheckpoint(bytes32 runId, bytes32 modelHash, string calldata hfRepo)
        external
        nonReentrant
        runExists(runId)
        notHalted(runId)
    {
        Run storage run = runs[runId];
        if (clientIndices[runId][msg.sender] == 0) revert ClientNotInRun();
        run.model.modelHash = modelHash;
        run.model.hfRepo = hfRepo;

        emit CheckpointSubmitted(runId, modelHash, hfRepo, msg.sender);
    }

    function withdrawFromRun(bytes32 runId) external nonReentrant runExists(runId) {
        uint16 clientIdx = clientIndices[runId][msg.sender];
        if (clientIdx == 0) revert ClientNotInRun();

        Client[] storage clients = runClients[runId];
        Client storage client = clients[clientIdx - 1];

        if (client.state == ClientState.Healthy) {
            client.state = ClientState.Withdrawn;
            emit ClientExited(runId, msg.sender, ClientState.Withdrawn);
        }
    }

    function pauseRun(bytes32 runId) external runExists(runId) onlyRunCreator(runId) {
        Run storage run = runs[runId];

        if (run.state == RunState.Uninitialized || run.state == RunState.Finished || run.state == RunState.Paused) {
            revert CannotPause();
        }

        if (_isActive(run.state)) {
            run.pendingPause = true;
        } else {
            _withdrawAll(runId);
            _changeState(runId, run, RunState.Paused, uint64(block.timestamp));
            run.epochState.coldStartEpoch = true;
            emit RunPaused(runId, msg.sender);
        }
    }

    function resumeRun(bytes32 runId) external runExists(runId) onlyRunCreator(runId) {
        Run storage run = runs[runId];

        if (run.state != RunState.Paused) revert CannotResume();

        _changeState(runId, run, RunState.WaitingForMembers, uint64(block.timestamp));
        emit RunResumed(runId, msg.sender);
    }

    function getRunState(bytes32 runId) external view returns (RunState) {
        return runs[runId].state;
    }

    function getRunConfig(bytes32 runId) external view returns (CoordinatorConfig memory) {
        return runs[runId].config;
    }

    function getRunModel(bytes32 runId) external view returns (ModelConfig memory) {
        return runs[runId].model;
    }

    function getClients(bytes32 runId) external view returns (Client[] memory) {
        return runClients[runId];
    }

    function getClientCount(bytes32 runId) external view returns (uint16) {
        return uint16(runClients[runId].length);
    }

    function getCurrentRound(bytes32 runId) external view returns (Round memory) {
        Run storage run = runs[runId];
        return run.epochState.rounds[run.epochState.roundsHead];
    }

    function getEpoch(bytes32 runId) external view returns (uint16) {
        return runs[runId].progress.epoch;
    }

    function getStep(bytes32 runId) external view returns (uint32) {
        return runs[runId].progress.step;
    }

    function isClientInRun(bytes32 runId, address client) external view returns (bool) {
        return clientIndices[runId][client] != 0;
    }

    function getWitnessQuorum(bytes32 runId) external view returns (uint16) {
        Run storage run = runs[runId];
        uint16 witnessNodes = run.config.witnessNodes == 0
            ? uint16(runClients[runId].length > MAX_WITNESSES ? MAX_WITNESSES : runClients[runId].length)
            : run.config.witnessNodes;
        return _getWitnessQuorum(run, witnessNodes);
    }

    function getActiveRunCount() external view returns (uint256) {
        return activeRunIds.length;
    }

    function getRun(bytes32 runId)
        external
        view
        returns (
            address creator,
            RunState state,
            uint16 epoch,
            uint32 step,
            uint16 clientCount,
            PrivacyMode privacyMode
        )
    {
        Run storage run = runs[runId];
        return (
            run.creator,
            run.state,
            run.progress.epoch,
            run.progress.step,
            uint16(runClients[runId].length),
            run.privacyMode
        );
    }

    function _validateConfig(CoordinatorConfig calldata config) internal pure returns (bool) {
        return config.maxRoundTrainTime > 0 && config.roundWitnessTime > 0 && config.minClients > 0
            && config.initMinClients >= config.minClients && config.initMinClients <= MAX_CLIENTS
            && config.globalBatchSizeStart > 0 && config.globalBatchSizeEnd >= config.globalBatchSizeStart
            && config.totalSteps > 0 && config.witnessNodes <= config.minClients && config.witnessNodes <= MAX_WITNESSES
            && config.cooldownTime > 0 && config.waitingForMembersExtraTime > 0;
    }

    function _checkTimeout(uint64 startTime, uint64 currentTime, uint64 duration) internal pure returns (bool) {
        return startTime != currentTime && currentTime >= startTime + duration;
    }

    function _checkEpochTimeout(Run storage run, uint64 currentTime) internal view returns (bool) {
        return run.epochState.startTimestamp != currentTime
            && currentTime >= run.epochState.startTimestamp + run.config.epochTime;
    }

    function _changeState(bytes32 runId, Run storage run, RunState newState, uint64 currentTime) internal {
        RunState oldState = run.state;
        run.state = newState;
        run.stateStartTimestamp = currentTime;
        emit StateTransition(runId, oldState, newState, currentTime);
    }

    function _startRoundTrain(bytes32 runId, Run storage run, uint64 currentTime, uint64 randomSeed, uint16 tieBreaker)
        internal
    {
        uint32 nextHeight;
        uint64 nextDataIndex;
        uint32 nextRoundsHead;

        if (run.epochState.firstRound) {
            nextHeight = 0;
            nextDataIndex = run.progress.epochStartDataIndex;
            nextRoundsHead = 0;
        } else {
            Round storage prevRound = run.epochState.rounds[run.epochState.roundsHead];
            uint16 prevBatchSize = _getTargetGlobalBatchSize(run, prevRound.dataIndex);
            nextHeight = prevRound.height + 1;
            nextDataIndex = prevRound.dataIndex + prevBatchSize;
            nextRoundsHead = (run.epochState.roundsHead + 1) % NUM_STORED_ROUNDS;
        }

        Round storage newRound = run.epochState.rounds[nextRoundsHead];
        run.epochState.roundsHead = nextRoundsHead;

        newRound.height = nextHeight;
        newRound.dataIndex = nextDataIndex;
        newRound.randomSeed = randomSeed;
        newRound.clientsLen = uint16(runClients[runId].length);
        newRound.tieBreaker = tieBreaker;
        delete newRound.witnessProofs;

        _changeState(runId, run, RunState.RoundTrain, currentTime);

        emit RoundStarted(runId, nextHeight, nextDataIndex, randomSeed);
    }

    function _startCooldown(bytes32 runId, Run storage run, uint64 currentTime) internal {
        // Clear witness proofs for reuse
        Round storage currentRound = run.epochState.rounds[run.epochState.roundsHead];
        delete currentRound.witnessProofs;

        _changeState(runId, run, RunState.Cooldown, currentTime);
    }

    function _moveUnhealthyToExited(bytes32 runId, uint32 height) internal {
        Client[] storage clients = runClients[runId];
        Client[] storage exited = exitedClients[runId];

        uint256 i = 0;
        while (i < clients.length) {
            if (clients[i].state != ClientState.Healthy) {
                Client memory exitedClient = clients[i];
                exitedClient.exitedHeight = height;
                exited.push(exitedClient);

                // Remove from client indices
                clientIndices[runId][clients[i].addr] = 0;

                // Swap and pop
                if (i < clients.length - 1) {
                    clients[i] = clients[clients.length - 1];
                    clientIndices[runId][clients[i].addr] = uint16(i + 1);
                }
                clients.pop();
            } else {
                i++;
            }
        }
    }

    function _withdrawAll(bytes32 runId) internal {
        Client[] storage clients = runClients[runId];
        for (uint256 i = 0; i < clients.length; i++) {
            if (clients[i].state == ClientState.Healthy) {
                clients[i].state = ClientState.Withdrawn;
            }
        }
    }

    function _getTargetGlobalBatchSize(Run storage run, uint64 dataIndex) internal view returns (uint16) {
        uint64 tokensProcessed = dataIndex * run.model.maxSeqLen;

        if (tokensProcessed >= run.config.globalBatchSizeWarmupTokens) {
            return run.config.globalBatchSizeEnd;
        }

        uint256 progress = (tokensProcessed * 1e18) / run.config.globalBatchSizeWarmupTokens;
        uint256 batchSize = run.config.globalBatchSizeStart
            + ((run.config.globalBatchSizeEnd - run.config.globalBatchSizeStart) * progress) / 1e18;

        return uint16(batchSize);
    }

    function _getWitnessQuorum(Run storage run, uint16 witnessCount) internal view returns (uint16) {
        uint16 witnessNodes = run.config.witnessNodes == 0 ? witnessCount : run.config.witnessNodes;

        if (witnessNodes <= 1) return 1;
        if (witnessNodes == 2) return 2;
        if (witnessNodes == 3) return 2;

        return uint16((uint256(witnessNodes) * WITNESS_QUORUM_PERCENT) / 100);
    }

    function _verifyWitnessCommittee(Run storage run, uint16 clientIndex, uint64 randomSeed, bytes calldata)
        internal
        view
        returns (bool)
    {
        // Simplified committee selection: deterministic based on random seed
        uint256 hash = uint256(keccak256(abi.encodePacked(randomSeed, clientIndex)));
        uint16 witnessNodes = run.config.witnessNodes == 0
            ? uint16(runClients[run.runId].length > MAX_WITNESSES ? MAX_WITNESSES : runClients[run.runId].length)
            : run.config.witnessNodes;

        // Check if this client is selected as a witness
        return (hash % runClients[run.runId].length) < witnessNodes;
    }

    function _isClientHealthy(bytes32 runId, Run storage run, uint16 clientIndex) internal view returns (bool) {
        // Check previous round's witness bloom filters
        uint32 prevRoundIdx = run.epochState.roundsHead == 0 ? NUM_STORED_ROUNDS - 1 : run.epochState.roundsHead - 1;

        WitnessSubmission[] storage witnesses = roundWitnesses[runId][run.epochState.rounds[prevRoundIdx].height];

        // Client is healthy if it appears in the majority of witness bloom filters
        uint256 quorum = _getWitnessQuorum(run, uint16(witnesses.length));
        uint256 confirmations = 0;

        bytes32 clientHash = keccak256(abi.encodePacked(runClients[runId][clientIndex].p2pEndpointId));

        for (uint256 i = 0; i < witnesses.length; i++) {
            // Simplified bloom filter check: client hash appears in participant bloom
            if (_bloomContains(witnesses[i].participantBloom, clientHash)) {
                confirmations++;
            }
        }

        return confirmations >= quorum;
    }

    function _bloomContains(bytes32 bloom, bytes32 element) internal pure returns (bool) {
        // Simplified bloom filter check: XOR the element hash with bloom and check for overlap
        return (bloom & element) != bytes32(0);
    }

    function _isActive(RunState state) internal pure returns (bool) {
        return state == RunState.RoundTrain || state == RunState.RoundWitness || state == RunState.Cooldown;
    }

    function _removeFromActiveRuns(bytes32 runId) internal {
        uint256 idx = activeRunIndex[runId];
        if (idx == 0) return;

        uint256 lastIdx = activeRunIds.length - 1;
        if (idx - 1 != lastIdx) {
            bytes32 lastRunId = activeRunIds[lastIdx];
            activeRunIds[idx - 1] = lastRunId;
            activeRunIndex[lastRunId] = idx;
        }

        activeRunIds.pop();
        delete activeRunIndex[runId];
    }

    function setComputeRegistry(address _computeRegistry) external onlyOwner {
        computeRegistry = ComputeRegistry(_computeRegistry);
    }

    function setMPCKeyRegistry(address _mpcKeyRegistry) external onlyOwner {
        mpcKeyRegistry = MPCKeyRegistry(_mpcKeyRegistry);
    }

    function setMinParticipantStake(uint256 _stake) external onlyOwner {
        minParticipantStake = _stake;
    }

    function setRunCreationFee(uint256 _fee) external onlyOwner {
        runCreationFee = _fee;
    }

    function withdrawFees(address to) external onlyOwner {
        (bool success, ) = payable(to).call{value: address(this).balance}("");
        if (!success) revert ETHTransferFailed();
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
