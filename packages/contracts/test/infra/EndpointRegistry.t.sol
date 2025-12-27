// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {EndpointRegistry} from "../../src/infra/EndpointRegistry.sol";

contract EndpointRegistryTest is Test {
    EndpointRegistry public registry;

    address public owner = address(this);
    address public operator = address(0x1);
    address public user = address(0x2);

    bytes32 public rpcServiceId = keccak256("rpc");
    bytes32 public wsServiceId = keccak256("ws");

    function setUp() public {
        registry = new EndpointRegistry();
        registry.setOperator(operator, true);
    }

    // ============================================================================
    // Service Registration
    // ============================================================================

    function testDefaultServicesRegistered() public view {
        bytes32[] memory services = registry.getServices();
        assertGt(services.length, 0, "Should have default services");

        EndpointRegistry.ServiceInfo memory rpcInfo = registry.getServiceInfo(rpcServiceId);
        assertEq(rpcInfo.name, "RPC", "RPC service should be registered");
        assertTrue(rpcInfo.critical, "RPC should be critical");
    }

    function testRegisterNewService() public {
        bytes32 newServiceId = keccak256("custom");
        registry.registerService(newServiceId, "Custom", "Custom service", false, 1);

        EndpointRegistry.ServiceInfo memory info = registry.getServiceInfo(newServiceId);
        assertEq(info.name, "Custom");
        assertFalse(info.critical);
    }

    function testOnlyOwnerCanRegisterService() public {
        bytes32 newServiceId = keccak256("custom");

        vm.prank(user);
        vm.expectRevert();
        registry.registerService(newServiceId, "Custom", "Custom service", false, 1);
    }

    // ============================================================================
    // Endpoint Management
    // ============================================================================

    function testAddEndpoint() public {
        registry.addEndpoint(rpcServiceId, "https://rpc.jejunetwork.org", "aws-us-east-1", 0);

        EndpointRegistry.Endpoint[] memory endpoints = registry.getEndpoints(rpcServiceId);
        assertEq(endpoints.length, 1);
        assertEq(endpoints[0].url, "https://rpc.jejunetwork.org");
        assertEq(endpoints[0].region, "aws-us-east-1");
        assertEq(endpoints[0].priority, 0);
        assertTrue(endpoints[0].active);
    }

    function testAddMultipleEndpoints() public {
        registry.addEndpoint(rpcServiceId, "https://rpc1.jejunetwork.org", "aws-us-east-1", 0);
        registry.addEndpoint(rpcServiceId, "https://rpc2.jejunetwork.org", "gcp-us-central1", 1);
        registry.addEndpoint(rpcServiceId, "https://rpc3.jejunetwork.org", "aws-eu-west-1", 2);

        EndpointRegistry.Endpoint[] memory endpoints = registry.getEndpoints(rpcServiceId);
        assertEq(endpoints.length, 3);
    }

    function testCannotAddDuplicateEndpoint() public {
        registry.addEndpoint(rpcServiceId, "https://rpc.jejunetwork.org", "aws-us-east-1", 0);

        vm.expectRevert(EndpointRegistry.EndpointAlreadyExists.selector);
        registry.addEndpoint(rpcServiceId, "https://rpc.jejunetwork.org", "aws-us-east-1", 1);
    }

    function testCannotAddEmptyUrl() public {
        vm.expectRevert(EndpointRegistry.InvalidUrl.selector);
        registry.addEndpoint(rpcServiceId, "", "aws-us-east-1", 0);
    }

    function testCannotAddToNonexistentService() public {
        bytes32 fakeService = keccak256("fake");

        vm.expectRevert(EndpointRegistry.ServiceNotFound.selector);
        registry.addEndpoint(fakeService, "https://example.com", "global", 0);
    }

    function testRemoveEndpoint() public {
        registry.addEndpoint(rpcServiceId, "https://rpc1.jejunetwork.org", "aws-us-east-1", 0);
        registry.addEndpoint(rpcServiceId, "https://rpc2.jejunetwork.org", "gcp-us-central1", 1);

        registry.removeEndpoint(rpcServiceId, "https://rpc1.jejunetwork.org");

        EndpointRegistry.Endpoint[] memory endpoints = registry.getEndpoints(rpcServiceId);
        assertEq(endpoints.length, 1);
        assertEq(endpoints[0].url, "https://rpc2.jejunetwork.org");
    }

    function testUpdateEndpoint() public {
        registry.addEndpoint(rpcServiceId, "https://rpc.jejunetwork.org", "aws-us-east-1", 0);

        registry.updateEndpoint(rpcServiceId, "https://rpc.jejunetwork.org", 5, false);

        EndpointRegistry.Endpoint[] memory endpoints = registry.getEndpoints(rpcServiceId);
        assertEq(endpoints[0].priority, 5);
        assertFalse(endpoints[0].active);
    }

    // ============================================================================
    // Health Updates
    // ============================================================================

    function testOperatorCanUpdateHealth() public {
        registry.addEndpoint(rpcServiceId, "https://rpc.jejunetwork.org", "aws-us-east-1", 0);

        vm.prank(operator);
        registry.updateHealth(rpcServiceId, "https://rpc.jejunetwork.org", 50, true);

        EndpointRegistry.Endpoint[] memory endpoints = registry.getEndpoints(rpcServiceId);
        assertEq(endpoints[0].responseTimeMs, 50);
        assertTrue(endpoints[0].active);
    }

    function testOwnerCanUpdateHealth() public {
        registry.addEndpoint(rpcServiceId, "https://rpc.jejunetwork.org", "aws-us-east-1", 0);

        registry.updateHealth(rpcServiceId, "https://rpc.jejunetwork.org", 100, true);

        EndpointRegistry.Endpoint[] memory endpoints = registry.getEndpoints(rpcServiceId);
        assertEq(endpoints[0].responseTimeMs, 100);
    }

    function testUnauthorizedCannotUpdateHealth() public {
        registry.addEndpoint(rpcServiceId, "https://rpc.jejunetwork.org", "aws-us-east-1", 0);

        vm.prank(user);
        vm.expectRevert(EndpointRegistry.UnauthorizedOperator.selector);
        registry.updateHealth(rpcServiceId, "https://rpc.jejunetwork.org", 50, true);
    }

    function testBatchUpdateHealth() public {
        registry.addEndpoint(rpcServiceId, "https://rpc1.jejunetwork.org", "aws-us-east-1", 0);
        registry.addEndpoint(rpcServiceId, "https://rpc2.jejunetwork.org", "gcp-us-central1", 1);

        bytes32[] memory serviceIds = new bytes32[](2);
        serviceIds[0] = rpcServiceId;
        serviceIds[1] = rpcServiceId;

        string[] memory urls = new string[](2);
        urls[0] = "https://rpc1.jejunetwork.org";
        urls[1] = "https://rpc2.jejunetwork.org";

        uint256[] memory responseTimes = new uint256[](2);
        responseTimes[0] = 50;
        responseTimes[1] = 100;

        bool[] memory healthy = new bool[](2);
        healthy[0] = true;
        healthy[1] = true;

        vm.prank(operator);
        registry.batchUpdateHealth(serviceIds, urls, responseTimes, healthy);

        EndpointRegistry.Endpoint[] memory endpoints = registry.getEndpoints(rpcServiceId);
        assertEq(endpoints[0].responseTimeMs, 50);
        assertEq(endpoints[1].responseTimeMs, 100);
    }

    // ============================================================================
    // Query Functions
    // ============================================================================

    function testGetActiveEndpoints() public {
        registry.addEndpoint(rpcServiceId, "https://rpc1.jejunetwork.org", "aws-us-east-1", 2);
        registry.addEndpoint(rpcServiceId, "https://rpc2.jejunetwork.org", "gcp-us-central1", 0);
        registry.addEndpoint(rpcServiceId, "https://rpc3.jejunetwork.org", "aws-eu-west-1", 1);

        // Deactivate one
        registry.updateEndpoint(rpcServiceId, "https://rpc3.jejunetwork.org", 1, false);

        EndpointRegistry.Endpoint[] memory active = registry.getActiveEndpoints(rpcServiceId);
        assertEq(active.length, 2);

        // Should be sorted by priority
        assertEq(active[0].priority, 0);
        assertEq(active[1].priority, 2);
    }

    function testGetEndpointsByRegion() public {
        registry.addEndpoint(rpcServiceId, "https://rpc1.jejunetwork.org", "aws-us-east-1", 0);
        registry.addEndpoint(rpcServiceId, "https://rpc2.jejunetwork.org", "aws-us-east-1", 1);
        registry.addEndpoint(rpcServiceId, "https://rpc3.jejunetwork.org", "gcp-us-central1", 0);

        EndpointRegistry.Endpoint[] memory awsEndpoints = registry.getEndpointsByRegion(rpcServiceId, "aws-us-east-1");
        assertEq(awsEndpoints.length, 2);

        EndpointRegistry.Endpoint[] memory gcpEndpoints = registry.getEndpointsByRegion(rpcServiceId, "gcp-us-central1");
        assertEq(gcpEndpoints.length, 1);
    }

    function testGetBestEndpoint() public {
        registry.addEndpoint(rpcServiceId, "https://rpc1.jejunetwork.org", "aws-us-east-1", 1);
        registry.addEndpoint(rpcServiceId, "https://rpc2.jejunetwork.org", "gcp-us-central1", 0);
        registry.addEndpoint(rpcServiceId, "https://rpc3.jejunetwork.org", "aws-eu-west-1", 0);

        // Update health - rpc3 is faster
        registry.updateHealth(rpcServiceId, "https://rpc2.jejunetwork.org", 100, true);
        registry.updateHealth(rpcServiceId, "https://rpc3.jejunetwork.org", 50, true);

        (string memory url, string memory region, uint256 responseTime) = registry.getBestEndpoint(rpcServiceId);

        // Should return rpc3 (same priority 0, but lower response time)
        assertEq(url, "https://rpc3.jejunetwork.org");
        assertEq(region, "aws-eu-west-1");
        assertEq(responseTime, 50);
    }

    function testEndpointExists() public {
        registry.addEndpoint(rpcServiceId, "https://rpc.jejunetwork.org", "aws-us-east-1", 0);

        assertTrue(registry.endpointExists(rpcServiceId, "https://rpc.jejunetwork.org"));
        assertFalse(registry.endpointExists(rpcServiceId, "https://nonexistent.com"));
    }

    function testGetEndpointCount() public {
        assertEq(registry.getEndpointCount(rpcServiceId), 0);

        registry.addEndpoint(rpcServiceId, "https://rpc1.jejunetwork.org", "aws-us-east-1", 0);
        registry.addEndpoint(rpcServiceId, "https://rpc2.jejunetwork.org", "gcp-us-central1", 1);

        assertEq(registry.getEndpointCount(rpcServiceId), 2);
    }

    // ============================================================================
    // Regions
    // ============================================================================

    function testDefaultRegions() public view {
        string[] memory regions = registry.getRegions();
        assertGt(regions.length, 0, "Should have default regions");
    }

    function testAddRegion() public {
        registry.addRegion("custom-region");

        string[] memory regions = registry.getRegions();
        bool found = false;
        for (uint256 i = 0; i < regions.length; i++) {
            if (keccak256(bytes(regions[i])) == keccak256(bytes("custom-region"))) {
                found = true;
                break;
            }
        }
        assertTrue(found, "Custom region should be added");
    }

    // ============================================================================
    // Operator Management
    // ============================================================================

    function testSetOperator() public {
        address newOperator = address(0x3);
        assertFalse(registry.healthOperators(newOperator));

        registry.setOperator(newOperator, true);
        assertTrue(registry.healthOperators(newOperator));

        registry.setOperator(newOperator, false);
        assertFalse(registry.healthOperators(newOperator));
    }

    function testOnlyOwnerCanSetOperator() public {
        vm.prank(user);
        vm.expectRevert();
        registry.setOperator(address(0x3), true);
    }
}
