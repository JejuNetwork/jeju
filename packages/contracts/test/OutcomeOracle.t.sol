// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {OutcomeOracle} from "../src/council/OutcomeOracle.sol";

contract OutcomeOracleTest is Test {
    OutcomeOracle public oracle;

    address public owner = address(1);
    address public evaluator1 = address(2);
    address public evaluator2 = address(3);
    address public user = address(4);
    address public ceoAgent = address(5);
    address public council = address(6);

    bytes32 public proposalId = keccak256("proposal-1");
    bytes32 public decisionId = keccak256("decision-1");
    bytes32 public evidenceHash = keccak256("evidence");

    function setUp() public {
        vm.startPrank(owner);
        oracle = new OutcomeOracle(ceoAgent, council, owner);

        // Authorize evaluators
        oracle.authorizeEvaluator(evaluator1);
        oracle.authorizeEvaluator(evaluator2);
        vm.stopPrank();
    }

    function testDeployment() public view {
        assertEq(oracle.ceoAgent(), ceoAgent);
        assertEq(oracle.council(), council);
        assertEq(oracle.owner(), owner);
    }

    function testAuthorizeEvaluator() public {
        vm.prank(owner);
        oracle.authorizeEvaluator(user);

        assertTrue(oracle.authorizedEvaluators(user));

        OutcomeOracle.EvaluatorInfo memory info = oracle.getEvaluator(user);
        assertEq(info.evaluator, user);
        assertTrue(info.isActive);
        assertEq(info.reputation, 100);
    }

    function testDeauthorizeEvaluator() public {
        vm.prank(owner);
        oracle.deauthorizeEvaluator(evaluator1);

        assertFalse(oracle.authorizedEvaluators(evaluator1));

        OutcomeOracle.EvaluatorInfo memory info = oracle.getEvaluator(evaluator1);
        assertFalse(info.isActive);
    }

    function testReportOutcome() public {
        OutcomeOracle.OutcomeMetrics memory metrics = OutcomeOracle.OutcomeMetrics({
            goalAchievement: 85,
            costEfficiency: 90,
            communityImpact: 80,
            unexpectedConsequences: 75,
            timeliness: 95
        });

        vm.prank(evaluator1);
        bytes32 reportId =
            oracle.reportOutcome(proposalId, decisionId, metrics, evidenceHash, "Proposal executed successfully");

        // Verify report was created
        OutcomeOracle.OutcomeReport memory report = oracle.getReport(reportId);
        assertEq(report.proposalId, proposalId);
        assertEq(report.decisionId, decisionId);
        assertEq(report.reporter, evaluator1);
        assertFalse(report.disputed);
        assertFalse(report.finalized);

        // Overall score should be weighted average
        assertTrue(report.overallScore > 0);
        assertTrue(report.overallScore <= 100);
    }

    function testCannotReportWithoutAuthorization() public {
        OutcomeOracle.OutcomeMetrics memory metrics = OutcomeOracle.OutcomeMetrics({
            goalAchievement: 85,
            costEfficiency: 90,
            communityImpact: 80,
            unexpectedConsequences: 75,
            timeliness: 95
        });

        vm.prank(user); // Not authorized
        vm.expectRevert(OutcomeOracle.NotAuthorized.selector);
        oracle.reportOutcome(proposalId, decisionId, metrics, evidenceHash, "Test");
    }

    function testCannotReportDuplicate() public {
        OutcomeOracle.OutcomeMetrics memory metrics = OutcomeOracle.OutcomeMetrics({
            goalAchievement: 85,
            costEfficiency: 90,
            communityImpact: 80,
            unexpectedConsequences: 75,
            timeliness: 95
        });

        // First report
        vm.prank(evaluator1);
        oracle.reportOutcome(proposalId, decisionId, metrics, evidenceHash, "Test");

        // Duplicate report should fail
        vm.prank(evaluator2);
        vm.expectRevert(OutcomeOracle.ReportAlreadyExists.selector);
        oracle.reportOutcome(proposalId, decisionId, metrics, evidenceHash, "Test 2");
    }

    function testDisputeReport() public {
        // Create report
        OutcomeOracle.OutcomeMetrics memory metrics = OutcomeOracle.OutcomeMetrics({
            goalAchievement: 85,
            costEfficiency: 90,
            communityImpact: 80,
            unexpectedConsequences: 75,
            timeliness: 95
        });

        vm.prank(evaluator1);
        bytes32 reportId = oracle.reportOutcome(proposalId, decisionId, metrics, evidenceHash, "Test");

        // Dispute the report
        vm.deal(user, 1 ether);
        vm.prank(user);
        oracle.disputeReport{value: 0.01 ether}(
            reportId, keccak256("counter-evidence"), "I disagree with this assessment"
        );

        // Verify dispute was recorded
        OutcomeOracle.OutcomeReport memory report = oracle.getReport(reportId);
        assertTrue(report.disputed);

        OutcomeOracle.Dispute[] memory disputes = oracle.getDisputes(reportId);
        assertEq(disputes.length, 1);
        assertEq(disputes[0].disputer, user);
        assertEq(disputes[0].stake, 0.01 ether);
    }

    function testCannotDisputeWithInsufficientStake() public {
        OutcomeOracle.OutcomeMetrics memory metrics = OutcomeOracle.OutcomeMetrics({
            goalAchievement: 85,
            costEfficiency: 90,
            communityImpact: 80,
            unexpectedConsequences: 75,
            timeliness: 95
        });

        vm.prank(evaluator1);
        bytes32 reportId = oracle.reportOutcome(proposalId, decisionId, metrics, evidenceHash, "Test");

        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert(OutcomeOracle.InsufficientStake.selector);
        oracle.disputeReport{value: 0.001 ether}(reportId, bytes32(0), "Test");
    }

    function testCannotDisputeAfterDeadline() public {
        OutcomeOracle.OutcomeMetrics memory metrics = OutcomeOracle.OutcomeMetrics({
            goalAchievement: 85,
            costEfficiency: 90,
            communityImpact: 80,
            unexpectedConsequences: 75,
            timeliness: 95
        });

        vm.prank(evaluator1);
        bytes32 reportId = oracle.reportOutcome(proposalId, decisionId, metrics, evidenceHash, "Test");

        // Skip past dispute period
        vm.warp(block.timestamp + 4 days);

        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert(OutcomeOracle.DisputePeriodEnded.selector);
        oracle.disputeReport{value: 0.01 ether}(reportId, bytes32(0), "Test");
    }

    function testResolveDisputeUpholdReport() public {
        OutcomeOracle.OutcomeMetrics memory metrics = OutcomeOracle.OutcomeMetrics({
            goalAchievement: 85,
            costEfficiency: 90,
            communityImpact: 80,
            unexpectedConsequences: 75,
            timeliness: 95
        });

        vm.prank(evaluator1);
        bytes32 reportId = oracle.reportOutcome(proposalId, decisionId, metrics, evidenceHash, "Test");

        // Dispute
        vm.deal(user, 1 ether);
        vm.prank(user);
        oracle.disputeReport{value: 0.1 ether}(reportId, bytes32(0), "Test");

        uint256 reporterBalanceBefore = evaluator1.balance;

        // Resolve - uphold report (reporter wins)
        vm.prank(owner);
        oracle.resolveDispute(reportId, 0, true);

        // Reporter should receive stake
        assertEq(evaluator1.balance, reporterBalanceBefore + 0.1 ether);

        // Dispute should be marked resolved
        OutcomeOracle.Dispute[] memory disputes = oracle.getDisputes(reportId);
        assertTrue(disputes[0].resolved);
        assertTrue(disputes[0].reportUpheld);
    }

    function testResolveDisputeRejectReport() public {
        OutcomeOracle.OutcomeMetrics memory metrics = OutcomeOracle.OutcomeMetrics({
            goalAchievement: 85,
            costEfficiency: 90,
            communityImpact: 80,
            unexpectedConsequences: 75,
            timeliness: 95
        });

        vm.prank(evaluator1);
        bytes32 reportId = oracle.reportOutcome(proposalId, decisionId, metrics, evidenceHash, "Test");

        vm.deal(user, 1 ether);
        vm.prank(user);
        oracle.disputeReport{value: 0.1 ether}(reportId, bytes32(0), "Test");

        uint256 disputerBalanceBefore = user.balance;

        // Resolve - reject report (disputer wins)
        vm.prank(owner);
        oracle.resolveDispute(reportId, 0, false);

        // Disputer should get stake back
        assertEq(user.balance, disputerBalanceBefore + 0.1 ether);

        // Dispute should be marked resolved
        OutcomeOracle.Dispute[] memory disputes = oracle.getDisputes(reportId);
        assertTrue(disputes[0].resolved);
        assertFalse(disputes[0].reportUpheld);
    }

    function testFinalizeReport() public {
        OutcomeOracle.OutcomeMetrics memory metrics = OutcomeOracle.OutcomeMetrics({
            goalAchievement: 85,
            costEfficiency: 90,
            communityImpact: 80,
            unexpectedConsequences: 75,
            timeliness: 95
        });

        vm.prank(evaluator1);
        bytes32 reportId = oracle.reportOutcome(proposalId, decisionId, metrics, evidenceHash, "Test");

        // Skip past dispute period
        vm.warp(block.timestamp + 4 days);

        // Finalize
        oracle.finalizeReport(reportId);

        OutcomeOracle.OutcomeReport memory report = oracle.getReport(reportId);
        assertTrue(report.finalized);
    }

    function testCannotFinalizeBeforeDisputePeriod() public {
        OutcomeOracle.OutcomeMetrics memory metrics = OutcomeOracle.OutcomeMetrics({
            goalAchievement: 85,
            costEfficiency: 90,
            communityImpact: 80,
            unexpectedConsequences: 75,
            timeliness: 95
        });

        vm.prank(evaluator1);
        bytes32 reportId = oracle.reportOutcome(proposalId, decisionId, metrics, evidenceHash, "Test");

        // Try to finalize before dispute period ends
        vm.expectRevert(OutcomeOracle.DisputePeriodActive.selector);
        oracle.finalizeReport(reportId);
    }

    function testCannotFinalizeWithUnresolvedDispute() public {
        OutcomeOracle.OutcomeMetrics memory metrics = OutcomeOracle.OutcomeMetrics({
            goalAchievement: 85,
            costEfficiency: 90,
            communityImpact: 80,
            unexpectedConsequences: 75,
            timeliness: 95
        });

        vm.prank(evaluator1);
        bytes32 reportId = oracle.reportOutcome(proposalId, decisionId, metrics, evidenceHash, "Test");

        // Create dispute
        vm.deal(user, 1 ether);
        vm.prank(user);
        oracle.disputeReport{value: 0.1 ether}(reportId, bytes32(0), "Test");

        // Skip past dispute period
        vm.warp(block.timestamp + 4 days);

        // Try to finalize with unresolved dispute
        vm.expectRevert(OutcomeOracle.DisputePeriodActive.selector);
        oracle.finalizeReport(reportId);
    }

    function testCanFinalizeWithResolvedDispute() public {
        OutcomeOracle.OutcomeMetrics memory metrics = OutcomeOracle.OutcomeMetrics({
            goalAchievement: 85,
            costEfficiency: 90,
            communityImpact: 80,
            unexpectedConsequences: 75,
            timeliness: 95
        });

        vm.prank(evaluator1);
        bytes32 reportId = oracle.reportOutcome(proposalId, decisionId, metrics, evidenceHash, "Test");

        // Create and resolve dispute
        vm.deal(user, 1 ether);
        vm.prank(user);
        oracle.disputeReport{value: 0.1 ether}(reportId, bytes32(0), "Test");

        vm.prank(owner);
        oracle.resolveDispute(reportId, 0, true);

        // Skip past dispute period
        vm.warp(block.timestamp + 4 days);

        // Should be able to finalize now
        oracle.finalizeReport(reportId);

        OutcomeOracle.OutcomeReport memory report = oracle.getReport(reportId);
        assertTrue(report.finalized);
    }

    function testSetParameters() public {
        vm.prank(owner);
        oracle.setParameters(14 days, 7 days, 0.05 ether, 70);

        assertEq(oracle.minEvaluationDelay(), 14 days);
        assertEq(oracle.disputePeriod(), 7 days);
        assertEq(oracle.minDisputeStake(), 0.05 ether);
        assertEq(oracle.successThreshold(), 70);
    }

    function testSetWeights() public {
        vm.prank(owner);
        oracle.setWeights(4000, 2000, 2000, 1000, 1000);

        assertEq(oracle.weightGoal(), 4000);
        assertEq(oracle.weightCost(), 2000);
        assertEq(oracle.weightCommunity(), 2000);
        assertEq(oracle.weightConsequences(), 1000);
        assertEq(oracle.weightTimeliness(), 1000);
    }

    function testWeightsMustSumTo10000() public {
        vm.prank(owner);
        vm.expectRevert("Weights must sum to 10000");
        oracle.setWeights(3000, 2000, 2000, 1000, 1000);
    }

    function testCanFinalizeCheck() public {
        OutcomeOracle.OutcomeMetrics memory metrics = OutcomeOracle.OutcomeMetrics({
            goalAchievement: 85,
            costEfficiency: 90,
            communityImpact: 80,
            unexpectedConsequences: 75,
            timeliness: 95
        });

        vm.prank(evaluator1);
        bytes32 reportId = oracle.reportOutcome(proposalId, decisionId, metrics, evidenceHash, "Test");

        // Before dispute period ends
        assertFalse(oracle.canFinalize(reportId));

        // After dispute period
        vm.warp(block.timestamp + 4 days);
        assertTrue(oracle.canFinalize(reportId));
    }

    function testInvalidMetrics() public {
        OutcomeOracle.OutcomeMetrics memory metrics = OutcomeOracle.OutcomeMetrics({
            goalAchievement: 150, // Invalid - over 100
            costEfficiency: 90,
            communityImpact: 80,
            unexpectedConsequences: 75,
            timeliness: 95
        });

        vm.prank(evaluator1);
        vm.expectRevert(OutcomeOracle.InvalidMetrics.selector);
        oracle.reportOutcome(proposalId, decisionId, metrics, evidenceHash, "Test");
    }

    function testGetReportCount() public view {
        assertEq(oracle.getReportCount(), 0);
    }

    function testGetReportForProposal() public {
        OutcomeOracle.OutcomeMetrics memory metrics = OutcomeOracle.OutcomeMetrics({
            goalAchievement: 85,
            costEfficiency: 90,
            communityImpact: 80,
            unexpectedConsequences: 75,
            timeliness: 95
        });

        vm.prank(evaluator1);
        oracle.reportOutcome(proposalId, decisionId, metrics, evidenceHash, "Test");

        OutcomeOracle.OutcomeReport memory report = oracle.getReportForProposal(proposalId);
        assertEq(report.proposalId, proposalId);
    }

    function testReceiveETH() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        (bool success,) = address(oracle).call{value: 0.5 ether}("");
        assertTrue(success);
        assertEq(address(oracle).balance, 0.5 ether);
    }
}
