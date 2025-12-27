// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ITrainingCoordinator} from "./interfaces/ITrainingCoordinator.sol";
import {ComputeRegistry} from "../compute/ComputeRegistry.sol";

/**
 * @title NodePerformanceOracle
 * @author Jeju Network
 * @notice Tracks training node performance metrics for intelligent work distribution
 * @dev Integrates with ERC-8004 ReputationRegistry for cross-system reputation
 *
 * Metrics Tracked:
 * - Rounds participated / completed
 * - Witness reliability (successful witness submissions)
 * - Network latency and bandwidth
 * - Tokens per second (training throughput)
 * - GPU tier classification
 *
 * Score Calculation:
 * - 40% GPU tier (h100=100, a100=80, 4090=60, etc.)
 * - 30% Bandwidth (normalized to 0-100)
 * - 20% Tokens per second (normalized)
 * - 10% Reliability (completion rate)
 */
contract NodePerformanceOracle is Ownable, ReentrancyGuard {
    enum GPUTier {
        Unknown, // 0
        Consumer, // 1 - RTX 3090, 4080, etc.
        Prosumer, // 2 - RTX 4090, A5000
        Datacenter, // 3 - A100, A10G
        HighEnd // 4 - H100, H200

    }

    struct NodeMetrics {
        // Participation metrics
        uint64 totalRoundsParticipated;
        uint64 successfulRounds;
        uint64 droppedRounds;
        uint64 witnessSubmissions;
        uint64 successfulWitnesses;
        // Performance metrics
        uint64 averageLatencyMs;
        uint64 averageBandwidthMbps;
        uint64 averageTokensPerSec;
        // Classification
        GPUTier gpuTier;
        bytes32 attestationHash;
        // Timestamps
        uint64 lastActiveTimestamp;
        uint64 registeredAt;
        // Computed score (updated periodically)
        uint8 score;
    }

    struct RunParticipation {
        uint64 roundsParticipated;
        uint64 roundsCompleted;
        uint64 witnessesSubmitted;
        uint16 lastEpoch;
        bool active;
    }

    struct MetricReport {
        uint64 latencyMs;
        uint64 bandwidthMbps;
        uint64 tokensPerSec;
        uint32 roundHeight;
        bytes32 runId;
    }

    /// @notice Node metrics by address
    mapping(address => NodeMetrics) public nodeMetrics;

    /// @notice Run participation (node => runId => participation)
    mapping(address => mapping(bytes32 => RunParticipation)) public runParticipation;

    /// @notice All registered nodes
    address[] public registeredNodes;

    /// @notice Node index in registeredNodes array (address => index + 1, 0 = not found)
    mapping(address => uint256) internal nodeIndex;

    /// @notice Training coordinator
    ITrainingCoordinator public coordinator;

    /// @notice Compute registry for attestation verification
    ComputeRegistry public computeRegistry;

    /// @notice Authorized metric reporters (training clients, witnesses)
    mapping(address => bool) public authorizedReporters;

    /// @notice Minimum rounds before score is calculated
    uint64 public minRoundsForScore = 10;

    /// @notice GPU tier score multipliers (basis points, 100 = 1x)
    mapping(GPUTier => uint16) public gpuTierMultipliers;

    event NodeRegistered(address indexed node, GPUTier gpuTier, bytes32 attestationHash);
    event MetricsUpdated(address indexed node, uint64 latency, uint64 bandwidth, uint64 tps);
    event RoundParticipationRecorded(bytes32 indexed runId, address indexed node, bool successful);
    event WitnessRecorded(bytes32 indexed runId, address indexed node, bool successful);
    event ScoreUpdated(address indexed node, uint8 oldScore, uint8 newScore);
    event GPUTierUpdated(address indexed node, GPUTier oldTier, GPUTier newTier);
    event ReporterUpdated(address indexed reporter, bool authorized);

    error NodeNotRegistered();
    error AlreadyRegistered();
    error NotAuthorizedReporter();
    error InvalidMetrics();
    error InvalidGPUTier();

    modifier onlyReporter() {
        if (!authorizedReporters[msg.sender] && msg.sender != owner()) {
            revert NotAuthorizedReporter();
        }
        _;
    }

    modifier nodeExists(address node) {
        if (nodeMetrics[node].registeredAt == 0) revert NodeNotRegistered();
        _;
    }

    constructor(address _coordinator, address _computeRegistry, address initialOwner) Ownable(initialOwner) {
        coordinator = ITrainingCoordinator(_coordinator);
        computeRegistry = ComputeRegistry(_computeRegistry);
        authorizedReporters[initialOwner] = true;

        // Set default GPU tier multipliers
        gpuTierMultipliers[GPUTier.Unknown] = 10; // 0.1x
        gpuTierMultipliers[GPUTier.Consumer] = 50; // 0.5x
        gpuTierMultipliers[GPUTier.Prosumer] = 75; // 0.75x
        gpuTierMultipliers[GPUTier.Datacenter] = 90; // 0.9x
        gpuTierMultipliers[GPUTier.HighEnd] = 100; // 1.0x
    }

    /**
     * @notice Register a node for performance tracking
     * @param gpuTier GPU tier classification
     * @param attestationHash TEE attestation hash (from ComputeRegistry)
     */
    function registerNode(GPUTier gpuTier, bytes32 attestationHash) external nonReentrant {
        if (nodeMetrics[msg.sender].registeredAt != 0) revert AlreadyRegistered();

        // Verify node is registered in compute registry
        ComputeRegistry.Provider memory provider = computeRegistry.getProvider(msg.sender);
        if (provider.registeredAt == 0) revert NodeNotRegistered();

        nodeMetrics[msg.sender] = NodeMetrics({
            totalRoundsParticipated: 0,
            successfulRounds: 0,
            droppedRounds: 0,
            witnessSubmissions: 0,
            successfulWitnesses: 0,
            averageLatencyMs: 0,
            averageBandwidthMbps: 0,
            averageTokensPerSec: 0,
            gpuTier: gpuTier,
            attestationHash: attestationHash,
            lastActiveTimestamp: uint64(block.timestamp),
            registeredAt: uint64(block.timestamp),
            score: 50 // Default score
        });

        registeredNodes.push(msg.sender);
        nodeIndex[msg.sender] = registeredNodes.length;

        emit NodeRegistered(msg.sender, gpuTier, attestationHash);
    }

    /**
     * @notice Report performance metrics for a node
     * @param node Node address
     * @param report Metric report data
     */
    function reportMetrics(address node, MetricReport calldata report) external onlyReporter nodeExists(node) {
        NodeMetrics storage metrics = nodeMetrics[node];

        // Update running averages (exponential moving average with alpha=0.2)
        if (metrics.averageLatencyMs == 0) {
            metrics.averageLatencyMs = report.latencyMs;
            metrics.averageBandwidthMbps = report.bandwidthMbps;
            metrics.averageTokensPerSec = report.tokensPerSec;
        } else {
            metrics.averageLatencyMs = _ema(metrics.averageLatencyMs, report.latencyMs);
            metrics.averageBandwidthMbps = _ema(metrics.averageBandwidthMbps, report.bandwidthMbps);
            metrics.averageTokensPerSec = _ema(metrics.averageTokensPerSec, report.tokensPerSec);
        }

        metrics.lastActiveTimestamp = uint64(block.timestamp);

        emit MetricsUpdated(node, report.latencyMs, report.bandwidthMbps, report.tokensPerSec);

        // Update score if enough data
        if (metrics.totalRoundsParticipated >= minRoundsForScore) {
            _updateScore(node, metrics);
        }
    }

    /**
     * @notice Record round participation for a node
     * @param runId Training run ID
     * @param node Node address
     * @param successful Whether the round was successful
     */
    function recordRoundParticipation(bytes32 runId, address node, bool successful)
        external
        onlyReporter
        nodeExists(node)
    {
        NodeMetrics storage metrics = nodeMetrics[node];
        RunParticipation storage participation = runParticipation[node][runId];

        metrics.totalRoundsParticipated++;
        participation.roundsParticipated++;

        if (successful) {
            metrics.successfulRounds++;
            participation.roundsCompleted++;
        } else {
            metrics.droppedRounds++;
        }

        metrics.lastActiveTimestamp = uint64(block.timestamp);
        participation.active = true;

        emit RoundParticipationRecorded(runId, node, successful);

        // Update score
        if (metrics.totalRoundsParticipated >= minRoundsForScore) {
            _updateScore(node, metrics);
        }
    }

    /**
     * @notice Record batch round participation for multiple nodes
     * @param runId Training run ID
     * @param nodes Array of node addresses
     * @param successful Array of success flags
     */
    function recordBatchRoundParticipation(bytes32 runId, address[] calldata nodes, bool[] calldata successful)
        external
        onlyReporter
    {
        if (nodes.length != successful.length) revert InvalidMetrics();

        for (uint256 i = 0; i < nodes.length; i++) {
            if (nodeMetrics[nodes[i]].registeredAt == 0) continue;

            NodeMetrics storage metrics = nodeMetrics[nodes[i]];
            RunParticipation storage participation = runParticipation[nodes[i]][runId];

            metrics.totalRoundsParticipated++;
            participation.roundsParticipated++;

            if (successful[i]) {
                metrics.successfulRounds++;
                participation.roundsCompleted++;
            } else {
                metrics.droppedRounds++;
            }

            metrics.lastActiveTimestamp = uint64(block.timestamp);
            participation.active = true;

            emit RoundParticipationRecorded(runId, nodes[i], successful[i]);
        }
    }

    /**
     * @notice Record witness submission for a node
     * @param runId Training run ID
     * @param node Node address
     * @param successful Whether the witness was accepted
     */
    function recordWitness(bytes32 runId, address node, bool successful) external onlyReporter nodeExists(node) {
        NodeMetrics storage metrics = nodeMetrics[node];
        RunParticipation storage participation = runParticipation[node][runId];

        metrics.witnessSubmissions++;
        participation.witnessesSubmitted++;

        if (successful) {
            metrics.successfulWitnesses++;
        }

        metrics.lastActiveTimestamp = uint64(block.timestamp);

        emit WitnessRecorded(runId, node, successful);
    }

    /**
     * @notice Get the performance score for a node
     * @param node Node address
     * @return score Performance score (0-100)
     */
    function getNodeScore(address node) external view returns (uint8) {
        NodeMetrics storage metrics = nodeMetrics[node];
        if (metrics.registeredAt == 0) return 0;
        return metrics.score;
    }

    /**
     * @notice Calculate score for a node (view function)
     * @param node Node address
     * @return score Calculated score (0-100)
     */
    function calculateScore(address node) external view returns (uint8) {
        NodeMetrics storage metrics = nodeMetrics[node];
        if (metrics.registeredAt == 0) return 0;
        return _calculateScore(metrics);
    }

    function _calculateScore(NodeMetrics storage metrics) internal view returns (uint8) {
        // Component scores (0-100 each)

        // 1. GPU tier score (40% weight)
        uint256 gpuScore = gpuTierMultipliers[metrics.gpuTier];

        // 2. Bandwidth score (30% weight) - normalize to 0-100 based on typical range 0-10Gbps
        uint256 bandwidthScore =
            metrics.averageBandwidthMbps > 10000 ? 100 : (metrics.averageBandwidthMbps * 100) / 10000;

        // 3. TPS score (20% weight) - normalize based on typical range 0-1000 tokens/sec
        uint256 tpsScore = metrics.averageTokensPerSec > 1000 ? 100 : (metrics.averageTokensPerSec * 100) / 1000;

        // 4. Reliability score (10% weight) - completion rate
        uint256 reliabilityScore = metrics.totalRoundsParticipated > 0
            ? (metrics.successfulRounds * 100) / metrics.totalRoundsParticipated
            : 50;

        // Weighted average
        uint256 totalScore = (gpuScore * 40) + (bandwidthScore * 30) + (tpsScore * 20) + (reliabilityScore * 10);

        return uint8(totalScore / 100);
    }

    function _updateScore(address node, NodeMetrics storage metrics) internal {
        uint8 oldScore = metrics.score;
        uint8 newScore = _calculateScore(metrics);

        if (newScore != oldScore) {
            metrics.score = newScore;
            emit ScoreUpdated(node, oldScore, newScore);
        }
    }

    /**
     * @notice Get optimal nodes for a training run
     * @param count Number of nodes to select
     * @param minGpuTier Minimum GPU tier required
     * @param minBandwidth Minimum bandwidth in Mbps
     * @param minScore Minimum performance score
     * @return selected Array of selected node addresses
     */
    function getOptimalNodes(uint16 count, GPUTier minGpuTier, uint64 minBandwidth, uint8 minScore)
        external
        view
        returns (address[] memory selected)
    {
        // Count eligible nodes
        uint256 eligibleCount = 0;
        for (uint256 i = 0; i < registeredNodes.length; i++) {
            if (_isEligible(registeredNodes[i], minGpuTier, minBandwidth, minScore)) {
                eligibleCount++;
            }
        }

        if (eligibleCount == 0) return new address[](0);

        // Collect eligible nodes with scores
        address[] memory eligible = new address[](eligibleCount);
        uint8[] memory scores = new uint8[](eligibleCount);
        uint256 idx = 0;

        for (uint256 i = 0; i < registeredNodes.length; i++) {
            address node = registeredNodes[i];
            if (_isEligible(node, minGpuTier, minBandwidth, minScore)) {
                eligible[idx] = node;
                scores[idx] = nodeMetrics[node].score;
                idx++;
            }
        }

        // Sort by score (simple insertion sort for small arrays)
        for (uint256 i = 1; i < eligibleCount; i++) {
            uint256 j = i;
            while (j > 0 && scores[j - 1] < scores[j]) {
                (scores[j - 1], scores[j]) = (scores[j], scores[j - 1]);
                (eligible[j - 1], eligible[j]) = (eligible[j], eligible[j - 1]);
                j--;
            }
        }

        // Return top N
        uint256 resultCount = count > eligibleCount ? eligibleCount : count;
        selected = new address[](resultCount);
        for (uint256 i = 0; i < resultCount; i++) {
            selected[i] = eligible[i];
        }
    }

    /**
     * @notice Get all nodes above a minimum score
     * @param minScore Minimum performance score
     * @return nodes Array of node addresses
     * @return nodeScores Array of scores
     */
    function getNodesAboveScore(uint8 minScore)
        external
        view
        returns (address[] memory nodes, uint8[] memory nodeScores)
    {
        uint256 count = 0;
        for (uint256 i = 0; i < registeredNodes.length; i++) {
            if (nodeMetrics[registeredNodes[i]].score >= minScore) {
                count++;
            }
        }

        nodes = new address[](count);
        nodeScores = new uint8[](count);
        uint256 idx = 0;

        for (uint256 i = 0; i < registeredNodes.length; i++) {
            address node = registeredNodes[i];
            if (nodeMetrics[node].score >= minScore) {
                nodes[idx] = node;
                nodeScores[idx] = nodeMetrics[node].score;
                idx++;
            }
        }
    }

    /**
     * @notice Get full metrics for a node
     */
    function getNodeMetrics(address node) external view returns (NodeMetrics memory) {
        return nodeMetrics[node];
    }

    /**
     * @notice Get run participation for a node
     */
    function getRunParticipation(address node, bytes32 runId) external view returns (RunParticipation memory) {
        return runParticipation[node][runId];
    }

    /**
     * @notice Get total registered node count
     */
    function getNodeCount() external view returns (uint256) {
        return registeredNodes.length;
    }

    /**
     * @notice Get nodes by GPU tier
     */
    function getNodesByGPUTier(GPUTier tier) external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < registeredNodes.length; i++) {
            if (nodeMetrics[registeredNodes[i]].gpuTier == tier) {
                count++;
            }
        }

        address[] memory nodes = new address[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < registeredNodes.length; i++) {
            if (nodeMetrics[registeredNodes[i]].gpuTier == tier) {
                nodes[idx++] = registeredNodes[i];
            }
        }

        return nodes;
    }

    /**
     * @notice Check if a node is active (activity in last hour)
     */
    function isNodeActive(address node) external view returns (bool) {
        NodeMetrics storage metrics = nodeMetrics[node];
        return metrics.registeredAt > 0 && block.timestamp - metrics.lastActiveTimestamp < 1 hours;
    }

    function _isEligible(address node, GPUTier minGpuTier, uint64 minBandwidth, uint8 minScore)
        internal
        view
        returns (bool)
    {
        NodeMetrics storage metrics = nodeMetrics[node];

        // Check if node is active (last seen within 1 hour)
        if (block.timestamp - metrics.lastActiveTimestamp > 1 hours) return false;

        // Check GPU tier
        if (uint8(metrics.gpuTier) < uint8(minGpuTier)) return false;

        // Check bandwidth
        if (metrics.averageBandwidthMbps < minBandwidth) return false;

        // Check score
        if (metrics.score < minScore) return false;

        return true;
    }

    function _ema(uint64 current, uint64 newValue) internal pure returns (uint64) {
        // Exponential moving average with alpha = 0.2
        // EMA = alpha * new + (1 - alpha) * current
        return uint64((2 * uint256(newValue) + 8 * uint256(current)) / 10);
    }

    /**
     * @notice Update GPU tier for a node (admin or self)
     */
    function updateGPUTier(address node, GPUTier newTier) external nodeExists(node) {
        if (msg.sender != node && msg.sender != owner()) revert NotAuthorizedReporter();

        NodeMetrics storage metrics = nodeMetrics[node];
        GPUTier oldTier = metrics.gpuTier;
        metrics.gpuTier = newTier;

        emit GPUTierUpdated(node, oldTier, newTier);

        // Recalculate score
        _updateScore(node, metrics);
    }

    /**
     * @notice Set reporter authorization
     */
    function setReporter(address reporter, bool authorized) external onlyOwner {
        authorizedReporters[reporter] = authorized;
        emit ReporterUpdated(reporter, authorized);
    }

    /**
     * @notice Set GPU tier multiplier
     */
    function setGPUTierMultiplier(GPUTier tier, uint16 multiplier) external onlyOwner {
        gpuTierMultipliers[tier] = multiplier;
    }

    /**
     * @notice Set minimum rounds for score calculation
     */
    function setMinRoundsForScore(uint64 minRounds) external onlyOwner {
        minRoundsForScore = minRounds;
    }

    /**
     * @notice Update coordinator contract
     */
    function setCoordinator(address _coordinator) external onlyOwner {
        coordinator = ITrainingCoordinator(_coordinator);
    }

    /**
     * @notice Update compute registry
     */
    function setComputeRegistry(address _computeRegistry) external onlyOwner {
        computeRegistry = ComputeRegistry(_computeRegistry);
    }

    /**
     * @notice Force recalculate score for a node
     */
    function recalculateScore(address node) external onlyOwner nodeExists(node) {
        _updateScore(node, nodeMetrics[node]);
    }

    /**
     * @notice Contract version
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
