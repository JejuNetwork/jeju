// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title CEOAgent
 * @author Jeju Network
 * @notice On-chain CEO agent with encrypted state and DAO-governed model selection
 * @dev Implements:
 *      - Encrypted CEO internal state (TEE-managed)
 *      - Model election via reputation + token staking
 *      - Decision history with reproducible context
 *      - Human override through voting
 *      - Benchmarking against historical decisions
 *
 * The CEO's internal reasoning is encrypted and only accessible via TEE.
 * External observers can see decisions but not internal deliberation.
 * This maintains competitive advantage while ensuring transparency.
 *
 * Model Selection:
 * - Users stake tokens + reputation on preferred models
 * - Model with highest weighted stake becomes CEO
 * - Performance benchmarking adjusts weights over time
 * - Poor decisions can trigger re-election
 *
 * @custom:security-contact security@jeju.network
 */
contract CEOAgent is Ownable, Pausable, ReentrancyGuard {

    // ============================================================================
    // Structs
    // ============================================================================

    struct ModelCandidate {
        string modelId;           // e.g., "claude-opus-4-5-20250514"
        string modelName;
        string provider;          // e.g., "anthropic"
        address nominatedBy;
        uint256 totalStaked;
        uint256 totalReputation;
        uint256 nominatedAt;
        bool isActive;
        uint256 decisionsCount;
        uint256 approvedDecisions;
        uint256 benchmarkScore;   // 0-10000 (100.00%)
    }

    struct Decision {
        bytes32 proposalId;
        string modelId;
        bool approved;
        bytes32 decisionHash;     // IPFS hash of full reasoning
        bytes32 encryptedHash;    // TEE-encrypted internal reasoning
        bytes32 contextHash;      // Hash of context/values used
        uint256 decidedAt;
        uint256 confidenceScore;  // 0-100
        uint256 alignmentScore;   // 0-100
        bool disputed;
        bool overridden;
    }

    struct ModelStake {
        address staker;
        string modelId;
        uint256 stakedAmount;
        uint256 reputationWeight;
        uint256 stakedAt;
    }

    struct OverrideVote {
        bytes32 decisionId;
        address voter;
        bool override_;
        uint256 weight;
        bytes32 reasonHash;
        uint256 votedAt;
    }

    struct CEOState {
        string currentModelId;
        uint256 totalDecisions;
        uint256 approvedDecisions;
        uint256 overriddenDecisions;
        bytes32 contextHash;        // Current values/context hash
        bytes32 encryptedStateHash; // TEE-encrypted internal state
        uint256 lastDecision;
        uint256 electionCooldown;
    }

    // ============================================================================
    // State Variables
    // ============================================================================

    /// @notice Current CEO state
    CEOState public ceoState;

    /// @notice Governance token for staking
    address public governanceToken;

    /// @notice Council contract
    address public council;

    /// @notice TEE oracle for encrypted state management
    address public teeOracle;

    /// @notice All model candidates
    mapping(string => ModelCandidate) public modelCandidates;
    string[] public allModelIds;

    /// @notice Stakes per model
    mapping(string => ModelStake[]) public modelStakes;

    /// @notice Has address staked on model
    mapping(string => mapping(address => bool)) public hasStaked;

    /// @notice All decisions
    mapping(bytes32 => Decision) public decisions;
    bytes32[] public allDecisionIds;

    /// @notice Decisions by proposal
    mapping(bytes32 => bytes32) public proposalDecisions;

    /// @notice Override votes per decision
    mapping(bytes32 => OverrideVote[]) public overrideVotes;

    /// @notice Has address voted to override
    mapping(bytes32 => mapping(address => bool)) public hasVotedOverride;

    /// @notice Benchmark history (model => decision => actual outcome match)
    mapping(string => mapping(bytes32 => bool)) public benchmarkResults;

    // ============================================================================
    // Parameters
    // ============================================================================

    uint256 public electionPeriod = 30 days;
    uint256 public overrideThresholdBPS = 6000;  // 60% to override
    uint256 public overrideVotingPeriod = 7 days;
    uint256 public minStakeForNomination = 0.1 ether;
    uint256 public minBenchmarkDecisions = 10;

    // ============================================================================
    // Events
    // ============================================================================

    event ModelNominated(
        string indexed modelId,
        string modelName,
        string provider,
        address indexed nominatedBy
    );

    event ModelStaked(
        string indexed modelId,
        address indexed staker,
        uint256 amount,
        uint256 reputationWeight
    );

    event ModelElected(
        string indexed oldModel,
        string indexed newModel,
        uint256 totalStake
    );

    event DecisionMade(
        bytes32 indexed decisionId,
        bytes32 indexed proposalId,
        string modelId,
        bool approved,
        uint256 confidence
    );

    event DecisionDisputed(
        bytes32 indexed decisionId,
        address indexed disputer
    );

    event DecisionOverridden(
        bytes32 indexed decisionId,
        uint256 overrideVotes,
        uint256 threshold
    );

    event ContextUpdated(
        bytes32 oldHash,
        bytes32 newHash,
        string reason
    );

    event BenchmarkRecorded(
        string indexed modelId,
        bytes32 indexed decisionId,
        bool matched,
        uint256 newScore
    );

    event TEEStateUpdated(
        bytes32 oldHash,
        bytes32 newHash
    );

    // ============================================================================
    // Errors
    // ============================================================================

    error NotCouncil();
    error NotTEEOracle();
    error ModelNotFound();
    error ModelAlreadyExists();
    error AlreadyStaked();
    error InsufficientStake();
    error DecisionNotFound();
    error AlreadyVoted();
    error VotingPeriodEnded();
    error ElectionCooldown();

    // ============================================================================
    // Modifiers
    // ============================================================================

    modifier onlyCouncil() {
        if (msg.sender != council) revert NotCouncil();
        _;
    }

    modifier onlyTEE() {
        if (msg.sender != teeOracle) revert NotTEEOracle();
        _;
    }

    // ============================================================================
    // Constructor
    // ============================================================================

    constructor(
        address _governanceToken,
        address _council,
        string memory initialModelId,
        address initialOwner
    ) Ownable(initialOwner) {
        require(_governanceToken != address(0), "Invalid token");
        require(_council != address(0), "Invalid council");

        governanceToken = _governanceToken;
        council = _council;

        // Initialize with default model
        ceoState.currentModelId = initialModelId;
        ceoState.contextHash = keccak256(abi.encodePacked("initial-context"));

        // Register initial model
        modelCandidates[initialModelId] = ModelCandidate({
            modelId: initialModelId,
            modelName: "Claude Opus 4.5",
            provider: "anthropic",
            nominatedBy: initialOwner,
            totalStaked: 0,
            totalReputation: 0,
            nominatedAt: block.timestamp,
            isActive: true,
            decisionsCount: 0,
            approvedDecisions: 0,
            benchmarkScore: 10000
        });
        allModelIds.push(initialModelId);
    }

    // ============================================================================
    // Model Nomination & Staking
    // ============================================================================

    /**
     * @notice Nominate a new model candidate
     * @param modelId Unique model identifier
     * @param modelName Human-readable name
     * @param provider Model provider
     */
    function nominateModel(
        string calldata modelId,
        string calldata modelName,
        string calldata provider
    ) external payable nonReentrant {
        if (modelCandidates[modelId].nominatedAt != 0) revert ModelAlreadyExists();
        if (msg.value < minStakeForNomination) revert InsufficientStake();

        modelCandidates[modelId] = ModelCandidate({
            modelId: modelId,
            modelName: modelName,
            provider: provider,
            nominatedBy: msg.sender,
            totalStaked: msg.value,
            totalReputation: 0,
            nominatedAt: block.timestamp,
            isActive: true,
            decisionsCount: 0,
            approvedDecisions: 0,
            benchmarkScore: 5000  // Start at 50%
        });
        allModelIds.push(modelId);

        modelStakes[modelId].push(ModelStake({
            staker: msg.sender,
            modelId: modelId,
            stakedAmount: msg.value,
            reputationWeight: 0,
            stakedAt: block.timestamp
        }));
        hasStaked[modelId][msg.sender] = true;

        emit ModelNominated(modelId, modelName, provider, msg.sender);
    }

    /**
     * @notice Stake on a model candidate
     * @param modelId Model to stake on
     * @param reputationWeight Reputation weight (verified off-chain)
     */
    function stakeOnModel(
        string calldata modelId,
        uint256 reputationWeight
    ) external payable nonReentrant {
        ModelCandidate storage model = modelCandidates[modelId];
        if (model.nominatedAt == 0) revert ModelNotFound();
        if (hasStaked[modelId][msg.sender]) revert AlreadyStaked();

        model.totalStaked += msg.value;
        model.totalReputation += reputationWeight;

        modelStakes[modelId].push(ModelStake({
            staker: msg.sender,
            modelId: modelId,
            stakedAmount: msg.value,
            reputationWeight: reputationWeight,
            stakedAt: block.timestamp
        }));
        hasStaked[modelId][msg.sender] = true;

        emit ModelStaked(modelId, msg.sender, msg.value, reputationWeight);

        // Check if this triggers election
        _checkElection();
    }

    /**
     * @notice Check and potentially trigger model election
     */
    function _checkElection() internal {
        if (block.timestamp < ceoState.electionCooldown) return;

        string memory currentModel = ceoState.currentModelId;
        string memory bestModel = currentModel;
        uint256 bestScore = _calculateModelScore(currentModel);

        for (uint256 i = 0; i < allModelIds.length; i++) {
            string memory modelId = allModelIds[i];
            if (!modelCandidates[modelId].isActive) continue;

            uint256 score = _calculateModelScore(modelId);
            if (score > bestScore) {
                bestScore = score;
                bestModel = modelId;
            }
        }

        if (keccak256(bytes(bestModel)) != keccak256(bytes(currentModel))) {
            emit ModelElected(currentModel, bestModel, modelCandidates[bestModel].totalStaked);
            ceoState.currentModelId = bestModel;
            ceoState.electionCooldown = block.timestamp + electionPeriod;
        }
    }

    /**
     * @notice Calculate weighted score for model selection
     */
    function _calculateModelScore(string memory modelId) internal view returns (uint256) {
        ModelCandidate storage model = modelCandidates[modelId];
        
        // Score = (stake * 0.4) + (reputation * 0.3) + (benchmark * 0.3)
        uint256 stakeScore = model.totalStaked;
        uint256 repScore = model.totalReputation * 1e18 / 100; // Scale reputation
        uint256 benchScore = model.benchmarkScore * 1e14; // Scale to wei

        return (stakeScore * 40 + repScore * 30 + benchScore * 30) / 100;
    }

    // ============================================================================
    // CEO Decision Making
    // ============================================================================

    /**
     * @notice Record CEO decision (called by Council after off-chain AI decision)
     * @param proposalId Proposal being decided
     * @param approved Decision outcome
     * @param decisionHash IPFS hash of public reasoning
     * @param encryptedHash TEE-encrypted internal reasoning
     * @param confidenceScore Confidence level (0-100)
     * @param alignmentScore Alignment with DAO values (0-100)
     */
    function recordDecision(
        bytes32 proposalId,
        bool approved,
        bytes32 decisionHash,
        bytes32 encryptedHash,
        uint256 confidenceScore,
        uint256 alignmentScore
    ) external onlyCouncil returns (bytes32 decisionId) {
        decisionId = keccak256(abi.encodePacked(
            proposalId,
            ceoState.currentModelId,
            block.timestamp
        ));

        decisions[decisionId] = Decision({
            proposalId: proposalId,
            modelId: ceoState.currentModelId,
            approved: approved,
            decisionHash: decisionHash,
            encryptedHash: encryptedHash,
            contextHash: ceoState.contextHash,
            decidedAt: block.timestamp,
            confidenceScore: confidenceScore,
            alignmentScore: alignmentScore,
            disputed: false,
            overridden: false
        });

        allDecisionIds.push(decisionId);
        proposalDecisions[proposalId] = decisionId;

        // Update CEO state
        ceoState.totalDecisions++;
        if (approved) ceoState.approvedDecisions++;
        ceoState.lastDecision = block.timestamp;

        // Update model stats
        ModelCandidate storage model = modelCandidates[ceoState.currentModelId];
        model.decisionsCount++;
        if (approved) model.approvedDecisions++;

        emit DecisionMade(
            decisionId,
            proposalId,
            ceoState.currentModelId,
            approved,
            confidenceScore
        );
    }

    /**
     * @notice Dispute a CEO decision
     * @param decisionId Decision to dispute
     */
    function disputeDecision(bytes32 decisionId) external {
        Decision storage decision = decisions[decisionId];
        if (decision.decidedAt == 0) revert DecisionNotFound();

        decision.disputed = true;
        emit DecisionDisputed(decisionId, msg.sender);
    }

    /**
     * @notice Vote to override a CEO decision
     * @param decisionId Decision to potentially override
     * @param override_ Whether to override
     * @param reasonHash IPFS hash of reason
     */
    function voteOverride(
        bytes32 decisionId,
        bool override_,
        bytes32 reasonHash
    ) external payable nonReentrant {
        Decision storage decision = decisions[decisionId];
        if (decision.decidedAt == 0) revert DecisionNotFound();
        if (!decision.disputed) revert DecisionNotFound();
        if (block.timestamp > decision.decidedAt + overrideVotingPeriod) {
            revert VotingPeriodEnded();
        }
        if (hasVotedOverride[decisionId][msg.sender]) revert AlreadyVoted();

        overrideVotes[decisionId].push(OverrideVote({
            decisionId: decisionId,
            voter: msg.sender,
            override_: override_,
            weight: msg.value,
            reasonHash: reasonHash,
            votedAt: block.timestamp
        }));
        hasVotedOverride[decisionId][msg.sender] = true;

        // Check if override threshold reached
        uint256 overrideWeight = 0;
        uint256 keepWeight = 0;
        OverrideVote[] storage votes = overrideVotes[decisionId];

        for (uint256 i = 0; i < votes.length; i++) {
            if (votes[i].override_) {
                overrideWeight += votes[i].weight;
            } else {
                keepWeight += votes[i].weight;
            }
        }

        uint256 totalWeight = overrideWeight + keepWeight;
        if (totalWeight > 0 && overrideWeight * 10000 / totalWeight >= overrideThresholdBPS) {
            decision.overridden = true;
            ceoState.overriddenDecisions++;

            // Reduce model benchmark score
            ModelCandidate storage model = modelCandidates[decision.modelId];
            if (model.benchmarkScore > 500) {
                model.benchmarkScore -= 500; // -5%
            }

            emit DecisionOverridden(decisionId, overrideWeight, overrideThresholdBPS);
        }
    }

    // ============================================================================
    // Context & State Management
    // ============================================================================

    /**
     * @notice Update CEO context/values (DAO governance decision)
     * @param newContextHash Hash of new context
     * @param reason Reason for update
     */
    function updateContext(
        bytes32 newContextHash,
        string calldata reason
    ) external onlyOwner {
        bytes32 oldHash = ceoState.contextHash;
        ceoState.contextHash = newContextHash;
        emit ContextUpdated(oldHash, newContextHash, reason);
    }

    /**
     * @notice Update TEE-encrypted state (only TEE oracle)
     * @param newStateHash New encrypted state hash
     */
    function updateEncryptedState(bytes32 newStateHash) external onlyTEE {
        bytes32 oldHash = ceoState.encryptedStateHash;
        ceoState.encryptedStateHash = newStateHash;
        emit TEEStateUpdated(oldHash, newStateHash);
    }

    // ============================================================================
    // Benchmarking
    // ============================================================================

    /**
     * @notice Record benchmark result (did decision match actual outcome)
     * @param decisionId Decision to benchmark
     * @param matched Whether decision matched desired outcome
     */
    function recordBenchmark(
        bytes32 decisionId,
        bool matched
    ) external onlyOwner {
        Decision storage decision = decisions[decisionId];
        if (decision.decidedAt == 0) revert DecisionNotFound();

        benchmarkResults[decision.modelId][decisionId] = matched;

        // Update model benchmark score
        ModelCandidate storage model = modelCandidates[decision.modelId];
        if (model.decisionsCount >= minBenchmarkDecisions) {
            // Calculate running average
            if (matched && model.benchmarkScore < 10000) {
                model.benchmarkScore += (10000 - model.benchmarkScore) / 10;
            } else if (!matched && model.benchmarkScore > 0) {
                model.benchmarkScore -= model.benchmarkScore / 10;
            }
        }

        emit BenchmarkRecorded(decision.modelId, decisionId, matched, model.benchmarkScore);

        // Check if poor performance triggers re-election
        if (model.benchmarkScore < 3000) { // Below 30%
            ceoState.electionCooldown = 0; // Allow immediate election
            _checkElection();
        }
    }

    // ============================================================================
    // View Functions
    // ============================================================================

    function getCurrentModel() external view returns (ModelCandidate memory) {
        return modelCandidates[ceoState.currentModelId];
    }

    function getDecision(bytes32 decisionId) external view returns (Decision memory) {
        return decisions[decisionId];
    }

    function getDecisionForProposal(bytes32 proposalId) external view returns (Decision memory) {
        bytes32 decisionId = proposalDecisions[proposalId];
        return decisions[decisionId];
    }

    function getModelStakes(string calldata modelId) external view returns (ModelStake[] memory) {
        return modelStakes[modelId];
    }

    function getOverrideVotes(bytes32 decisionId) external view returns (OverrideVote[] memory) {
        return overrideVotes[decisionId];
    }

    function getAllModels() external view returns (string[] memory) {
        return allModelIds;
    }

    function getAllDecisions() external view returns (bytes32[] memory) {
        return allDecisionIds;
    }

    function getCEOStats() external view returns (
        string memory currentModelId,
        uint256 totalDecisions,
        uint256 approvedDecisions,
        uint256 overriddenDecisions,
        uint256 approvalRate,
        uint256 overrideRate
    ) {
        currentModelId = ceoState.currentModelId;
        totalDecisions = ceoState.totalDecisions;
        approvedDecisions = ceoState.approvedDecisions;
        overriddenDecisions = ceoState.overriddenDecisions;
        approvalRate = totalDecisions > 0 ? (approvedDecisions * 10000) / totalDecisions : 0;
        overrideRate = totalDecisions > 0 ? (overriddenDecisions * 10000) / totalDecisions : 0;
    }

    // ============================================================================
    // Admin Functions
    // ============================================================================

    function setCouncil(address _council) external onlyOwner {
        require(_council != address(0), "Invalid council");
        council = _council;
    }

    function setTEEOracle(address _teeOracle) external onlyOwner {
        teeOracle = _teeOracle;
    }

    function setParameters(
        uint256 _electionPeriod,
        uint256 _overrideThresholdBPS,
        uint256 _overrideVotingPeriod,
        uint256 _minStakeForNomination,
        uint256 _minBenchmarkDecisions
    ) external onlyOwner {
        electionPeriod = _electionPeriod;
        overrideThresholdBPS = _overrideThresholdBPS;
        overrideVotingPeriod = _overrideVotingPeriod;
        minStakeForNomination = _minStakeForNomination;
        minBenchmarkDecisions = _minBenchmarkDecisions;
    }

    function deactivateModel(string calldata modelId) external onlyOwner {
        modelCandidates[modelId].isActive = false;
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
