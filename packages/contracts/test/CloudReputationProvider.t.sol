// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/services/CloudReputationProvider.sol";
import "../src/registry/IdentityRegistry.sol";
import "../src/registry/ReputationRegistry.sol";
import "../src/registry/RegistryGovernance.sol";
import {Predimarket} from "../src/prediction-markets/Predimarket.sol";
import {PredictionOracle} from "../src/prediction-markets/PredictionOracle.sol";
import "../src/tokens/ElizaOSToken.sol";

contract CloudReputationProviderTest is Test {
    CloudReputationProvider public cloudProvider;
    IdentityRegistry public identityRegistry;
    ReputationRegistry public reputationRegistry;
    RegistryGovernance public registryGovernance;
    Predimarket public predimarket;
    PredictionOracle public predictionOracle;
    ElizaOSToken public elizaToken;

    address public owner = address(this);
    address public operator = address(0x1);
    address public user = address(0x2);
    address public cloudService = address(0x3);

    uint256 public cloudAgentId;
    uint256 public testAgentId;

    function setUp() public {
        // Deploy ERC-8004 registries
        identityRegistry = new IdentityRegistry();
        reputationRegistry = new ReputationRegistry(payable(address(identityRegistry)));

        // Deploy prediction market infrastructure
        elizaToken = new ElizaOSToken(owner);
        predictionOracle = new PredictionOracle(owner);
        predimarket = new Predimarket(address(elizaToken), address(predictionOracle), owner, owner);

        // Deploy registry governance
        registryGovernance = new RegistryGovernance(
            payable(address(identityRegistry)),
            address(predimarket),
            owner,
            RegistryGovernance.Environment.LOCALNET,
            owner
        );

        // Set governance in identity registry
        identityRegistry.setGovernance(address(registryGovernance));

        // Authorize RegistryGovernance to create markets on Predimarket
        predimarket.addAuthorizedCreator(address(registryGovernance));

        // Deploy CloudReputationProvider
        cloudProvider = new CloudReputationProvider(
            address(identityRegistry), address(reputationRegistry), payable(address(registryGovernance)), owner
        );

        // Setup: Register cloud service as agent
        vm.prank(cloudService);
        cloudAgentId = identityRegistry.register("ipfs://cloud-service");

        // Set cloud agent ID
        cloudProvider.setCloudAgentId(cloudAgentId);

        // Authorize operator
        cloudProvider.setAuthorizedOperator(operator, true);

        // Register test agent
        vm.prank(user);
        testAgentId = identityRegistry.register("ipfs://test-agent");
    }

    // ============ Authorization Tests ============

    function testSetAuthorizedOperator() public {
        address newOperator = address(0x10);

        cloudProvider.setAuthorizedOperator(newOperator, true);
        assertTrue(cloudProvider.authorizedOperators(newOperator));

        cloudProvider.setAuthorizedOperator(newOperator, false);
        assertFalse(cloudProvider.authorizedOperators(newOperator));
    }

    function testOnlyOwnerCanSetAuthorizedOperator() public {
        vm.prank(user);
        vm.expectRevert();
        cloudProvider.setAuthorizedOperator(user, true);
    }

    // ============ Cloud Agent ID Tests ============

    function testCloudAgentIdCanOnlyBeSetOnce() public {
        // Already set in setUp, so trying to set again should fail
        vm.expectRevert("Cloud agent already set");
        cloudProvider.setCloudAgentId(999);
    }

    function testGetCloudAgentId() public view {
        assertEq(cloudProvider.cloudAgentId(), cloudAgentId);
    }

    function testOnlyOwnerCanSetCloudAgentId() public {
        vm.prank(user);
        vm.expectRevert();
        cloudProvider.setCloudAgentId(123);
    }

    // ============ Violation Recording Tests ============

    function testRecordViolation() public {
        vm.prank(operator);
        cloudProvider.recordViolationWithType(
            testAgentId, CloudReputationProvider.ViolationType.API_ABUSE, 60, "ipfs://evidence"
        );

        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 10);
        assertEq(violations.length, 1);
        assertEq(uint8(violations[0].violationType), uint8(CloudReputationProvider.ViolationType.API_ABUSE));
        assertEq(violations[0].severityScore, 60);
    }

    function testRecordMultipleViolations() public {
        vm.startPrank(operator);

        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 30, "");
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.API_ABUSE, 50, "");
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.HARASSMENT, 70, "");

        vm.stopPrank();

        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 10);
        assertEq(violations.length, 3);
    }

    function testViolationPagination() public {
        vm.startPrank(operator);

        for (uint256 i = 0; i < 5; i++) {
            cloudProvider.recordViolationWithType(
                testAgentId, CloudReputationProvider.ViolationType.SPAM, uint8(i * 10), ""
            );
        }

        vm.stopPrank();

        // Get first 2
        CloudReputationProvider.Violation[] memory page1 = cloudProvider.getAgentViolations(testAgentId, 0, 2);
        assertEq(page1.length, 2);

        // Get next 2
        CloudReputationProvider.Violation[] memory page2 = cloudProvider.getAgentViolations(testAgentId, 2, 2);
        assertEq(page2.length, 2);

        // Get last 1
        CloudReputationProvider.Violation[] memory page3 = cloudProvider.getAgentViolations(testAgentId, 4, 2);
        assertEq(page3.length, 1);
    }

    function testViolationCountsTracked() public {
        vm.startPrank(operator);

        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 30, "");
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 40, "");

        vm.stopPrank();

        assertEq(cloudProvider.violationCounts(CloudReputationProvider.ViolationType.SPAM), 2);
    }

    function testUnauthorizedCannotRecordViolation() public {
        vm.prank(user);
        vm.expectRevert(CloudReputationProvider.NotAuthorized.selector);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, "");
    }

    function testCannotRecordViolationForNonexistentAgent() public {
        vm.prank(operator);
        vm.expectRevert(CloudReputationProvider.InvalidAgentId.selector);
        cloudProvider.recordViolationWithType(99999, CloudReputationProvider.ViolationType.SPAM, 50, "");
    }

    function testCannotRecordInvalidSeverityScore() public {
        vm.prank(operator);
        vm.expectRevert(CloudReputationProvider.InvalidScore.selector);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 150, "");
    }

    // ============ Ban Proposal Tests ============
    // Note: Full ban proposal tests are in ModerationIntegration.t.sol
    // These tests verify CloudReputationProvider's authorization checks

    function testUnauthorizedCannotRequestBan() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert(CloudReputationProvider.NotAuthorized.selector);
        cloudProvider.requestBanViaGovernanceWithType{value: 0.01 ether}(
            testAgentId, CloudReputationProvider.ViolationType.HACKING
        );
    }

    function testCannotBanNonexistentAgent() public {
        vm.deal(owner, 1 ether);
        vm.expectRevert(CloudReputationProvider.InvalidAgentId.selector);
        cloudProvider.requestBanViaGovernanceWithType{value: 0.01 ether}(
            99999, CloudReputationProvider.ViolationType.HACKING
        );
    }

    // ============ Threshold Tests ============

    function testSetAutobanThreshold() public {
        cloudProvider.setAutobanThreshold(30);
        assertEq(cloudProvider.autobanThreshold(), 30);
    }

    function testAutobanThresholdMustBeValid() public {
        vm.expectRevert("Invalid threshold");
        cloudProvider.setAutobanThreshold(150);
    }

    // ============ Pause Tests ============

    function testPauseUnpause() public {
        cloudProvider.pause();
        assertTrue(cloudProvider.paused());

        vm.prank(operator);
        vm.expectRevert();
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, "");

        cloudProvider.unpause();
        assertFalse(cloudProvider.paused());

        vm.prank(operator);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, "");
    }

    function testOnlyOwnerCanPause() public {
        vm.prank(user);
        vm.expectRevert();
        cloudProvider.pause();
    }

    // ============ Integration Tests ============

    function testFullViolationWorkflow() public {
        // 1. Record minor violation (as operator)
        vm.prank(operator);
        cloudProvider.recordViolationWithType(
            testAgentId, CloudReputationProvider.ViolationType.SPAM, 30, "ipfs://minor-violation"
        );

        // 2. Record more serious violation (as operator)
        vm.prank(operator);
        cloudProvider.recordViolationWithType(
            testAgentId, CloudReputationProvider.ViolationType.API_ABUSE, 60, "ipfs://api-abuse"
        );

        // 3. Record severe violation (as operator)
        vm.prank(operator);
        cloudProvider.recordViolationWithType(
            testAgentId, CloudReputationProvider.ViolationType.HACKING, 95, "ipfs://hacking-evidence"
        );

        // Verify violations recorded correctly
        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 10);
        assertEq(violations.length, 3);
        assertEq(cloudProvider.violationCounts(CloudReputationProvider.ViolationType.SPAM), 1);
        assertEq(cloudProvider.violationCounts(CloudReputationProvider.ViolationType.API_ABUSE), 1);
        assertEq(cloudProvider.violationCounts(CloudReputationProvider.ViolationType.HACKING), 1);

        // Verify severity ordering
        assertEq(violations[0].severityScore, 30);
        assertEq(violations[1].severityScore, 60);
        assertEq(violations[2].severityScore, 95);
    }

    // ============ View Functions Tests ============

    function testImmutableAddresses() public view {
        assertEq(address(cloudProvider.identityRegistry()), address(identityRegistry));
        assertEq(address(cloudProvider.reputationRegistry()), address(reputationRegistry));
        assertEq(address(cloudProvider.registryGovernance()), address(registryGovernance));
    }

    // ============ IReputationProvider Interface Tests ============

    function testRecordViolationViaInterface() public {
        // Test the uint8 interface method (IReputationProvider compliance)
        vm.prank(operator);
        cloudProvider.recordViolation(testAgentId, 0, 50, "ipfs://interface-test"); // 0 = API_ABUSE

        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 10);
        assertEq(violations.length, 1);
        assertEq(uint8(violations[0].violationType), 0);
    }

    function testGetProviderAgentId() public view {
        assertEq(cloudProvider.getProviderAgentId(), cloudAgentId);
    }

    function testIsAuthorizedOperator() public view {
        assertTrue(cloudProvider.isAuthorizedOperator(operator));
        assertFalse(cloudProvider.isAuthorizedOperator(user));
        // Note: isAuthorizedOperator only checks the mapping, owner permissions
        // are checked separately in _validateAndRecordViolation
    }

    function testVersion() public view {
        assertEq(cloudProvider.version(), "2.0.0");
    }

    function test_GetProviderAgentId() public view {
        assertEq(cloudProvider.getProviderAgentId(), cloudAgentId);
    }

    // ============ Boundary Condition Tests ============

    function testScoreBoundaryZero() public {
        vm.prank(operator);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 0, "");

        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 1);
        assertEq(violations[0].severityScore, 0);
    }

    function testScoreBoundaryMax() public {
        vm.prank(operator);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 100, "");

        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 1);
        assertEq(violations[0].severityScore, 100);
    }

    function testScoreBoundaryJustOver() public {
        vm.prank(operator);
        vm.expectRevert(CloudReputationProvider.InvalidScore.selector);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 101, "");
    }

    function testPaginationEmptyOffset() public view {
        // No violations yet for a fresh agent
        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 10);
        assertEq(violations.length, 0);
    }

    function testPaginationLargeOffset() public {
        vm.prank(operator);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, "");

        // Offset beyond existing violations
        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 100, 10);
        assertEq(violations.length, 0);
    }

    function testPaginationZeroLimit() public {
        vm.prank(operator);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, "");

        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 0);
        assertEq(violations.length, 0);
    }

    function testPaginationLargeLimit() public {
        vm.prank(operator);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, "");

        // Limit larger than actual violations
        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 1000);
        assertEq(violations.length, 1);
    }

    // ============ All Violation Types Tests ============

    function testAllViolationTypes() public {
        vm.startPrank(operator);

        // Test all 11 violation types
        cloudProvider.recordViolation(testAgentId, 0, 10, ""); // API_ABUSE
        cloudProvider.recordViolation(testAgentId, 1, 20, ""); // RESOURCE_EXPLOITATION
        cloudProvider.recordViolation(testAgentId, 2, 30, ""); // SCAMMING
        cloudProvider.recordViolation(testAgentId, 3, 40, ""); // PHISHING
        cloudProvider.recordViolation(testAgentId, 4, 50, ""); // HACKING
        cloudProvider.recordViolation(testAgentId, 5, 60, ""); // UNAUTHORIZED_ACCESS
        cloudProvider.recordViolation(testAgentId, 6, 70, ""); // DATA_THEFT
        cloudProvider.recordViolation(testAgentId, 7, 80, ""); // ILLEGAL_CONTENT
        cloudProvider.recordViolation(testAgentId, 8, 85, ""); // HARASSMENT
        cloudProvider.recordViolation(testAgentId, 9, 90, ""); // SPAM
        cloudProvider.recordViolation(testAgentId, 10, 95, ""); // TOS_VIOLATION

        vm.stopPrank();

        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 20);
        assertEq(violations.length, 11);

        // Verify each type was recorded with correct severity
        assertEq(violations[0].severityScore, 10);
        assertEq(violations[10].severityScore, 95);
    }

    function testViolationCountsForAllTypes() public {
        vm.startPrank(operator);

        // Record 2 of each type
        for (uint8 i = 0; i <= 10; i++) {
            cloudProvider.recordViolation(testAgentId, i, 50, "");
            cloudProvider.recordViolation(testAgentId, i, 50, "");
        }

        vm.stopPrank();

        // Verify counts for each type
        assertEq(cloudProvider.violationCounts(CloudReputationProvider.ViolationType.API_ABUSE), 2);
        assertEq(cloudProvider.violationCounts(CloudReputationProvider.ViolationType.SPAM), 2);
        assertEq(cloudProvider.violationCounts(CloudReputationProvider.ViolationType.TOS_VIOLATION), 2);
    }

    // ============ Multiple Agents Tests ============

    function testMultipleAgentsWithViolations() public {
        // Register additional agents
        vm.prank(address(0x100));
        uint256 agent2 = identityRegistry.register("ipfs://agent2");
        vm.prank(address(0x101));
        uint256 agent3 = identityRegistry.register("ipfs://agent3");

        vm.startPrank(operator);

        // Record violations for each agent
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 30, "");
        cloudProvider.recordViolationWithType(agent2, CloudReputationProvider.ViolationType.HACKING, 90, "");
        cloudProvider.recordViolationWithType(agent3, CloudReputationProvider.ViolationType.API_ABUSE, 50, "");
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.HARASSMENT, 70, "");

        vm.stopPrank();

        // Verify each agent has correct violations
        assertEq(cloudProvider.getAgentViolationCount(testAgentId), 2);
        assertEq(cloudProvider.getAgentViolationCount(agent2), 1);
        assertEq(cloudProvider.getAgentViolationCount(agent3), 1);
    }

    // ============ Owner vs Operator Tests ============

    function testOwnerCanRecordViolation() public {
        // Owner should be able to record violations directly
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, "");

        assertEq(cloudProvider.getAgentViolationCount(testAgentId), 1);
    }

    function testOwnerCanRecordEvenWhenNotOperator() public {
        // Remove owner from operators (if possible) - owner should still work
        cloudProvider.setAuthorizedOperator(owner, false);

        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, "");
        assertEq(cloudProvider.getAgentViolationCount(testAgentId), 1);
    }

    // ============ Concurrent Operations Tests ============

    function testMultipleViolationsInSameBlock() public {
        vm.startPrank(operator);

        // Record many violations in same block
        for (uint256 i = 0; i < 10; i++) {
            cloudProvider.recordViolationWithType(
                testAgentId, CloudReputationProvider.ViolationType.SPAM, uint8(i * 10), ""
            );
        }

        vm.stopPrank();

        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 20);
        assertEq(violations.length, 10);

        // All should have same timestamp (same block)
        uint256 firstTimestamp = violations[0].timestamp;
        for (uint256 i = 1; i < violations.length; i++) {
            assertEq(violations[i].timestamp, firstTimestamp);
        }
    }

    function testViolationsAcrossBlocks() public {
        uint256 startTime = block.timestamp;

        vm.prank(operator);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 30, "");

        vm.warp(startTime + 100);

        vm.prank(operator);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 60, "");

        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 10);

        // Verify timestamps are different and second is later
        assertTrue(violations[1].timestamp > violations[0].timestamp, "Second violation should be later");
        assertEq(violations[1].timestamp - violations[0].timestamp, 100, "Time gap should be 100 seconds");
    }

    // ============ Reporter Address Tests ============

    function testReporterAddressRecorded() public {
        vm.prank(operator);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, "");

        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 1);
        assertEq(violations[0].reporter, operator);
    }

    function testDifferentReporters() public {
        address operator2 = address(0x999);
        cloudProvider.setAuthorizedOperator(operator2, true);

        vm.prank(operator);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 30, "");

        vm.prank(operator2);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.HARASSMENT, 50, "");

        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 10);
        assertEq(violations[0].reporter, operator);
        assertEq(violations[1].reporter, operator2);
    }

    // ============ Evidence String Tests ============

    function testEmptyEvidence() public {
        vm.prank(operator);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, "");

        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 1);
        assertEq(violations[0].evidence, "");
    }

    function testLongEvidence() public {
        string memory longEvidence =
            "ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG/very/long/path/to/evidence/file/with/details";

        vm.prank(operator);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, longEvidence);

        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 1);
        assertEq(violations[0].evidence, longEvidence);
    }

    // ============ Reentrancy Guard Tests ============

    function testNoReentrancyOnRecordViolation() public {
        // This test verifies the nonReentrant modifier is working
        // by checking that normal operation succeeds (no revert due to reentrancy lock issues)
        vm.prank(operator);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, "first");

        vm.prank(operator);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 60, "second");

        assertEq(cloudProvider.getAgentViolationCount(testAgentId), 2);
    }

    // ============ Authorization Edge Cases ============

    function testToggleOperatorAuthorization() public {
        address testOp = address(0x888);

        // Initially not authorized
        assertFalse(cloudProvider.isAuthorizedOperator(testOp));

        // Authorize
        cloudProvider.setAuthorizedOperator(testOp, true);
        assertTrue(cloudProvider.isAuthorizedOperator(testOp));

        // Record violation while authorized
        vm.prank(testOp);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, "");

        // Deauthorize
        cloudProvider.setAuthorizedOperator(testOp, false);
        assertFalse(cloudProvider.isAuthorizedOperator(testOp));

        // Should fail now
        vm.prank(testOp);
        vm.expectRevert(CloudReputationProvider.NotAuthorized.selector);
        cloudProvider.recordViolationWithType(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, "");
    }
}
