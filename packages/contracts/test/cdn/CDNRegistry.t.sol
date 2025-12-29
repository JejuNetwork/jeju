// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {CDNRegistry} from "../../src/cdn/CDNRegistry.sol";
import {ICDNTypes} from "../../src/cdn/ICDNTypes.sol";

contract CDNRegistryTest is Test {
    CDNRegistry public registry;

    address public owner;
    address public provider1;
    address public provider2;
    address public siteOwner;

    function setUp() public {
        owner = makeAddr("owner");
        provider1 = makeAddr("provider1");
        provider2 = makeAddr("provider2");
        siteOwner = makeAddr("siteOwner");

        vm.deal(owner, 100 ether);
        vm.deal(provider1, 100 ether);
        vm.deal(provider2, 100 ether);
        vm.deal(siteOwner, 100 ether);

        vm.prank(owner);
        registry = new CDNRegistry(owner, address(0), address(0), 0.01 ether);
    }

    // ============ Provider Registration Tests ============

    function test_RegisterProvider() public {
        vm.prank(provider1);
        registry.registerProvider{value: 0.1 ether}(
            "Provider 1", "https://cdn1.jejunetwork.org", ICDNTypes.ProviderType.DECENTRALIZED, bytes32(0)
        );

        ICDNTypes.Provider memory provider = registry.getProvider(provider1);
        assertEq(provider.name, "Provider 1");
        assertEq(provider.endpoint, "https://cdn1.jejunetwork.org");
        assertEq(provider.stake, 0.1 ether);
        assertTrue(provider.active);
    }

    function test_RegisterProvider_RevertIfEmptyName() public {
        vm.prank(provider1);
        vm.expectRevert(CDNRegistry.InvalidName.selector);
        registry.registerProvider{value: 0.1 ether}(
            "", "https://cdn1.jejunetwork.org", ICDNTypes.ProviderType.DECENTRALIZED, bytes32(0)
        );
    }

    function test_RegisterProvider_RevertIfEmptyEndpoint() public {
        vm.prank(provider1);
        vm.expectRevert(CDNRegistry.InvalidEndpoint.selector);
        registry.registerProvider{value: 0.1 ether}("Provider 1", "", ICDNTypes.ProviderType.DECENTRALIZED, bytes32(0));
    }

    // ============ Edge Node Tests ============

    function test_RegisterEdgeNode() public {
        vm.prank(provider1);
        bytes32 nodeId = registry.registerEdgeNode{value: 0.01 ether}(
            "edge1.jejunetwork.org:443", ICDNTypes.Region.US_EAST_1, ICDNTypes.ProviderType.DECENTRALIZED
        );

        ICDNTypes.EdgeNode memory node = registry.getEdgeNode(nodeId);
        assertEq(node.operator, provider1);
        assertEq(node.endpoint, "edge1.jejunetwork.org:443");
        assertEq(uint8(node.region), uint8(ICDNTypes.Region.US_EAST_1));
        assertEq(node.stake, 0.01 ether);
        assertEq(uint8(node.status), uint8(ICDNTypes.NodeStatus.HEALTHY));
    }

    function test_RegisterEdgeNode_RevertIfInsufficientStake() public {
        vm.prank(provider1);
        vm.expectRevert();
        registry.registerEdgeNode{value: 0.0001 ether}(
            "edge1.jejunetwork.org:443", ICDNTypes.Region.US_EAST_1, ICDNTypes.ProviderType.DECENTRALIZED
        );
    }

    function test_UpdateNodeStatus() public {
        vm.prank(provider1);
        bytes32 nodeId = registry.registerEdgeNode{value: 0.01 ether}(
            "edge1.jejunetwork.org:443", ICDNTypes.Region.US_EAST_1, ICDNTypes.ProviderType.DECENTRALIZED
        );

        vm.prank(provider1);
        registry.updateNodeStatus(nodeId, ICDNTypes.NodeStatus.DEGRADED);

        ICDNTypes.EdgeNode memory node = registry.getEdgeNode(nodeId);
        assertEq(uint8(node.status), uint8(ICDNTypes.NodeStatus.DEGRADED));
    }

    function test_ReportNodeMetrics() public {
        vm.prank(provider1);
        bytes32 nodeId = registry.registerEdgeNode{value: 0.01 ether}(
            "edge1.jejunetwork.org:443", ICDNTypes.Region.US_EAST_1, ICDNTypes.ProviderType.DECENTRALIZED
        );

        vm.prank(provider1);
        registry.reportNodeMetrics(
            nodeId,
            50, // currentLoad
            1000000, // bandwidthUsage
            100, // activeConnections
            500, // requestsPerSecond
            10000000, // bytesServedTotal
            50000, // requestsTotal
            95, // cacheHitRate
            15 // avgResponseTime
        );

        ICDNTypes.EdgeNodeMetrics memory metrics = registry.getNodeMetrics(nodeId);
        assertEq(metrics.currentLoad, 50);
        assertEq(metrics.cacheHitRate, 95);
    }

    function test_DeactivateNode() public {
        vm.prank(provider1);
        bytes32 nodeId = registry.registerEdgeNode{value: 0.01 ether}(
            "edge1.jejunetwork.org:443", ICDNTypes.Region.US_EAST_1, ICDNTypes.ProviderType.DECENTRALIZED
        );

        vm.prank(provider1);
        registry.deactivateNode(nodeId, "Maintenance");

        ICDNTypes.EdgeNode memory node = registry.getEdgeNode(nodeId);
        assertEq(uint8(node.status), uint8(ICDNTypes.NodeStatus.OFFLINE));
    }

    // ============ Site Management Tests ============

    function test_CreateSite() public {
        vm.prank(siteOwner);
        bytes32 siteId = registry.createSite("example.com", "https://origin.example.com");

        ICDNTypes.Site memory site = registry.getSite(siteId);
        assertEq(site.owner, siteOwner);
        assertEq(site.domain, "example.com");
        assertEq(site.origin, "https://origin.example.com");
        assertTrue(site.active);
    }

    function test_UpdateSiteContent() public {
        vm.prank(siteOwner);
        bytes32 siteId = registry.createSite("example.com", "https://origin.example.com");

        bytes32 contentHash = keccak256("new content");

        vm.prank(siteOwner);
        registry.updateSiteContent(siteId, contentHash);

        ICDNTypes.Site memory site = registry.getSite(siteId);
        assertEq(site.contentHash, contentHash);
    }

    function test_UpdateSiteContent_RevertIfNotOwner() public {
        vm.prank(siteOwner);
        bytes32 siteId = registry.createSite("example.com", "https://origin.example.com");

        vm.prank(provider1);
        vm.expectRevert(CDNRegistry.NotSiteOwner.selector);
        registry.updateSiteContent(siteId, keccak256("malicious"));
    }

    // ============ Invalidation Tests ============

    function test_RequestInvalidation() public {
        vm.prank(siteOwner);
        bytes32 siteId = registry.createSite("example.com", "https://origin.example.com");

        string[] memory paths = new string[](2);
        paths[0] = "/assets/main.js";
        paths[1] = "/images/*";

        ICDNTypes.Region[] memory regions = new ICDNTypes.Region[](1);
        regions[0] = ICDNTypes.Region.US_EAST_1;

        vm.prank(siteOwner);
        bytes32 requestId = registry.requestInvalidation(siteId, paths, regions);

        assertTrue(requestId != bytes32(0));
    }

    function test_CompleteInvalidation() public {
        vm.prank(siteOwner);
        bytes32 siteId = registry.createSite("example.com", "https://origin.example.com");

        string[] memory paths = new string[](1);
        paths[0] = "/assets/*";

        ICDNTypes.Region[] memory regions = new ICDNTypes.Region[](1);
        regions[0] = ICDNTypes.Region.US_EAST_1;

        vm.prank(siteOwner);
        bytes32 requestId = registry.requestInvalidation(siteId, paths, regions);

        vm.prank(owner);
        registry.completeInvalidation(requestId, 10);
    }

    // ============ Usage Reporting Tests ============

    function test_ReportUsage() public {
        // Warp to a reasonable time so we can have valid period timestamps
        vm.warp(10000);

        vm.prank(provider1);
        bytes32 nodeId = registry.registerEdgeNode{value: 0.01 ether}(
            "edge1.jejunetwork.org:443", ICDNTypes.Region.US_EAST_1, ICDNTypes.ProviderType.DECENTRALIZED
        );

        uint256 periodStart = block.timestamp - 1 hours;
        uint256 periodEnd = block.timestamp;

        vm.prank(provider1);
        registry.reportUsage(
            nodeId,
            periodStart,
            periodEnd,
            1000000000,
            // bytesEgress (1GB)
            100000000,
            // bytesIngress (100MB)
            50000,
            // requests
            45000,
            // cacheHits
            5000,
            // cacheMisses
            ""
        );
        // signature

        ICDNTypes.UsageRecord[] memory records = registry.getUsageRecords(nodeId);
        assertEq(records.length, 1);
        assertEq(records[0].bytesEgress, 1000000000);
        assertEq(records[0].cacheHits, 45000);
    }

    // ============ Stake Management Tests ============

    function test_AddProviderStake() public {
        vm.prank(provider1);
        registry.registerProvider{value: 0.1 ether}(
            "Provider 1", "https://cdn1.jejunetwork.org", ICDNTypes.ProviderType.DECENTRALIZED, bytes32(0)
        );

        vm.prank(provider1);
        registry.addProviderStake{value: 0.5 ether}();

        ICDNTypes.Provider memory provider = registry.getProvider(provider1);
        assertEq(provider.stake, 0.6 ether);
    }

    function test_WithdrawProviderStake() public {
        vm.prank(provider1);
        registry.registerProvider{value: 0.5 ether}(
            "Provider 1", "https://cdn1.jejunetwork.org", ICDNTypes.ProviderType.DECENTRALIZED, bytes32(0)
        );

        uint256 balanceBefore = provider1.balance;

        vm.prank(provider1);
        registry.withdrawProviderStake(0.3 ether);

        ICDNTypes.Provider memory provider = registry.getProvider(provider1);
        assertEq(provider.stake, 0.2 ether);
        assertEq(provider1.balance, balanceBefore + 0.3 ether);
    }

    function test_AddNodeStake() public {
        vm.prank(provider1);
        bytes32 nodeId = registry.registerEdgeNode{value: 0.01 ether}(
            "edge1.jejunetwork.org:443", ICDNTypes.Region.US_EAST_1, ICDNTypes.ProviderType.DECENTRALIZED
        );

        vm.prank(provider1);
        registry.addNodeStake{value: 0.05 ether}(nodeId);

        ICDNTypes.EdgeNode memory node = registry.getEdgeNode(nodeId);
        assertEq(node.stake, 0.06 ether);
    }

    // ============ Provider Activation Tests ============

    function test_DeactivateAndReactivateProvider() public {
        vm.prank(provider1);
        registry.registerProvider{value: 0.1 ether}(
            "Provider 1", "https://cdn1.jejunetwork.org", ICDNTypes.ProviderType.DECENTRALIZED, bytes32(0)
        );

        vm.prank(provider1);
        registry.deactivateProvider();

        ICDNTypes.Provider memory provider = registry.getProvider(provider1);
        assertFalse(provider.active);

        vm.prank(provider1);
        registry.reactivateProvider();

        provider = registry.getProvider(provider1);
        assertTrue(provider.active);
    }

    // ============ View Functions Tests ============

    function test_GetActiveProviders() public {
        vm.prank(provider1);
        registry.registerProvider{value: 0.1 ether}(
            "Provider 1", "https://cdn1.jejunetwork.org", ICDNTypes.ProviderType.DECENTRALIZED, bytes32(0)
        );

        vm.prank(provider2);
        registry.registerProvider{value: 0.1 ether}(
            "Provider 2", "https://cdn2.jejunetwork.org", ICDNTypes.ProviderType.DECENTRALIZED, bytes32(0)
        );

        address[] memory active = registry.getActiveProviders();
        assertEq(active.length, 2);
    }

    function test_GetNodesInRegion() public {
        vm.prank(provider1);
        registry.registerEdgeNode{value: 0.01 ether}(
            "edge1.us-east.jejunetwork.org:443", ICDNTypes.Region.US_EAST_1, ICDNTypes.ProviderType.DECENTRALIZED
        );

        vm.prank(provider1);
        registry.registerEdgeNode{value: 0.01 ether}(
            "edge2.us-east.jejunetwork.org:443", ICDNTypes.Region.US_EAST_1, ICDNTypes.ProviderType.DECENTRALIZED
        );

        vm.prank(provider2);
        registry.registerEdgeNode{value: 0.01 ether}(
            "edge1.eu-west.jejunetwork.org:443", ICDNTypes.Region.EU_WEST_1, ICDNTypes.ProviderType.DECENTRALIZED
        );

        bytes32[] memory usEastNodes = registry.getNodesInRegion(ICDNTypes.Region.US_EAST_1);
        bytes32[] memory euWestNodes = registry.getNodesInRegion(ICDNTypes.Region.EU_WEST_1);

        assertEq(usEastNodes.length, 2);
        assertEq(euWestNodes.length, 1);
    }

    function test_GetOperatorNodes() public {
        vm.startPrank(provider1);
        bytes32 node1 = registry.registerEdgeNode{value: 0.01 ether}(
            "edge1.jejunetwork.org:443", ICDNTypes.Region.US_EAST_1, ICDNTypes.ProviderType.DECENTRALIZED
        );

        bytes32 node2 = registry.registerEdgeNode{value: 0.01 ether}(
            "edge2.jejunetwork.org:443", ICDNTypes.Region.US_WEST_1, ICDNTypes.ProviderType.DECENTRALIZED
        );
        vm.stopPrank();

        bytes32[] memory nodes = registry.getOperatorNodes(provider1);
        assertEq(nodes.length, 2);
        assertEq(nodes[0], node1);
        assertEq(nodes[1], node2);
    }

    // ============ Admin Functions Tests ============

    function test_VerifyProvider() public {
        vm.prank(provider1);
        registry.registerProvider{value: 0.1 ether}(
            "Provider 1", "https://cdn1.jejunetwork.org", ICDNTypes.ProviderType.DECENTRALIZED, bytes32(0)
        );

        vm.prank(owner);
        registry.verifyProvider(provider1);

        ICDNTypes.Provider memory provider = registry.getProvider(provider1);
        assertTrue(provider.verified);
    }

    function test_SlashProvider() public {
        vm.prank(provider1);
        registry.registerProvider{value: 1 ether}(
            "Provider 1", "https://cdn1.jejunetwork.org", ICDNTypes.ProviderType.DECENTRALIZED, bytes32(0)
        );

        uint256 ownerBalanceBefore = owner.balance;

        vm.prank(owner);
        registry.slashProvider(provider1, 0.5 ether, "SLA violation");

        ICDNTypes.Provider memory provider = registry.getProvider(provider1);
        assertEq(provider.stake, 0.5 ether);
        assertEq(owner.balance, ownerBalanceBefore + 0.5 ether);
    }

    function test_SetMinNodeStake() public {
        vm.prank(owner);
        registry.setMinNodeStake(0.1 ether);

        assertEq(registry.minNodeStake(), 0.1 ether);
    }
}
