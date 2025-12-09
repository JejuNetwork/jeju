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
        cloudProvider.recordViolation(
            testAgentId, CloudReputationProvider.ViolationType.API_ABUSE, 60, "ipfs://evidence"
        );

        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 10);
        assertEq(violations.length, 1);
        assertEq(uint8(violations[0].violationType), uint8(CloudReputationProvider.ViolationType.API_ABUSE));
        assertEq(violations[0].severityScore, 60);
    }

    function testRecordMultipleViolations() public {
        vm.startPrank(operator);

        cloudProvider.recordViolation(testAgentId, CloudReputationProvider.ViolationType.SPAM, 30, "");
        cloudProvider.recordViolation(testAgentId, CloudReputationProvider.ViolationType.API_ABUSE, 50, "");
        cloudProvider.recordViolation(testAgentId, CloudReputationProvider.ViolationType.HARASSMENT, 70, "");

        vm.stopPrank();

        CloudReputationProvider.Violation[] memory violations = cloudProvider.getAgentViolations(testAgentId, 0, 10);
        assertEq(violations.length, 3);
    }

    function testViolationPagination() public {
        vm.startPrank(operator);

        for (uint256 i = 0; i < 5; i++) {
            cloudProvider.recordViolation(testAgentId, CloudReputationProvider.ViolationType.SPAM, uint8(i * 10), "");
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

        cloudProvider.recordViolation(testAgentId, CloudReputationProvider.ViolationType.SPAM, 30, "");
        cloudProvider.recordViolation(testAgentId, CloudReputationProvider.ViolationType.SPAM, 40, "");

        vm.stopPrank();

        assertEq(cloudProvider.violationCounts(CloudReputationProvider.ViolationType.SPAM), 2);
    }

    function testUnauthorizedCannotRecordViolation() public {
        vm.prank(user);
        vm.expectRevert(CloudReputationProvider.NotAuthorized.selector);
        cloudProvider.recordViolation(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, "");
    }

    function testCannotRecordViolationForNonexistentAgent() public {
        vm.prank(operator);
        vm.expectRevert(CloudReputationProvider.InvalidAgentId.selector);
        cloudProvider.recordViolation(99999, CloudReputationProvider.ViolationType.SPAM, 50, "");
    }

    function testCannotRecordInvalidSeverityScore() public {
        vm.prank(operator);
        vm.expectRevert(CloudReputationProvider.InvalidScore.selector);
        cloudProvider.recordViolation(testAgentId, CloudReputationProvider.ViolationType.SPAM, 150, "");
    }

    // ============ Ban Proposal Tests ============
    // Note: Full ban proposal tests are in ModerationIntegration.t.sol
    // These tests verify CloudReputationProvider's authorization checks

    function testUnauthorizedCannotRequestBan() public {
        vm.deal(user, 1 ether);
        vm.prank(user);
        vm.expectRevert(CloudReputationProvider.NotAuthorized.selector);
        cloudProvider.requestBanViaGovernance{value: 0.01 ether}(
            testAgentId, CloudReputationProvider.ViolationType.HACKING
        );
    }

    function testCannotBanNonexistentAgent() public {
        vm.deal(owner, 1 ether);
        vm.expectRevert(CloudReputationProvider.InvalidAgentId.selector);
        cloudProvider.requestBanViaGovernance{value: 0.01 ether}(99999, CloudReputationProvider.ViolationType.HACKING);
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
        cloudProvider.recordViolation(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, "");

        cloudProvider.unpause();
        assertFalse(cloudProvider.paused());

        vm.prank(operator);
        cloudProvider.recordViolation(testAgentId, CloudReputationProvider.ViolationType.SPAM, 50, "");
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
        cloudProvider.recordViolation(
            testAgentId, CloudReputationProvider.ViolationType.SPAM, 30, "ipfs://minor-violation"
        );

        // 2. Record more serious violation (as operator)
        vm.prank(operator);
        cloudProvider.recordViolation(
            testAgentId, CloudReputationProvider.ViolationType.API_ABUSE, 60, "ipfs://api-abuse"
        );

        // 3. Record severe violation (as operator)
        vm.prank(operator);
        cloudProvider.recordViolation(
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
}
