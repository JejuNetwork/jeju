// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title BandwidthRewards
 * @author Jeju Network
 * @notice Rewards contract for bandwidth contributors (Grass-style network)
 * @dev Permissionless bandwidth sharing with reputation-based rewards
 *
 * Design Philosophy:
 * - Nodes report their own bandwidth contribution
 * - QoS monitoring service validates and adjusts claims
 * - Reputation affects reward multiplier
 * - No cryptographic proofs - trust emerges from:
 *   - ERC-8004 persistent identity
 *   - Historical performance tracking
 *   - Cross-validation between nodes
 *   - Slashing for provably false claims
 *
 * Reward Model:
 * - Base rate: X JEJU per GB shared
 * - Reputation multiplier: 0.5x to 2x based on history
 * - Quality bonus: Extra for low latency, high uptime
 * - Residential premium: Higher rate for residential IPs
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract BandwidthRewards is Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum NodeType {
        Unknown,
        Datacenter,
        Residential,
        Mobile
    }

    // ============ Structs ============

    struct BandwidthNode {
        address operator;
        uint256 stake;
        uint256 registeredAt;
        uint256 agentId;            // ERC-8004 identity
        NodeType nodeType;
        string region;              // Geographic region
        bool isActive;
        bool isFrozen;
        // Cumulative stats
        uint256 totalBytesShared;   // Total bytes contributed
        uint256 totalSessions;      // Total proxy sessions handled
        uint256 totalEarnings;      // Total JEJU earned
        uint256 lastClaimTime;
    }

    struct NodePerformance {
        uint256 uptimeScore;        // 0-10000 basis points (100.00%)
        uint256 successRate;        // 0-10000 basis points
        uint256 avgLatencyMs;
        uint256 avgBandwidthMbps;
        uint256 lastUpdated;
    }

    struct PendingReward {
        uint256 bytesContributed;
        uint256 sessionsHandled;
        uint256 periodStart;
        uint256 periodEnd;
        uint256 calculatedReward;
        bool claimed;
    }

    struct RewardConfig {
        uint256 baseRatePerGb;      // Base JEJU per GB
        uint256 residentialMultiplier;  // Residential bonus (10000 = 1x)
        uint256 mobileMultiplier;   // Mobile bonus
        uint256 qualityBonusCap;    // Max quality bonus percentage
        uint256 minClaimPeriod;     // Minimum time between claims
        uint256 minBytesForClaim;   // Minimum bytes to claim
    }

    // ============ Constants ============

    uint256 public constant BPS = 10000;
    uint256 public constant MIN_STAKE = 0.01 ether;
    uint256 public constant BYTES_PER_GB = 1073741824;  // 1 GB

    // ============ State ============

    IERC20 public immutable rewardToken;

    mapping(address => BandwidthNode) public nodes;
    mapping(address => NodePerformance) public nodePerformance;
    mapping(address => PendingReward) public pendingRewards;

    address[] public nodeList;
    mapping(address => uint256) internal nodeIndex;

    RewardConfig public config;

    // Authorized reporters (QoS monitoring service)
    mapping(address => bool) public authorizedReporters;

    // Stats
    uint256 public totalNodesRegistered;
    uint256 public totalBytesShared;
    uint256 public totalRewardsDistributed;
    address public treasury;
    address public rewardsPool;  // Where reward tokens come from

    // ============ Events ============

    event NodeRegistered(address indexed node, NodeType nodeType, string region, uint256 stake);
    event NodeDeactivated(address indexed node);
    event BandwidthReported(address indexed node, uint256 bytes_, uint256 sessions);
    event PerformanceUpdated(address indexed node, uint256 uptime, uint256 successRate);
    event RewardsClaimed(address indexed node, uint256 amount, uint256 bytes_);
    event NodeSlashed(address indexed node, uint256 amount, string reason);
    event ReporterAuthorized(address indexed reporter, bool authorized);
    event ConfigUpdated(uint256 baseRate, uint256 residentialMultiplier);

    // ============ Errors ============

    error InsufficientStake();
    error NodeNotActive();
    error NodeIsFrozen();
    error NotAuthorizedReporter();
    error ClaimTooSoon();
    error InsufficientContribution();
    error NothingToClaim();
    error InvalidScore();
    error AlreadyRegistered();

    // ============ Modifiers ============

    modifier onlyReporter() {
        if (!authorizedReporters[msg.sender] && msg.sender != owner()) {
            revert NotAuthorizedReporter();
        }
        _;
    }

    // ============ Constructor ============

    constructor(
        address _rewardToken,
        address _treasury,
        address initialOwner
    ) Ownable(initialOwner) {
        rewardToken = IERC20(_rewardToken);
        treasury = _treasury;
        authorizedReporters[initialOwner] = true;

        // Default config
        config = RewardConfig({
            baseRatePerGb: 1e18,           // 1 JEJU per GB
            residentialMultiplier: 15000,   // 1.5x for residential
            mobileMultiplier: 20000,        // 2x for mobile
            qualityBonusCap: 5000,          // Max 50% quality bonus
            minClaimPeriod: 1 hours,
            minBytesForClaim: 100 * 1024 * 1024  // 100 MB
        });
    }

    // ============ Registration ============

    /**
     * @notice Register as a bandwidth sharing node
     * @param nodeType Type of node (datacenter, residential, mobile)
     * @param region Geographic region
     */
    function registerNode(
        NodeType nodeType,
        string calldata region
    ) external payable nonReentrant whenNotPaused {
        if (msg.value < MIN_STAKE) revert InsufficientStake();
        if (nodes[msg.sender].registeredAt > 0) revert AlreadyRegistered();

        nodes[msg.sender] = BandwidthNode({
            operator: msg.sender,
            stake: msg.value,
            registeredAt: block.timestamp,
            agentId: 0,
            nodeType: nodeType,
            region: region,
            isActive: true,
            isFrozen: false,
            totalBytesShared: 0,
            totalSessions: 0,
            totalEarnings: 0,
            lastClaimTime: block.timestamp
        });

        nodeList.push(msg.sender);
        nodeIndex[msg.sender] = nodeList.length;
        totalNodesRegistered++;

        emit NodeRegistered(msg.sender, nodeType, region, msg.value);
    }

    /**
     * @notice Register with ERC-8004 agent ID
     */
    function registerNodeWithAgent(
        NodeType nodeType,
        string calldata region,
        uint256 agentId
    ) external payable nonReentrant whenNotPaused {
        if (msg.value < MIN_STAKE) revert InsufficientStake();
        if (nodes[msg.sender].registeredAt > 0) revert AlreadyRegistered();

        nodes[msg.sender] = BandwidthNode({
            operator: msg.sender,
            stake: msg.value,
            registeredAt: block.timestamp,
            agentId: agentId,
            nodeType: nodeType,
            region: region,
            isActive: true,
            isFrozen: false,
            totalBytesShared: 0,
            totalSessions: 0,
            totalEarnings: 0,
            lastClaimTime: block.timestamp
        });

        nodeList.push(msg.sender);
        nodeIndex[msg.sender] = nodeList.length;
        totalNodesRegistered++;

        emit NodeRegistered(msg.sender, nodeType, region, msg.value);
    }

    /**
     * @notice Deactivate node and start withdrawal process
     */
    function deactivateNode() external nonReentrant {
        BandwidthNode storage node = nodes[msg.sender];
        if (!node.isActive) revert NodeNotActive();

        node.isActive = false;
        totalNodesRegistered--;

        emit NodeDeactivated(msg.sender);
    }

    // ============ Bandwidth Reporting ============

    /**
     * @notice Report bandwidth contribution (called by authorized reporter)
     * @param node Node address
     * @param bytesShared Bytes shared in this period
     * @param sessionsHandled Sessions handled in this period
     */
    function reportBandwidth(
        address node,
        uint256 bytesShared,
        uint256 sessionsHandled
    ) external onlyReporter {
        BandwidthNode storage n = nodes[node];
        if (!n.isActive) revert NodeNotActive();
        if (n.isFrozen) revert NodeIsFrozen();

        // Update cumulative stats
        n.totalBytesShared += bytesShared;
        n.totalSessions += sessionsHandled;
        totalBytesShared += bytesShared;

        // Update pending rewards
        PendingReward storage pending = pendingRewards[node];
        if (pending.periodStart == 0) {
            pending.periodStart = block.timestamp;
        }
        pending.bytesContributed += bytesShared;
        pending.sessionsHandled += sessionsHandled;
        pending.periodEnd = block.timestamp;
        pending.calculatedReward = _calculateReward(node, pending.bytesContributed);

        emit BandwidthReported(node, bytesShared, sessionsHandled);
    }

    /**
     * @notice Update node performance metrics (called by QoS monitor)
     */
    function reportPerformance(
        address node,
        uint256 uptimeScore,
        uint256 successRate,
        uint256 avgLatencyMs,
        uint256 avgBandwidthMbps
    ) external onlyReporter {
        if (uptimeScore > BPS || successRate > BPS) revert InvalidScore();

        nodePerformance[node] = NodePerformance({
            uptimeScore: uptimeScore,
            successRate: successRate,
            avgLatencyMs: avgLatencyMs,
            avgBandwidthMbps: avgBandwidthMbps,
            lastUpdated: block.timestamp
        });

        emit PerformanceUpdated(node, uptimeScore, successRate);
    }

    // ============ Rewards ============

    /**
     * @notice Claim accumulated rewards
     */
    function claimRewards() external nonReentrant {
        BandwidthNode storage node = nodes[msg.sender];
        if (!node.isActive && node.registeredAt == 0) revert NodeNotActive();
        if (node.isFrozen) revert NodeIsFrozen();

        PendingReward storage pending = pendingRewards[msg.sender];
        if (pending.claimed || pending.calculatedReward == 0) revert NothingToClaim();
        if (pending.bytesContributed < config.minBytesForClaim) revert InsufficientContribution();
        if (block.timestamp - node.lastClaimTime < config.minClaimPeriod) revert ClaimTooSoon();

        uint256 reward = pending.calculatedReward;
        uint256 bytes_ = pending.bytesContributed;

        // Reset pending
        pending.bytesContributed = 0;
        pending.sessionsHandled = 0;
        pending.periodStart = 0;
        pending.periodEnd = 0;
        pending.calculatedReward = 0;
        pending.claimed = false;

        // Update node
        node.totalEarnings += reward;
        node.lastClaimTime = block.timestamp;
        totalRewardsDistributed += reward;

        // Transfer rewards
        if (rewardsPool != address(0)) {
            rewardToken.safeTransferFrom(rewardsPool, msg.sender, reward);
        } else {
            rewardToken.safeTransfer(msg.sender, reward);
        }

        emit RewardsClaimed(msg.sender, reward, bytes_);
    }

    /**
     * @notice Get estimated reward for pending contribution
     */
    function getEstimatedReward(address node) external view returns (uint256) {
        PendingReward storage pending = pendingRewards[node];
        return _calculateReward(node, pending.bytesContributed);
    }

    // ============ Queries ============

    /**
     * @notice Get node info
     */
    function getNode(address node) external view returns (BandwidthNode memory) {
        return nodes[node];
    }

    /**
     * @notice Get active nodes
     */
    function getActiveNodes() external view returns (address[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < nodeList.length; i++) {
            if (nodes[nodeList[i]].isActive) activeCount++;
        }

        address[] memory active = new address[](activeCount);
        uint256 j = 0;
        for (uint256 i = 0; i < nodeList.length; i++) {
            if (nodes[nodeList[i]].isActive) active[j++] = nodeList[i];
        }

        return active;
    }

    /**
     * @notice Get nodes by type
     */
    function getNodesByType(NodeType nodeType) external view returns (address[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < nodeList.length; i++) {
            if (nodes[nodeList[i]].isActive && nodes[nodeList[i]].nodeType == nodeType) {
                count++;
            }
        }

        address[] memory result = new address[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < nodeList.length; i++) {
            if (nodes[nodeList[i]].isActive && nodes[nodeList[i]].nodeType == nodeType) {
                result[j++] = nodeList[i];
            }
        }

        return result;
    }

    /**
     * @notice Get pending reward info
     */
    function getPendingReward(address node) external view returns (PendingReward memory) {
        return pendingRewards[node];
    }

    // ============ Admin ============

    /**
     * @notice Authorize a reporter
     */
    function setReporter(address reporter, bool authorized) external onlyOwner {
        authorizedReporters[reporter] = authorized;
        emit ReporterAuthorized(reporter, authorized);
    }

    /**
     * @notice Update reward configuration
     */
    function setConfig(
        uint256 baseRatePerGb,
        uint256 residentialMultiplier,
        uint256 mobileMultiplier,
        uint256 qualityBonusCap,
        uint256 minClaimPeriod,
        uint256 minBytesForClaim
    ) external onlyOwner {
        config = RewardConfig({
            baseRatePerGb: baseRatePerGb,
            residentialMultiplier: residentialMultiplier,
            mobileMultiplier: mobileMultiplier,
            qualityBonusCap: qualityBonusCap,
            minClaimPeriod: minClaimPeriod,
            minBytesForClaim: minBytesForClaim
        });

        emit ConfigUpdated(baseRatePerGb, residentialMultiplier);
    }

    /**
     * @notice Slash a node
     */
    function slashNode(address node, uint256 amount, string calldata reason) external onlyOwner {
        BandwidthNode storage n = nodes[node];
        uint256 toSlash = amount > n.stake ? n.stake : amount;

        n.stake -= toSlash;
        n.isFrozen = true;

        if (treasury != address(0) && toSlash > 0) {
            (bool success, ) = treasury.call{value: toSlash}("");
            require(success, "Transfer failed");
        }

        emit NodeSlashed(node, toSlash, reason);
    }

    /**
     * @notice Freeze/unfreeze a node
     */
    function setNodeFrozen(address node, bool frozen) external onlyOwner {
        nodes[node].isFrozen = frozen;
    }

    /**
     * @notice Set rewards pool address
     */
    function setRewardsPool(address pool) external onlyOwner {
        rewardsPool = pool;
    }

    /**
     * @notice Set treasury address
     */
    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Internal ============

    function _calculateReward(address node, uint256 bytes_) internal view returns (uint256) {
        if (bytes_ == 0) return 0;

        BandwidthNode storage n = nodes[node];
        NodePerformance storage perf = nodePerformance[node];

        // Base reward
        uint256 gbContributed = bytes_ / BYTES_PER_GB;
        if (gbContributed == 0 && bytes_ > 0) gbContributed = 1;  // Min 1 GB equivalent

        uint256 baseReward = gbContributed * config.baseRatePerGb;

        // Node type multiplier
        uint256 typeMultiplier = BPS;
        if (n.nodeType == NodeType.Residential) {
            typeMultiplier = config.residentialMultiplier;
        } else if (n.nodeType == NodeType.Mobile) {
            typeMultiplier = config.mobileMultiplier;
        }

        // Quality bonus based on performance
        uint256 qualityBonus = 0;
        if (perf.lastUpdated > 0) {
            // Higher uptime and success rate = higher bonus
            uint256 qualityScore = (perf.uptimeScore + perf.successRate) / 2;
            qualityBonus = (qualityScore * config.qualityBonusCap) / BPS;
        }

        // Final calculation: base * typeMultiplier * (1 + qualityBonus)
        uint256 reward = (baseReward * typeMultiplier / BPS) * (BPS + qualityBonus) / BPS;

        return reward;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
