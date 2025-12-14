// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FeedRegistry} from "../../src/oracle/FeedRegistry.sol";
import {OracleFeeRouter} from "../../src/oracle/OracleFeeRouter.sol";
import {IFeedRegistry} from "../../src/oracle/interfaces/IFeedRegistry.sol";
import {IOracleFeeRouter} from "../../src/oracle/interfaces/IOracleFeeRouter.sol";

contract OracleFeeRouterTest is Test {
    FeedRegistry public registry;
    OracleFeeRouter public feeRouter;

    address public owner = address(0x1);
    address public subscriber1 = address(0x10);
    address public subscriber2 = address(0x20);
    address public operator1 = address(0x30);

    address public constant WETH = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    address public constant USDC = address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
    address public constant DAI = address(0x6B175474E89094C44Da98b954EedeAC495271d0F);

    bytes32 public feedId1;
    bytes32 public feedId2;

    function setUp() public {
        vm.warp(1700000000);

        // Fund accounts
        vm.deal(subscriber1, 100 ether);
        vm.deal(subscriber2, 100 ether);
        vm.deal(owner, 100 ether);

        // Deploy contracts
        vm.startPrank(owner);
        registry = new FeedRegistry(owner);
        feeRouter = new OracleFeeRouter(address(registry), owner);

        // Create feeds
        feedId1 = registry.createFeed(
            IFeedRegistry.FeedCreateParams({
                symbol: "ETH-USD",
                baseToken: WETH,
                quoteToken: USDC,
                decimals: 8,
                heartbeatSeconds: 3600,
                twapWindowSeconds: 1800,
                minLiquidityUSD: 100_000 ether,
                maxDeviationBps: 100,
                minOracles: 3,
                quorumThreshold: 2,
                requiresConfidence: true,
                category: IFeedRegistry.FeedCategory.SPOT_PRICE
            })
        );

        feedId2 = registry.createFeed(
            IFeedRegistry.FeedCreateParams({
                symbol: "DAI-USD",
                baseToken: DAI,
                quoteToken: USDC,
                decimals: 8,
                heartbeatSeconds: 86400,
                twapWindowSeconds: 3600,
                minLiquidityUSD: 50_000 ether,
                maxDeviationBps: 50,
                minOracles: 3,
                quorumThreshold: 2,
                requiresConfidence: false,
                category: IFeedRegistry.FeedCategory.STABLECOIN_PEG
            })
        );

        vm.stopPrank();
    }

    // ============ Subscribe Tests ============

    function test_Subscribe_SingleFeed() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId1;

        uint256 price = feeRouter.getSubscriptionPrice(feedIds, 1);
        assertEq(price, 0.1 ether); // Default monthly fee

        vm.prank(subscriber1);
        bytes32 subId = feeRouter.subscribe{value: price}(feedIds, 1);

        assertTrue(feeRouter.isSubscribed(subscriber1, feedId1));

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subId);
        assertEq(sub.subscriber, subscriber1);
        assertEq(sub.feedIds.length, 1);
        assertEq(sub.feedIds[0], feedId1);
        assertTrue(sub.isActive);
        assertEq(sub.amountPaid, price);
        assertEq(sub.endTime, block.timestamp + 30 days);
    }

    function test_Subscribe_MultipleFeeds() public {
        bytes32[] memory feedIds = new bytes32[](2);
        feedIds[0] = feedId1;
        feedIds[1] = feedId2;

        uint256 price = feeRouter.getSubscriptionPrice(feedIds, 1);
        assertEq(price, 0.2 ether); // 2 feeds * 0.1 ETH

        vm.prank(subscriber1);
        bytes32 subId = feeRouter.subscribe{value: price}(feedIds, 1);

        assertTrue(feeRouter.isSubscribed(subscriber1, feedId1));
        assertTrue(feeRouter.isSubscribed(subscriber1, feedId2));

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subId);
        assertEq(sub.feedIds.length, 2);
    }

    function test_Subscribe_MultipleMonths() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId1;

        uint256 price = feeRouter.getSubscriptionPrice(feedIds, 6);
        assertEq(price, 0.6 ether); // 6 months * 0.1 ETH

        vm.prank(subscriber1);
        bytes32 subId = feeRouter.subscribe{value: price}(feedIds, 6);

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subId);
        assertEq(sub.endTime, block.timestamp + 180 days);
    }

    function test_Subscribe_ExcessRefund() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId1;

        uint256 price = feeRouter.getSubscriptionPrice(feedIds, 1);
        uint256 excess = 1 ether;
        uint256 balanceBefore = subscriber1.balance;

        vm.prank(subscriber1);
        feeRouter.subscribe{value: price + excess}(feedIds, 1);

        // Excess should be refunded
        assertEq(subscriber1.balance, balanceBefore - price);
    }

    function test_Subscribe_RevertEmptyFeeds() public {
        bytes32[] memory feedIds = new bytes32[](0);

        vm.expectRevert(IOracleFeeRouter.InvalidFeeConfig.selector);
        vm.prank(subscriber1);
        feeRouter.subscribe{value: 1 ether}(feedIds, 1);
    }

    function test_Subscribe_RevertInvalidDuration() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId1;

        // 0 months
        vm.expectRevert(IOracleFeeRouter.InvalidFeeConfig.selector);
        vm.prank(subscriber1);
        feeRouter.subscribe{value: 1 ether}(feedIds, 0);

        // 13 months (max is 12)
        vm.expectRevert(IOracleFeeRouter.InvalidFeeConfig.selector);
        vm.prank(subscriber1);
        feeRouter.subscribe{value: 2 ether}(feedIds, 13);
    }

    function test_Subscribe_RevertInsufficientPayment() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId1;

        vm.expectRevert(abi.encodeWithSelector(IOracleFeeRouter.InsufficientPayment.selector, 0.05 ether, 0.1 ether));
        vm.prank(subscriber1);
        feeRouter.subscribe{value: 0.05 ether}(feedIds, 1);
    }

    function test_Subscribe_RevertNonExistentFeed() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = bytes32(uint256(0xdead));

        vm.expectRevert(IOracleFeeRouter.InvalidFeeConfig.selector);
        vm.prank(subscriber1);
        feeRouter.subscribe{value: 1 ether}(feedIds, 1);
    }

    // ============ Renew Tests ============

    function test_RenewSubscription() public {
        // First subscribe
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId1;
        uint256 price = feeRouter.getSubscriptionPrice(feedIds, 1);

        vm.prank(subscriber1);
        bytes32 subId = feeRouter.subscribe{value: price}(feedIds, 1);

        uint256 originalEnd = feeRouter.getSubscription(subId).endTime;

        // Renew for 2 more months
        uint256 renewPrice = feeRouter.getSubscriptionPrice(feedIds, 2);
        vm.prank(subscriber1);
        feeRouter.renewSubscription{value: renewPrice}(subId, 2);

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subId);
        assertEq(sub.endTime, originalEnd + 60 days);
        assertEq(sub.amountPaid, price + renewPrice);
    }

    function test_RenewSubscription_Expired() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId1;
        uint256 price = feeRouter.getSubscriptionPrice(feedIds, 1);

        vm.prank(subscriber1);
        bytes32 subId = feeRouter.subscribe{value: price}(feedIds, 1);

        // Advance past expiry
        vm.warp(block.timestamp + 31 days);

        // Renew expired subscription - should restart from now
        vm.prank(subscriber1);
        feeRouter.renewSubscription{value: price}(subId, 1);

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subId);
        assertEq(sub.startTime, block.timestamp);
        assertEq(sub.endTime, block.timestamp + 30 days);
    }

    function test_RenewSubscription_RevertNotOwner() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId1;
        uint256 price = feeRouter.getSubscriptionPrice(feedIds, 1);

        vm.prank(subscriber1);
        bytes32 subId = feeRouter.subscribe{value: price}(feedIds, 1);

        vm.expectRevert(abi.encodeWithSelector(IOracleFeeRouter.SubscriptionNotFound.selector, subId));
        vm.prank(subscriber2);
        feeRouter.renewSubscription{value: price}(subId, 1);
    }

    // ============ Cancel Tests ============

    function test_CancelSubscription() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId1;
        uint256 price = feeRouter.getSubscriptionPrice(feedIds, 1);

        vm.prank(subscriber1);
        bytes32 subId = feeRouter.subscribe{value: price}(feedIds, 1);

        assertTrue(feeRouter.isSubscribed(subscriber1, feedId1));

        vm.prank(subscriber1);
        feeRouter.cancelSubscription(subId);

        assertFalse(feeRouter.isSubscribed(subscriber1, feedId1));

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subId);
        assertFalse(sub.isActive);
    }

    function test_CancelSubscription_RevertAlreadyCancelled() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId1;
        uint256 price = feeRouter.getSubscriptionPrice(feedIds, 1);

        vm.prank(subscriber1);
        bytes32 subId = feeRouter.subscribe{value: price}(feedIds, 1);

        vm.prank(subscriber1);
        feeRouter.cancelSubscription(subId);

        vm.expectRevert(abi.encodeWithSelector(IOracleFeeRouter.SubscriptionNotActive.selector, subId));
        vm.prank(subscriber1);
        feeRouter.cancelSubscription(subId);
    }

    // ============ Per-Read Payment Tests ============

    function test_PayForRead() public {
        IOracleFeeRouter.FeeConfig memory config = feeRouter.getFeeConfig();
        uint256 readFee = config.perReadFee;

        uint256 balanceBefore = subscriber1.balance;
        uint256 totalBefore = feeRouter.getTotalFeesCollected();

        vm.prank(subscriber1);
        feeRouter.payForRead{value: readFee}(feedId1);

        assertEq(subscriber1.balance, balanceBefore - readFee);
        assertEq(feeRouter.getTotalFeesCollected(), totalBefore + readFee);
    }

    function test_PayForReadBatch() public {
        bytes32[] memory feedIds = new bytes32[](2);
        feedIds[0] = feedId1;
        feedIds[1] = feedId2;

        IOracleFeeRouter.FeeConfig memory config = feeRouter.getFeeConfig();
        uint256 totalFee = 2 * config.perReadFee;

        vm.prank(subscriber1);
        feeRouter.payForReadBatch{value: totalFee}(feedIds);

        assertEq(feeRouter.getTotalFeesCollected(), totalFee);
    }

    function test_PayForRead_RevertInsufficientPayment() public {
        vm.expectRevert(abi.encodeWithSelector(IOracleFeeRouter.InsufficientPayment.selector, 0, 0.0001 ether));
        vm.prank(subscriber1);
        feeRouter.payForRead{value: 0}(feedId1);
    }

    // ============ Epoch & Rewards Tests ============

    function test_DistributeEpochRewards() public {
        // Accumulate some fees via subscription
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId1;
        uint256 price = feeRouter.getSubscriptionPrice(feedIds, 1);

        vm.prank(subscriber1);
        feeRouter.subscribe{value: price}(feedIds, 1);

        uint256 currentEpoch = feeRouter.getCurrentEpoch();
        uint256 expectedFees = price;

        // Advance time past epoch duration
        vm.warp(block.timestamp + 1 days + 1);

        // Trigger epoch advance with a read operation
        // Use distributeEpochRewards itself which calls _advanceEpochIfNeeded
        feeRouter.distributeEpochRewards(currentEpoch);

        IOracleFeeRouter.EpochRewards memory rewards = feeRouter.getEpochRewards(currentEpoch);
        assertTrue(rewards.finalized);
        assertEq(rewards.totalFees, expectedFees);

        // Check splits: treasury = 10%, operators = 70%, delegators = 15%
        assertEq(rewards.treasuryShare, (expectedFees * 1000) / 10000);
        assertEq(rewards.operatorPool, (expectedFees * 7000) / 10000);
        assertEq(rewards.delegatorPool, (expectedFees * 1500) / 10000);
    }

    function test_DistributeEpochRewards_RevertNotFinalized() public {
        uint256 currentEpoch = feeRouter.getCurrentEpoch();

        vm.expectRevert(abi.encodeWithSelector(IOracleFeeRouter.EpochNotFinalized.selector, currentEpoch));
        feeRouter.distributeEpochRewards(currentEpoch);
    }

    function test_ClaimOperatorRewards() public {
        bytes32 operatorId = keccak256("operator1");

        // Credit some rewards
        vm.prank(owner);
        feeRouter.creditOperatorRewards(operatorId, 1 ether);

        IOracleFeeRouter.OperatorEarnings memory earnings = feeRouter.getOperatorEarnings(operatorId);
        assertEq(earnings.pendingRewards, 1 ether);
        assertEq(earnings.totalEarned, 1 ether);

        // Fund the contract
        vm.deal(address(feeRouter), 10 ether);

        uint256 balanceBefore = subscriber1.balance;

        vm.prank(subscriber1);
        uint256 claimed = feeRouter.claimOperatorRewards(operatorId);

        assertEq(claimed, 1 ether);
        assertEq(subscriber1.balance, balanceBefore + 1 ether);

        earnings = feeRouter.getOperatorEarnings(operatorId);
        assertEq(earnings.pendingRewards, 0);
        assertEq(earnings.totalClaimed, 1 ether);
    }

    function test_ClaimOperatorRewards_RevertNothingToClaim() public {
        bytes32 operatorId = keccak256("operator1");

        vm.expectRevert(IOracleFeeRouter.NoRewardsToClaim.selector);
        vm.prank(subscriber1);
        feeRouter.claimOperatorRewards(operatorId);
    }

    // ============ Admin Tests ============

    function test_SetFeeConfig() public {
        IOracleFeeRouter.FeeConfig memory newConfig = IOracleFeeRouter.FeeConfig({
            subscriptionFeePerMonth: 0.2 ether,
            perReadFee: 0.0002 ether,
            treasuryShareBps: 2000,
            operatorShareBps: 6000,
            delegatorShareBps: 1000,
            disputerRewardBps: 1000
        });

        vm.prank(owner);
        feeRouter.setFeeConfig(newConfig);

        IOracleFeeRouter.FeeConfig memory config = feeRouter.getFeeConfig();
        assertEq(config.subscriptionFeePerMonth, 0.2 ether);
        assertEq(config.perReadFee, 0.0002 ether);
    }

    function test_SetFeeConfig_RevertInvalidBps() public {
        // BPS must sum to 10000
        IOracleFeeRouter.FeeConfig memory badConfig = IOracleFeeRouter.FeeConfig({
            subscriptionFeePerMonth: 0.2 ether,
            perReadFee: 0.0002 ether,
            treasuryShareBps: 5000,
            operatorShareBps: 6000,
            delegatorShareBps: 1000,
            disputerRewardBps: 1000
        });

        vm.expectRevert(IOracleFeeRouter.InvalidFeeConfig.selector);
        vm.prank(owner);
        feeRouter.setFeeConfig(badConfig);
    }

    function test_SetFeedPrice() public {
        vm.prank(owner);
        feeRouter.setFeedPrice(feedId1, 0.5 ether);

        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId1;

        uint256 price = feeRouter.getSubscriptionPrice(feedIds, 1);
        assertEq(price, 0.5 ether);
    }

    function test_WithdrawTreasury() public {
        // Accumulate fees
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId1;
        uint256 price = feeRouter.getSubscriptionPrice(feedIds, 1);

        vm.prank(subscriber1);
        feeRouter.subscribe{value: price}(feedIds, 1);

        // Advance and distribute
        vm.warp(block.timestamp + 1 days + 1);
        vm.prank(subscriber2);
        feeRouter.payForRead{value: 0.0001 ether}(feedId1);
        feeRouter.distributeEpochRewards(1);

        uint256 treasury = feeRouter.getTreasuryBalance();
        assertTrue(treasury > 0);

        uint256 ownerBefore = owner.balance;

        vm.prank(owner);
        feeRouter.withdrawTreasury(owner, treasury);

        assertEq(owner.balance, ownerBefore + treasury);
        assertEq(feeRouter.getTreasuryBalance(), 0);
    }

    function test_Pause_Unpause() public {
        vm.prank(owner);
        feeRouter.pause();

        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId1;

        vm.expectRevert();
        vm.prank(subscriber1);
        feeRouter.subscribe{value: 0.1 ether}(feedIds, 1);

        vm.prank(owner);
        feeRouter.unpause();

        // Should work now
        vm.prank(subscriber1);
        feeRouter.subscribe{value: 0.1 ether}(feedIds, 1);
    }

    // ============ Edge Cases ============

    function test_ReceiveETH() public {
        uint256 totalBefore = feeRouter.getTotalFeesCollected();

        (bool success,) = address(feeRouter).call{value: 1 ether}("");
        assertTrue(success);

        assertEq(feeRouter.getTotalFeesCollected(), totalBefore + 1 ether);
    }

    function test_AddFeedsToSubscription() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId1;

        vm.prank(subscriber1);
        bytes32 subId = feeRouter.subscribe{value: 0.1 ether}(feedIds, 1);

        // Add second feed
        bytes32[] memory newFeeds = new bytes32[](1);
        newFeeds[0] = feedId2;

        vm.prank(subscriber1);
        feeRouter.addFeedsToSubscription{value: 0.1 ether}(subId, newFeeds);

        assertTrue(feeRouter.isSubscribed(subscriber1, feedId2));

        IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subId);
        assertEq(sub.feedIds.length, 2);
    }

    function test_MultipleSubscribers() public {
        bytes32[] memory feedIds = new bytes32[](1);
        feedIds[0] = feedId1;

        vm.prank(subscriber1);
        feeRouter.subscribe{value: 0.1 ether}(feedIds, 1);

        vm.prank(subscriber2);
        feeRouter.subscribe{value: 0.1 ether}(feedIds, 1);

        assertTrue(feeRouter.isSubscribed(subscriber1, feedId1));
        assertTrue(feeRouter.isSubscribed(subscriber2, feedId1));

        bytes32[] memory subs1 = feeRouter.getSubscriptionsByAccount(subscriber1);
        bytes32[] memory subs2 = feeRouter.getSubscriptionsByAccount(subscriber2);
        assertEq(subs1.length, 1);
        assertEq(subs2.length, 1);
    }
}
