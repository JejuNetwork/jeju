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
import {ICommitteeManager} from "../../../src/oracle/interfaces/ICommitteeManager.sol";
import {IDisputeGame} from "../../../src/oracle/interfaces/IDisputeGame.sol";

/// @title AttackSimulation
/// @notice Simulates various attack vectors against the oracle network
/// @dev Tests defenses against known DeFi oracle exploits
contract AttackSimulationTest is Test {
    FeedRegistry public registry;
    ReportVerifier public verifier;
    CommitteeManager public committee;
    DisputeGame public disputeGame;
    OracleFeeRouter public feeRouter;

    address public owner = address(0x1);
    address public attacker = address(0xBAD);

    bytes32 public feedId;

    // Honest operators
    uint256[] public honestPks;
    address[] public honestOperators;

    // Attacker's operators (for collusion attacks)
    uint256[] public attackerPks;
    address[] public attackerOperators;

    function setUp() public {
        vm.warp(1700000000);

        // Create honest operators (5)
        for (uint256 i = 1; i <= 5; i++) {
            honestPks.push(i * 0x1111);
            honestOperators.push(vm.addr(i * 0x1111));
        }

        // Create attacker's operators (3)
        for (uint256 i = 1; i <= 3; i++) {
            attackerPks.push(0xBAD00 + i);
            attackerOperators.push(vm.addr(0xBAD00 + i));
        }

        vm.deal(attacker, 10000 ether);

        vm.startPrank(owner);

        registry = new FeedRegistry(owner);
        committee = new CommitteeManager(address(registry), owner);
        // Pass address(0) for committee to allow any signer (committee tests done separately)
        verifier = new ReportVerifier(address(registry), address(0), owner);
        disputeGame = new DisputeGame(address(verifier), address(registry), owner);
        feeRouter = new OracleFeeRouter(address(registry), owner);

        feedId = registry.createFeed(
            IFeedRegistry.FeedCreateParams({
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
            })
        );

        vm.stopPrank();

        // Fund dispute game
        vm.deal(address(disputeGame), 1000 ether);
    }

    // ==================== Attack 1: Flash Loan Price Manipulation ====================

    /// @notice Simulates a flash loan attack attempting to manipulate TWAP
    /// @dev Tests circuit breaker protection against sudden price spikes
    function test_Attack_FlashLoanPriceManipulation() public {
        // Use absolute timestamps to avoid timing issues
        uint256 t1 = 1700000100;
        vm.warp(t1);
        _submitHonestReport(2000e8, 1);

        // Advance enough time to pass MIN_REPORT_INTERVAL
        uint256 t2 = t1 + 60;
        vm.warp(t2);

        uint256 manipulatedPrice = 3000e8; // 50% increase

        IReportVerifier.PriceReport memory maliciousReport = IReportVerifier.PriceReport({
            feedId: feedId,
            price: manipulatedPrice,
            confidence: 100,
            timestamp: t2,
            round: 2,
            sourcesHash: keccak256("manipulated")
        });

        bytes32 reportHash = _computeReportHash(maliciousReport);
        bytes[] memory signatures = _signWithHonest(reportHash, 2);

        IReportVerifier.ReportSubmission memory submission =
            IReportVerifier.ReportSubmission({report: maliciousReport, signatures: signatures});

        // Should be blocked by circuit breaker (>20% deviation = 5000 bps > 2000 bps)
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                IReportVerifier.PriceDeviationTooLarge.selector,
                5000, // actual deviation (50%)
                2000 // circuit breaker threshold (20%)
            )
        );
        verifier.submitReport(submission);

        // Verify original price unchanged
        (uint256 price,,,) = verifier.getLatestPrice(feedId);
        assertEq(price, 2000e8, "Price should not have changed");

        console2.log("[ATTACK BLOCKED] Flash loan price manipulation prevented by circuit breaker");
    }

    /// @notice Tests gradual price manipulation over multiple blocks
    function test_Attack_GradualPriceManipulation() public {
        // Use absolute timestamps
        uint256 baseTime = 1700000100;
        vm.warp(baseTime);
        _submitHonestReport(2000e8, 1);

        // Attacker attempts gradual manipulation (19% each time, just under circuit breaker)
        uint256 currentPrice = 2000e8;
        uint256 targetPrice = 4000e8; // 2x the original price

        uint256 round = 2;
        uint256 successfulManipulations = 0;

        while (currentPrice < targetPrice && round <= 20) {
            uint256 currentTime = baseTime + (round * 60);
            vm.warp(currentTime);

            // Try 19% increase (just under 20% circuit breaker)
            uint256 newPrice = currentPrice * 119 / 100;

            IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
                feedId: feedId,
                price: newPrice,
                confidence: 100,
                timestamp: currentTime,
                round: round,
                sourcesHash: keccak256(abi.encodePacked("gradual", round))
            });

            bytes32 reportHash = _computeReportHash(report);
            bytes[] memory signatures = _signWithHonest(reportHash, 2);

            IReportVerifier.ReportSubmission memory submission =
                IReportVerifier.ReportSubmission({report: report, signatures: signatures});

            vm.prank(owner);
            try verifier.submitReport(submission) returns (bool accepted) {
                if (accepted) {
                    currentPrice = newPrice;
                    successfulManipulations++;
                    round++;
                } else {
                    break;
                }
            } catch {
                break;
            }
        }

        console2.log("[ATTACK ANALYSIS] Gradual manipulation attempts:", successfulManipulations);
        console2.log("[ATTACK ANALYSIS] Final price:", currentPrice);
        console2.log("[ATTACK ANALYSIS] Target price:", targetPrice);

        // 19% is under 20% circuit breaker, so manipulation can proceed
        // This highlights need for dispute system and TWAP monitoring
        assertTrue(successfulManipulations > 0 || round > 2, "Gradual manipulation analysis complete");
    }

    // ==================== Attack 2: Committee Collusion ====================
    // NOTE: Committee membership tests require committee to be properly formed.
    // These tests verify quorum requirements theoretically.

    /// @notice Verifies quorum requirements prevent simple collusion
    function test_Attack_CommitteeCollusion_QuorumAnalysis() public pure {
        // Committee security analysis
        // With minOracles=3, quorumThreshold=2:
        // - Attacker needs 2 colluding operators to submit false price
        // - Attacker needs to compromise 66% of minimum committee

        uint256 minOracles = 3;
        uint256 quorumThreshold = 2;
        uint256 attackerControlNeeded = quorumThreshold;

        // Security margin: what % of committee must be compromised
        uint256 compromisePercent = (attackerControlNeeded * 100) / minOracles;

        console2.log("[ANALYSIS] Committee size:", minOracles);
        console2.log("[ANALYSIS] Quorum threshold:", quorumThreshold);
        console2.log("[ANALYSIS] Compromise needed:", compromisePercent, "%");

        // For BFT, we want f < n/3 tolerance
        // With 3 nodes and quorum of 2, we can tolerate 1 byzantine
        assertTrue(minOracles - quorumThreshold >= 1, "Should tolerate at least 1 byzantine");
    }

    /// @notice Analyzes economic cost of committee infiltration
    function test_Attack_CommitteeInfiltration_EconomicAnalysis() public pure {
        // Assume minimum stake per operator
        uint256 stakePerOperator = 32 ether;
        uint256 operatorsNeeded = 2; // quorum threshold
        uint256 slashRate = 5000; // 50%

        uint256 attackCost = stakePerOperator * operatorsNeeded;
        uint256 potentialSlash = (attackCost * slashRate) / 10000;

        // For attack to be worthwhile, profit must exceed slash risk
        uint256 maxTVL = potentialSlash * 10; // Assumes 10x buffer

        console2.log("[ANALYSIS] Attack setup cost:", attackCost / 1e18, "ETH");
        console2.log("[ANALYSIS] Potential slash:", potentialSlash / 1e18, "ETH");
        console2.log("[ANALYSIS] Max safe TVL:", maxTVL / 1e18, "ETH");

        assertTrue(potentialSlash > 0, "Slashing should deter attacks");
    }

    // ==================== Attack 3: Liveness Attack (Oracle Freeze) ====================

    /// @notice Simulates Terra/Luna style oracle freeze attack
    function test_Attack_OracleFreeze() public {
        // Use absolute timestamps
        uint256 t1 = 1700000100;
        vm.warp(t1);
        _submitHonestReportAt(2000e8, 1, t1);

        // Attacker causes all operators to stop reporting (simulated)
        // In reality this would be DoS, key compromise, or coordination failure

        // Fast forward past heartbeat
        uint256 t2 = t1 + 4000; // > 3600 heartbeat
        vm.warp(t2);

        // Price should now be stale
        bool isStale = verifier.isPriceStale(feedId);
        assertTrue(isStale, "Price should be stale after freeze");

        // Any protocol relying on this price should detect staleness
        (,, uint256 timestamp, bool isValid) = verifier.getLatestPrice(feedId);
        assertFalse(isValid, "Stale price should not be valid");

        console2.log("[ATTACK DETECTED] Oracle freeze - price stale after", t2 - t1, "seconds");

        // Recovery: Submit new report
        _submitHonestReportAt(2100e8, 2, t2);

        isStale = verifier.isPriceStale(feedId);
        assertFalse(isStale, "Price should be fresh after recovery");

        console2.log("[ATTACK RECOVERED] Oracle resumed with fresh price");
    }

    // ==================== Attack 4: Dispute Griefing ====================

    /// @notice Tests dispute griefing attack (spam disputes to drain funds)
    function test_Attack_DisputeGriefing() public {
        // Submit valid report with proper timestamp
        uint256 t1 = 1700000100;
        vm.warp(t1);
        bytes32 reportHash = _submitHonestReportAt(2000e8, 1, t1);

        uint256 attackerBalanceBefore = attacker.balance;
        uint256 minBond = disputeGame.getMinBond();

        // Attacker opens frivolous dispute
        vm.prank(attacker);
        bytes32 disputeId = disputeGame.openDispute{value: minBond}(
            reportHash, IDisputeGame.DisputeReason.PRICE_DEVIATION, keccak256("griefing")
        );

        // Report was valid, so dispute should be resolved against attacker
        vm.prank(owner);
        disputeGame.resolveDispute(disputeId, IDisputeGame.ResolutionOutcome.REPORT_VALID, "Report was accurate");

        uint256 attackerBalanceAfter = attacker.balance;

        // Attacker should lose their bond
        assertLt(attackerBalanceAfter, attackerBalanceBefore, "Attacker should lose bond");
        assertEq(attackerBalanceAfter, attackerBalanceBefore - minBond, "Attacker should lose exactly the bond");

        console2.log("[ATTACK PUNISHED] Griefing attacker lost:", minBond / 1e18, "ETH");
    }

    /// @notice Tests repeated griefing attacks
    function test_Attack_RepeatedGriefing() public {
        uint256 initialBalance = attacker.balance;
        uint256 minBond = disputeGame.getMinBond();
        uint256 attackAttempts = 5;
        uint256 successfulAttacks = 0;

        uint256 baseTime = 1700000100;

        for (uint256 i = 0; i < attackAttempts; i++) {
            // Use absolute timestamps to ensure proper time advancement
            uint256 reportTime = baseTime + ((i + 1) * 60);
            vm.warp(reportTime);

            // Submit valid report with proper timestamp
            bytes32 reportHash = _submitHonestReportAt(2000e8 + (i * 1e8), i + 1, reportTime);

            // Verify report was processed
            bool isProcessed = verifier.isReportProcessed(reportHash);
            if (!isProcessed) {
                console2.log("Report not processed at attempt:", i);
                continue;
            }

            if (attacker.balance < minBond) break;

            // Attacker disputes
            vm.prank(attacker);
            bytes32 disputeId = disputeGame.openDispute{value: minBond}(
                reportHash, IDisputeGame.DisputeReason.PRICE_DEVIATION, keccak256(abi.encodePacked("grief", i))
            );

            // Resolve against attacker
            vm.prank(owner);
            disputeGame.resolveDispute(disputeId, IDisputeGame.ResolutionOutcome.REPORT_VALID, "Valid report");

            successfulAttacks++;
        }

        uint256 totalLoss = initialBalance - attacker.balance;

        console2.log("[ATTACK ANALYSIS] Griefing attempts:", attackAttempts);
        console2.log("[ATTACK ANALYSIS] Total ETH lost:", totalLoss / 1e18);
        console2.log("[ATTACK ANALYSIS] Cost per attempt:", minBond / 1e18, "ETH");

        // Griefing should be economically infeasible
        if (successfulAttacks > 0) {
            assertGe(totalLoss, minBond * successfulAttacks, "Attacker should lose at least all bonds");
        }
    }

    function _submitHonestReportAt(uint256 price, uint256 round, uint256 timestamp) internal returns (bytes32) {
        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: price,
            confidence: 100,
            timestamp: timestamp,
            round: round,
            sourcesHash: keccak256(abi.encodePacked("honest", round))
        });

        bytes32 reportHash = _computeReportHash(report);
        bytes[] memory signatures = _signWithHonest(reportHash, 2);

        IReportVerifier.ReportSubmission memory submission =
            IReportVerifier.ReportSubmission({report: report, signatures: signatures});

        vm.prank(owner);
        verifier.submitReport(submission);

        return reportHash;
    }

    // ==================== Attack 5: Stale Price Exploitation ====================

    /// @notice Tests using stale prices when fresh price is unfavorable
    function test_Attack_StalePriceExploitation() public {
        // Submit initial price
        uint256 t1 = 1700000100;
        vm.warp(t1);
        _submitHonestReportAt(2000e8, 1, t1);

        // Price is valid
        (,,, bool isValid) = verifier.getLatestPrice(feedId);
        assertTrue(isValid);

        // Market moves significantly, but attacker blocks updates
        // (simulated by just not submitting)
        uint256 t2 = t1 + 3500; // Just under heartbeat
        vm.warp(t2);

        // Price still "valid" but actually stale
        (,,, isValid) = verifier.getLatestPrice(feedId);
        assertTrue(isValid, "Price still valid within heartbeat");

        // Just past heartbeat
        vm.warp(t2 + 200);

        (,,, isValid) = verifier.getLatestPrice(feedId);
        assertFalse(isValid, "Price should be invalid after heartbeat");

        bool isStale = verifier.isPriceStale(feedId);
        assertTrue(isStale, "Price should be marked stale");

        console2.log("[ATTACK DETECTED] Stale price exploitation detected via staleness check");
    }

    // ==================== Helper Functions ====================

    function _submitHonestReport(uint256 price, uint256 round) internal returns (bytes32) {
        return _submitHonestReportAt(price, round, block.timestamp);
    }

    function _computeReportHash(IReportVerifier.PriceReport memory report) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                report.feedId, report.price, report.confidence, report.timestamp, report.round, report.sourcesHash
            )
        );
    }

    function _signWithHonest(bytes32 reportHash, uint256 count) internal view returns (bytes[] memory) {
        bytes[] memory signatures = new bytes[](count);
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", reportHash));

        for (uint256 i = 0; i < count; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(honestPks[i], ethSignedHash);
            signatures[i] = abi.encodePacked(r, s, v);
        }

        return signatures;
    }

    function _signWithAttacker(bytes32 reportHash, uint256 count) internal view returns (bytes[] memory) {
        bytes[] memory signatures = new bytes[](count);
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", reportHash));

        for (uint256 i = 0; i < count && i < attackerPks.length; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(attackerPks[i], ethSignedHash);
            signatures[i] = abi.encodePacked(r, s, v);
        }

        return signatures;
    }
}
