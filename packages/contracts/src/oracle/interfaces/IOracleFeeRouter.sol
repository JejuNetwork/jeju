// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IOracleFeeRouter
 * @author Jeju Network
 * @notice Interface for oracle payment distribution and subscriptions
 */
interface IOracleFeeRouter {
    // ============ Enums ============

    enum PaymentType {
        SUBSCRIPTION,
        PER_READ,
        DISPUTE_BOND,
        SLASH_DISTRIBUTION
    }

    // ============ Structs ============

    struct FeeConfig {
        uint256 subscriptionFeePerMonth;
        uint256 perReadFee;
        uint16 treasuryShareBps;
        uint16 operatorShareBps;
        uint16 delegatorShareBps;
        uint16 disputerRewardBps;
    }

    struct Subscription {
        address subscriber;
        bytes32[] feedIds;
        uint256 startTime;
        uint256 endTime;
        uint256 amountPaid;
        bool isActive;
    }

    struct OperatorEarnings {
        bytes32 operatorId;
        uint256 totalEarned;
        uint256 totalClaimed;
        uint256 pendingRewards;
        uint256 lastClaimTime;
    }

    struct EpochRewards {
        uint256 epochNumber;
        uint256 totalFees;
        uint256 operatorPool;
        uint256 delegatorPool;
        uint256 treasuryShare;
        uint256 distributed;
        bool finalized;
    }

    // ============ Events ============

    event SubscriptionCreated(
        bytes32 indexed subscriptionId,
        address indexed subscriber,
        bytes32[] feedIds,
        uint256 duration,
        uint256 amountPaid
    );

    event SubscriptionRenewed(bytes32 indexed subscriptionId, uint256 newEndTime, uint256 amountPaid);

    event SubscriptionCancelled(bytes32 indexed subscriptionId, uint256 refundAmount);

    event ReadFeePaid(bytes32 indexed feedId, address indexed reader, uint256 amount);

    event RewardsDistributed(
        uint256 indexed epochNumber, uint256 operatorAmount, uint256 delegatorAmount, uint256 treasuryAmount
    );

    event RewardsClaimed(bytes32 indexed operatorId, address indexed recipient, uint256 amount);

    event DelegatorRewardsClaimed(address indexed delegator, bytes32 indexed operatorId, uint256 amount);

    event FeeConfigUpdated(uint256 subscriptionFee, uint256 perReadFee);

    // ============ Errors ============

    error SubscriptionNotFound(bytes32 subscriptionId);
    error SubscriptionExpired(bytes32 subscriptionId);
    error SubscriptionNotActive(bytes32 subscriptionId);
    error InsufficientPayment(uint256 provided, uint256 required);
    error NoRewardsToClaim();
    error InvalidFeeConfig();
    error EpochNotFinalized(uint256 epochNumber);
    error AlreadyClaimed(uint256 epochNumber);
    error NotSubscribed(address account, bytes32 feedId);

    // ============ Subscription Functions ============

    function subscribe(bytes32[] calldata feedIds, uint256 durationMonths)
        external
        payable
        returns (bytes32 subscriptionId);

    function renewSubscription(bytes32 subscriptionId, uint256 additionalMonths) external payable;

    function cancelSubscription(bytes32 subscriptionId) external returns (uint256 refund);

    function addFeedsToSubscription(bytes32 subscriptionId, bytes32[] calldata newFeedIds) external payable;

    // ============ Per-Read Payments ============

    function payForRead(bytes32 feedId) external payable;

    function payForReadBatch(bytes32[] calldata feedIds) external payable;

    function isSubscribed(address account, bytes32 feedId) external view returns (bool);

    // ============ Rewards Distribution ============

    function distributeEpochRewards(uint256 epochNumber) external;

    function claimOperatorRewards(bytes32 operatorId) external returns (uint256);

    // ============ View Functions ============

    function getSubscription(bytes32 subscriptionId) external view returns (Subscription memory);

    function getSubscriptionsByAccount(address account) external view returns (bytes32[] memory);

    function getOperatorEarnings(bytes32 operatorId) external view returns (OperatorEarnings memory);

    function getPendingRewards(bytes32 operatorId) external view returns (uint256);

    function getDelegatorPendingRewards(address delegator, bytes32 operatorId) external view returns (uint256);

    function getFeeConfig() external view returns (FeeConfig memory);

    function getEpochRewards(uint256 epochNumber) external view returns (EpochRewards memory);

    function getCurrentEpoch() external view returns (uint256);

    function getSubscriptionPrice(bytes32[] calldata feedIds, uint256 durationMonths) external view returns (uint256);

    function getTotalFeesCollected() external view returns (uint256);

    function getTreasuryBalance() external view returns (uint256);

    // ============ Admin Functions ============

    function setFeeConfig(FeeConfig calldata config) external;

    function setFeedPrice(bytes32 feedId, uint256 monthlyPrice) external;

    function withdrawTreasury(address recipient, uint256 amount) external;
}
