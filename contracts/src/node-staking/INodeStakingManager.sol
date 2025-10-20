// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title INodeStakingManager
 * @notice Interface for multi-token node staking system
 * @dev Extensible interface designed for v2 compatibility (futarchy, diversity bonuses)
 */
interface INodeStakingManager {
    // ============ Enums ============
    
    enum Region {
        NorthAmerica,
        SouthAmerica,
        Europe,
        Asia,
        Africa,
        Oceania
    }
    
    // ============ Structs ============
    
    struct NodeStake {
        bytes32 nodeId;
        address operator;
        address stakedToken;
        uint256 stakedAmount;
        uint256 stakedValueUSD;
        address rewardToken;
        string rpcUrl;
        Region geographicRegion;
        uint256 registrationTime;
        uint256 lastClaimTime;
        uint256 totalRewardsClaimed;
        bool isActive;
        bool isSlashed;
    }
    
    struct PerformanceMetrics {
        uint256 uptimeScore;
        uint256 requestsServed;
        uint256 avgResponseTime;
        uint256 lastUpdateTime;
    }
    
    struct OperatorStats {
        uint256 totalNodesActive;
        uint256 totalStakedUSD;
        uint256 lifetimeRewardsUSD;
    }
    
    struct TokenDistribution {
        uint256 totalStaked;
        uint256 totalStakedUSD;
        uint256 nodeCount;
        uint256 rewardBudget;
    }
    
    // ============ Events ============
    
    event NodeRegistered(
        bytes32 indexed nodeId,
        address indexed operator,
        address indexed stakedToken,
        address rewardToken,
        uint256 stakedAmount,
        uint256 stakedValueUSD
    );
    
    event NodeDeregistered(
        bytes32 indexed nodeId,
        address indexed operator
    );
    
    event PerformanceUpdated(
        bytes32 indexed nodeId,
        uint256 uptimeScore,
        uint256 requestsServed,
        uint256 avgResponseTime
    );
    
    event RewardsClaimed(
        bytes32 indexed nodeId,
        address indexed operator,
        address indexed rewardToken,
        uint256 rewardAmount,
        uint256 paymasterFeesETH
    );
    
    event PaymasterFeeDistributed(
        address indexed paymaster,
        uint256 amount,
        string reason
    );
    
    event NodeSlashed(
        bytes32 indexed nodeId,
        address indexed operator,
        uint256 slashAmount,
        string reason
    );
    
    // ============ Core Functions ============
    
    /**
     * @notice Register a new node with multi-token staking
     * @param stakingToken Token to stake (must be in TokenRegistry with paymaster)
     * @param stakeAmount Amount to stake
     * @param rewardToken Token operator wants rewards in (can be different)
     * @param rpcUrl Node's RPC endpoint
     * @param region Geographic region (0-5)
     * @return nodeId Unique identifier for the node
     */
    function registerNode(
        address stakingToken,
        uint256 stakeAmount,
        address rewardToken,
        string calldata rpcUrl,
        Region region
    ) external returns (bytes32 nodeId);
    
    /**
     * @notice Claim accumulated rewards in chosen token
     * @param nodeId Node identifier
     */
    function claimRewards(bytes32 nodeId) external;
    
    /**
     * @notice Deregister node and withdraw stake
     * @param nodeId Node identifier
     */
    function deregisterNode(bytes32 nodeId) external;
    
    /**
     * @notice Update node performance (called by authorized oracle)
     * @param nodeId Node identifier
     * @param uptimeScore Uptime score (0-10000 = 0-100%)
     * @param requestsServed Total requests served
     * @param avgResponseTime Average response time in milliseconds
     */
    function updatePerformance(
        bytes32 nodeId,
        uint256 uptimeScore,
        uint256 requestsServed,
        uint256 avgResponseTime
    ) external;
    
    /**
     * @notice Slash a node for poor performance or violations
     * @param nodeId Node identifier
     * @param slashPercentageBPS Percentage to slash in basis points (0-10000)
     * @param reason Reason for slashing
     */
    function slashNode(
        bytes32 nodeId,
        uint256 slashPercentageBPS,
        string calldata reason
    ) external;
    
    // ============ View Functions ============
    
    function getNodeInfo(bytes32 nodeId) external view returns (
        NodeStake memory node,
        PerformanceMetrics memory perf,
        uint256 pendingRewardsUSD
    );
    
    function getOperatorNodes(address operator) external view returns (bytes32[] memory);
    
    function calculatePendingRewards(bytes32 nodeId) external view returns (uint256 rewardsUSD);
    
    function getNetworkStats() external view returns (
        uint256 totalNodesActive,
        uint256 totalStakedUSD,
        uint256 totalRewardsClaimedUSD
    );
    
    function getTokenDistribution(address token) external view returns (TokenDistribution memory);
    
    function getOperatorStats(address operator) external view returns (OperatorStats memory);
    
    // ============ Admin Functions ============
    
    function setMinStakeUSD(uint256 newMinimum) external;
    
    function setPaymasterFees(uint256 rewardCutBPS, uint256 stakeCutBPS) external;
    
    function addPerformanceOracle(address oracle) external;
    
    function pause() external;
    
    function unpause() external;
}



