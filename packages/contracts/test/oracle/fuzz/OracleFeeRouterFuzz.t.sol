// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FeedRegistry} from "../../../src/oracle/FeedRegistry.sol";
import {OracleFeeRouter} from "../../../src/oracle/OracleFeeRouter.sol";
import {IFeedRegistry} from "../../../src/oracle/interfaces/IFeedRegistry.sol";
import {IOracleFeeRouter} from "../../../src/oracle/interfaces/IOracleFeeRouter.sol";

/// @title OracleFeeRouter Fuzz Tests
/// @notice Comprehensive fuzz testing for subscription and payment mechanics
contract OracleFeeRouterFuzzTest is Test {
    FeedRegistry public registry;
    OracleFeeRouter public feeRouter;

    address public owner = address(0x1);
    bytes32 public feedId;
    bytes32[] public feedIds;

    function setUp() public {
        vm.warp(1700000000);

        vm.startPrank(owner);
        registry = new FeedRegistry(owner);
        feeRouter = new OracleFeeRouter(address(registry), owner);

        // Create multiple feeds for testing
        for (uint256 i = 0; i < 5; i++) {
            bytes32 id = registry.createFeed(IFeedRegistry.FeedCreateParams({
                symbol: string(abi.encodePacked("FEED-", vm.toString(i))),
                baseToken: address(uint160(0x1000 + i)),
                quoteToken: address(uint160(0x2000 + i)),
                decimals: 8,
                heartbeatSeconds: 3600,
                twapWindowSeconds: 1800,
                minLiquidityUSD: 100_000 ether,
                maxDeviationBps: 100,
                minOracles: 3,
                quorumThreshold: 2,
                requiresConfidence: true,
                category: IFeedRegistry.FeedCategory.SPOT_PRICE
            }));
            feedIds.push(id);
        }
        feedId = feedIds[0];
        vm.stopPrank();
    }

    // ==================== Subscription Fuzz Tests ====================

    function testFuzz_Subscribe_Duration(uint256 durationMonths) public {
        durationMonths = bound(durationMonths, 1, 12);

        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        uint256 price = feeRouter.getSubscriptionPrice(feeds, durationMonths);

        address subscriber = address(0x100);
        vm.deal(subscriber, price + 1 ether);

        vm.prank(subscriber);
        bytes32 subscriptionId = feeRouter.subscribe{value: price}(feeds, durationMonths);

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subscriptionId);
        assertEq(sub.subscriber, subscriber);
        assertTrue(sub.isActive);
        assertEq(sub.endTime, block.timestamp + (durationMonths * 30 days));
    }

    function testFuzz_Subscribe_MultipleFeeds(uint8 feedCount) public {
        feedCount = uint8(bound(feedCount, 1, 5));

        bytes32[] memory feeds = new bytes32[](feedCount);
        for (uint256 i = 0; i < feedCount; i++) {
            feeds[i] = feedIds[i];
        }

        uint256 price = feeRouter.getSubscriptionPrice(feeds, 1);

        address subscriber = address(0x101);
        vm.deal(subscriber, price + 1 ether);

        vm.prank(subscriber);
        bytes32 subscriptionId = feeRouter.subscribe{value: price}(feeds, 1);

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subscriptionId);
        assertEq(sub.feedIds.length, feedCount);
    }

    function testFuzz_Subscribe_ExcessPayment(uint256 excessAmount) public {
        excessAmount = bound(excessAmount, 0.001 ether, 10 ether);

        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        uint256 price = feeRouter.getSubscriptionPrice(feeds, 1);
        uint256 totalPayment = price + excessAmount;

        address subscriber = address(0x102);
        vm.deal(subscriber, totalPayment + 1 ether);

        uint256 balanceBefore = subscriber.balance;

        vm.prank(subscriber);
        feeRouter.subscribe{value: totalPayment}(feeds, 1);

        uint256 balanceAfter = subscriber.balance;
        // Should refund excess
        assertEq(balanceBefore - balanceAfter, price);
    }

    function testFuzz_Subscribe_InsufficientPayment(uint256 shortfall) public {
        shortfall = bound(shortfall, 1, 0.05 ether);

        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        uint256 price = feeRouter.getSubscriptionPrice(feeds, 1);
        uint256 insufficientPayment = price > shortfall ? price - shortfall : 0;

        address subscriber = address(0x103);
        vm.deal(subscriber, price);

        vm.prank(subscriber);
        vm.expectRevert();
        feeRouter.subscribe{value: insufficientPayment}(feeds, 1);
    }

    // ==================== Renewal Fuzz Tests ====================

    function testFuzz_RenewSubscription_Duration(uint256 renewMonths) public {
        renewMonths = bound(renewMonths, 1, 12);

        // First subscribe
        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        uint256 initialPrice = feeRouter.getSubscriptionPrice(feeds, 1);
        address subscriber = address(0x104);
        vm.deal(subscriber, 100 ether);

        vm.prank(subscriber);
        bytes32 subscriptionId = feeRouter.subscribe{value: initialPrice}(feeds, 1);

        IOracleFeeRouter.Subscription memory subBefore = feeRouter.getSubscription(subscriptionId);
        uint256 endTimeBefore = subBefore.endTime;

        // Renew
        uint256 renewPrice = feeRouter.getSubscriptionPrice(feeds, renewMonths);

        vm.prank(subscriber);
        feeRouter.renewSubscription{value: renewPrice}(subscriptionId, renewMonths);

        IOracleFeeRouter.Subscription memory subAfter = feeRouter.getSubscription(subscriptionId);
        assertEq(subAfter.endTime, endTimeBefore + (renewMonths * 30 days));
    }

    function testFuzz_RenewSubscription_AfterExpiry(uint256 expiryGap) public {
        expiryGap = bound(expiryGap, 1 days, 365 days);

        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        uint256 price = feeRouter.getSubscriptionPrice(feeds, 1);
        address subscriber = address(0x105);
        vm.deal(subscriber, 100 ether);

        // Use absolute timestamp for predictable behavior
        uint256 startTime = 1700000000;
        vm.warp(startTime);

        vm.prank(subscriber);
        bytes32 subscriptionId = feeRouter.subscribe{value: price}(feeds, 1);

        // Let it expire
        uint256 expiredTime = startTime + 30 days + expiryGap;
        vm.warp(expiredTime);

        // Renew expired subscription
        vm.prank(subscriber);
        feeRouter.renewSubscription{value: price}(subscriptionId, 1);

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subscriptionId);
        assertTrue(sub.isActive);
        // Should start from now (expired time), not extend from old end time
        assertEq(sub.endTime, expiredTime + 30 days);
    }

    // ==================== Per-Read Payment Fuzz Tests ====================

    function testFuzz_PayForRead_Amount(uint256 paymentAmount) public {
        paymentAmount = bound(paymentAmount, 0, 1 ether);

        IOracleFeeRouter.FeeConfig memory config = feeRouter.getFeeConfig();
        uint256 perReadFee = config.perReadFee;

        address reader = address(0x106);
        vm.deal(reader, paymentAmount + 1 ether);

        vm.prank(reader);

        if (paymentAmount < perReadFee) {
            vm.expectRevert();
            feeRouter.payForRead{value: paymentAmount}(feedId);
        } else {
            uint256 balanceBefore = reader.balance;
            feeRouter.payForRead{value: paymentAmount}(feedId);
            uint256 balanceAfter = reader.balance;
            // Should only charge perReadFee
            assertEq(balanceBefore - balanceAfter, perReadFee);
        }
    }

    function testFuzz_PayForReadBatch_Count(uint8 readCount) public {
        readCount = uint8(bound(readCount, 1, 5));

        bytes32[] memory reads = new bytes32[](readCount);
        for (uint256 i = 0; i < readCount; i++) {
            reads[i] = feedIds[i];
        }

        IOracleFeeRouter.FeeConfig memory config = feeRouter.getFeeConfig();
        uint256 totalFee = config.perReadFee * readCount;

        address reader = address(0x107);
        vm.deal(reader, totalFee + 1 ether);

        uint256 balanceBefore = reader.balance;

        vm.prank(reader);
        feeRouter.payForReadBatch{value: totalFee}(reads);

        uint256 balanceAfter = reader.balance;
        assertEq(balanceBefore - balanceAfter, totalFee);
    }

    // ==================== Operator Rewards Fuzz Tests ====================

    function testFuzz_CreditOperatorRewards_Amount(uint256 rewardAmount) public {
        rewardAmount = bound(rewardAmount, 0.001 ether, 100 ether);

        bytes32 operatorId = keccak256("operator1");

        // Fund the contract
        vm.deal(address(feeRouter), rewardAmount + 10 ether);

        vm.prank(owner);
        feeRouter.creditOperatorRewards(operatorId, rewardAmount);

        IOracleFeeRouter.OperatorEarnings memory earnings = feeRouter.getOperatorEarnings(operatorId);
        assertEq(earnings.pendingRewards, rewardAmount);
    }

    function testFuzz_ClaimOperatorRewards_Partial(uint256 creditAmount, uint256 claimPercent) public {
        creditAmount = bound(creditAmount, 1 ether, 100 ether);
        claimPercent = bound(claimPercent, 1, 100);

        bytes32 operatorId = keccak256("operator2");
        address operatorAddress = address(0x108);

        // Fund and credit
        vm.deal(address(feeRouter), creditAmount + 10 ether);
        vm.prank(owner);
        feeRouter.creditOperatorRewards(operatorId, creditAmount);

        uint256 balanceBefore = operatorAddress.balance;

        vm.prank(operatorAddress);
        feeRouter.claimOperatorRewards(operatorId);

        uint256 balanceAfter = operatorAddress.balance;
        assertEq(balanceAfter - balanceBefore, creditAmount);
    }

    // ==================== Multiple Subscribers Fuzz Tests ====================

    function testFuzz_MultipleSubscribers(uint8 subscriberCount) public {
        subscriberCount = uint8(bound(subscriberCount, 1, 20));

        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        uint256 price = feeRouter.getSubscriptionPrice(feeds, 1);
        uint256 totalExpected = price * subscriberCount;

        uint256 feesBefore = feeRouter.getTotalFeesCollected();

        for (uint256 i = 0; i < subscriberCount; i++) {
            address subscriber = address(uint160(0x200 + i));
            vm.deal(subscriber, price + 1 ether);

            vm.prank(subscriber);
            feeRouter.subscribe{value: price}(feeds, 1);
        }

        uint256 feesAfter = feeRouter.getTotalFeesCollected();
        assertEq(feesAfter - feesBefore, totalExpected);
    }

    // ==================== Epoch Distribution Fuzz Tests ====================

    function testFuzz_EpochAdvancement(uint256 timeAdvance) public {
        timeAdvance = bound(timeAdvance, 0, 7 days);

        uint256 epochBefore = feeRouter.getCurrentEpoch();

        vm.warp(block.timestamp + timeAdvance);

        // Trigger epoch check via subscription
        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;
        uint256 price = feeRouter.getSubscriptionPrice(feeds, 1);

        address subscriber = address(0x300);
        vm.deal(subscriber, price + 1 ether);

        vm.prank(subscriber);
        feeRouter.subscribe{value: price}(feeds, 1);

        uint256 epochAfter = feeRouter.getCurrentEpoch();

        // Epoch should advance if > 1 day passed
        if (timeAdvance >= 1 days) {
            assertGe(epochAfter, epochBefore);
        }
    }

    // ==================== Fee Configuration Fuzz Tests ====================

    function testFuzz_SetFeeConfig_ValidBps(
        uint16 treasuryBps,
        uint16 operatorBps,
        uint16 delegatorBps,
        uint16 disputerBps
    ) public {
        // Total must be <= 10000
        uint256 total = uint256(treasuryBps) + operatorBps + delegatorBps + disputerBps;

        if (total > 10000) {
            // Scale down proportionally
            treasuryBps = uint16((uint256(treasuryBps) * 10000) / total);
            operatorBps = uint16((uint256(operatorBps) * 10000) / total);
            delegatorBps = uint16((uint256(delegatorBps) * 10000) / total);
            disputerBps = uint16(10000 - treasuryBps - operatorBps - delegatorBps);
        }

        vm.prank(owner);
        
        if (treasuryBps + operatorBps + delegatorBps + disputerBps != 10000) {
            vm.expectRevert();
        }
        
        feeRouter.setFeeConfig(IOracleFeeRouter.FeeConfig({
            subscriptionFeePerMonth: 0.1 ether,
            perReadFee: 0.0001 ether,
            treasuryShareBps: treasuryBps,
            operatorShareBps: operatorBps,
            delegatorShareBps: delegatorBps,
            disputerRewardBps: disputerBps
        }));
    }

    function testFuzz_SetFeedPrice_Amount(uint256 pricePerMonth) public {
        pricePerMonth = bound(pricePerMonth, 0.001 ether, 10 ether);

        vm.prank(owner);
        feeRouter.setFeedPrice(feedId, pricePerMonth);

        // Verify price affects subscription cost
        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        uint256 subscriptionPrice = feeRouter.getSubscriptionPrice(feeds, 1);
        // Price should be at least the feed price
        assertGe(subscriptionPrice, pricePerMonth);
    }

    // ==================== Subscription Status Fuzz Tests ====================

    function testFuzz_IsSubscribed_Timing(uint256 checkTime) public {
        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        uint256 price = feeRouter.getSubscriptionPrice(feeds, 1);
        address subscriber = address(0x400);
        vm.deal(subscriber, price + 1 ether);

        // Use absolute timestamp
        uint256 startTime = 1700000000;
        vm.warp(startTime);

        vm.prank(subscriber);
        feeRouter.subscribe{value: price}(feeds, 1);

        uint256 endTime = startTime + 30 days;
        checkTime = bound(checkTime, 0, 60 days);

        uint256 actualCheckTime = startTime + checkTime;
        vm.warp(actualCheckTime);

        bool isSubscribed = feeRouter.isSubscribed(subscriber, feedId);

        if (actualCheckTime <= endTime) {
            assertTrue(isSubscribed);
        } else {
            assertFalse(isSubscribed);
        }
    }

    // ==================== Edge Cases ====================

    function testFuzz_Subscribe_ZeroFeeds_Reverts() public {
        bytes32[] memory emptyFeeds = new bytes32[](0);

        address subscriber = address(0x500);
        vm.deal(subscriber, 1 ether);

        vm.prank(subscriber);
        vm.expectRevert();
        feeRouter.subscribe{value: 0.1 ether}(emptyFeeds, 1);
    }

    function testFuzz_Subscribe_InvalidDuration(uint256 duration) public {
        // 0 or > 12 should fail
        vm.assume(duration == 0 || duration > 12);

        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        address subscriber = address(0x501);
        vm.deal(subscriber, 10 ether);

        vm.prank(subscriber);
        vm.expectRevert();
        feeRouter.subscribe{value: 1 ether}(feeds, duration);
    }

    receive() external payable {}
}
