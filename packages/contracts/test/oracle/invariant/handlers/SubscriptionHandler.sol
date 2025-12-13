// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {OracleFeeRouter} from "../../../../src/oracle/OracleFeeRouter.sol";
import {FeedRegistry} from "../../../../src/oracle/FeedRegistry.sol";
import {IOracleFeeRouter} from "../../../../src/oracle/interfaces/IOracleFeeRouter.sol";

/// @title Subscription Handler for Invariant Testing
/// @notice Manages subscriptions and tracks payment state
contract SubscriptionHandler is Test {
    OracleFeeRouter public feeRouter;
    FeedRegistry public registry;
    bytes32 public feedId;

    // State tracking
    uint256 public subscriptionCount;
    uint256 public totalPaid;
    uint256 public renewalCount;
    uint256 public cancelCount;
    uint256 public readCount;

    bytes32[] public subscriptionIds;
    bytes32[] public operatorIds;

    // Track subscribers
    address[] public subscribers;
    mapping(address => bytes32[]) public subscriberToSubs;

    constructor(OracleFeeRouter _feeRouter, FeedRegistry _registry, bytes32 _feedId) {
        feeRouter = _feeRouter;
        registry = _registry;
        feedId = _feedId;

        // Pre-create some operator IDs
        for (uint256 i = 0; i < 5; i++) {
            operatorIds.push(keccak256(abi.encodePacked("operator", i)));
        }
    }

    /// @notice Create a new subscription
    function subscribe(uint256 subscriberSeed, uint256 durationMonths, uint256 feedCount) external {
        durationMonths = bound(durationMonths, 1, 12);
        feedCount = bound(feedCount, 1, 3);

        // Generate subscriber address
        address subscriber = address(uint160(bound(subscriberSeed, 0x1000, 0x9999)));

        // Build feed list
        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        uint256 price = feeRouter.getSubscriptionPrice(feeds, durationMonths);

        // Ensure subscriber has funds
        vm.deal(subscriber, price + 1 ether);

        vm.prank(subscriber);
        try feeRouter.subscribe{value: price}(feeds, durationMonths) returns (bytes32 subId) {
            subscriptionCount++;
            totalPaid += price;
            subscriptionIds.push(subId);

            if (subscriberToSubs[subscriber].length == 0) {
                subscribers.push(subscriber);
            }
            subscriberToSubs[subscriber].push(subId);
        } catch {}
    }

    /// @notice Renew an existing subscription
    function renewSubscription(uint256 subIndex, uint256 additionalMonths) external {
        if (subscriptionIds.length == 0) return;

        subIndex = bound(subIndex, 0, subscriptionIds.length - 1);
        bytes32 subId = subscriptionIds[subIndex];

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subId);
        if (!sub.isActive) return;

        additionalMonths = bound(additionalMonths, 1, 12);

        uint256 price = feeRouter.getSubscriptionPrice(sub.feedIds, additionalMonths);

        vm.deal(sub.subscriber, price + 1 ether);

        vm.prank(sub.subscriber);
        try feeRouter.renewSubscription{value: price}(subId, additionalMonths) {
            renewalCount++;
            totalPaid += price;
        } catch {}
    }

    /// @notice Cancel a subscription
    function cancelSubscription(uint256 subIndex) external {
        if (subscriptionIds.length == 0) return;

        subIndex = bound(subIndex, 0, subscriptionIds.length - 1);
        bytes32 subId = subscriptionIds[subIndex];

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subId);
        if (!sub.isActive) return;

        vm.prank(sub.subscriber);
        try feeRouter.cancelSubscription(subId) {
            cancelCount++;
        } catch {}
    }

    /// @notice Pay for a single read
    function payForRead(uint256 readerSeed) external {
        address reader = address(uint160(bound(readerSeed, 0x2000, 0x2999)));

        IOracleFeeRouter.FeeConfig memory config = feeRouter.getFeeConfig();
        uint256 fee = config.perReadFee;

        vm.deal(reader, fee + 0.1 ether);

        vm.prank(reader);
        try feeRouter.payForRead{value: fee}(feedId) {
            readCount++;
            totalPaid += fee;
        } catch {}
    }

    /// @notice Advance time to test subscription expiry
    function advanceTime(uint256 days_) external {
        days_ = bound(days_, 1, 60);
        vm.warp(block.timestamp + days_ * 1 days);
    }

    // ==================== View Functions ====================

    function getSubscriptionIds() external view returns (bytes32[] memory) {
        return subscriptionIds;
    }

    function getOperatorIds() external view returns (bytes32[] memory) {
        return operatorIds;
    }

    function getSubscribers() external view returns (address[] memory) {
        return subscribers;
    }

    receive() external payable {}
}
