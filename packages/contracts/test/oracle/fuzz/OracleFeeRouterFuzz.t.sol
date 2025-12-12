// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FeedRegistry} from "../../../src/oracle/FeedRegistry.sol";
import {OracleFeeRouter} from "../../../src/oracle/OracleFeeRouter.sol";
import {IFeedRegistry} from "../../../src/oracle/interfaces/IFeedRegistry.sol";
import {IOracleFeeRouter} from "../../../src/oracle/interfaces/IOracleFeeRouter.sol";

/// @title OracleFeeRouter Fuzz Tests
/// @notice Comprehensive fuzz testing for subscription and fee mechanics
contract OracleFeeRouterFuzzTest is Test {
    FeedRegistry public registry;
    OracleFeeRouter public feeRouter;

    address public owner = address(0x1);
    bytes32 public feedId;
    bytes32 public feedId2;

    function setUp() public {
        vm.warp(1700000000);

        vm.startPrank(owner);
        registry = new FeedRegistry(owner);
        feeRouter = new OracleFeeRouter(address(registry), owner);

        feedId = registry.createFeed(IFeedRegistry.FeedCreateParams({
            symbol: "ETH-USD",
            baseToken: address(0x100),
            quoteToken: address(0x200),
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

        feedId2 = registry.createFeed(IFeedRegistry.FeedCreateParams({
            symbol: "BTC-USD",
            baseToken: address(0x300),
            quoteToken: address(0x200),
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
        vm.stopPrank();
    }

    // ==================== Subscription Fuzz Tests ====================

    function testFuzz_Subscribe_Duration(uint256 durationMonths) public {
        durationMonths = bound(durationMonths, 1, 12);

        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        uint256 price = feeRouter.getSubscriptionPrice(feeds, durationMonths);

        address subscriber = address(0x10);
        vm.deal(subscriber, price + 1 ether);

        vm.prank(subscriber);
        bytes32 subId = feeRouter.subscribe{value: price}(feeds, durationMonths);

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subId);
        assertEq(sub.subscriber, subscriber);
        assertTrue(sub.isActive);
        assertEq(sub.endTime, block.timestamp + (durationMonths * 30 days));
    }

    function testFuzz_Subscribe_MultipleFeeds(uint8 feedCount) public {
        feedCount = uint8(bound(feedCount, 1, 10));

        // Create feeds
        bytes32[] memory feeds = new bytes32[](feedCount);
        for (uint256 i = 0; i < feedCount; i++) {
            vm.prank(owner);
            feeds[i] = registry.createFeed(IFeedRegistry.FeedCreateParams({
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
        }

        uint256 price = feeRouter.getSubscriptionPrice(feeds, 1);

        address subscriber = address(0x11);
        vm.deal(subscriber, price + 1 ether);

        vm.prank(subscriber);
        bytes32 subId = feeRouter.subscribe{value: price}(feeds, 1);

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subId);
        assertEq(sub.feedIds.length, feedCount);
    }

    function testFuzz_Subscribe_InsufficientPayment(uint256 shortfall) public {
        shortfall = bound(shortfall, 1, 0.1 ether);

        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        uint256 price = feeRouter.getSubscriptionPrice(feeds, 1);
        uint256 payment = price > shortfall ? price - shortfall : 0;

        address subscriber = address(0x12);
        vm.deal(subscriber, payment + 1 ether);

        vm.prank(subscriber);
        vm.expectRevert(abi.encodeWithSelector(
            IOracleFeeRouter.InsufficientPayment.selector,
            payment,
            price
        ));
        feeRouter.subscribe{value: payment}(feeds, 1);
    }

    function testFuzz_Subscribe_ExcessRefund(uint256 excess) public {
        excess = bound(excess, 0.001 ether, 10 ether);

        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        uint256 price = feeRouter.getSubscriptionPrice(feeds, 1);
        uint256 payment = price + excess;

        address subscriber = address(0x13);
        vm.deal(subscriber, payment + 1 ether);

        uint256 balanceBefore = subscriber.balance;

        vm.prank(subscriber);
        feeRouter.subscribe{value: payment}(feeds, 1);

        // Should receive excess back
        assertEq(subscriber.balance, balanceBefore - price);
    }

    // ==================== Renewal Fuzz Tests ====================

    function testFuzz_RenewSubscription_AdditionalMonths(uint256 additionalMonths) public {
        additionalMonths = bound(additionalMonths, 1, 12);

        // Create subscription
        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        uint256 initialPrice = feeRouter.getSubscriptionPrice(feeds, 1);

        address subscriber = address(0x14);
        vm.deal(subscriber, 100 ether);

        vm.prank(subscriber);
        bytes32 subId = feeRouter.subscribe{value: initialPrice}(feeds, 1);

        IOracleFeeRouter.Subscription memory subBefore = feeRouter.getSubscription(subId);
        uint256 endTimeBefore = subBefore.endTime;

        // Renew
        uint256 renewPrice = feeRouter.getSubscriptionPrice(feeds, additionalMonths);

        vm.prank(subscriber);
        feeRouter.renewSubscription{value: renewPrice}(subId, additionalMonths);

        IOracleFeeRouter.Subscription memory subAfter = feeRouter.getSubscription(subId);
        assertEq(subAfter.endTime, endTimeBefore + (additionalMonths * 30 days));
    }

    function testFuzz_RenewSubscription_AfterExpiry(uint256 timePassed) public {
        timePassed = bound(timePassed, 31 days, 365 days);

        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        uint256 price = feeRouter.getSubscriptionPrice(feeds, 1);

        address subscriber = address(0x15);
        vm.deal(subscriber, 100 ether);

        vm.prank(subscriber);
        bytes32 subId = feeRouter.subscribe{value: price}(feeds, 1);

        // Fast forward past expiry
        vm.warp(block.timestamp + timePassed);

        // Renew after expiry
        vm.prank(subscriber);
        feeRouter.renewSubscription{value: price}(subId, 1);

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subId);
        assertTrue(sub.isActive);
        assertEq(sub.endTime, block.timestamp + 30 days);
    }

    // ==================== Per-Read Payment Fuzz Tests ====================

    function testFuzz_PayForRead_ValidPayment(uint256 paymentAmount) public {
        IOracleFeeRouter.FeeConfig memory config = feeRouter.getFeeConfig();
        paymentAmount = bound(paymentAmount, config.perReadFee, 1 ether);

        address reader = address(0x16);
        vm.deal(reader, paymentAmount + 1 ether);

        uint256 feesBefore = feeRouter.getTotalFeesCollected();

        vm.prank(reader);
        feeRouter.payForRead{value: paymentAmount}(feedId);

        uint256 feesAfter = feeRouter.getTotalFeesCollected();
        assertEq(feesAfter, feesBefore + config.perReadFee);
    }

    function testFuzz_PayForReadBatch_MultipleFeeds(uint8 feedCount) public {
        feedCount = uint8(bound(feedCount, 1, 10));

        bytes32[] memory feeds = new bytes32[](feedCount);
        feeds[0] = feedId;
        
        for (uint256 i = 1; i < feedCount; i++) {
            vm.prank(owner);
            feeds[i] = registry.createFeed(IFeedRegistry.FeedCreateParams({
                symbol: string(abi.encodePacked("READ-", vm.toString(i))),
                baseToken: address(uint160(0x3000 + i)),
                quoteToken: address(uint160(0x4000 + i)),
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
        }

        IOracleFeeRouter.FeeConfig memory config = feeRouter.getFeeConfig();
        uint256 totalFee = config.perReadFee * feedCount;

        address reader = address(0x17);
        vm.deal(reader, totalFee + 1 ether);

        uint256 feesBefore = feeRouter.getTotalFeesCollected();

        vm.prank(reader);
        feeRouter.payForReadBatch{value: totalFee}(feeds);

        uint256 feesAfter = feeRouter.getTotalFeesCollected();
        assertEq(feesAfter, feesBefore + totalFee);
    }

    // ==================== Epoch Fuzz Tests ====================

    function testFuzz_EpochAdvancement(uint256 timePassed) public {
        timePassed = bound(timePassed, 0, 10 days);

        uint256 epochBefore = feeRouter.getCurrentEpoch();

        vm.warp(block.timestamp + timePassed);

        // Trigger epoch check via subscription
        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;
        uint256 price = feeRouter.getSubscriptionPrice(feeds, 1);

        address subscriber = address(0x18);
        vm.deal(subscriber, price + 1 ether);

        vm.prank(subscriber);
        feeRouter.subscribe{value: price}(feeds, 1);

        uint256 epochAfter = feeRouter.getCurrentEpoch();
        uint256 expectedEpochs = timePassed / 1 days;

        assertGe(epochAfter, epochBefore + expectedEpochs);
    }

    // ==================== Operator Rewards Fuzz Tests ====================

    function testFuzz_CreditOperatorRewards(uint256 rewardAmount) public {
        rewardAmount = bound(rewardAmount, 0.001 ether, 100 ether);

        bytes32 operatorId = keccak256("operator1");

        vm.prank(owner);
        feeRouter.creditOperatorRewards(operatorId, rewardAmount);

        IOracleFeeRouter.OperatorEarnings memory earnings = feeRouter.getOperatorEarnings(operatorId);
        assertEq(earnings.totalEarned, rewardAmount);
        assertEq(earnings.pendingRewards, rewardAmount);
    }

    function testFuzz_ClaimOperatorRewards_Partial(uint256 creditAmount, uint256 claimCount) public {
        creditAmount = bound(creditAmount, 1 ether, 100 ether);
        claimCount = bound(claimCount, 1, 5);

        bytes32 operatorId = keccak256("operator2");
        address operatorWallet = address(0x19);

        // Credit rewards
        vm.prank(owner);
        feeRouter.creditOperatorRewards(operatorId, creditAmount);

        // Claim multiple times (should only work once)
        for (uint256 i = 0; i < claimCount; i++) {
            IOracleFeeRouter.OperatorEarnings memory earnings = feeRouter.getOperatorEarnings(operatorId);
            
            if (earnings.pendingRewards > 0) {
                uint256 balanceBefore = owner.balance;
                
                vm.prank(owner);
                feeRouter.claimOperatorRewards(operatorId);
                
                assertGt(owner.balance, balanceBefore);
            } else {
                vm.prank(owner);
                vm.expectRevert(IOracleFeeRouter.NoRewardsToClaim.selector);
                feeRouter.claimOperatorRewards(operatorId);
            }
        }
    }

    // ==================== Fee Distribution Fuzz Tests ====================

    function testFuzz_FeeDistribution_Invariant(uint256 subscriptionCount) public {
        subscriptionCount = bound(subscriptionCount, 1, 20);

        uint256 totalPaid;

        for (uint256 i = 0; i < subscriptionCount; i++) {
            bytes32[] memory feeds = new bytes32[](1);
            feeds[0] = feedId;

            uint256 price = feeRouter.getSubscriptionPrice(feeds, 1);

            address subscriber = address(uint160(0x1000 + i));
            vm.deal(subscriber, price + 1 ether);

            vm.prank(subscriber);
            feeRouter.subscribe{value: price}(feeds, 1);

            totalPaid += price;
        }

        uint256 totalCollected = feeRouter.getTotalFeesCollected();
        assertEq(totalCollected, totalPaid);
    }

    // ==================== Subscription Status Fuzz Tests ====================

    function testFuzz_IsSubscribed_AfterExpiry(uint256 timePassed) public {
        timePassed = bound(timePassed, 0, 60 days);

        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        uint256 price = feeRouter.getSubscriptionPrice(feeds, 1);

        address subscriber = address(0x20);
        vm.deal(subscriber, price + 1 ether);

        vm.prank(subscriber);
        feeRouter.subscribe{value: price}(feeds, 1);

        vm.warp(block.timestamp + timePassed);

        bool isSubscribed = feeRouter.isSubscribed(subscriber, feedId);

        if (timePassed <= 30 days) {
            assertTrue(isSubscribed);
        } else {
            assertFalse(isSubscribed);
        }
    }

    // ==================== Cancel Subscription Fuzz Tests ====================

    function testFuzz_CancelSubscription_Timing(uint256 cancelTime) public {
        cancelTime = bound(cancelTime, 0, 30 days);

        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        uint256 price = feeRouter.getSubscriptionPrice(feeds, 1);

        address subscriber = address(0x21);
        vm.deal(subscriber, price + 1 ether);

        vm.prank(subscriber);
        bytes32 subId = feeRouter.subscribe{value: price}(feeds, 1);

        vm.warp(block.timestamp + cancelTime);

        vm.prank(subscriber);
        feeRouter.cancelSubscription(subId);

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subId);
        assertFalse(sub.isActive);
    }

    // ==================== Edge Cases ====================

    function testFuzz_Subscribe_ZeroDuration_Reverts() public {
        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        address subscriber = address(0x22);
        vm.deal(subscriber, 10 ether);

        vm.prank(subscriber);
        vm.expectRevert(IOracleFeeRouter.InvalidFeeConfig.selector);
        feeRouter.subscribe{value: 1 ether}(feeds, 0);
    }

    function testFuzz_Subscribe_ExceedMaxDuration_Reverts(uint256 duration) public {
        duration = bound(duration, 13, 100);

        bytes32[] memory feeds = new bytes32[](1);
        feeds[0] = feedId;

        address subscriber = address(0x23);
        vm.deal(subscriber, 100 ether);

        vm.prank(subscriber);
        vm.expectRevert(IOracleFeeRouter.InvalidFeeConfig.selector);
        feeRouter.subscribe{value: 50 ether}(feeds, duration);
    }

    receive() external payable {}
}
