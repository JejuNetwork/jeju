// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IStaking
 * @author Jeju Network
 * @notice Common interface for all staking contracts
 * @dev This interface defines the core staking functionality that all
 *      staking contracts should implement for consistency.
 *
 * Implementations:
 * - RPCStakingManager: RPC access tier-based staking
 * - NodeStakingManager: Node operator multi-token staking
 * - ComputeStaking: Compute marketplace user/provider/guardian staking
 *
 * All staking contracts should support:
 * - Basic stake/unstake with unbonding
 * - ERC-8004 agent linking
 * - Moderation (freeze/slash)
 * - Position queries
 */
interface IStaking {
    // ============ Common Structs ============

    /**
     * @notice Common stake position fields
     * @dev Implementations may extend this with additional fields
     */
    struct Position {
        uint256 amount;
        uint256 stakedAt;
        uint256 unbondingAmount;
        uint256 unbondingStartTime;
        uint256 agentId;
        bool isActive;
        bool isFrozen;
        bool isSlashed;
    }

    // ============ Common Events ============

    event Staked(address indexed user, uint256 amount);
    event UnbondingStarted(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event AgentLinked(address indexed user, uint256 indexed agentId);
    event StakeFrozen(address indexed user, string reason, address indexed moderator);
    event StakeUnfrozen(address indexed user, address indexed moderator);
    event StakeSlashed(address indexed user, uint256 amount, string reason, address indexed moderator);

    // ============ Common Errors ============

    error InsufficientBalance();
    error InvalidAmount();
    error StakeFrozenError();
    error NotUnbonding();
    error UnbondingInProgress();
    error UnbondingNotComplete();
    error AgentNotOwned();
    error AgentAlreadyLinked();
    error UserIsBanned();
    error NotModerator();
    error TransferFailed();

    // ============ Core Staking Functions ============

    /**
     * @notice Get the unbonding period for this staking contract
     * @return period Unbonding period in seconds
     */
    function unbondingPeriod() external view returns (uint256 period);

    /**
     * @notice Get total amount staked in the contract
     * @return total Total staked amount
     */
    function totalStaked() external view returns (uint256 total);

    /**
     * @notice Get total number of stakers
     * @return count Total staker count
     */
    function totalStakers() external view returns (uint256 count);

    // ============ Position Queries ============

    /**
     * @notice Get user's staked amount
     * @param user User address
     * @return amount Staked amount
     */
    function getStakedAmount(address user) external view returns (uint256 amount);

    /**
     * @notice Check if user has an active stake
     * @param user User address
     * @return active True if user has active stake
     */
    function isStaked(address user) external view returns (bool active);

    /**
     * @notice Check if user's stake is frozen
     * @param user User address
     * @return frozen True if stake is frozen
     */
    function isFrozen(address user) external view returns (bool frozen);

    /**
     * @notice Check if user's stake has been slashed
     * @param user User address
     * @return slashed True if stake has been slashed
     */
    function isSlashed(address user) external view returns (bool slashed);

    // ============ Agent Integration ============

    /**
     * @notice Get the agent ID linked to a user's stake
     * @param user User address
     * @return agentId Agent ID (0 if not linked)
     */
    function getAgentId(address user) external view returns (uint256 agentId);

    // ============ Admin Functions ============

    /**
     * @notice Set the identity registry for agent verification
     * @param registry New identity registry address
     */
    function setIdentityRegistry(address registry) external;

    /**
     * @notice Set the ban manager for moderation
     * @param manager New ban manager address
     */
    function setBanManager(address manager) external;

    /**
     * @notice Pause the staking contract
     */
    function pause() external;

    /**
     * @notice Unpause the staking contract
     */
    function unpause() external;

    /**
     * @notice Get contract version
     * @return ver Version string
     */
    function version() external pure returns (string memory ver);
}

/**
 * @title IStakingWithModeration
 * @notice Extended interface for staking contracts with moderation capabilities
 */
interface IStakingWithModeration is IStaking {
    /**
     * @notice Freeze a user's stake (moderator only)
     * @param user User address
     * @param reason Reason for freezing
     */
    function freezeStake(address user, string calldata reason) external;

    /**
     * @notice Unfreeze a user's stake (moderator only)
     * @param user User address
     */
    function unfreezeStake(address user) external;

    /**
     * @notice Slash a user's stake (moderator only)
     * @param user User address
     * @param amount Amount to slash
     * @param reason Reason for slashing
     */
    function slashStake(address user, uint256 amount, string calldata reason) external;
}

/**
 * @title IStakingWithTiers
 * @notice Extended interface for staking contracts with tier systems
 */
interface IStakingWithTiers is IStaking {
    /**
     * @notice Get user's current tier
     * @param user User address
     * @return tier Tier level
     */
    function getTier(address user) external view returns (uint256 tier);

    /**
     * @notice Get rate limit for user's tier
     * @param user User address
     * @return rateLimit Rate limit (0 = unlimited)
     */
    function getRateLimit(address user) external view returns (uint256 rateLimit);

    /**
     * @notice Check if user can access the service
     * @param user User address
     * @return canAccess True if user can access
     */
    function canAccess(address user) external view returns (bool canAccess);
}

/**
 * @title IStakingWithRewards
 * @notice Extended interface for staking contracts with reward systems
 */
interface IStakingWithRewards is IStaking {
    /**
     * @notice Get pending rewards for a user/position
     * @param user User address or position identifier
     * @return rewards Pending reward amount
     */
    function getPendingRewards(address user) external view returns (uint256 rewards);

    /**
     * @notice Claim pending rewards
     */
    function claimRewards() external;
}
