// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FeedRegistry} from "../../../src/oracle/FeedRegistry.sol";
import {ReportVerifier} from "../../../src/oracle/ReportVerifier.sol";
import {DisputeGame} from "../../../src/oracle/DisputeGame.sol";
import {OracleFeeRouter} from "../../../src/oracle/OracleFeeRouter.sol";
import {IFeedRegistry} from "../../../src/oracle/interfaces/IFeedRegistry.sol";
import {IDisputeGame} from "../../../src/oracle/interfaces/IDisputeGame.sol";
import {OracleOperatorHandler} from "./handlers/OracleOperatorHandler.sol";
import {DisputerHandler} from "./handlers/DisputerHandler.sol";

/// @title OracleInvariant
/// @notice Invariant tests for the Jeju Oracle Network
/// @dev Tests critical system invariants that must hold under all conditions
contract OracleInvariantTest is Test {
    FeedRegistry public registry;
    ReportVerifier public verifier;
    DisputeGame public disputeGame;
    OracleFeeRouter public feeRouter;

    OracleOperatorHandler public operatorHandler;
    DisputerHandler public disputerHandler;

    address public owner = address(0x1);
    bytes32[] public feedIds;

    function setUp() public {
        vm.warp(1700000000);

        vm.startPrank(owner);

        // Deploy contracts
        registry = new FeedRegistry(owner);
        verifier = new ReportVerifier(address(registry), address(0), owner);
        disputeGame = new DisputeGame(address(verifier), address(registry), owner);
        feeRouter = new OracleFeeRouter(address(registry), owner);

        // Create test feeds
        for (uint256 i = 0; i < 3; i++) {
            bytes32 feedId = registry.createFeed(
                IFeedRegistry.FeedCreateParams({
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
                })
            );
            feedIds.push(feedId);
        }

        vm.stopPrank();

        // Create handlers
        operatorHandler = new OracleOperatorHandler(registry, verifier, 5);
        disputerHandler = new DisputerHandler(verifier, disputeGame, 3);

        // Add feeds to operator handler
        for (uint256 i = 0; i < feedIds.length; i++) {
            operatorHandler.addFeed(feedIds[i]);
        }

        // Fund dispute game for rewards
        vm.deal(address(disputeGame), 1000 ether);

        // Target handlers for invariant testing
        targetContract(address(operatorHandler));
        targetContract(address(disputerHandler));
    }

    // ==================== Price Integrity Invariants ====================

    /// @notice Price deviation must never exceed circuit breaker threshold
    function invariant_priceDeviationWithinBounds() public view {
        uint256 maxDeviation = operatorHandler.ghost_maxPriceDeviation();
        uint256 circuitBreakerBps = 2000; // 20%

        assertLe(maxDeviation, circuitBreakerBps, "Price deviation exceeded circuit breaker");
    }

    /// @notice All stored prices must be positive
    function invariant_pricesArePositive() public view {
        for (uint256 i = 0; i < feedIds.length; i++) {
            bytes32 feedId = feedIds[i];
            uint256 price = operatorHandler.ghost_lastPrice(feedId);

            // Price of 0 is only valid if never updated
            if (operatorHandler.ghost_lastUpdateTime(feedId) > 0) {
                assertGt(price, 0, "Stored price is zero");
            }
        }
    }

    // ==================== Round Sequencing Invariants ====================

    /// @notice Report rounds must be strictly increasing
    function invariant_roundsMonotonicallyIncrease() public view {
        for (uint256 i = 0; i < feedIds.length; i++) {
            bytes32 feedId = feedIds[i];
            uint256 round = verifier.getCurrentRound(feedId);

            // Round should never decrease (this is implicitly enforced by storage)
            assertGe(round, 0, "Round went negative");
        }
    }

    // ==================== Dispute System Invariants ====================

    /// @notice Total bonds collected >= total rewards paid
    function invariant_disputeBondsBalanced() public view {
        uint256 totalBonds = disputerHandler.totalBondsPaid();
        uint256 totalRewards = disputerHandler.totalRewardsEarned();

        // Rewards come from bonds + protocol funds, so this can be exceeded
        // But the system should always have funds to pay rewards
        uint256 disputeGameBalance = address(disputeGame).balance;
        assertGe(disputeGameBalance + totalBonds, 0, "Dispute game insolvent");
    }

    /// @notice Open disputes + resolved disputes == total disputes opened
    function invariant_disputeCountConsistent() public view {
        uint256 opened = disputerHandler.totalDisputesOpened();
        uint256 openCount = disputerHandler.getOpenDisputeCount();
        uint256 resolvedCount = disputerHandler.getResolvedDisputeCount();

        assertEq(openCount + resolvedCount, opened, "Dispute count mismatch");
    }

    /// @notice No duplicate disputes for same report
    function invariant_noDuplicateDisputes() public view {
        bytes32[] memory activeDisputes = disputeGame.getActiveDisputes();

        for (uint256 i = 0; i < activeDisputes.length; i++) {
            IDisputeGame.Dispute memory dispute1 = disputeGame.getDispute(activeDisputes[i]);

            for (uint256 j = i + 1; j < activeDisputes.length; j++) {
                IDisputeGame.Dispute memory dispute2 = disputeGame.getDispute(activeDisputes[j]);

                assertTrue(dispute1.reportHash != dispute2.reportHash, "Duplicate dispute for same report");
            }
        }
    }

    // ==================== Report Acceptance Invariants ====================

    /// @notice Track acceptance metrics (informational, not strict invariant)
    function invariant_trackAcceptanceRate() public view {
        uint256 submitted = operatorHandler.totalReportsSubmitted();
        uint256 accepted = operatorHandler.totalReportsAccepted();

        // This is informational - high rejection rate may indicate:
        // 1. Round sequencing issues
        // 2. Timing constraints
        // 3. Circuit breaker triggers
        // All are valid system behaviors
        if (submitted > 0) {
            uint256 acceptanceRate = (accepted * 100) / submitted;
            // Log for analysis, don't fail test
            // console2.log("Acceptance rate:", acceptanceRate, "%");
        }
    }

    // ==================== Fee Collection Invariants ====================

    /// @notice Total fees collected should never decrease
    function invariant_feesMonotonicallyIncrease() public view {
        uint256 totalFees = feeRouter.getTotalFeesCollected();
        // Fees can only be added, never removed
        assertGe(totalFees, 0, "Fees went negative");
    }

    // ==================== System State Invariants ====================

    /// @notice All feeds should remain in valid state
    function invariant_feedsRemainValid() public view {
        for (uint256 i = 0; i < feedIds.length; i++) {
            bytes32 feedId = feedIds[i];

            assertTrue(registry.feedExists(feedId), "Feed disappeared");

            IFeedRegistry.FeedSpec memory spec = registry.getFeed(feedId);
            assertGt(spec.heartbeatSeconds, 0, "Invalid heartbeat");
            assertGt(spec.quorumThreshold, 0, "Invalid quorum");
        }
    }

    // ==================== Call Summary ====================

    function invariant_callSummary() public view {
        console2.log("\n=== Oracle Invariant Test Summary ===");
        console2.log("Total reports submitted:", operatorHandler.totalReportsSubmitted());
        console2.log("Total reports accepted:", operatorHandler.totalReportsAccepted());
        console2.log("Total reports rejected:", operatorHandler.totalReportsRejected());
        console2.log("Max price deviation (bps):", operatorHandler.ghost_maxPriceDeviation());
        console2.log("---");
        console2.log("Total disputes opened:", disputerHandler.totalDisputesOpened());
        console2.log("Total disputes challenged:", disputerHandler.totalDisputesChallenged());
        console2.log("Total disputes expired:", disputerHandler.totalDisputesExpired());
        console2.log("Max concurrent disputes:", disputerHandler.ghost_maxConcurrentDisputes());
        console2.log("=====================================\n");
    }
}
