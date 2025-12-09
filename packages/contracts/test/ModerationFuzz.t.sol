// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/moderation/BanManager.sol";
import "../src/moderation/ReputationLabelManager.sol";
import "../src/moderation/ReportingSystem.sol";

/**
 * @title Moderation Fuzz Test Suite
 * @notice Fuzz testing for edge cases and overflow conditions
 */
contract ModerationFuzzTest is Test {
    BanManager public banManager;
    ReputationLabelManager public labelManager;
    ReportingSystem public reportingSystem;
    MockPredimarket public mockPredimarket;
    MockIdentityRegistry public mockIdentityRegistry;

    address public owner = address(0x7001);
    address public governance = address(0x7002);

    // Allow test contract to receive ETH rewards
    receive() external payable {}

    function setUp() public {
        mockPredimarket = new MockPredimarket();
        mockIdentityRegistry = new MockIdentityRegistry();

        vm.prank(owner);
        banManager = new BanManager(governance, owner);

        vm.prank(owner);
        labelManager = new ReputationLabelManager(address(banManager), address(mockPredimarket), governance, owner);

        vm.prank(owner);
        reportingSystem = new ReportingSystem(
            address(banManager),
            address(labelManager),
            address(mockPredimarket),
            address(mockIdentityRegistry),
            governance,
            owner
        );

        vm.prank(owner);
        banManager.setGovernance(address(reportingSystem));
    }

    // ============ Fuzz Test 1: Random Agent IDs ============

    function testFuzz_BanRandomAgentIds(uint256 agentId) public {
        vm.assume(agentId > 0 && agentId < type(uint128).max); // Reasonable range

        bytes32 appId = keccak256("test_app");

        vm.prank(address(reportingSystem)); // reportingSystem is set as governance
        banManager.banFromApp(agentId, appId, "Fuzz test", bytes32(uint256(1)));

        assertFalse(banManager.isAccessAllowed(agentId, appId));
    }

    // ============ Fuzz Test 2: Random Report Bonds ============

    function testFuzz_ReportBondsWithinLimits(uint96 rawBond) public {
        uint256 bondAmount = bound(uint256(rawBond), 0.01 ether, 10 ether); // MEDIUM requires 0.01 ETH

        bytes32 appId = keccak256("test");
        bytes32 evidence = keccak256("evidence");

        vm.deal(address(this), bondAmount + 1 ether);

        (uint256 reportId,) = reportingSystem.submitReport{value: bondAmount}(
            100, ReportingSystem.ReportType.APP_BAN, ReportingSystem.ReportSeverity.MEDIUM, appId, evidence, "Fuzz test"
        );

        assertEq(reportId, 1);
    }

    // ============ Fuzz Test 3: Multiple App Bans ============

    function testFuzz_MultipleAppBans(uint8 numApps) public {
        vm.assume(numApps > 0 && numApps <= 20); // Reasonable limit

        uint256 agentId = 500;

        vm.startPrank(address(reportingSystem)); // reportingSystem is set as governance

        for (uint8 i = 0; i < numApps; i++) {
            bytes32 appId = keccak256(abi.encodePacked("app_", i));
            banManager.banFromApp(agentId, appId, "Test", bytes32(uint256(i)));
        }

        vm.stopPrank();

        bytes32[] memory bans = banManager.getAppBans(agentId);
        assertEq(bans.length, numApps);
    }

    // ============ Fuzz Test 4: Random Stake Amounts ============

    function testFuzz_LabelStakeAmounts(uint96 rawStake) public {
        uint256 stakeAmount = bound(uint256(rawStake), 0.1 ether, 100 ether);

        vm.deal(address(this), stakeAmount + 1 ether);

        bytes32 proposalId = labelManager.proposeLabel{value: stakeAmount}(
            200, ReputationLabelManager.Label.HACKER, keccak256("evidence")
        );

        assertGt(uint256(proposalId), 0);
    }

    // ============ Fuzz Test 5: Random App IDs ============

    function testFuzz_RandomAppIds(bytes32 appId) public {
        vm.assume(appId != bytes32(0));

        uint256 agentId = 300;

        vm.prank(address(reportingSystem)); // reportingSystem is set as governance
        banManager.banFromApp(agentId, appId, "Random app", bytes32(uint256(1)));

        assertFalse(banManager.isAccessAllowed(agentId, appId));
    }

    // ============ Fuzz Test 6: Large Report Counts ============

    function testFuzz_ManyReports(uint8 reportCount) public {
        vm.assume(reportCount > 0 && reportCount <= 50);

        bytes32 appId = keccak256("app");
        bytes32 evidence = keccak256("evidence");
        uint256 bond = 0.01 ether;

        vm.deal(address(this), reportCount * bond + 1 ether);

        for (uint8 i = 0; i < reportCount; i++) {
            reportingSystem.submitReport{value: bond}(
                uint256(i) + 1000,
                ReportingSystem.ReportType.APP_BAN,
                ReportingSystem.ReportSeverity.MEDIUM,
                appId,
                evidence,
                "Fuzz test"
            );
        }

        uint256[] memory allReports = reportingSystem.getAllReports();
        assertEq(allReports.length, reportCount);
    }

    // ============ Fuzz Test 7: Timestamp Edge Cases ============

    function testFuzz_FutureTimestamps(uint32 timeOffset) public {
        vm.assume(timeOffset > 0 && timeOffset < 365 days);

        bytes32 appId = keccak256("app");
        bytes32 evidence = keccak256("evidence");

        vm.deal(address(this), 10 ether); // Ensure test has enough funds
        (uint256 reportId,) = reportingSystem.submitReport{value: 0.01 ether}(
            400, ReportingSystem.ReportType.APP_BAN, ReportingSystem.ReportSeverity.MEDIUM, appId, evidence, "Test"
        );

        // Try to resolve before voting ends (should fail)
        vm.expectRevert(ReportingSystem.VotingNotEnded.selector);
        reportingSystem.resolveReport(reportId);

        // Warp to after voting period
        vm.warp(block.timestamp + 3 days + timeOffset);

        // Ensure contract has sufficient balance for reward payment (add to existing)
        uint256 currentBalance = address(reportingSystem).balance;
        vm.deal(address(reportingSystem), currentBalance + 10 ether);

        // Should work now (if market resolved)
        mockPredimarket.setOutcome(reportingSystem.getReport(reportId).marketId, true);
        reportingSystem.resolveReport(reportId);
    }

    // ============ Fuzz Test 8: Gas Limit Testing ============

    function testFuzz_GasConsumption(uint8 numBans) public {
        vm.assume(numBans > 0 && numBans <= 10);

        uint256 gasBefore = gasleft();

        vm.startPrank(address(reportingSystem)); // reportingSystem is set as governance
        for (uint8 i = 0; i < numBans; i++) {
            banManager.banFromNetwork(uint256(i) + 1, "Test ban", bytes32(uint256(i)));
        }
        vm.stopPrank();

        uint256 gasUsed = gasBefore - gasleft();
        uint256 avgGasPerBan = gasUsed / numBans;

        // Should be < 150k gas per ban (increased after security hardening)
        assertLt(avgGasPerBan, 150_000);
    }

    // ============ Fuzz Test 9: Overflow Protection ============

    function testFuzz_NoOverflowOnLargeValues(uint128 agentId, uint96 stakeAmount) public {
        vm.assume(agentId > 0);
        vm.assume(stakeAmount >= 0.1 ether && stakeAmount <= type(uint96).max / 2);

        vm.deal(address(this), stakeAmount + 1 ether);

        // Should not overflow
        bytes32 proposalId = labelManager.proposeLabel{value: stakeAmount}(
            agentId, ReputationLabelManager.Label.HACKER, keccak256("evidence")
        );

        assertGt(uint256(proposalId), 0);
    }

    // ============ Fuzz Test 10: String Length Limits ============

    function testFuzz_LongBanReasons(uint8 reasonLength) public {
        vm.assume(reasonLength > 0 && reasonLength <= 200);

        // Generate random-length reason
        string memory reason = new string(reasonLength);
        bytes memory reasonBytes = bytes(reason);
        for (uint256 i = 0; i < reasonLength; i++) {
            reasonBytes[i] = bytes1(uint8(65 + (i % 26))); // A-Z
        }
        reason = string(reasonBytes);

        vm.prank(address(reportingSystem)); // reportingSystem is set as governance
        banManager.banFromNetwork(600, reason, bytes32(uint256(1)));

        string memory storedReason = banManager.getBanReason(600, bytes32(0));
        assertEq(storedReason, reason);
    }
}

/**
 * Mock Predimarket for fuzz testing
 */
contract MockIdentityRegistry {
    function balanceOf(address) external pure returns (uint256) {
        return 1; // All addresses have an identity for testing
    }

    function agentExists(uint256) external pure returns (bool) {
        return true;
    }
}

contract MockPredimarket {
    mapping(bytes32 => bool) public marketResolved;
    mapping(bytes32 => bool) public marketOutcome;

    function createMarket(bytes32, string memory, uint256) external pure {
        // No-op for fuzz testing
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
        return
            (sessionId, "", 0, 0, 1000 ether, 0, block.timestamp, marketResolved[sessionId], marketOutcome[sessionId]);
    }
}
