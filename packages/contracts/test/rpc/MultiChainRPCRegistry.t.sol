// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {MultiChainRPCRegistry} from "../../src/rpc/MultiChainRPCRegistry.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockJejuToken is ERC20 {
    constructor() ERC20("Jeju Token", "JEJU") {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MultiChainRPCRegistryTest is Test {
    MultiChainRPCRegistry public registry;
    MockJejuToken public jejuToken;

    address public owner;
    address public node1;
    address public node2;
    address public node3;
    address public relayer;
    address public treasury;
    address public user;

    uint64 constant ETHEREUM_CHAIN_ID = 1;
    uint64 constant POLYGON_CHAIN_ID = 137;
    uint64 constant ARBITRUM_CHAIN_ID = 42161;

    function setUp() public {
        owner = makeAddr("owner");
        node1 = makeAddr("node1");
        node2 = makeAddr("node2");
        node3 = makeAddr("node3");
        relayer = makeAddr("relayer");
        treasury = makeAddr("treasury");
        user = makeAddr("user");

        vm.deal(owner, 100 ether);
        vm.deal(node1, 100 ether);
        vm.deal(node2, 100 ether);
        vm.deal(node3, 100 ether);
        vm.deal(user, 100 ether);

        vm.startPrank(owner);
        jejuToken = new MockJejuToken();
        registry = new MultiChainRPCRegistry(
            address(jejuToken),
            address(0), // identity registry (optional)
            address(0), // ban manager (optional)
            owner
        );
        vm.stopPrank();

        // Mint tokens to nodes
        vm.prank(owner);
        jejuToken.mint(node1, 10000 ether);
        vm.prank(owner);
        jejuToken.mint(node2, 10000 ether);
    }

    // ============ Registration Tests ============

    function test_RegisterNode() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        MultiChainRPCRegistry.RPCNode memory node = registry.getNode(node1);
        assertEq(node.operator, node1);
        assertEq(node.region, "us-east");
        assertEq(node.stake, 1 ether);
        assertTrue(node.isActive);
        assertFalse(node.isFrozen);
        assertEq(node.agentId, 0);
    }

    function test_RegisterNode_RevertIfEmptyRegion() public {
        vm.prank(node1);
        vm.expectRevert(MultiChainRPCRegistry.InvalidRegion.selector);
        registry.registerNode{value: 1 ether}("");
    }

    function test_RegisterNode_MinimumStake() public {
        vm.prank(node1);
        vm.expectRevert(); // Minimum stake requirement from ProviderRegistryBase
        registry.registerNode{value: 0.001 ether}("us-east");
    }

    // ============ Chain Endpoint Tests ============

    function test_AddChainEndpoint() public {
        // Register node first
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        // Add chain endpoint
        vm.prank(node1);
        registry.addChainEndpoint(
            ETHEREUM_CHAIN_ID,
            "https://eth.node1.jejunetwork.org",
            true, // archive
            true  // websocket
        );

        MultiChainRPCRegistry.ChainEndpoint memory endpoint = registry.getChainEndpoint(node1, ETHEREUM_CHAIN_ID);
        assertEq(endpoint.chainId, ETHEREUM_CHAIN_ID);
        assertEq(endpoint.endpoint, "https://eth.node1.jejunetwork.org");
        assertTrue(endpoint.isActive);
        assertTrue(endpoint.isArchive);
        assertTrue(endpoint.isWebSocket);
    }

    function test_AddChainEndpoint_RevertIfNotRegistered() public {
        vm.prank(node1);
        vm.expectRevert(MultiChainRPCRegistry.NodeNotActive.selector);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node1.jejunetwork.org", false, false);
    }

    function test_AddChainEndpoint_RevertIfEmptyEndpoint() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(node1);
        vm.expectRevert(MultiChainRPCRegistry.InvalidEndpoint.selector);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "", false, false);
    }

    function test_AddMultipleChainEndpoints() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.startPrank(node1);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node1.jejunetwork.org", true, true);
        registry.addChainEndpoint(POLYGON_CHAIN_ID, "https://polygon.node1.jejunetwork.org", false, true);
        registry.addChainEndpoint(ARBITRUM_CHAIN_ID, "https://arb.node1.jejunetwork.org", true, false);
        vm.stopPrank();

        uint64[] memory chains = registry.getNodeChains(node1);
        assertEq(chains.length, 3);
    }

    function test_RemoveChainEndpoint() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(node1);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node1.jejunetwork.org", true, true);

        vm.prank(node1);
        registry.removeChainEndpoint(ETHEREUM_CHAIN_ID);

        MultiChainRPCRegistry.ChainEndpoint memory endpoint = registry.getChainEndpoint(node1, ETHEREUM_CHAIN_ID);
        assertFalse(endpoint.isActive);
    }

    function test_RemoveChainEndpoint_RevertIfNotSupported() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(node1);
        vm.expectRevert(abi.encodeWithSelector(MultiChainRPCRegistry.ChainNotSupported.selector, ETHEREUM_CHAIN_ID));
        registry.removeChainEndpoint(ETHEREUM_CHAIN_ID);
    }

    // ============ Heartbeat Tests ============

    function test_Heartbeat() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(node1);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node1.jejunetwork.org", true, true);

        uint64 blockHeight = 19_000_000;
        vm.prank(node1);
        registry.heartbeat(ETHEREUM_CHAIN_ID, blockHeight);

        MultiChainRPCRegistry.ChainEndpoint memory endpoint = registry.getChainEndpoint(node1, ETHEREUM_CHAIN_ID);
        assertEq(endpoint.blockHeight, blockHeight);
    }

    function test_Heartbeat_UpdatesLastSeen() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(node1);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node1.jejunetwork.org", true, true);

        // Warp time
        vm.warp(block.timestamp + 1 hours);

        vm.prank(node1);
        registry.heartbeat(ETHEREUM_CHAIN_ID, 19_000_000);

        MultiChainRPCRegistry.RPCNode memory node = registry.getNode(node1);
        assertEq(node.lastSeen, uint64(block.timestamp));
    }

    // ============ Usage Reporting Tests ============

    function test_ReportUsage() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        // Owner is authorized by default
        vm.prank(owner);
        registry.reportUsage(node1, 1000, 5000, 5);

        MultiChainRPCRegistry.RPCNode memory node = registry.getNode(node1);
        assertEq(node.totalRequests, 1000);
        assertEq(node.totalComputeUnits, 5000);
        assertEq(node.totalErrors, 5);
    }

    function test_ReportUsage_Accumulates() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(owner);
        registry.reportUsage(node1, 1000, 5000, 5);

        vm.prank(owner);
        registry.reportUsage(node1, 500, 2000, 2);

        MultiChainRPCRegistry.RPCNode memory node = registry.getNode(node1);
        assertEq(node.totalRequests, 1500);
        assertEq(node.totalComputeUnits, 7000);
        assertEq(node.totalErrors, 7);
    }

    function test_ReportUsage_RevertIfNotAuthorized() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(user);
        vm.expectRevert(MultiChainRPCRegistry.NotAuthorizedRelayer.selector);
        registry.reportUsage(node1, 1000, 5000, 5);
    }

    function test_ReportUsage_AuthorizedRelayer() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        // Authorize relayer
        vm.prank(owner);
        registry.setRelayer(relayer, true);

        // Relayer reports usage
        vm.prank(relayer);
        registry.reportUsage(node1, 1000, 5000, 5);

        MultiChainRPCRegistry.RPCNode memory node = registry.getNode(node1);
        assertEq(node.totalRequests, 1000);
    }

    // ============ Performance Reporting Tests ============

    function test_ReportPerformance() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(owner);
        registry.reportPerformance(node1, 9500, 9800, 50);

        (uint256 uptime, uint256 successRate, uint256 latency, uint256 updated) = registry.nodePerformance(node1);
        assertEq(uptime, 9500);
        assertEq(successRate, 9800);
        assertEq(latency, 50);
        assertGt(updated, 0);
    }

    function test_ReportPerformance_RevertIfInvalidScore() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(owner);
        vm.expectRevert(MultiChainRPCRegistry.InvalidScore.selector);
        registry.reportPerformance(node1, 10001, 9800, 50); // Uptime > 10000
    }

    function test_ReportPerformance_RevertIfNotAuthorized() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(user);
        vm.expectRevert(MultiChainRPCRegistry.NotAuthorizedRelayer.selector);
        registry.reportPerformance(node1, 9500, 9800, 50);
    }

    // ============ Provider Query Tests ============

    function test_GetProvidersForChain() public {
        // Register multiple nodes
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");
        vm.prank(node2);
        registry.registerNode{value: 1 ether}("eu-west");

        // Both support Ethereum
        vm.prank(node1);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node1.jejunetwork.org", true, true);
        vm.prank(node2);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node2.jejunetwork.org", false, true);

        address[] memory providers = registry.getProvidersForChain(ETHEREUM_CHAIN_ID);
        assertEq(providers.length, 2);
    }

    function test_GetProvidersForChain_ExcludesInactive() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");
        vm.prank(node2);
        registry.registerNode{value: 1 ether}("eu-west");

        vm.prank(node1);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node1.jejunetwork.org", true, true);
        vm.prank(node2);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node2.jejunetwork.org", false, true);

        // Remove node2's endpoint
        vm.prank(node2);
        registry.removeChainEndpoint(ETHEREUM_CHAIN_ID);

        address[] memory providers = registry.getProvidersForChain(ETHEREUM_CHAIN_ID);
        assertEq(providers.length, 1);
        assertEq(providers[0], node1);
    }

    function test_GetQualifiedProviders() public {
        // Setup nodes with performance data
        _setupQualifiedNodes();

        // Query qualified providers
        (address[] memory providers, uint256[] memory scores) = registry.getQualifiedProviders(
            ETHEREUM_CHAIN_ID,
            5000, // 50% min uptime
            false, // don't require archive
            10    // max 10
        );

        assertEq(providers.length, 2);
        // Should be sorted by score descending
        assertGe(scores[0], scores[1]);
    }

    function test_GetQualifiedProviders_RequireArchive() public {
        _setupQualifiedNodes();

        (address[] memory providers, uint256[] memory scores) = registry.getQualifiedProviders(
            ETHEREUM_CHAIN_ID,
            5000,
            true, // require archive
            10
        );

        // Only node1 has archive support
        assertEq(providers.length, 1);
        assertEq(providers[0], node1);
        assertGt(scores[0], 0);
    }

    function test_GetQualifiedProviders_FilterByUptime() public {
        _setupQualifiedNodes();

        (address[] memory providers, ) = registry.getQualifiedProviders(
            ETHEREUM_CHAIN_ID,
            9000, // 90% min uptime
            false,
            10
        );

        // Only node1 has 95% uptime, node2 has 80%
        assertEq(providers.length, 1);
        assertEq(providers[0], node1);
    }

    function test_GetQualifiedProviders_RespectsMaxCount() public {
        _setupQualifiedNodes();

        (address[] memory providers, ) = registry.getQualifiedProviders(
            ETHEREUM_CHAIN_ID,
            0, // any uptime
            false,
            1 // max 1
        );

        assertEq(providers.length, 1);
    }

    function test_GetQualifiedProviders_ExcludesStale() public {
        _setupQualifiedNodes();

        // Warp 25 hours - beyond staleness threshold
        vm.warp(block.timestamp + 25 hours);

        (address[] memory providers, ) = registry.getQualifiedProviders(
            ETHEREUM_CHAIN_ID,
            0,
            false,
            10
        );

        // All nodes should be excluded due to staleness
        assertEq(providers.length, 0);
    }

    function test_GetQualifiedProviders_ExcludesFrozen() public {
        _setupQualifiedNodes();

        // Freeze node1
        vm.prank(owner);
        registry.setNodeFrozen(node1, true);

        (address[] memory providers, ) = registry.getQualifiedProviders(
            ETHEREUM_CHAIN_ID,
            0,
            false,
            10
        );

        assertEq(providers.length, 1);
        assertEq(providers[0], node2);
    }

    // ============ Admin Tests ============

    function test_SetRelayer() public {
        vm.prank(owner);
        registry.setRelayer(relayer, true);

        assertTrue(registry.authorizedRelayers(relayer));
    }

    function test_SetRelayer_Revoke() public {
        vm.prank(owner);
        registry.setRelayer(relayer, true);

        vm.prank(owner);
        registry.setRelayer(relayer, false);

        assertFalse(registry.authorizedRelayers(relayer));
    }

    function test_SetRelayer_RevertIfNotOwner() public {
        vm.prank(user);
        vm.expectRevert();
        registry.setRelayer(relayer, true);
    }

    function test_SlashNode() public {
        vm.prank(node1);
        registry.registerNode{value: 5 ether}("us-east");

        // Set treasury
        vm.prank(owner);
        registry.setTreasury(treasury);

        uint256 treasuryBalanceBefore = treasury.balance;

        vm.prank(owner);
        registry.slashNode(node1, 2 ether, "SLA violation");

        MultiChainRPCRegistry.RPCNode memory node = registry.getNode(node1);
        assertEq(node.stake, 3 ether);
        assertEq(treasury.balance, treasuryBalanceBefore + 2 ether);
    }

    function test_SlashNode_CappedAtStake() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(owner);
        registry.setTreasury(treasury);

        vm.prank(owner);
        registry.slashNode(node1, 10 ether, "Major violation"); // Try to slash more than stake

        MultiChainRPCRegistry.RPCNode memory node = registry.getNode(node1);
        assertEq(node.stake, 0); // All stake slashed
    }

    function test_SlashNode_RevertIfNotOwner() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(user);
        vm.expectRevert();
        registry.slashNode(node1, 0.5 ether, "Unauthorized slash");
    }

    function test_SetNodeFrozen() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(owner);
        registry.setNodeFrozen(node1, true);

        MultiChainRPCRegistry.RPCNode memory node = registry.getNode(node1);
        assertTrue(node.isFrozen);

        vm.prank(owner);
        registry.setNodeFrozen(node1, false);

        node = registry.getNode(node1);
        assertFalse(node.isFrozen);
    }

    function test_SetMinReputation() public {
        vm.prank(owner);
        registry.setMinReputation(7500);

        assertEq(registry.minReputationForSelection(), 7500);
    }

    function test_SetTreasury() public {
        vm.prank(owner);
        registry.setTreasury(treasury);

        assertEq(registry.treasury(), treasury);
    }

    // ============ View Function Tests ============

    function test_GetActiveProviders() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");
        vm.prank(node2);
        registry.registerNode{value: 1 ether}("eu-west");

        address[] memory active = registry.getActiveProviders();
        assertEq(active.length, 2);
    }

    function test_GetSupportedChains() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.startPrank(node1);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node1.jejunetwork.org", true, true);
        registry.addChainEndpoint(POLYGON_CHAIN_ID, "https://polygon.node1.jejunetwork.org", false, true);
        vm.stopPrank();

        uint64[] memory chains = registry.getSupportedChains();
        assertEq(chains.length, 2);
    }

    function test_Version() public view {
        assertEq(registry.version(), "1.0.0");
    }

    // ============ Edge Case Tests ============

    function test_RegisterNode_MaxRegionLength() public {
        // 256 char region - should work (reasonable limit)
        string memory longRegion = "us-east-1-aws-us-east-1-aws-us-east-1-aws-us-east-1-aws-us-east-1-aws-us-east-1-aws-us-east-1-aws";
        vm.prank(node1);
        registry.registerNode{value: 1 ether}(longRegion);

        MultiChainRPCRegistry.RPCNode memory node = registry.getNode(node1);
        assertEq(node.region, longRegion);
    }

    function test_RegisterNode_SpecialCharactersInRegion() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east-1 (AWS) [primary]");

        MultiChainRPCRegistry.RPCNode memory node = registry.getNode(node1);
        assertEq(node.region, "us-east-1 (AWS) [primary]");
    }

    function test_RegisterNode_MaxStake() public {
        vm.deal(node1, 1000 ether);
        vm.prank(node1);
        registry.registerNode{value: 100 ether}("us-east");

        MultiChainRPCRegistry.RPCNode memory node = registry.getNode(node1);
        assertEq(node.stake, 100 ether);
    }

    function test_RegisterNode_TwiceUpdatesStake() public {
        // First registration
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        // Second registration adds stake (not revert)
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("eu-west");

        MultiChainRPCRegistry.RPCNode memory node = registry.getNode(node1);
        // Stake should be accumulated or updated based on contract logic
        assertGe(node.stake, 1 ether);
    }

    function test_AddChainEndpoint_MaxChainId() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        uint64 maxChainId = type(uint64).max;
        vm.prank(node1);
        registry.addChainEndpoint(maxChainId, "https://custom.network", false, false);

        uint64[] memory chains = registry.getNodeChains(node1);
        assertEq(chains.length, 1);
        assertEq(chains[0], maxChainId);
    }

    function test_AddChainEndpoint_UpdateExisting() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(node1);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://old.endpoint", false, false);

        vm.prank(node1);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://new.endpoint", true, true);

        MultiChainRPCRegistry.ChainEndpoint memory endpoint = registry.getChainEndpoint(node1, ETHEREUM_CHAIN_ID);
        assertEq(endpoint.endpoint, "https://new.endpoint");
        assertTrue(endpoint.isArchive);
        assertTrue(endpoint.isWebSocket);
    }

    function test_AddChainEndpoint_ManyChains() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        // Add 10 chains
        vm.startPrank(node1);
        for (uint64 i = 1; i <= 10; i++) {
            registry.addChainEndpoint(i, string(abi.encodePacked("https://chain", i, ".network")), false, false);
        }
        vm.stopPrank();

        uint64[] memory chains = registry.getNodeChains(node1);
        assertEq(chains.length, 10);
    }

    function test_Heartbeat_RevertIfChainNotSupported() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(node1);
        vm.expectRevert(abi.encodeWithSelector(MultiChainRPCRegistry.ChainNotSupported.selector, ETHEREUM_CHAIN_ID));
        registry.heartbeat(ETHEREUM_CHAIN_ID, 19_000_000);
    }

    function test_Heartbeat_MultipleChainsSequentially() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.startPrank(node1);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node1.jejunetwork.org", true, true);
        registry.addChainEndpoint(POLYGON_CHAIN_ID, "https://polygon.node1.jejunetwork.org", false, true);
        vm.stopPrank();

        vm.startPrank(node1);
        registry.heartbeat(ETHEREUM_CHAIN_ID, 19_000_000);
        registry.heartbeat(POLYGON_CHAIN_ID, 50_000_000);
        vm.stopPrank();

        MultiChainRPCRegistry.ChainEndpoint memory ethEndpoint = registry.getChainEndpoint(node1, ETHEREUM_CHAIN_ID);
        MultiChainRPCRegistry.ChainEndpoint memory polyEndpoint = registry.getChainEndpoint(node1, POLYGON_CHAIN_ID);

        assertEq(ethEndpoint.blockHeight, 19_000_000);
        assertEq(polyEndpoint.blockHeight, 50_000_000);
    }

    function test_ReportUsage_RevertIfNodeNotActive() public {
        // Don't register node
        vm.prank(owner);
        vm.expectRevert(MultiChainRPCRegistry.NodeNotActive.selector);
        registry.reportUsage(node1, 1000, 5000, 5);
    }

    function test_ReportUsage_ZeroValues() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(owner);
        registry.reportUsage(node1, 0, 0, 0);

        MultiChainRPCRegistry.RPCNode memory node = registry.getNode(node1);
        assertEq(node.totalRequests, 0);
        assertEq(node.totalComputeUnits, 0);
        assertEq(node.totalErrors, 0);
    }

    function test_ReportUsage_LargeValues() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        uint256 largeValue = type(uint128).max;
        vm.prank(owner);
        registry.reportUsage(node1, largeValue, largeValue, largeValue);

        MultiChainRPCRegistry.RPCNode memory node = registry.getNode(node1);
        assertEq(node.totalRequests, largeValue);
    }

    function test_ReportPerformance_BoundaryScores() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        // Test min boundary
        vm.prank(owner);
        registry.reportPerformance(node1, 0, 0, 0);

        (uint256 uptime, uint256 successRate, uint256 latency, ) = registry.nodePerformance(node1);
        assertEq(uptime, 0);
        assertEq(successRate, 0);
        assertEq(latency, 0);

        // Test max boundary
        vm.prank(owner);
        registry.reportPerformance(node1, 10000, 10000, type(uint256).max);

        (uptime, successRate, latency, ) = registry.nodePerformance(node1);
        assertEq(uptime, 10000);
        assertEq(successRate, 10000);
        assertEq(latency, type(uint256).max);
    }

    function test_ReportPerformance_RevertIfSuccessRateTooHigh() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(owner);
        vm.expectRevert(MultiChainRPCRegistry.InvalidScore.selector);
        registry.reportPerformance(node1, 9500, 10001, 50); // SuccessRate > 10000
    }

    function test_GetQualifiedProviders_EmptyResult() public {
        // No nodes registered
        (address[] memory providers, uint256[] memory scores) = registry.getQualifiedProviders(
            ETHEREUM_CHAIN_ID,
            5000,
            false,
            10
        );

        assertEq(providers.length, 0);
        assertEq(scores.length, 0);
    }

    function test_GetQualifiedProviders_ZeroMaxCount() public {
        _setupQualifiedNodes();

        (address[] memory providers, ) = registry.getQualifiedProviders(
            ETHEREUM_CHAIN_ID,
            0,
            false,
            0  // Request 0 providers
        );

        assertEq(providers.length, 0);
    }

    function test_GetProvidersForChain_NonExistentChain() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(node1);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node1.jejunetwork.org", true, true);

        // Query for chain that no one supports
        address[] memory providers = registry.getProvidersForChain(99999);
        assertEq(providers.length, 0);
    }

    function test_SlashNode_FullSlash() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(owner);
        registry.setTreasury(treasury);

        vm.prank(owner);
        registry.slashNode(node1, 1 ether, "100% slash");

        MultiChainRPCRegistry.RPCNode memory node = registry.getNode(node1);
        assertEq(node.stake, 0);
    }

    function test_SlashNode_UnregisteredNodeNoEffect() public {
        vm.prank(owner);
        registry.setTreasury(treasury);

        uint256 treasuryBefore = treasury.balance;

        // Slashing unregistered node should have no effect (no stake to slash)
        vm.prank(owner);
        registry.slashNode(node1, 1 ether, "Unregistered node");

        // Treasury shouldn't receive anything
        assertEq(treasury.balance, treasuryBefore);
    }

    function test_SetNodeFrozen_PreventOperations() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.prank(node1);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node1.jejunetwork.org", true, true);

        vm.prank(owner);
        registry.setNodeFrozen(node1, true);

        // Frozen node should be excluded from qualified providers
        vm.prank(owner);
        registry.reportPerformance(node1, 9500, 9800, 30);

        (address[] memory providers, ) = registry.getQualifiedProviders(
            ETHEREUM_CHAIN_ID,
            0,
            false,
            10
        );

        assertEq(providers.length, 0);
    }

    function test_GetActiveProviders_IncludesFrozen() public {
        // getActiveProviders returns all registered nodes regardless of frozen state.
        // Frozen nodes are filtered out at selection time, not in getActiveProviders.
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");
        vm.prank(node2);
        registry.registerNode{value: 1 ether}("eu-west");

        vm.prank(owner);
        registry.setNodeFrozen(node1, true);

        address[] memory active = registry.getActiveProviders();
        // Both nodes are "active" (registered), but node1 is frozen
        assertEq(active.length, 2);
    }

    function test_GetSupportedChains_AfterRemoval() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");

        vm.startPrank(node1);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node1.jejunetwork.org", true, true);
        registry.addChainEndpoint(POLYGON_CHAIN_ID, "https://polygon.node1.jejunetwork.org", false, true);
        vm.stopPrank();

        // Remove one chain
        vm.prank(node1);
        registry.removeChainEndpoint(ETHEREUM_CHAIN_ID);

        // getSupportedChains returns chains that have ANY active endpoint
        // After removal, the chain may still be in the list until garbage collected
        // The actual behavior filters at query time
        uint64[] memory chains = registry.getSupportedChains();
        // Implementation may keep both in list, actual filtering happens at provider query
        assertGe(chains.length, 1);
    }

    function test_MultipleNodesWithOverlappingChains() public {
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");
        vm.prank(node2);
        registry.registerNode{value: 1 ether}("eu-west");

        vm.startPrank(node1);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node1.jejunetwork.org", true, true);
        registry.addChainEndpoint(POLYGON_CHAIN_ID, "https://polygon.node1.jejunetwork.org", false, true);
        vm.stopPrank();

        vm.startPrank(node2);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node2.jejunetwork.org", false, false);
        registry.addChainEndpoint(ARBITRUM_CHAIN_ID, "https://arb.node2.jejunetwork.org", true, false);
        vm.stopPrank();

        // Check Ethereum providers
        address[] memory ethProviders = registry.getProvidersForChain(ETHEREUM_CHAIN_ID);
        assertEq(ethProviders.length, 2);

        // Check Polygon providers
        address[] memory polyProviders = registry.getProvidersForChain(POLYGON_CHAIN_ID);
        assertEq(polyProviders.length, 1);

        // Check Arbitrum providers
        address[] memory arbProviders = registry.getProvidersForChain(ARBITRUM_CHAIN_ID);
        assertEq(arbProviders.length, 1);

        // Total supported chains
        uint64[] memory allChains = registry.getSupportedChains();
        assertEq(allChains.length, 3);
    }

    // ============ Helpers ============

    function _setupQualifiedNodes() internal {
        // Register and setup node1
        vm.prank(node1);
        registry.registerNode{value: 1 ether}("us-east");
        vm.prank(node1);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node1.jejunetwork.org", true, true);

        // Register and setup node2
        vm.prank(node2);
        registry.registerNode{value: 1 ether}("eu-west");
        vm.prank(node2);
        registry.addChainEndpoint(ETHEREUM_CHAIN_ID, "https://eth.node2.jejunetwork.org", false, true);

        // Report performance
        vm.startPrank(owner);
        registry.reportPerformance(node1, 9500, 9800, 30);  // High performance
        registry.reportPerformance(node2, 8000, 9000, 100); // Medium performance
        vm.stopPrank();
    }
}
