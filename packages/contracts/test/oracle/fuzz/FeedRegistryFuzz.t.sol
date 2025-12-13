// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FeedRegistry} from "../../../src/oracle/FeedRegistry.sol";
import {IFeedRegistry} from "../../../src/oracle/interfaces/IFeedRegistry.sol";

/// @title FeedRegistry Fuzz Tests
/// @notice Comprehensive fuzz testing for FeedRegistry edge cases and boundaries
contract FeedRegistryFuzzTest is Test {
    FeedRegistry public registry;
    address public owner = address(0x1);

    function setUp() public {
        vm.prank(owner);
        registry = new FeedRegistry(owner);
    }

    // ==================== Feed Creation Fuzz Tests ====================

    function testFuzz_CreateFeed_ValidParams(
        uint8 decimals,
        uint32 heartbeatSeconds,
        uint32 twapWindowSeconds,
        uint16 maxDeviationBps,
        uint8 minOracles,
        uint8 quorumThreshold,
        uint8 categoryRaw
    ) public {
        // Bound inputs to valid ranges
        decimals = uint8(bound(decimals, 1, 18));
        heartbeatSeconds = uint32(bound(heartbeatSeconds, 60, 86400)); // 1 min to 1 day
        twapWindowSeconds = uint32(bound(twapWindowSeconds, 60, 7200)); // 1 min to 2 hours
        maxDeviationBps = uint16(bound(maxDeviationBps, 10, 1000)); // 0.1% to 10%
        minOracles = uint8(bound(minOracles, 1, 21));
        quorumThreshold = uint8(bound(quorumThreshold, 1, minOracles));
        categoryRaw = uint8(bound(categoryRaw, 0, 7)); // Valid category range (0-7)

        IFeedRegistry.FeedCategory category = IFeedRegistry.FeedCategory(categoryRaw);

        // Generate unique symbol
        string memory symbol = string(abi.encodePacked("TEST-", vm.toString(block.timestamp)));

        IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
            symbol: symbol,
            baseToken: address(uint160(uint256(keccak256(abi.encodePacked("base", block.timestamp))))),
            quoteToken: address(uint160(uint256(keccak256(abi.encodePacked("quote", block.timestamp))))),
            decimals: decimals,
            heartbeatSeconds: heartbeatSeconds,
            twapWindowSeconds: twapWindowSeconds,
            minLiquidityUSD: 1000 ether,
            maxDeviationBps: maxDeviationBps,
            minOracles: minOracles,
            quorumThreshold: quorumThreshold,
            requiresConfidence: true,
            category: category
        });

        vm.prank(owner);
        bytes32 feedId = registry.createFeed(params);

        // Verify feed was created
        assertTrue(registry.feedExists(feedId));
        assertTrue(registry.isFeedActive(feedId));

        // Verify stored parameters
        IFeedRegistry.FeedSpec memory spec = registry.getFeed(feedId);
        assertEq(spec.decimals, decimals);
        assertEq(spec.heartbeatSeconds, heartbeatSeconds);
        assertEq(spec.minOracles, minOracles);
        assertEq(spec.quorumThreshold, quorumThreshold);
    }

    function testFuzz_CreateFeed_SymbolLength(uint8 symbolLength) public {
        // Test various symbol lengths
        symbolLength = uint8(bound(symbolLength, 1, 64));

        bytes memory symbolBytes = new bytes(symbolLength);
        for (uint256 i = 0; i < symbolLength; i++) {
            symbolBytes[i] = bytes1(uint8(65 + (i % 26))); // A-Z
        }
        string memory symbol = string(symbolBytes);

        IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
            symbol: symbol,
            baseToken: address(0x100),
            quoteToken: address(0x200),
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 1000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        vm.prank(owner);
        bytes32 feedId = registry.createFeed(params);
        assertTrue(registry.feedExists(feedId));
    }

    function testFuzz_CreateFeed_QuorumThresholdBounds(uint8 minOracles, uint8 quorumThreshold) public {
        minOracles = uint8(bound(minOracles, 1, 21));

        // Test that quorum > minOracles reverts
        if (quorumThreshold > minOracles) {
            IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
                symbol: "TEST-QUORUM",
                baseToken: address(0x100),
                quoteToken: address(0x200),
                decimals: 8,
                heartbeatSeconds: 3600,
                twapWindowSeconds: 1800,
                minLiquidityUSD: 1000 ether,
                maxDeviationBps: 100,
                minOracles: minOracles,
                quorumThreshold: quorumThreshold,
                requiresConfidence: true,
                category: IFeedRegistry.FeedCategory.SPOT_PRICE
            });

            vm.prank(owner);
            vm.expectRevert(IFeedRegistry.InvalidFeedParams.selector);
            registry.createFeed(params);
        }
    }

    // ==================== Feed Update Fuzz Tests ====================

    function testFuzz_UpdateFeed_HeartbeatBounds(uint32 newHeartbeat) public {
        // Create initial feed
        IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
            symbol: "ETH-USD",
            baseToken: address(0x100),
            quoteToken: address(0x200),
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 1000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        vm.prank(owner);
        bytes32 feedId = registry.createFeed(params);

        // Bound to valid heartbeat range
        newHeartbeat = uint32(bound(newHeartbeat, 60, 604800)); // 1 min to 1 week

        vm.prank(owner);
        registry.updateFeed(feedId, newHeartbeat, 1800, 1000 ether, 100);

        IFeedRegistry.FeedSpec memory spec = registry.getFeed(feedId);
        assertEq(spec.heartbeatSeconds, newHeartbeat);
    }

    function testFuzz_UpdateFeed_DeviationBounds(uint16 newDeviation) public {
        // Create initial feed
        IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
            symbol: "BTC-USD",
            baseToken: address(0x300),
            quoteToken: address(0x200),
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 1000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        vm.prank(owner);
        bytes32 feedId = registry.createFeed(params);

        // Bound deviation to valid range (0.01% to 50%)
        newDeviation = uint16(bound(newDeviation, 1, 5000));

        vm.prank(owner);
        registry.updateFeed(feedId, 3600, 1800, 1000 ether, newDeviation);

        IFeedRegistry.FeedSpec memory spec = registry.getFeed(feedId);
        assertEq(spec.maxDeviationBps, newDeviation);
    }

    // ==================== Batch Operations Fuzz Tests ====================

    function testFuzz_CreateFeedsBatch_MultipleFeeds(uint8 feedCount) public {
        feedCount = uint8(bound(feedCount, 1, 20)); // Reasonable batch size

        IFeedRegistry.FeedCreateParams[] memory paramsArray = new IFeedRegistry.FeedCreateParams[](feedCount);

        for (uint256 i = 0; i < feedCount; i++) {
            paramsArray[i] = IFeedRegistry.FeedCreateParams({
                symbol: string(abi.encodePacked("FEED-", vm.toString(i))),
                baseToken: address(uint160(0x1000 + i)),
                quoteToken: address(uint160(0x2000 + i)),
                decimals: 8,
                heartbeatSeconds: 3600,
                twapWindowSeconds: 1800,
                minLiquidityUSD: 1000 ether,
                maxDeviationBps: 100,
                minOracles: 3,
                quorumThreshold: 2,
                requiresConfidence: true,
                category: IFeedRegistry.FeedCategory.SPOT_PRICE
            });
        }

        vm.prank(owner);
        bytes32[] memory feedIds = registry.createFeedsBatch(paramsArray);

        assertEq(feedIds.length, feedCount);

        for (uint256 i = 0; i < feedCount; i++) {
            assertTrue(registry.feedExists(feedIds[i]));
        }
    }

    // ==================== Edge Case Fuzz Tests ====================

    function testFuzz_GetAllFeeds_AfterMultipleCreations(uint8 createCount) public {
        createCount = uint8(bound(createCount, 1, 30));

        for (uint256 i = 0; i < createCount; i++) {
            IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
                symbol: string(abi.encodePacked("ALL-", vm.toString(i))),
                baseToken: address(uint160(0x3000 + i)),
                quoteToken: address(uint160(0x4000 + i)),
                decimals: 8,
                heartbeatSeconds: 3600,
                twapWindowSeconds: 1800,
                minLiquidityUSD: 1000 ether,
                maxDeviationBps: 100,
                minOracles: 3,
                quorumThreshold: 2,
                requiresConfidence: true,
                category: IFeedRegistry.FeedCategory.SPOT_PRICE
            });

            vm.prank(owner);
            registry.createFeed(params);
        }

        bytes32[] memory allFeeds = registry.getAllFeeds();
        assertEq(allFeeds.length, createCount);
    }

    function testFuzz_FeedId_Deterministic(address baseToken, address quoteToken) public {
        vm.assume(baseToken != address(0) && quoteToken != address(0));
        vm.assume(baseToken != quoteToken);

        // Compute expected feedId (based on tokens only)
        bytes32 expectedFeedId = keccak256(abi.encodePacked(baseToken, quoteToken));

        IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
            symbol: "TEST-PAIR",
            baseToken: baseToken,
            quoteToken: quoteToken,
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 1000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        vm.prank(owner);
        bytes32 actualFeedId = registry.createFeed(params);

        assertEq(actualFeedId, expectedFeedId);
    }

    // ==================== Access Control Fuzz Tests ====================

    function testFuzz_Unauthorized_CreateFeed(address caller) public {
        vm.assume(caller != owner && caller != address(0));

        IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
            symbol: "UNAUTHORIZED",
            baseToken: address(0x100),
            quoteToken: address(0x200),
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 1000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        vm.prank(caller);
        vm.expectRevert();
        registry.createFeed(params);
    }

    function testFuzz_FeedManager_CanUpdate(address manager) public {
        vm.assume(manager != address(0) && manager != owner);

        // Create feed
        IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
            symbol: "MANAGED",
            baseToken: address(0x100),
            quoteToken: address(0x200),
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 1000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        vm.prank(owner);
        bytes32 feedId = registry.createFeed(params);

        // Add manager
        vm.prank(owner);
        registry.setFeedManager(manager, true);

        // Manager can update
        vm.prank(manager);
        registry.updateFeed(feedId, 7200, 1800, 1000 ether, 100);

        IFeedRegistry.FeedSpec memory spec = registry.getFeed(feedId);
        assertEq(spec.heartbeatSeconds, 7200);
    }
}
