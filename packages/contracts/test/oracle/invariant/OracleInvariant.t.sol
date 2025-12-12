// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FeedRegistry} from "../../../src/oracle/FeedRegistry.sol";
import {ReportVerifier} from "../../../src/oracle/ReportVerifier.sol";
import {CommitteeManager} from "../../../src/oracle/CommitteeManager.sol";
import {DisputeGame} from "../../../src/oracle/DisputeGame.sol";
import {OracleFeeRouter} from "../../../src/oracle/OracleFeeRouter.sol";
import {IFeedRegistry} from "../../../src/oracle/interfaces/IFeedRegistry.sol";
import {IReportVerifier} from "../../../src/oracle/interfaces/IReportVerifier.sol";
import {IDisputeGame} from "../../../src/oracle/interfaces/IDisputeGame.sol";
import {IOracleFeeRouter} from "../../../src/oracle/interfaces/IOracleFeeRouter.sol";

import {OracleHandler} from "./handlers/OracleHandler.sol";
import {DisputeHandler} from "./handlers/DisputeHandler.sol";
import {SubscriptionHandler} from "./handlers/SubscriptionHandler.sol";

/// @title Oracle Network Invariant Tests
/// @notice Stateful invariant testing for the Jeju Oracle Network
contract OracleInvariantTest is Test {
    FeedRegistry public registry;
    ReportVerifier public verifier;
    CommitteeManager public committee;
    DisputeGame public disputeGame;
    OracleFeeRouter public feeRouter;

    OracleHandler public oracleHandler;
    DisputeHandler public disputeHandler;
    SubscriptionHandler public subscriptionHandler;

    address public owner = address(0x1);
    bytes32 public feedId;

    function setUp() public {
        vm.warp(1700000000);

        vm.startPrank(owner);
        registry = new FeedRegistry(owner);
        committee = new CommitteeManager(address(registry), owner);
        verifier = new ReportVerifier(address(registry), address(0), owner);
        disputeGame = new DisputeGame(address(verifier), address(registry), owner);
        feeRouter = new OracleFeeRouter(address(registry), owner);

        // Create initial feed
        feedId = registry.createFeed(IFeedRegistry.FeedCreateParams({
            symbol: "ETH-USD",
            baseToken: address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2),
            quoteToken: address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48),
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

        // Deploy handlers
        oracleHandler = new OracleHandler(registry, verifier, feedId, owner);
        disputeHandler = new DisputeHandler(disputeGame, verifier, registry, feedId, owner);
        subscriptionHandler = new SubscriptionHandler(feeRouter, registry, feedId);

        // Fund handlers
        vm.deal(address(oracleHandler), 100 ether);
        vm.deal(address(disputeHandler), 1000 ether);
        vm.deal(address(subscriptionHandler), 100 ether);

        // Target handlers for invariant testing
        targetContract(address(oracleHandler));
        targetContract(address(disputeHandler));
        targetContract(address(subscriptionHandler));
    }

    // ==================== Price Integrity Invariants ====================

    /// @notice Prices should never be zero for active feeds
    function invariant_activeFeedPriceNonZero() public view {
        bytes32[] memory allFeeds = registry.getAllFeeds();
        for (uint256 i = 0; i < allFeeds.length; i++) {
            if (registry.isFeedActive(allFeeds[i])) {
                uint256 round = verifier.getCurrentRound(allFeeds[i]);
                if (round > 0) {
                    (uint256 price,,,) = verifier.getLatestPrice(allFeeds[i]);
                    // If there's a round, price should be non-zero
                    if (price == 0) {
                        // This would be a critical invariant violation
                        assertTrue(false, "Active feed with round should have non-zero price");
                    }
                }
            }
        }
    }

    /// @notice Round numbers should be monotonically increasing
    function invariant_roundMonotonicallyIncreasing() public view {
        uint256 currentRound = verifier.getCurrentRound(feedId);
        uint256 trackedRound = oracleHandler.lastRound();
        
        // Current round should never decrease from what handler tracked
        assertGe(currentRound, trackedRound, "Round decreased unexpectedly");
    }

    /// @notice Price should be within circuit breaker bounds
    function invariant_priceWithinCircuitBreaker() public view {
        uint256 lastPrice = oracleHandler.lastPrice();
        if (lastPrice == 0) return;

        (uint256 currentPrice,,,) = verifier.getLatestPrice(feedId);
        if (currentPrice == 0) return;

        // Check deviation
        uint256 circuitBreakerBps = verifier.circuitBreakerBps();
        uint256 maxAllowedDeviation = (lastPrice * circuitBreakerBps) / 10000;

        uint256 deviation = currentPrice > lastPrice 
            ? currentPrice - lastPrice 
            : lastPrice - currentPrice;

        assertLe(deviation, maxAllowedDeviation + 1, "Price exceeded circuit breaker");
    }

    // ==================== Dispute System Invariants ====================

    /// @notice Total bonds should equal sum of active dispute bonds
    function invariant_disputeBondsAccountedFor() public view {
        bytes32[] memory activeDisputes = disputeGame.getActiveDisputes();
        uint256 totalActiveBonds;

        for (uint256 i = 0; i < activeDisputes.length; i++) {
            IDisputeGame.Dispute memory d = disputeGame.getDispute(activeDisputes[i]);
            totalActiveBonds += d.bond;
        }

        // Contract balance should cover active bonds
        assertGe(address(disputeGame).balance, totalActiveBonds, "Insufficient balance for bonds");
    }

    /// @notice Dispute should not exist for unprocessed reports
    function invariant_noDisputeForUnprocessedReports() public view {
        bytes32[] memory activeDisputes = disputeGame.getActiveDisputes();
        
        for (uint256 i = 0; i < activeDisputes.length; i++) {
            IDisputeGame.Dispute memory d = disputeGame.getDispute(activeDisputes[i]);
            assertTrue(verifier.isReportProcessed(d.reportHash), "Dispute for unprocessed report");
        }
    }

    // ==================== Fee System Invariants ====================

    /// @notice Total fees collected should equal sum of subscription payments
    function invariant_feesAccountedFor() public view {
        uint256 totalCollected = feeRouter.getTotalFeesCollected();
        uint256 handlerTracked = subscriptionHandler.totalPaid();
        
        assertEq(totalCollected, handlerTracked, "Fee accounting mismatch");
    }

    /// @notice Active subscriptions should have valid end times
    function invariant_activeSubscriptionsHaveValidEndTimes() public view {
        bytes32[] memory subIds = subscriptionHandler.getSubscriptionIds();
        
        for (uint256 i = 0; i < subIds.length; i++) {
            IOracleFeeRouter.Subscription memory sub = feeRouter.getSubscription(subIds[i]);
            if (sub.isActive) {
                assertGe(sub.endTime, sub.startTime, "End time before start time");
            }
        }
    }

    // ==================== Registry Invariants ====================

    /// @notice All feeds in getAllFeeds should exist and have valid specs
    function invariant_allFeedsValid() public view {
        bytes32[] memory allFeeds = registry.getAllFeeds();
        
        for (uint256 i = 0; i < allFeeds.length; i++) {
            assertTrue(registry.feedExists(allFeeds[i]), "Feed in list doesn't exist");
            
            IFeedRegistry.FeedSpec memory spec = registry.getFeed(allFeeds[i]);
            assertEq(spec.feedId, allFeeds[i], "Feed spec mismatch");
        }
    }

    // ==================== Cross-Contract Invariants ====================

    /// @notice Operator rewards should not exceed total fees
    function invariant_operatorRewardsNotExceedFees() public view {
        uint256 totalFees = feeRouter.getTotalFeesCollected();
        
        // Sum up all credited rewards
        bytes32[] memory operatorIds = subscriptionHandler.getOperatorIds();
        uint256 totalCredited;
        
        for (uint256 i = 0; i < operatorIds.length; i++) {
            IOracleFeeRouter.OperatorEarnings memory earnings = feeRouter.getOperatorEarnings(operatorIds[i]);
            totalCredited += earnings.totalEarned;
        }
        
        assertLe(totalCredited, totalFees, "Credited more than collected");
    }

    // ==================== Handler State Dump ====================

    function invariant_callSummary() public view {
        console2.log("=== Oracle Handler Stats ===");
        console2.log("Reports submitted:", oracleHandler.reportsSubmitted());
        console2.log("Reports accepted:", oracleHandler.reportsAccepted());
        console2.log("Last price:", oracleHandler.lastPrice());
        console2.log("Last round:", oracleHandler.lastRound());
        
        console2.log("=== Dispute Handler Stats ===");
        console2.log("Disputes opened:", disputeHandler.disputesOpened());
        console2.log("Disputes resolved:", disputeHandler.disputesResolved());
        
        console2.log("=== Subscription Handler Stats ===");
        console2.log("Subscriptions:", subscriptionHandler.subscriptionCount());
        console2.log("Total paid:", subscriptionHandler.totalPaid());
    }
}
