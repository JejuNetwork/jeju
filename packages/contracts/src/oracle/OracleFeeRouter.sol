// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IOracleFeeRouter} from "./interfaces/IOracleFeeRouter.sol";
import {IFeedRegistry} from "./interfaces/IFeedRegistry.sol";

/// @title OracleFeeRouter
/// @notice Subscriptions and payment distribution for Jeju Oracle Network
contract OracleFeeRouter is IOracleFeeRouter, Ownable, Pausable, ReentrancyGuard {
    uint256 public constant EPOCH_DURATION = 1 days;
    uint16 public constant BPS_DENOMINATOR = 10000;

    IFeedRegistry public immutable feedRegistry;
    FeeConfig private _feeConfig;
    mapping(bytes32 => uint256) public feedPrices;
    mapping(bytes32 => Subscription) private _subscriptions;
    mapping(address => bytes32[]) private _userSubscriptions;
    mapping(address => mapping(bytes32 => bytes32)) private _activeSubscriptions;
    mapping(bytes32 => OperatorEarnings) private _operatorEarnings;
    mapping(uint256 => EpochRewards) private _epochRewards;

    uint256 public currentEpoch;
    uint256 public epochStartTime;
    uint256 public epochAccumulatedFees;
    uint256 public treasuryBalance;
    uint256 public totalFeesCollected;
    uint256 private _subscriptionCounter;

    constructor(address _feedRegistry, address initialOwner) Ownable(initialOwner) {
        feedRegistry = IFeedRegistry(_feedRegistry);
        _feeConfig = FeeConfig({
            subscriptionFeePerMonth: 0.1 ether,
            perReadFee: 0.0001 ether,
            treasuryShareBps: 1000,
            operatorShareBps: 7000,
            delegatorShareBps: 1500,
            disputerRewardBps: 500
        });
        currentEpoch = 1;
        epochStartTime = block.timestamp;
    }

    function subscribe(bytes32[] calldata feedIds, uint256 durationMonths)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (bytes32 subscriptionId)
    {
        if (feedIds.length == 0 || durationMonths == 0 || durationMonths > 12) revert InvalidFeeConfig();
        for (uint256 i = 0; i < feedIds.length; i++) {
            if (!feedRegistry.feedExists(feedIds[i])) revert InvalidFeeConfig();
        }

        uint256 totalPrice = _calculateSubscriptionPrice(feedIds, durationMonths);
        if (msg.value < totalPrice) revert InsufficientPayment(msg.value, totalPrice);

        subscriptionId = keccak256(abi.encodePacked(msg.sender, block.timestamp, ++_subscriptionCounter));
        _subscriptions[subscriptionId] = Subscription({
            subscriber: msg.sender,
            feedIds: feedIds,
            startTime: block.timestamp,
            endTime: block.timestamp + (durationMonths * 30 days),
            amountPaid: totalPrice,
            isActive: true
        });

        _userSubscriptions[msg.sender].push(subscriptionId);
        for (uint256 i = 0; i < feedIds.length; i++) {
            _activeSubscriptions[msg.sender][feedIds[i]] = subscriptionId;
        }

        epochAccumulatedFees += totalPrice;
        totalFeesCollected += totalPrice;
        _refundExcess(msg.value, totalPrice);
        emit SubscriptionCreated(subscriptionId, msg.sender, feedIds, durationMonths, totalPrice);
    }

    function renewSubscription(bytes32 subscriptionId, uint256 additionalMonths)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        Subscription storage sub = _subscriptions[subscriptionId];
        if (sub.subscriber != msg.sender) revert SubscriptionNotFound(subscriptionId);
        if (additionalMonths == 0 || additionalMonths > 12) revert InvalidFeeConfig();

        uint256 price = _calculateSubscriptionPrice(sub.feedIds, additionalMonths);
        if (msg.value < price) revert InsufficientPayment(msg.value, price);

        if (sub.endTime < block.timestamp) {
            sub.startTime = block.timestamp;
            sub.endTime = block.timestamp + (additionalMonths * 30 days);
        } else {
            sub.endTime += additionalMonths * 30 days;
        }

        sub.amountPaid += price;
        sub.isActive = true;
        epochAccumulatedFees += price;
        totalFeesCollected += price;
        _refundExcess(msg.value, price);
        emit SubscriptionRenewed(subscriptionId, sub.endTime, price);
    }

    function cancelSubscription(bytes32 subscriptionId) external nonReentrant returns (uint256) {
        Subscription storage sub = _subscriptions[subscriptionId];
        if (sub.subscriber != msg.sender) revert SubscriptionNotFound(subscriptionId);
        if (!sub.isActive) revert SubscriptionNotActive(subscriptionId);

        sub.isActive = false;
        for (uint256 i = 0; i < sub.feedIds.length; i++) {
            delete _activeSubscriptions[msg.sender][sub.feedIds[i]];
        }
        emit SubscriptionCancelled(subscriptionId, 0);
        return 0;
    }

    function addFeedsToSubscription(bytes32 subscriptionId, bytes32[] calldata newFeedIds)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        Subscription storage sub = _subscriptions[subscriptionId];
        if (sub.subscriber != msg.sender) revert SubscriptionNotFound(subscriptionId);
        if (!sub.isActive || sub.endTime < block.timestamp) revert SubscriptionExpired(subscriptionId);

        uint256 remainingMonths = ((sub.endTime - block.timestamp) + 30 days - 1) / 30 days;
        if (remainingMonths == 0) remainingMonths = 1;

        uint256 price = _calculateSubscriptionPrice(newFeedIds, remainingMonths);
        if (msg.value < price) revert InsufficientPayment(msg.value, price);

        bytes32[] memory allFeeds = new bytes32[](sub.feedIds.length + newFeedIds.length);
        for (uint256 i = 0; i < sub.feedIds.length; i++) {
            allFeeds[i] = sub.feedIds[i];
        }
        for (uint256 i = 0; i < newFeedIds.length; i++) {
            allFeeds[sub.feedIds.length + i] = newFeedIds[i];
            _activeSubscriptions[msg.sender][newFeedIds[i]] = subscriptionId;
        }
        sub.feedIds = allFeeds;
        sub.amountPaid += price;
        epochAccumulatedFees += price;
        totalFeesCollected += price;
        _refundExcess(msg.value, price);
    }

    function payForRead(bytes32 feedId) external payable nonReentrant whenNotPaused {
        if (!feedRegistry.feedExists(feedId)) revert InvalidFeeConfig();
        if (msg.value < _feeConfig.perReadFee) revert InsufficientPayment(msg.value, _feeConfig.perReadFee);
        epochAccumulatedFees += _feeConfig.perReadFee;
        totalFeesCollected += _feeConfig.perReadFee;
        _refundExcess(msg.value, _feeConfig.perReadFee);
        emit ReadFeePaid(feedId, msg.sender, _feeConfig.perReadFee);
    }

    function payForReadBatch(bytes32[] calldata feedIds) external payable nonReentrant whenNotPaused {
        uint256 totalFee = feedIds.length * _feeConfig.perReadFee;
        if (msg.value < totalFee) revert InsufficientPayment(msg.value, totalFee);
        for (uint256 i = 0; i < feedIds.length; i++) {
            if (!feedRegistry.feedExists(feedIds[i])) revert InvalidFeeConfig();
            emit ReadFeePaid(feedIds[i], msg.sender, _feeConfig.perReadFee);
        }
        epochAccumulatedFees += totalFee;
        totalFeesCollected += totalFee;
        _refundExcess(msg.value, totalFee);
    }

    function isSubscribed(address account, bytes32 feedId) external view returns (bool) {
        bytes32 subId = _activeSubscriptions[account][feedId];
        if (subId == bytes32(0)) return false;
        Subscription storage sub = _subscriptions[subId];
        return sub.isActive && sub.endTime > block.timestamp;
    }

    function distributeEpochRewards(uint256 epochNumber) external nonReentrant {
        _advanceEpochIfNeeded();
        if (epochNumber >= currentEpoch) revert EpochNotFinalized(epochNumber);

        EpochRewards storage rewards = _epochRewards[epochNumber];
        if (rewards.finalized) revert AlreadyClaimed(epochNumber);

        uint256 totalFees = rewards.totalFees;
        if (totalFees == 0) {
            rewards.finalized = true;
            return;
        }

        rewards.treasuryShare = (totalFees * _feeConfig.treasuryShareBps) / BPS_DENOMINATOR;
        rewards.operatorPool = (totalFees * _feeConfig.operatorShareBps) / BPS_DENOMINATOR;
        rewards.delegatorPool = (totalFees * _feeConfig.delegatorShareBps) / BPS_DENOMINATOR;
        rewards.distributed = rewards.treasuryShare + rewards.operatorPool + rewards.delegatorPool;
        rewards.finalized = true;
        treasuryBalance += rewards.treasuryShare;

        emit RewardsDistributed(epochNumber, rewards.operatorPool, rewards.delegatorPool, rewards.treasuryShare);
    }

    function claimOperatorRewards(bytes32 operatorId) external nonReentrant returns (uint256 amount) {
        OperatorEarnings storage earnings = _operatorEarnings[operatorId];
        amount = earnings.pendingRewards;
        if (amount == 0) revert NoRewardsToClaim();
        earnings.pendingRewards = 0;
        earnings.totalClaimed += amount;
        earnings.lastClaimTime = block.timestamp;
        _transfer(msg.sender, amount);
        emit RewardsClaimed(operatorId, msg.sender, amount);
    }

    function getSubscription(bytes32 id) external view returns (Subscription memory) {
        return _subscriptions[id];
    }

    function getSubscriptionsByAccount(address a) external view returns (bytes32[] memory) {
        return _userSubscriptions[a];
    }

    function getOperatorEarnings(bytes32 id) external view returns (OperatorEarnings memory) {
        return _operatorEarnings[id];
    }

    function getPendingRewards(bytes32 id) external view returns (uint256) {
        return _operatorEarnings[id].pendingRewards;
    }

    function getDelegatorPendingRewards(address, bytes32) external pure returns (uint256) {
        return 0;
    }

    function getFeeConfig() external view returns (FeeConfig memory) {
        return _feeConfig;
    }

    function getEpochRewards(uint256 n) external view returns (EpochRewards memory) {
        return _epochRewards[n];
    }

    function getCurrentEpoch() external view returns (uint256) {
        return currentEpoch;
    }

    function getSubscriptionPrice(bytes32[] calldata f, uint256 m) external view returns (uint256) {
        return _calculateSubscriptionPrice(f, m);
    }

    function getTotalFeesCollected() external view returns (uint256) {
        return totalFeesCollected;
    }

    function getTreasuryBalance() external view returns (uint256) {
        return treasuryBalance;
    }

    function _calculateSubscriptionPrice(bytes32[] memory feedIds, uint256 months)
        internal
        view
        returns (uint256 total)
    {
        for (uint256 i = 0; i < feedIds.length; i++) {
            uint256 p = feedPrices[feedIds[i]];
            total += (p == 0 ? _feeConfig.subscriptionFeePerMonth : p) * months;
        }
    }

    function _advanceEpochIfNeeded() internal {
        if (block.timestamp < epochStartTime + EPOCH_DURATION) return;
        _epochRewards[currentEpoch] = EpochRewards(currentEpoch, epochAccumulatedFees, 0, 0, 0, 0, false);
        ++currentEpoch;
        epochStartTime = block.timestamp;
        epochAccumulatedFees = 0;
    }

    function _refundExcess(uint256 sent, uint256 required) internal {
        if (sent > required) _transfer(msg.sender, sent - required);
    }

    function _transfer(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert InvalidFeeConfig();
    }

    function setFeeConfig(FeeConfig calldata config) external onlyOwner {
        if (
            config.treasuryShareBps + config.operatorShareBps + config.delegatorShareBps + config.disputerRewardBps
                != BPS_DENOMINATOR
        ) {
            revert InvalidFeeConfig();
        }
        _feeConfig = config;
        emit FeeConfigUpdated(config.subscriptionFeePerMonth, config.perReadFee);
    }

    function setFeedPrice(bytes32 feedId, uint256 monthlyPrice) external onlyOwner {
        feedPrices[feedId] = monthlyPrice;
    }

    function withdrawTreasury(address recipient, uint256 amount) external onlyOwner {
        if (amount > treasuryBalance) revert InvalidFeeConfig();
        treasuryBalance -= amount;
        _transfer(recipient, amount);
    }

    function creditOperatorRewards(bytes32 operatorId, uint256 amount) external onlyOwner {
        _operatorEarnings[operatorId].totalEarned += amount;
        _operatorEarnings[operatorId].pendingRewards += amount;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    receive() external payable {
        epochAccumulatedFees += msg.value;
        totalFeesCollected += msg.value;
    }
}
