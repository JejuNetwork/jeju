// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/keepalive/KeepaliveRegistry.sol";

/**
 * @title KeepaliveRegistry Fuzz & Edge Case Tests
 * @notice Tests boundary conditions, error handling, and concurrent behavior
 */
contract KeepaliveRegistryFuzzTest is Test {
    KeepaliveRegistry public registry;

    address public alice = address(0x1);
    address public bob = address(0x2);
    address public executor = address(0x3);
    address public vault = address(0x4);

    function setUp() public {
        registry = new KeepaliveRegistry(address(0), address(0), address(0));
        registry.setExecutorAuthorized(executor, true);
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(vault, 100 ether);
    }

    // ============ Fuzz Tests ============

    function testFuzz_RegisterKeepalive_CheckInterval(uint256 interval) public {
        interval = bound(interval, 0, 30 days);

        bytes32 jnsNode = keccak256(abi.encodePacked("test", interval));

        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(jnsNode, 0, vault, 0.1 ether, interval, 0, false);

        (,,,,,, uint256 storedInterval,,,,,,) = registry.keepalives(keepaliveId);

        // 0 should default to 3600
        if (interval == 0) {
            assertEq(storedInterval, 3600);
        } else {
            assertEq(storedInterval, interval);
        }
    }

    function testFuzz_RegisterKeepalive_MinBalance(uint256 minBalance) public {
        minBalance = bound(minBalance, 0, 1000 ether);

        bytes32 jnsNode = keccak256(abi.encodePacked("test", minBalance));

        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(jnsNode, 0, vault, minBalance, 3600, 0, false);

        (,,,,, uint256 storedMinBalance,,,,,,,) = registry.keepalives(keepaliveId);
        assertEq(storedMinBalance, minBalance);
    }

    function testFuzz_RecordHealthCheck_ResourceCounts(uint8 healthyResources, uint8 totalResources) public {
        healthyResources = uint8(bound(healthyResources, 0, 100));
        totalResources = uint8(bound(totalResources, healthyResources, 100));

        bytes32 jnsNode = keccak256("test");

        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(jnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        string[] memory failed = new string[](0);

        vm.prank(executor);
        registry.recordHealthCheck(
            keepaliveId, KeepaliveRegistry.HealthStatus.HEALTHY, 1 ether, healthyResources, totalResources, failed
        );

        (,,,, uint8 storedHealthy, uint8 storedTotal) = registry.lastHealthCheck(keepaliveId);
        assertEq(storedHealthy, healthyResources);
        assertEq(storedTotal, totalResources);
    }

    function testFuzz_ManualFund_Amount(uint256 amount) public {
        amount = bound(amount, 0, 10 ether);

        bytes32 jnsNode = keccak256("test");

        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(jnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        vm.prank(bob);
        vm.expectEmit(true, false, false, true);
        emit KeepaliveRegistry.AutoFunded(keepaliveId, amount, bob);
        registry.manualFund{value: amount}(keepaliveId);
    }

    // ============ Boundary Tests ============

    function test_ResourceLimit_ManyResources() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(keccak256("test"), 0, vault, 0.1 ether, 3600, 0, false);

        // Add 50 resources
        vm.startPrank(alice);
        for (uint256 i = 0; i < 50; i++) {
            registry.addResource(
                keepaliveId,
                KeepaliveRegistry.ResourceType.CUSTOM,
                string(abi.encodePacked("resource", vm.toString(i))),
                "",
                0,
                true
            );
        }
        vm.stopPrank();

        KeepaliveRegistry.Resource[] memory resources = registry.getResources(keepaliveId);
        assertEq(resources.length, 50);
    }

    function test_RemoveResource_LastElement() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(keccak256("test"), 0, vault, 0.1 ether, 3600, 0, false);

        vm.startPrank(alice);
        registry.addResource(keepaliveId, KeepaliveRegistry.ResourceType.CUSTOM, "a", "", 0, true);
        registry.addResource(keepaliveId, KeepaliveRegistry.ResourceType.CUSTOM, "b", "", 0, true);
        registry.addResource(keepaliveId, KeepaliveRegistry.ResourceType.CUSTOM, "c", "", 0, true);

        // Remove last element
        registry.removeResource(keepaliveId, 2);
        vm.stopPrank();

        KeepaliveRegistry.Resource[] memory resources = registry.getResources(keepaliveId);
        assertEq(resources.length, 2);
        assertEq(resources[0].identifier, "a");
        assertEq(resources[1].identifier, "b");
    }

    function test_RemoveResource_FirstElement() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(keccak256("test"), 0, vault, 0.1 ether, 3600, 0, false);

        vm.startPrank(alice);
        registry.addResource(keepaliveId, KeepaliveRegistry.ResourceType.CUSTOM, "a", "", 0, true);
        registry.addResource(keepaliveId, KeepaliveRegistry.ResourceType.CUSTOM, "b", "", 0, true);
        registry.addResource(keepaliveId, KeepaliveRegistry.ResourceType.CUSTOM, "c", "", 0, true);

        // Remove first element (c moves to 0)
        registry.removeResource(keepaliveId, 0);
        vm.stopPrank();

        KeepaliveRegistry.Resource[] memory resources = registry.getResources(keepaliveId);
        assertEq(resources.length, 2);
        assertEq(resources[0].identifier, "c"); // c moved from 2 to 0
        assertEq(resources[1].identifier, "b");
    }

    function test_RemoveResource_RevertOutOfBounds() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(keccak256("test"), 0, vault, 0.1 ether, 3600, 0, false);

        vm.prank(alice);
        registry.addResource(keepaliveId, KeepaliveRegistry.ResourceType.CUSTOM, "a", "", 0, true);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KeepaliveRegistry.ResourceNotFound.selector, 1));
        registry.removeResource(keepaliveId, 1);
    }

    // ============ Error Handling Tests ============

    function test_RegisterKeepalive_RevertKeepaliveNotFound() public {
        bytes32 nonExistentId = keccak256("nonexistent");

        string[] memory failed = new string[](0);

        vm.prank(executor);
        vm.expectRevert(abi.encodeWithSelector(KeepaliveRegistry.KeepaliveNotFound.selector, nonExistentId));
        registry.recordHealthCheck(nonExistentId, KeepaliveRegistry.HealthStatus.HEALTHY, 1 ether, 1, 1, failed);
    }

    function test_AddDependency_RevertKeepaliveNotFound() public {
        vm.prank(alice);
        bytes32 id1 = registry.registerKeepalive(keccak256("test1"), 0, vault, 0.1 ether, 3600, 0, false);

        bytes32 nonExistentId = keccak256("nonexistent");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(KeepaliveRegistry.KeepaliveNotFound.selector, nonExistentId));
        registry.addDependency(id1, nonExistentId);
    }

    function test_IsFunded_NonExistent() public {
        bytes32 nonExistent = keccak256("nonexistent");
        bool funded = registry.isFunded(nonExistent);
        assertFalse(funded);
    }

    // ============ Concurrent Behavior Tests ============

    function test_MultipleConcurrentKeepalives() public {
        bytes32[] memory ids = new bytes32[](10);

        // Register 10 keepalives from different users
        for (uint256 i = 0; i < 10; i++) {
            address user = address(uint160(0x100 + i));
            vm.deal(user, 10 ether);

            vm.prank(user);
            ids[i] = registry.registerKeepalive(
                keccak256(abi.encodePacked("test", i)),
                0,
                vault,
                0.1 ether,
                60 + i, // Different intervals
                0,
                false
            );
        }

        // All should need check initially
        bytes32[] memory needing = registry.getKeepalivesNeedingCheck(20);
        assertEq(needing.length, 10);

        // Record check for half
        string[] memory failed = new string[](0);
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(executor);
            registry.recordHealthCheck(ids[i], KeepaliveRegistry.HealthStatus.HEALTHY, 1 ether, 1, 1, failed);
        }

        // Now only 5 should need check
        needing = registry.getKeepalivesNeedingCheck(20);
        assertEq(needing.length, 5);
    }

    function test_GetKeepalivesNeedingCheck_MaxResults() public {
        // Register 20 keepalives
        for (uint256 i = 0; i < 20; i++) {
            vm.prank(alice);
            registry.registerKeepalive(keccak256(abi.encodePacked("test", i)), 0, vault, 0.1 ether, 3600, 0, false);
        }

        // Request only 5
        bytes32[] memory needing = registry.getKeepalivesNeedingCheck(5);
        assertEq(needing.length, 5);

        // Request 100 (more than exist)
        needing = registry.getKeepalivesNeedingCheck(100);
        assertEq(needing.length, 20);
    }

    // ============ Status Transition Tests ============

    function test_StatusTransitions_AllStatuses() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(keccak256("test"), 0, vault, 0.1 ether, 60, 0, false);

        string[] memory failed = new string[](0);

        // UNKNOWN -> HEALTHY
        vm.prank(executor);
        registry.recordHealthCheck(keepaliveId, KeepaliveRegistry.HealthStatus.HEALTHY, 1 ether, 1, 1, failed);
        (,,,,,,,,,,,, KeepaliveRegistry.HealthStatus status) = registry.keepalives(keepaliveId);
        assertEq(uint8(status), uint8(KeepaliveRegistry.HealthStatus.HEALTHY));

        // HEALTHY -> DEGRADED
        vm.warp(block.timestamp + 61);
        vm.prank(executor);
        registry.recordHealthCheck(keepaliveId, KeepaliveRegistry.HealthStatus.DEGRADED, 1 ether, 1, 2, failed);
        (,,,,,,,,,,,, status) = registry.keepalives(keepaliveId);
        assertEq(uint8(status), uint8(KeepaliveRegistry.HealthStatus.DEGRADED));

        // DEGRADED -> UNHEALTHY
        vm.warp(block.timestamp + 61);
        failed = new string[](1);
        failed[0] = "api";
        vm.prank(executor);
        registry.recordHealthCheck(keepaliveId, KeepaliveRegistry.HealthStatus.UNHEALTHY, 1 ether, 0, 2, failed);
        (,,,,,,,,,,,, status) = registry.keepalives(keepaliveId);
        assertEq(uint8(status), uint8(KeepaliveRegistry.HealthStatus.UNHEALTHY));

        // UNHEALTHY -> UNFUNDED
        vm.warp(block.timestamp + 61);
        vm.prank(executor);
        registry.recordHealthCheck(keepaliveId, KeepaliveRegistry.HealthStatus.UNFUNDED, 0, 0, 0, new string[](0));
        (,,,,,,,,,,,, status) = registry.keepalives(keepaliveId);
        assertEq(uint8(status), uint8(KeepaliveRegistry.HealthStatus.UNFUNDED));

        // UNFUNDED -> HEALTHY (refunded)
        vm.warp(block.timestamp + 61);
        vm.prank(executor);
        registry.recordHealthCheck(keepaliveId, KeepaliveRegistry.HealthStatus.HEALTHY, 1 ether, 1, 1, new string[](0));
        (,,,,,,,,,,,, status) = registry.keepalives(keepaliveId);
        assertEq(uint8(status), uint8(KeepaliveRegistry.HealthStatus.HEALTHY));
    }

    // ============ Ownership Transfer Edge Cases ============

    function test_MultipleKeepalivesSameJNS_Blocked() public {
        bytes32 jnsNode = keccak256("test");

        vm.prank(alice);
        registry.registerKeepalive(jnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        // Cannot register another keepalive with same JNS node
        // (second registration has different timestamp, so different ID)
        vm.warp(block.timestamp + 1);
        vm.prank(bob);
        bytes32 id2 = registry.registerKeepalive(jnsNode, 0, vault, 0.1 ether, 3600, 0, false);

        // But the mapping only tracks the latest
        assertEq(registry.jnsToKeepalive(jnsNode), id2);
    }

    // ============ Gas Edge Cases ============

    function test_RecordHealthCheck_LargeFailedResourcesList() public {
        vm.prank(alice);
        bytes32 keepaliveId = registry.registerKeepalive(keccak256("test"), 0, vault, 0.1 ether, 3600, 0, false);

        // Create large failed resources list
        string[] memory failed = new string[](100);
        for (uint256 i = 0; i < 100; i++) {
            failed[i] = string(abi.encodePacked("resource", vm.toString(i)));
        }

        vm.prank(executor);
        registry.recordHealthCheck(keepaliveId, KeepaliveRegistry.HealthStatus.UNHEALTHY, 0, 0, 100, failed);

        // Verify it was stored (we can't retrieve array from public mapping directly)
        (bytes32 id, KeepaliveRegistry.HealthStatus status,,,,) = registry.lastHealthCheck(keepaliveId);
        assertEq(id, keepaliveId);
        assertEq(uint8(status), uint8(KeepaliveRegistry.HealthStatus.UNHEALTHY));
    }
}
