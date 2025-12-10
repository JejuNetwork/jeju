// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IRPCStakingManager
 * @notice Interface for RPC access staking with reputation-based discounts
 */
interface IRPCStakingManager {
    // ============ Enums ============

    enum Tier {
        FREE,      // $0 - 10 req/min
        BASIC,     // $10 - 100 req/min
        PRO,       // $100 - 1000 req/min
        UNLIMITED  // $1000 - unlimited
    }

    struct StakePosition {
        uint256 stakedAmount;
        uint256 stakedAt;
        uint256 unbondingAmount;
        uint256 unbondingStartTime;
        uint256 agentId;
        bool isActive;
        bool isFrozen;
    }

    struct TierConfig {
        uint256 minUsdValue; // USD value in 8 decimals (e.g., 1000000000 = $10)
        uint256 rateLimit;   // requests per minute (0 = unlimited)
    }

    // ============ Events ============

    event Staked(address indexed user, uint256 amount, Tier tier);
    event UnbondingStarted(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event TierChanged(address indexed user, Tier oldTier, Tier newTier);
    event AgentLinked(address indexed user, uint256 indexed agentId);
    event ReputationProviderUpdated(address indexed provider);
    event PriceOracleUpdated(address indexed oracle);
    event TierConfigUpdated(Tier indexed tier, uint256 minUsdValue, uint256 rateLimit);
    event StakeFrozen(address indexed user, string reason, address indexed moderator);
    event StakeUnfrozen(address indexed user, address indexed moderator);
    event StakeSlashed(address indexed user, uint256 amount, bytes32 indexed reportId, address indexed moderator);

    // ============ Errors ============

    error InsufficientStake();
    error InsufficientBalance();
    error StillUnbonding();
    error NotUnbonding();
    error InvalidAmount();
    error TransferFailed();
    error AgentNotOwned();
    error AlreadyLinked();
    error StakeIsFrozen();
    error StakeNotFrozen();
    error NotModerator();

    // ============ Core Functions ============

    function stake(uint256 amount) external;
    function stakeWithAgent(uint256 amount, uint256 agentId) external;
    function startUnbonding(uint256 amount) external;
    function completeUnstaking() external;
    function linkAgent(uint256 agentId) external;

    // ============ Moderation Functions ============

    function freezeStake(address user, string calldata reason) external;
    function unfreezeStake(address user) external;
    function slashStake(address user, uint256 amount, bytes32 reportId) external;

    // ============ View Functions ============

    function getPosition(address user) external view returns (StakePosition memory);
    function getTier(address user) external view returns (Tier);
    function getRateLimit(address user) external view returns (uint256);
    function getEffectiveStake(address user) external view returns (uint256);
    function getStakeUsdValue(address user) external view returns (uint256);
    function getJejuPrice() external view returns (uint256);
    function getReputationDiscount(address user) external view returns (uint256);
    function getTierConfig(Tier tier) external view returns (TierConfig memory);
    function canAccess(address user) external view returns (bool);
    function isFrozen(address user) external view returns (bool);
}
