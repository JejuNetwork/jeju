// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/moderation/ReportingSystem.sol";
import "../src/moderation/BanManager.sol";
import "../src/moderation/ReputationLabelManager.sol";

/**
 * @title ReportingSystem Test Suite
 * @notice Comprehensive tests for cross-app reporting system
 */
contract ReportingSystemTest is Test {
    ReportingSystem public reportingSystem;
    BanManager public banManager;
    ReputationLabelManager public labelManager;
    MockPredimarket public mockPredimarket;

    address public owner = address(0x1001);
    address public governance = address(0x1002);
    address public reporter1 = address(0x1003);
    address public reporter2 = address(0x1004);

    bytes32 public constant HYPERSCAPE_APP = keccak256("hyperscape");
    bytes32 public constant BAZAAR_APP = keccak256("bazaar");
    bytes32 public constant EVIDENCE_HASH = keccak256("ipfs_evidence");

    function setUp() public {
        // Deploy contracts
        mockPredimarket = new MockPredimarket();

        vm.prank(owner);
        banManager = new BanManager(governance, owner);

        vm.prank(owner);
        labelManager = new ReputationLabelManager(address(banManager), address(mockPredimarket), governance, owner);

        // Create mock IdentityRegistry
        address mockRegistry = address(0x9999);

        vm.prank(owner);
        reportingSystem = new ReportingSystem(
            address(banManager),
            address(labelManager),
            address(mockPredimarket),
            mockRegistry, // IdentityRegistry (mock for testing)
            governance,
            owner
        );

        // Configure governance
        vm.prank(owner);
        banManager.setGovernance(address(reportingSystem));

        // Fund reporters
        vm.deal(reporter1, 10 ether);
        vm.deal(reporter2, 10 ether);
    }

    // ============ Test 1: Submit Network Ban Report ============

    function test_SubmitNetworkBanReport() public {
        vm.prank(reporter1);
        (uint256 reportId, bytes32 marketId) = reportingSystem.submitReport{value: 0.01 ether}(
            100,
            ReportingSystem.ReportType.NETWORK_BAN,
            ReportingSystem.ReportSeverity.MEDIUM,
            HYPERSCAPE_APP,
            EVIDENCE_HASH,
            "Suspected hacker"
        );

        assertEq(reportId, 1);
        assertGt(uint256(marketId), 0);

        // Verify report stored
        ReportingSystem.Report memory report = reportingSystem.getReport(reportId);
        assertEq(report.targetAgentId, 100);
        assertEq(report.reporter, reporter1);
        assertEq(uint8(report.reportType), uint8(ReportingSystem.ReportType.NETWORK_BAN));
    }

    // ============ Test 2: Submit App Ban Report ============

    function test_SubmitAppBanReport() public {
        vm.prank(reporter1);
        (uint256 reportId,) = reportingSystem.submitReport{value: 0.001 ether}(
            200,
            ReportingSystem.ReportType.APP_BAN,
            ReportingSystem.ReportSeverity.LOW,
            HYPERSCAPE_APP,
            EVIDENCE_HASH,
            "Cheating in game"
        );

        ReportingSystem.Report memory report = reportingSystem.getReport(reportId);
        assertEq(report.sourceAppId, HYPERSCAPE_APP);
        assertEq(uint8(report.severity), uint8(ReportingSystem.ReportSeverity.LOW));
    }

    // ============ Test 3: Insufficient Bond ============

    function test_SubmitReport_InsufficientBond() public {
        vm.prank(reporter1);
        vm.expectRevert(ReportingSystem.InsufficientBond.selector);

        reportingSystem.submitReport{value: 0.0001 ether}( // Too low for MEDIUM
            300,
            ReportingSystem.ReportType.NETWORK_BAN,
            ReportingSystem.ReportSeverity.MEDIUM,
            HYPERSCAPE_APP,
            EVIDENCE_HASH,
            "Test"
        );
    }

    // ============ Test 4: Critical Report - Temp Ban ============

    function test_CriticalReport_TempBan() public {
        vm.prank(reporter1);
        (uint256 reportId,) = reportingSystem.submitReport{value: 0.1 ether}(
            400,
            ReportingSystem.ReportType.NETWORK_BAN,
            ReportingSystem.ReportSeverity.CRITICAL,
            HYPERSCAPE_APP,
            EVIDENCE_HASH,
            "Active exploit"
        );

        // Check temp ban applied immediately
        assertTrue(banManager.isNetworkBanned(400));

        ReportingSystem.Report memory report = reportingSystem.getReport(reportId);
        assertEq(uint8(report.status), uint8(ReportingSystem.ReportStatus.PENDING));
    }

    // ============ Test 5: Resolve Report - YES ============

    function test_ResolveReport_Approved() public {
        // Submit report
        vm.prank(reporter1);
        (uint256 reportId, bytes32 marketId) = reportingSystem.submitReport{value: 0.01 ether}(
            500,
            ReportingSystem.ReportType.NETWORK_BAN,
            ReportingSystem.ReportSeverity.MEDIUM,
            HYPERSCAPE_APP,
            EVIDENCE_HASH,
            "Bad actor"
        );

        // Mock market resolves YES
        mockPredimarket.setOutcome(marketId, true);

        // Advance time
        vm.warp(block.timestamp + 3 days + 1);

        // Resolve
        uint256 balanceBefore = reporter1.balance;
        reportingSystem.resolveReport(reportId);

        // Check reporter rewarded (bond returned, no bonus without funding)
        uint256 expectedReward = 0.01 ether;
        assertEq(reporter1.balance, balanceBefore + expectedReward);

        // Check report status
        ReportingSystem.Report memory report = reportingSystem.getReport(reportId);
        assertEq(uint8(report.status), uint8(ReportingSystem.ReportStatus.RESOLVED_YES));
    }

    // ============ Test 6: Resolve Report - NO (Slash Reporter) ============

    function test_ResolveReport_Rejected() public {
        // Submit report
        vm.prank(reporter1);
        (uint256 reportId, bytes32 marketId) = reportingSystem.submitReport{value: 0.01 ether}(
            600,
            ReportingSystem.ReportType.NETWORK_BAN,
            ReportingSystem.ReportSeverity.MEDIUM,
            HYPERSCAPE_APP,
            EVIDENCE_HASH,
            "False accusation"
        );

        // Mock market resolves NO
        mockPredimarket.setOutcome(marketId, false);

        // Advance time
        vm.warp(block.timestamp + 3 days + 1);

        // Resolve
        uint256 balanceBefore = reporter1.balance;
        reportingSystem.resolveReport(reportId);

        // Check reporter slashed (no refund)
        assertEq(reporter1.balance, balanceBefore);

        // Check report status
        ReportingSystem.Report memory report = reportingSystem.getReport(reportId);
        assertEq(uint8(report.status), uint8(ReportingSystem.ReportStatus.RESOLVED_NO));
    }

    // ============ Test 7: Execute Approved Report ============

    function test_ExecuteReport_NetworkBan() public {
        // Submit and resolve report
        vm.prank(reporter1);
        (uint256 reportId, bytes32 marketId) = reportingSystem.submitReport{value: 0.05 ether}(
            700,
            ReportingSystem.ReportType.NETWORK_BAN,
            ReportingSystem.ReportSeverity.HIGH,
            HYPERSCAPE_APP,
            EVIDENCE_HASH,
            "Confirmed exploit"
        );

        mockPredimarket.setOutcome(marketId, true);
        vm.warp(block.timestamp + 1 days + 1);
        reportingSystem.resolveReport(reportId);

        // Execute via governance
        vm.prank(governance);
        reportingSystem.executeReport(reportId);

        // Check ban applied
        assertTrue(banManager.isNetworkBanned(700));

        // Check report executed
        ReportingSystem.Report memory report = reportingSystem.getReport(reportId);
        assertEq(uint8(report.status), uint8(ReportingSystem.ReportStatus.EXECUTED));
    }

    // ============ Test 8: Query Reports By Target ============

    function test_GetReportsByTarget() public {
        // Submit multiple reports for same target
        vm.startPrank(reporter1);

        reportingSystem.submitReport{value: 0.001 ether}(
            800,
            ReportingSystem.ReportType.APP_BAN,
            ReportingSystem.ReportSeverity.LOW,
            HYPERSCAPE_APP,
            EVIDENCE_HASH,
            "Report 1"
        );

        reportingSystem.submitReport{value: 0.01 ether}(
            800,
            ReportingSystem.ReportType.LABEL_SCAMMER,
            ReportingSystem.ReportSeverity.MEDIUM,
            BAZAAR_APP,
            EVIDENCE_HASH,
            "Report 2"
        );

        vm.stopPrank();

        uint256[] memory reports = reportingSystem.getReportsByTarget(800);
        assertEq(reports.length, 2);
    }

    // ============ Test 9: Query Reports By Reporter ============

    function test_GetReportsByReporter() public {
        vm.prank(reporter1);
        reportingSystem.submitReport{value: 0.001 ether}(
            900,
            ReportingSystem.ReportType.APP_BAN,
            ReportingSystem.ReportSeverity.LOW,
            HYPERSCAPE_APP,
            EVIDENCE_HASH,
            "Report 1"
        );

        vm.prank(reporter1);
        reportingSystem.submitReport{value: 0.001 ether}(
            901,
            ReportingSystem.ReportType.APP_BAN,
            ReportingSystem.ReportSeverity.LOW,
            HYPERSCAPE_APP,
            EVIDENCE_HASH,
            "Report 2"
        );

        uint256[] memory reports = reportingSystem.getReportsByReporter(reporter1);
        assertEq(reports.length, 2);
    }

    // ============ Test 10: Reporter Score Tracking ============

    function test_ReporterScoreTracking() public {
        // Submit and approve report
        vm.prank(reporter1);
        (uint256 reportId, bytes32 marketId) = reportingSystem.submitReport{value: 0.01 ether}(
            1000,
            ReportingSystem.ReportType.NETWORK_BAN,
            ReportingSystem.ReportSeverity.MEDIUM,
            HYPERSCAPE_APP,
            EVIDENCE_HASH,
            "Good report"
        );

        mockPredimarket.setOutcome(marketId, true);
        vm.warp(block.timestamp + 3 days + 1);
        reportingSystem.resolveReport(reportId);

        // Check score increased
        assertEq(reportingSystem.reporterScore(reporter1), 1);
    }

    // ============ Test 11: Invalid Agent ID ============

    function test_SubmitReport_InvalidAgentId() public {
        vm.prank(reporter1);
        vm.expectRevert(ReportingSystem.InvalidAgentId.selector);

        reportingSystem.submitReport{value: 0.01 ether}(
            0, // Invalid
            ReportingSystem.ReportType.NETWORK_BAN,
            ReportingSystem.ReportSeverity.MEDIUM,
            HYPERSCAPE_APP,
            EVIDENCE_HASH,
            "Test"
        );
    }

    // ============ Test 12: Voting Not Ended ============

    function test_ResolveReport_VotingNotEnded() public {
        vm.prank(reporter1);
        (uint256 reportId,) = reportingSystem.submitReport{value: 0.01 ether}(
            1100,
            ReportingSystem.ReportType.NETWORK_BAN,
            ReportingSystem.ReportSeverity.MEDIUM,
            HYPERSCAPE_APP,
            EVIDENCE_HASH,
            "Test"
        );

        // Try to resolve immediately
        vm.expectRevert(ReportingSystem.VotingNotEnded.selector);
        reportingSystem.resolveReport(reportId);
    }

    // ============ Test 13: All Report Types ============

    function test_AllReportTypes() public {
        vm.startPrank(reporter1);

        // NETWORK_BAN
        (uint256 r1,) = reportingSystem.submitReport{value: 0.01 ether}(
            1200,
            ReportingSystem.ReportType.NETWORK_BAN,
            ReportingSystem.ReportSeverity.MEDIUM,
            HYPERSCAPE_APP,
            EVIDENCE_HASH,
            "Network ban"
        );

        // APP_BAN
        (uint256 r2,) = reportingSystem.submitReport{value: 0.001 ether}(
            1201,
            ReportingSystem.ReportType.APP_BAN,
            ReportingSystem.ReportSeverity.LOW,
            HYPERSCAPE_APP,
            EVIDENCE_HASH,
            "App ban"
        );

        // LABEL_HACKER
        (uint256 r3,) = reportingSystem.submitReport{value: 0.05 ether}(
            1202,
            ReportingSystem.ReportType.LABEL_HACKER,
            ReportingSystem.ReportSeverity.HIGH,
            HYPERSCAPE_APP,
            EVIDENCE_HASH,
            "Hacker label"
        );

        // LABEL_SCAMMER
        (uint256 r4,) = reportingSystem.submitReport{value: 0.01 ether}(
            1203,
            ReportingSystem.ReportType.LABEL_SCAMMER,
            ReportingSystem.ReportSeverity.MEDIUM,
            BAZAAR_APP,
            EVIDENCE_HASH,
            "Scammer label"
        );

        vm.stopPrank();

        assertEq(r1, 1);
        assertEq(r2, 2);
        assertEq(r3, 3);
        assertEq(r4, 4);
    }
}

/**
 * Mock Predimarket for testing
 */
contract MockPredimarket {
    mapping(bytes32 => bool) public marketResolved;
    mapping(bytes32 => bool) public marketOutcome;
    uint256 public marketCount = 0;

    function createMarket(bytes32, string memory, uint256) external {
        marketCount++;
    }

    function setOutcome(bytes32 sessionId, bool outcome) external {
        marketResolved[sessionId] = true;
        marketOutcome[sessionId] = outcome;
    }

    function getMarket(bytes32 sessionId)
        external
        view
        returns (bytes32, string memory, uint256, uint256, uint256, uint256, uint256, bool, bool)
    {
        return (
            sessionId, "Test", 0, 0, 1000 ether, 0, block.timestamp, marketResolved[sessionId], marketOutcome[sessionId]
        );
    }
}
