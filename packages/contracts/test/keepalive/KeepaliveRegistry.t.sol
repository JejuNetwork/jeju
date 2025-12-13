// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/keepalive/KeepaliveRegistry.sol";

/**
 * @title KeepaliveRegistry Test Suite
 * @notice Comprehensive tests for the Jeju Keepalive system
 */
contract KeepaliveRegistryTest is Test {
    KeepaliveRegistry public registry;

    address public deployer = address(this);
    address public alice = address(0x1);
    address public bob = address(0x2);
    address public executor = address(0x3);
    address public vault = address(0x4);

    address public triggerRegistry = address(0x10);
    address public agentVault = address(0x11);
    address public jnsRegistry = address(0x12);

    bytes32 public testJnsNode;
    uint256 public testAgentId = 1;

    function setUp() public {
        registry = new KeepaliveRegistry(triggerRegistry, agentVault, jnsRegistry);

        // Authorize executor
        registry.setExecutorAuthorized(executor, true);

        // Compute test JNS node
        testJnsNode = keccak256(abi.encodePacked(bytes32(0), keccak256("test")));

        // Fund accounts
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(vault, 10 ether);
    }

    // ============ Registration Tests ============

    function test_RegisterKeepalive() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(
            testJnsNode,
            testAgentId,
            vault,
            0.1 ether, // globalMinBalance
            3600, // checkInterval
            0.01 ether, // autoFundAmount
            true // autoFundEnabled
        );

        assertTrue(keepaliveId != bytes32(0));

        (
            bytes32 id,
            address owner,
            bytes32 jnsNode,
            uint256 agentId,
            address vaultAddress,
            uint256 globalMinBalance,
            uint256 checkInterval,
            uint256 autoFundAmount,
            bool autoFundEnabled,
            bool active,
            uint256 createdAt,
            ,
        ) = registry.keepalives(keepaliveId);

        assertEq(id, keepaliveId);
        assertEq(owner, alice);
        assertEq(jnsNode, testJnsNode);
        assertEq(agentId, testAgentId);
        assertEq(vaultAddress, vault);
        assertEq(globalMinBalance, 0.1 ether);
        assertEq(checkInterval, 3600);
        assertEq(autoFundAmount, 0.01 ether);
        assertTrue(autoFundEnabled);
        assertTrue(active);
        assertGt(createdAt, 0);
    }

    function test_RegisterKeepalive_DefaultCheckInterval() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(
            testJnsNode,
            testAgentId,
            vault,
            0.1 ether,
            0, // 0 should default to 3600
            0,
            false
        );

        (,,,,,, uint256 checkInterval,,,,,,) = registry.keepalives(keepaliveId);
        assertEq(checkInterval, 3600);
    }

    function test_RegisterKeepalive_TracksOwnership() public {
        vm.prank(alice);
        bytes32 id1 = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        bytes32 jnsNode2 = keccak256(abi.encodePacked(bytes32(0), keccak256("test2")));
        vm.prank(alice);
        bytes32 id2 = registry.registerKeepalive(jnsNode2, 0, vault, 0.1 ether, 3600, 0, false);

        bytes32[] memory aliceKeepalives = registry.getKeepalivesByOwner(alice);
        assertEq(aliceKeepalives.length, 2);
        assertEq(aliceKeepalives[0], id1);
        assertEq(aliceKeepalives[1], id2);
    }

    function test_RegisterKeepalive_MapsJNS() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        assertEq(registry.jnsToKeepalive(testJnsNode), keepaliveId);
    }

    function test_RegisterKeepalive_MapsAgent() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(bytes32(0), testAgentId, vault, 0.1 ether, 3600, 0, false);

        assertEq(registry.agentToKeepalive(testAgentId), keepaliveId);
    }

    // ============ Resource Management Tests ============

    function test_AddResource() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        vm.prank(alice);
        registry.addResource(
            keepaliveId,
            KeepaliveRegistry.ResourceType.COMPUTE_ENDPOINT,
            "https://api.example.com",
            "https://api.example.com/health",
            0,
            true
        );

        KeepaliveRegistry.Resource[] memory resources = registry.getResources(keepaliveId);
        assertEq(resources.length, 1);
        assertEq(uint8(resources[0].resourceType), uint8(KeepaliveRegistry.ResourceType.COMPUTE_ENDPOINT));
        assertEq(resources[0].identifier, "https://api.example.com");
        assertEq(resources[0].healthEndpoint, "https://api.example.com/health");
        assertTrue(resources[0].required);
    }

    function test_AddMultipleResources() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        vm.startPrank(alice);

        registry.addResource(keepaliveId, KeepaliveRegistry.ResourceType.IPFS_CONTENT, "QmTest123", "", 0, true);

        registry.addResource(
            keepaliveId,
            KeepaliveRegistry.ResourceType.COMPUTE_ENDPOINT,
            "https://api.example.com",
            "https://api.example.com/health",
            0,
            true
        );

        registry.addResource(keepaliveId, KeepaliveRegistry.ResourceType.TRIGGER, "0x1234567890", "", 0.01 ether, false);

        vm.stopPrank();

        KeepaliveRegistry.Resource[] memory resources = registry.getResources(keepaliveId);
        assertEq(resources.length, 3);
    }

    function test_RemoveResource() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        vm.startPrank(alice);
        registry.addResource(keepaliveId, KeepaliveRegistry.ResourceType.IPFS_CONTENT, "cid1", "", 0, true);
        registry.addResource(keepaliveId, KeepaliveRegistry.ResourceType.IPFS_CONTENT, "cid2", "", 0, true);
        registry.removeResource(keepaliveId, 0);
        vm.stopPrank();

        KeepaliveRegistry.Resource[] memory resources = registry.getResources(keepaliveId);
        assertEq(resources.length, 1);
        assertEq(resources[0].identifier, "cid2"); // cid2 moved to index 0
    }

    function test_AddResource_RevertNotOwner() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(KeepaliveRegistry.NotKeepaliveOwner.selector, keepaliveId, bob));
        registry.addResource(keepaliveId, KeepaliveRegistry.ResourceType.IPFS_CONTENT, "cid", "", 0, true);
    }

    function test_AddResource_RevertEmptyIdentifier() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        vm.prank(alice);
        vm.expectRevert(KeepaliveRegistry.InvalidResource.selector);
        registry.addResource(keepaliveId, KeepaliveRegistry.ResourceType.IPFS_CONTENT, "", "", 0, true);
    }

    // ============ Health Check Tests ============

    function test_RecordHealthCheck() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        string[] memory failedResources = new string[](0);

        vm.prank(executor);
        registry.recordHealthCheck(keepaliveId, KeepaliveRegistry.HealthStatus.HEALTHY, 1 ether, 5, 5, failedResources);

        (,,,,,,,,,,, uint256 lastCheckAt, KeepaliveRegistry.HealthStatus lastStatus) = registry.keepalives(keepaliveId);

        assertEq(lastCheckAt, block.timestamp);
        assertEq(uint8(lastStatus), uint8(KeepaliveRegistry.HealthStatus.HEALTHY));
    }

    function test_RecordHealthCheck_UpdatesLastHealthCheck() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        string[] memory failed = new string[](1);
        failed[0] = "resource1";

        vm.prank(executor);
        registry.recordHealthCheck(keepaliveId, KeepaliveRegistry.HealthStatus.UNHEALTHY, 0.05 ether, 3, 5, failed);

        // Public mapping getter doesn't return array members, so we check individually
        (
            bytes32 id,
            KeepaliveRegistry.HealthStatus status,
            uint256 timestamp,
            uint256 balance,
            uint8 healthyResources,
            uint8 totalResources
        ) = registry.lastHealthCheck(keepaliveId);

        assertEq(id, keepaliveId);
        assertEq(uint8(status), uint8(KeepaliveRegistry.HealthStatus.UNHEALTHY));
        assertEq(timestamp, block.timestamp);
        assertEq(balance, 0.05 ether);
        assertEq(healthyResources, 3);
        assertEq(totalResources, 5);
    }

    function test_RecordHealthCheck_RevertUnauthorizedExecutor() public {
        registry.setRequireExecutorAuth(true);

        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        string[] memory failedResources = new string[](0);

        vm.prank(bob); // bob is not an authorized executor
        vm.expectRevert(abi.encodeWithSelector(KeepaliveRegistry.NotAuthorizedExecutor.selector, bob));
        registry.recordHealthCheck(keepaliveId, KeepaliveRegistry.HealthStatus.HEALTHY, 1 ether, 5, 5, failedResources);
    }

    function test_RecordHealthCheck_EmitsStatusChanged() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        string[] memory failedResources = new string[](0);

        vm.prank(executor);
        vm.expectEmit(true, false, false, true);
        emit KeepaliveRegistry.StatusChanged(
            keepaliveId, KeepaliveRegistry.HealthStatus.UNKNOWN, KeepaliveRegistry.HealthStatus.HEALTHY
        );
        registry.recordHealthCheck(keepaliveId, KeepaliveRegistry.HealthStatus.HEALTHY, 1 ether, 5, 5, failedResources);
    }

    // ============ Status Query Tests ============

    function test_IsFunded() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        // Initially unknown (not unfunded)
        assertTrue(registry.isFunded(keepaliveId));

        // Record as unfunded
        string[] memory failedResources = new string[](0);
        vm.prank(executor);
        registry.recordHealthCheck(keepaliveId, KeepaliveRegistry.HealthStatus.UNFUNDED, 0, 0, 0, failedResources);

        assertFalse(registry.isFunded(keepaliveId));
    }

    function test_GetStatus() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        string[] memory failedResources = new string[](0);
        vm.prank(executor);
        registry.recordHealthCheck(keepaliveId, KeepaliveRegistry.HealthStatus.HEALTHY, 1 ether, 5, 5, failedResources);

        (bool funded, KeepaliveRegistry.HealthStatus status, uint256 lastCheck, uint256 balance) =
            registry.getStatus(keepaliveId);

        assertTrue(funded);
        assertEq(uint8(status), uint8(KeepaliveRegistry.HealthStatus.HEALTHY));
        assertEq(lastCheck, block.timestamp);
        assertEq(balance, 1 ether);
    }

    function test_GetStatusByJNS() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        string[] memory failedResources = new string[](0);
        vm.prank(executor);
        registry.recordHealthCheck(keepaliveId, KeepaliveRegistry.HealthStatus.HEALTHY, 1 ether, 5, 5, failedResources);

        (bool exists, bool funded, KeepaliveRegistry.HealthStatus status, bytes32 id) =
            registry.getStatusByJNS(testJnsNode);

        assertTrue(exists);
        assertTrue(funded);
        assertEq(uint8(status), uint8(KeepaliveRegistry.HealthStatus.HEALTHY));
        assertEq(id, keepaliveId);
    }

    function test_GetStatusByJNS_NotFound() public {
        bytes32 unknownNode = keccak256("unknown");
        (bool exists, bool funded, KeepaliveRegistry.HealthStatus status, bytes32 id) =
            registry.getStatusByJNS(unknownNode);

        assertFalse(exists);
        assertFalse(funded);
        assertEq(uint8(status), uint8(KeepaliveRegistry.HealthStatus.UNKNOWN));
        assertEq(id, bytes32(0));
    }

    // ============ Check Scheduling Tests ============

    function test_GetKeepalivesNeedingCheck() public {
        vm.prank(alice);
        bytes32 id1 = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 60, 0, false); // 60s interval

        // Initially should need check (never checked)
        bytes32[] memory needing = registry.getKeepalivesNeedingCheck(10);
        assertEq(needing.length, 1);
        assertEq(needing[0], id1);

        // Record check
        string[] memory failedResources = new string[](0);
        vm.prank(executor);
        registry.recordHealthCheck(id1, KeepaliveRegistry.HealthStatus.HEALTHY, 1 ether, 1, 1, failedResources);

        // Immediately after check, should not need check
        needing = registry.getKeepalivesNeedingCheck(10);
        assertEq(needing.length, 0);

        // Fast forward past interval
        vm.warp(block.timestamp + 61);

        // Should need check again
        needing = registry.getKeepalivesNeedingCheck(10);
        assertEq(needing.length, 1);
    }

    function test_GetKeepalivesNeedingCheck_InactiveExcluded() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 60, 0, false);

        // Deactivate
        vm.prank(alice);
        registry.setActive(keepaliveId, false);

        bytes32[] memory needing = registry.getKeepalivesNeedingCheck(10);
        assertEq(needing.length, 0);
    }

    // ============ Dependencies Tests ============

    function test_AddDependency() public {
        vm.prank(alice);
        bytes32 id1 = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        bytes32 jnsNode2 = keccak256(abi.encodePacked(bytes32(0), keccak256("test2")));
        vm.prank(alice);
        bytes32 id2 = registry.registerKeepalive(jnsNode2, 0, vault, 0.1 ether, 3600, 0, false);

        vm.prank(alice);
        registry.addDependency(id1, id2);

        bytes32[] memory deps = registry.getDependencies(id1);
        assertEq(deps.length, 1);
        assertEq(deps[0], id2);
    }

    // ============ Config Update Tests ============

    function test_UpdateConfig() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        vm.prank(alice);
        registry.updateConfig(keepaliveId, 0.2 ether, 1800, 0.05 ether, true);

        (,,,,, uint256 globalMinBalance, uint256 checkInterval, uint256 autoFundAmount, bool autoFundEnabled,,,,) =
            registry.keepalives(keepaliveId);

        assertEq(globalMinBalance, 0.2 ether);
        assertEq(checkInterval, 1800);
        assertEq(autoFundAmount, 0.05 ether);
        assertTrue(autoFundEnabled);
    }

    // ============ Manual Funding Tests ============

    function test_ManualFund() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        vm.expectEmit(true, false, false, true);
        emit KeepaliveRegistry.AutoFunded(keepaliveId, 1 ether, bob);

        vm.prank(bob);
        registry.manualFund{value: 1 ether}(keepaliveId);
    }

    // ============ Admin Tests ============

    function test_SetExecutorAuthorized() public {
        address newExecutor = address(0x100);

        registry.setExecutorAuthorized(newExecutor, true);
        assertTrue(registry.authorizedExecutors(newExecutor));

        registry.setExecutorAuthorized(newExecutor, false);
        assertFalse(registry.authorizedExecutors(newExecutor));
    }

    function test_Pause() public {
        registry.pause();

        vm.prank(alice);
        vm.expectRevert();
        registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        registry.unpause();

        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);
        assertTrue(keepaliveId != bytes32(0));
    }

    // ============ View Tests ============

    function test_GetAllKeepalives() public {
        vm.prank(alice);
        bytes32 id1 = registry.registerKeepalive(testJnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        bytes32 jnsNode2 = keccak256(abi.encodePacked(bytes32(0), keccak256("test2")));
        vm.prank(bob);
        bytes32 id2 = registry.registerKeepalive(jnsNode2, 0, vault, 0.1 ether, 3600, 0, false);

        bytes32[] memory all = registry.getAllKeepalives();
        assertEq(all.length, 2);
        assertEq(all[0], id1);
        assertEq(all[1], id2);
    }
}
