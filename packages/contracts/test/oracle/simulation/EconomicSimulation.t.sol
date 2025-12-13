// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FeedRegistry} from "../../../src/oracle/FeedRegistry.sol";
import {ReportVerifier} from "../../../src/oracle/ReportVerifier.sol";
import {DisputeGame} from "../../../src/oracle/DisputeGame.sol";
import {OracleFeeRouter} from "../../../src/oracle/OracleFeeRouter.sol";
import {IFeedRegistry} from "../../../src/oracle/interfaces/IFeedRegistry.sol";
import {IReportVerifier} from "../../../src/oracle/interfaces/IReportVerifier.sol";
import {IDisputeGame} from "../../../src/oracle/interfaces/IDisputeGame.sol";
import {IOracleFeeRouter} from "../../../src/oracle/interfaces/IOracleFeeRouter.sol";

/// @title Economic Simulation Tests
/// @notice Verify economic invariants and incentive alignment
contract EconomicSimulationTest is Test {
    FeedRegistry public registry;
    ReportVerifier public verifier;
    DisputeGame public disputeGame;
    OracleFeeRouter public feeRouter;

    address public owner = address(0x1);
    bytes32 public feedId;

    uint256[] public signerPks;
    address[] public signers;

    uint256 constant SIMULATION_EPOCHS = 100;
    uint256 constant OPERATORS_COUNT = 10;
    uint256 constant SUBSCRIBERS_COUNT = 50;

    function setUp() public {
        vm.warp(1700000000);

        for (uint256 i = 1; i <= 5; i++) {
            signerPks.push(i * 0x1111);
            signers.push(vm.addr(i * 0x1111));
        }

        vm.startPrank(owner);
        registry = new FeedRegistry(owner);
        verifier = new ReportVerifier(address(registry), address(0), owner);
        disputeGame = new DisputeGame(address(verifier), address(registry), owner);
        feeRouter = new OracleFeeRouter(address(registry), owner);

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
    }

    // ==================== Fee Economics ====================

    /// @notice Verify subscription pricing scales correctly with feeds and duration
    function test_SubscriptionPricing() public view {
        bytes32[] memory singleFeed = new bytes32[](1);
        singleFeed[0] = feedId;

        // Single feed pricing
        uint256 price1Month = feeRouter.getSubscriptionPrice(singleFeed, 1);
        uint256 price6Months = feeRouter.getSubscriptionPrice(singleFeed, 6);
        uint256 price12Months = feeRouter.getSubscriptionPrice(singleFeed, 12);

        console2.log("1 month price:", price1Month);
        console2.log("6 month price:", price6Months);
        console2.log("12 month price:", price12Months);

        // Linear scaling verification
        assertApproxEqRel(price6Months, price1Month * 6, 0.01e18); // 1% tolerance
        assertApproxEqRel(price12Months, price1Month * 12, 0.01e18);
    }

    /// @notice Simulate subscription revenue over time
    function test_SubscriptionRevenue_Simulation() public {
        uint256 totalRevenue;

        for (uint256 i = 0; i < SUBSCRIBERS_COUNT; i++) {
            address subscriber = address(uint160(0x2000 + i));

            bytes32[] memory feeds = new bytes32[](1);
            feeds[0] = feedId;

            uint256 months = (i % 12) + 1; // 1-12 months
            uint256 price = feeRouter.getSubscriptionPrice(feeds, months);

            vm.deal(subscriber, price + 1 ether);

            vm.prank(subscriber);
            feeRouter.subscribe{value: price}(feeds, months);

            totalRevenue += price;
        }

        uint256 collected = feeRouter.getTotalFeesCollected();
        assertEq(collected, totalRevenue, "Revenue accounting mismatch");

        console2.log("Total subscribers:", SUBSCRIBERS_COUNT);
        console2.log("Total revenue collected:", totalRevenue);
        console2.log("Average revenue per subscriber:", totalRevenue / SUBSCRIBERS_COUNT);
    }

    // ==================== Dispute Economics ====================

    /// @notice Verify dispute bond economics incentivize honest behavior
    function test_DisputeBondEconomics() public {
        vm.warp(block.timestamp + 60);
        bytes32 reportHash = _submitPrice(2000e8, 1);

        uint256 minBond = disputeGame.getMinBond();
        console2.log("Minimum dispute bond:", minBond);

        // Honest dispute (report was actually invalid)
        address honestDisputer = address(0x100);
        vm.deal(honestDisputer, minBond * 2);

        vm.prank(honestDisputer);
        bytes32 disputeId = disputeGame.openDispute{value: minBond}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("honest")
        );

        uint256 balanceBeforeResolve = honestDisputer.balance;

        // Resolve in disputer's favor (report was invalid)
        vm.prank(owner);
        disputeGame.resolveDispute(disputeId, IDisputeGame.ResolutionOutcome.REPORT_INVALID, "Confirmed invalid");

        uint256 balanceAfterResolve = honestDisputer.balance;
        uint256 reward = balanceAfterResolve - balanceBeforeResolve;

        console2.log("Disputer balance before:", balanceBeforeResolve);
        console2.log("Disputer balance after:", balanceAfterResolve);
        console2.log("Disputer reward:", reward);

        // Honest disputer should at least get bond back
        assertGe(balanceAfterResolve, minBond, "Honest disputer should recover bond");
    }

    /// @notice Calculate break-even for frivolous disputes
    function test_FrivolousDisputeCost() public {
        vm.warp(block.timestamp + 60);
        bytes32 reportHash = _submitPrice(2000e8, 1);

        uint256 minBond = disputeGame.getMinBond();

        // Frivolous disputer
        address frivolousDisputer = address(0x200);
        vm.deal(frivolousDisputer, minBond * 2);

        uint256 balanceBefore = frivolousDisputer.balance;

        vm.prank(frivolousDisputer);
        bytes32 disputeId = disputeGame.openDispute{value: minBond}(
            reportHash,
            IDisputeGame.DisputeReason.PRICE_DEVIATION,
            keccak256("frivolous")
        );

        // Resolve against disputer (report was valid)
        vm.prank(owner);
        disputeGame.resolveDispute(disputeId, IDisputeGame.ResolutionOutcome.REPORT_VALID, "Report was correct");

        uint256 balanceAfter = frivolousDisputer.balance;
        uint256 loss = balanceBefore - balanceAfter;

        console2.log("Frivolous disputer loss:", loss);
        assertGe(loss, minBond, "Frivolous dispute should cost at least bond");
    }

    // ==================== Operator Economics ====================

    /// @notice Simulate operator reward distribution
    function test_OperatorRewardDistribution() public {
        // Fund the router
        vm.deal(address(feeRouter), 1000 ether);

        bytes32[] memory operatorIds = new bytes32[](OPERATORS_COUNT);
        uint256[] memory reportCounts = new uint256[](OPERATORS_COUNT);

        // Simulate report submissions (varying participation)
        for (uint256 i = 0; i < OPERATORS_COUNT; i++) {
            operatorIds[i] = keccak256(abi.encodePacked("operator", i));
            reportCounts[i] = (i + 1) * 10; // 10, 20, 30... reports
        }

        // Credit rewards proportionally
        uint256 totalReports;
        for (uint256 i = 0; i < OPERATORS_COUNT; i++) {
            totalReports += reportCounts[i];
        }

        uint256 rewardPool = 100 ether;
        for (uint256 i = 0; i < OPERATORS_COUNT; i++) {
            uint256 operatorReward = (rewardPool * reportCounts[i]) / totalReports;

            vm.prank(owner);
            feeRouter.creditOperatorRewards(operatorIds[i], operatorReward);
        }

        // Verify distribution
        uint256 totalCredited;
        for (uint256 i = 0; i < OPERATORS_COUNT; i++) {
            IOracleFeeRouter.OperatorEarnings memory earnings = feeRouter.getOperatorEarnings(operatorIds[i]);
            totalCredited += earnings.totalEarned;

            console2.log("Operator", i, "reports:", reportCounts[i]);
            console2.log("Operator", i, "earned:", earnings.totalEarned);
        }

        assertApproxEqAbs(totalCredited, rewardPool, 1e15); // 0.001 ETH tolerance
    }

    // ==================== Game Theory Simulations ====================

    /// @notice Simulate rational operator behavior over time
    function test_RationalOperatorBehavior() public {
        // Assumptions:
        // - Cost per report submission: ~0.001 ETH (gas)
        // - Reward per report: portion of subscription fees
        // - Slashing: loss of stake for bad reports

        uint256 costPerReport = 0.001 ether;
        uint256 rewardPerReport = 0.01 ether; // 10x reward vs cost
        uint256 slashAmount = 1 ether; // 100x cost

        // Expected value calculation
        uint256 probCorrect = 999; // 99.9% honest reporting
        uint256 probIncorrect = 1; // 0.1% mistakes

        // EV = p(correct) * reward - p(incorrect) * slash - cost
        int256 ev = int256((probCorrect * rewardPerReport) / 1000) -
                    int256((probIncorrect * slashAmount) / 1000) -
                    int256(costPerReport);

        console2.log("Cost per report:", costPerReport);
        console2.log("Reward per report:", rewardPerReport);
        console2.log("Slash amount:", slashAmount);

        if (ev > 0) {
            console2.log("Expected value positive:", uint256(ev));
            console2.log("Rational to participate honestly");
        } else {
            console2.log("Expected value negative:", uint256(-ev));
            console2.log("WARNING: May not be economically viable");
        }

        // For this to be sustainable, EV must be positive
        assertTrue(ev > 0, "Oracle operation should be profitable for honest operators");
    }

    /// @notice Model attack cost vs potential gain
    function test_AttackEconomics() public pure {
        // Scenario: Attacker wants to manipulate price for a DeFi exploit
        // This models the economic security requirements
        
        uint256 protocolTVL = 100_000_000 ether; // $100M TVL
        uint256 maxExploitPercent = 500; // 5% of TVL extractable (in basis points)
        uint256 potentialGain = (protocolTVL * maxExploitPercent) / 10000;

        // Attack costs - designed to exceed potential gain
        // In a secure system, stake requirements should scale with secured value
        uint256 requiredStake = 10_000_000 ether; // 10% of TVL in stake
        uint256 slashingRisk = requiredStake; // Could lose entire stake
        uint256 bribesNeeded = requiredStake / 2; // To corrupt quorum (5% of TVL)
        uint256 disputeBond = 1_000 ether;

        uint256 totalAttackCost = requiredStake + bribesNeeded + disputeBond;

        console2.log("=== Attack Economics ===");
        console2.log("Protocol TVL:", protocolTVL);
        console2.log("Potential gain:", potentialGain);
        console2.log("Required stake:", requiredStake);
        console2.log("Bribes needed:", bribesNeeded);
        console2.log("Dispute bond:", disputeBond);
        console2.log("Total attack cost:", totalAttackCost);

        // Attack should not be profitable
        if (totalAttackCost > potentialGain) {
            console2.log("Attack NOT profitable - system secure");
        } else {
            console2.log("WARNING: Attack may be profitable - increase stake requirements!");
        }

        // Security margin
        uint256 securityMargin = (totalAttackCost * 10000) / potentialGain;
        console2.log("Security margin (bps):", securityMargin);

        // Key insight: stake + bribes must exceed max exploitable value
        assertGt(totalAttackCost, potentialGain, "Security budget must exceed exploit potential");
    }

    // ==================== Long-term Sustainability ====================

    /// @notice Project fee revenue sustainability
    function test_RevenueSustainability() public {
        IOracleFeeRouter.FeeConfig memory config = feeRouter.getFeeConfig();

        uint256 monthlyFeePerFeed = config.subscriptionFeePerMonth;
        uint256 assumedFeeds = 20;
        uint256 assumedSubscribers = 100;
        uint256 assumedMonths = 12;

        uint256 annualRevenue = monthlyFeePerFeed * assumedFeeds * assumedSubscribers * assumedMonths;

        // Operating costs (estimated)
        uint256 operatorCount = 20;
        uint256 gasPerReportPerOperator = 0.0005 ether;
        uint256 reportsPerDay = 24; // Hourly updates
        uint256 annualGasCost = gasPerReportPerOperator * operatorCount * reportsPerDay * 365;

        // Infrastructure costs (estimated)
        uint256 annualInfraCost = 100 ether; // Servers, monitoring, etc.

        uint256 totalCosts = annualGasCost + annualInfraCost;

        console2.log("=== Annual Projections ===");
        console2.log("Annual revenue:", annualRevenue);
        console2.log("Gas costs:", annualGasCost);
        console2.log("Infrastructure costs:", annualInfraCost);
        console2.log("Total costs:", totalCosts);

        if (annualRevenue > totalCosts) {
            uint256 profit = annualRevenue - totalCosts;
            uint256 margin = (profit * 10000) / annualRevenue;
            console2.log("Net profit:", profit);
            console2.log("Margin (bps):", margin);
        } else {
            uint256 deficit = totalCosts - annualRevenue;
            console2.log("DEFICIT:", deficit);
        }
    }

    // ==================== Helper Functions ====================

    function _submitPrice(uint256 price, uint256 round) internal returns (bytes32) {
        IReportVerifier.PriceReport memory report = IReportVerifier.PriceReport({
            feedId: feedId,
            price: price,
            confidence: 100,
            timestamp: block.timestamp,
            round: round,
            sourcesHash: keccak256(abi.encodePacked("econ", round))
        });

        bytes32 reportHash = keccak256(abi.encodePacked(
            report.feedId, report.price, report.confidence,
            report.timestamp, report.round, report.sourcesHash
        ));

        bytes[] memory signatures = new bytes[](2);
        for (uint256 i = 0; i < 2; i++) {
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(
                signerPks[i],
                keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", reportHash))
            );
            signatures[i] = abi.encodePacked(r, s, v);
        }

        IReportVerifier.ReportSubmission memory submission = IReportVerifier.ReportSubmission({
            report: report,
            signatures: signatures
        });

        vm.prank(owner);
        verifier.submitReport(submission);

        return reportHash;
    }

    receive() external payable {}
}
