// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title RLAIFCoordinator
 * @author Jeju Network
 * @notice Coordinates end-to-end RLAIF training runs on-chain
 * @dev Manages the training loop: Rollouts → Judging → Training → Evaluation → Promotion
 *
 * Architecture:
 * - State machine with 8 states matching the RLAIF pipeline
 * - Tracks iterations with trajectory manifests, rewards, and model CIDs
 * - Supports reward tokens for incentivizing participation
 * - Integrates with Jeju Compute and Storage via CID references
 */
contract RLAIFCoordinator is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum RunState {
        Uninitialized,
        CollectingRollouts,
        Judging,
        Training,
        Evaluating,
        Promoting,
        Paused,
        Finished
    }

    struct RunConfig {
        string environmentId;
        string baseModelCID;
        string judgeModelCID;
        string rubricId;
        uint32 targetIterations;
        uint32 minTrajectoriesPerIteration;
        address rewardToken;
        uint256 rewardPerIteration;
    }

    struct Iteration {
        uint32 number;
        RunState state;
        string trajectoryManifestCID;
        uint32 trajectoryCount;
        string rewardsManifestCID;
        string updatedPolicyCID;
        string evalResultsCID;
        bool evalPassed;
        uint256 evalScore;
        uint64 startedAt;
        uint64 completedAt;
    }

    struct Run {
        bytes32 runId;
        address creator;
        RunState state;
        RunConfig config;
        uint32 currentIteration;
        string currentPolicyCID;
        string bestPolicyCID;
        uint256 bestEvalScore;
        uint64 createdAt;
        uint64 updatedAt;
    }

    mapping(bytes32 => Run) public runs;
    mapping(bytes32 => Iteration[]) public iterations;
    mapping(bytes32 => mapping(address => bool)) public authorizedWorkers;

    bytes32[] public activeRunIds;
    mapping(bytes32 => uint256) internal activeRunIndex;

    event RunCreated(
        bytes32 indexed runId,
        address indexed creator,
        string environmentId,
        string baseModelCID,
        uint32 targetIterations
    );

    event IterationStarted(
        bytes32 indexed runId,
        uint32 iteration,
        RunState state
    );

    event RolloutsSubmitted(
        bytes32 indexed runId,
        uint32 iteration,
        string manifestCID,
        uint32 trajectoryCount
    );

    event JudgingCompleted(
        bytes32 indexed runId,
        uint32 iteration,
        string rewardsCID
    );

    event TrainingCompleted(
        bytes32 indexed runId,
        uint32 iteration,
        string newPolicyCID,
        string metricsCID
    );

    event EvaluationCompleted(
        bytes32 indexed runId,
        uint32 iteration,
        string evalCID,
        bool passed,
        uint256 score
    );

    event PolicyPromoted(
        bytes32 indexed runId,
        uint32 iteration,
        string policyCID,
        uint256 evalScore
    );

    event RunFinished(
        bytes32 indexed runId,
        uint32 totalIterations,
        string bestPolicyCID,
        uint256 bestEvalScore
    );

    error RunAlreadyExists();
    error RunNotFound();
    error InvalidState(RunState current, RunState expected);
    error NotAuthorized();
    error InvalidConfig();
    error IterationNotFound();

    modifier runExists(bytes32 runId) {
        if (runs[runId].createdAt == 0) revert RunNotFound();
        _;
    }

    modifier onlyRunCreatorOrWorker(bytes32 runId) {
        if (runs[runId].creator != msg.sender && !authorizedWorkers[runId][msg.sender]) {
            revert NotAuthorized();
        }
        _;
    }

    modifier inState(bytes32 runId, RunState expected) {
        if (runs[runId].state != expected) {
            revert InvalidState(runs[runId].state, expected);
        }
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    function createRun(
        bytes32 runId,
        string calldata environmentId,
        string calldata policyModelCID,
        uint32 targetIterations
    ) external {
        if (runs[runId].createdAt != 0) revert RunAlreadyExists();
        if (targetIterations == 0) revert InvalidConfig();

        Run storage run = runs[runId];
        run.runId = runId;
        run.creator = msg.sender;
        run.state = RunState.CollectingRollouts;
        run.config.environmentId = environmentId;
        run.config.baseModelCID = policyModelCID;
        run.config.targetIterations = targetIterations;
        run.currentPolicyCID = policyModelCID;
        run.createdAt = uint64(block.timestamp);
        run.updatedAt = uint64(block.timestamp);

        activeRunIds.push(runId);
        activeRunIndex[runId] = activeRunIds.length;

        emit RunCreated(runId, msg.sender, environmentId, policyModelCID, targetIterations);

        _startIteration(runId);
    }

    function createRunWithConfig(
        bytes32 runId,
        RunConfig calldata config
    ) external {
        if (runs[runId].createdAt != 0) revert RunAlreadyExists();
        if (config.targetIterations == 0) revert InvalidConfig();

        Run storage run = runs[runId];
        run.runId = runId;
        run.creator = msg.sender;
        run.state = RunState.CollectingRollouts;
        run.config = config;
        run.currentPolicyCID = config.baseModelCID;
        run.createdAt = uint64(block.timestamp);
        run.updatedAt = uint64(block.timestamp);

        if (config.rewardToken != address(0) && config.rewardPerIteration > 0) {
            uint256 totalRewards = uint256(config.targetIterations) * config.rewardPerIteration;
            IERC20(config.rewardToken).safeTransferFrom(msg.sender, address(this), totalRewards);
        }

        activeRunIds.push(runId);
        activeRunIndex[runId] = activeRunIds.length;

        emit RunCreated(
            runId,
            msg.sender,
            config.environmentId,
            config.baseModelCID,
            config.targetIterations
        );

        _startIteration(runId);
    }

    function authorizeWorker(bytes32 runId, address worker) external runExists(runId) {
        if (runs[runId].creator != msg.sender) revert NotAuthorized();
        authorizedWorkers[runId][worker] = true;
    }

    function submitRollouts(
        bytes32 runId,
        string calldata manifestCID,
        uint32 count
    )
        external
        runExists(runId)
        onlyRunCreatorOrWorker(runId)
        inState(runId, RunState.CollectingRollouts)
    {
        Run storage run = runs[runId];
        uint32 iterNum = run.currentIteration;

        Iteration storage iter = iterations[runId][iterNum - 1];
        iter.trajectoryManifestCID = manifestCID;
        iter.trajectoryCount = count;
        iter.state = RunState.Judging;

        run.state = RunState.Judging;
        run.updatedAt = uint64(block.timestamp);

        emit RolloutsSubmitted(runId, iterNum, manifestCID, count);
        emit IterationStarted(runId, iterNum, RunState.Judging);
    }

    function submitJudgingResults(
        bytes32 runId,
        string calldata rewardsCID
    )
        external
        runExists(runId)
        onlyRunCreatorOrWorker(runId)
        inState(runId, RunState.Judging)
    {
        Run storage run = runs[runId];
        uint32 iterNum = run.currentIteration;

        Iteration storage iter = iterations[runId][iterNum - 1];
        iter.rewardsManifestCID = rewardsCID;
        iter.state = RunState.Training;

        run.state = RunState.Training;
        run.updatedAt = uint64(block.timestamp);

        emit JudgingCompleted(runId, iterNum, rewardsCID);
        emit IterationStarted(runId, iterNum, RunState.Training);
    }

    function submitTrainingResult(
        bytes32 runId,
        string calldata newPolicyCID,
        string calldata metricsCID
    )
        external
        runExists(runId)
        onlyRunCreatorOrWorker(runId)
        inState(runId, RunState.Training)
    {
        Run storage run = runs[runId];
        uint32 iterNum = run.currentIteration;

        Iteration storage iter = iterations[runId][iterNum - 1];
        iter.updatedPolicyCID = newPolicyCID;
        iter.state = RunState.Evaluating;

        run.state = RunState.Evaluating;
        run.updatedAt = uint64(block.timestamp);

        emit TrainingCompleted(runId, iterNum, newPolicyCID, metricsCID);
        emit IterationStarted(runId, iterNum, RunState.Evaluating);
    }

    function submitEvaluation(
        bytes32 runId,
        string calldata evalCID,
        bool passed,
        uint256 score
    )
        external
        runExists(runId)
        onlyRunCreatorOrWorker(runId)
        inState(runId, RunState.Evaluating)
    {
        Run storage run = runs[runId];
        uint32 iterNum = run.currentIteration;

        Iteration storage iter = iterations[runId][iterNum - 1];
        iter.evalResultsCID = evalCID;
        iter.evalPassed = passed;
        iter.evalScore = score;
        iter.completedAt = uint64(block.timestamp);

        emit EvaluationCompleted(runId, iterNum, evalCID, passed, score);

        if (passed) {
            _promotePolicy(runId, iterNum);
        }

        _completeIteration(runId);
    }

    function pauseRun(bytes32 runId) external runExists(runId) {
        if (runs[runId].creator != msg.sender && msg.sender != owner()) revert NotAuthorized();
        if (runs[runId].state == RunState.Finished) revert InvalidState(RunState.Finished, RunState.Paused);

        runs[runId].state = RunState.Paused;
        runs[runId].updatedAt = uint64(block.timestamp);
    }

    function resumeRun(bytes32 runId) external runExists(runId) {
        if (runs[runId].creator != msg.sender && msg.sender != owner()) revert NotAuthorized();
        if (runs[runId].state != RunState.Paused) revert InvalidState(runs[runId].state, RunState.Paused);

        runs[runId].state = RunState.CollectingRollouts;
        runs[runId].updatedAt = uint64(block.timestamp);

        _startIteration(runId);
    }

    function getRunState(bytes32 runId) external view returns (RunState) {
        return runs[runId].state;
    }

    function getCurrentIteration(bytes32 runId) external view returns (uint32) {
        return runs[runId].currentIteration;
    }

    function getIteration(bytes32 runId, uint32 iterNum) external view returns (Iteration memory) {
        if (iterNum == 0 || iterNum > iterations[runId].length) revert IterationNotFound();
        return iterations[runId][iterNum - 1];
    }

    function getIterationCount(bytes32 runId) external view returns (uint256) {
        return iterations[runId].length;
    }

    function getCurrentPolicy(bytes32 runId) external view returns (string memory) {
        return runs[runId].currentPolicyCID;
    }

    function getBestPolicy(bytes32 runId) external view returns (string memory, uint256) {
        return (runs[runId].bestPolicyCID, runs[runId].bestEvalScore);
    }

    function getActiveRunCount() external view returns (uint256) {
        return activeRunIds.length;
    }

    function _startIteration(bytes32 runId) internal {
        Run storage run = runs[runId];
        run.currentIteration++;

        iterations[runId].push(Iteration({
            number: run.currentIteration,
            state: RunState.CollectingRollouts,
            trajectoryManifestCID: "",
            trajectoryCount: 0,
            rewardsManifestCID: "",
            updatedPolicyCID: "",
            evalResultsCID: "",
            evalPassed: false,
            evalScore: 0,
            startedAt: uint64(block.timestamp),
            completedAt: 0
        }));

        emit IterationStarted(runId, run.currentIteration, RunState.CollectingRollouts);
    }

    function _promotePolicy(bytes32 runId, uint32 iterNum) internal {
        Run storage run = runs[runId];
        Iteration storage iter = iterations[runId][iterNum - 1];

        run.currentPolicyCID = iter.updatedPolicyCID;

        if (iter.evalScore > run.bestEvalScore) {
            run.bestPolicyCID = iter.updatedPolicyCID;
            run.bestEvalScore = iter.evalScore;
        }

        if (run.config.rewardToken != address(0) && run.config.rewardPerIteration > 0) {
            IERC20(run.config.rewardToken).safeTransfer(run.creator, run.config.rewardPerIteration);
        }

        emit PolicyPromoted(runId, iterNum, iter.updatedPolicyCID, iter.evalScore);
    }

    function _completeIteration(bytes32 runId) internal {
        Run storage run = runs[runId];

        if (run.currentIteration >= run.config.targetIterations) {
            run.state = RunState.Finished;

            uint256 idx = activeRunIndex[runId];
            if (idx > 0 && idx <= activeRunIds.length) {
                uint256 lastIdx = activeRunIds.length - 1;
                if (idx - 1 != lastIdx) {
                    bytes32 lastRunId = activeRunIds[lastIdx];
                    activeRunIds[idx - 1] = lastRunId;
                    activeRunIndex[lastRunId] = idx;
                }
                activeRunIds.pop();
                delete activeRunIndex[runId];
            }

            emit RunFinished(
                runId,
                run.currentIteration,
                run.bestPolicyCID,
                run.bestEvalScore
            );
        } else {
            run.state = RunState.CollectingRollouts;
            _startIteration(runId);
        }
    }
}

