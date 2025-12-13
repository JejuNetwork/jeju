// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {FeedRegistry} from "../../src/oracle/FeedRegistry.sol";
import {IFeedRegistry} from "../../src/oracle/interfaces/IFeedRegistry.sol";

contract FeedRegistryTest is Test {
    FeedRegistry public registry;

    address public owner = address(0x1);
    address public manager = address(0x2);
    address public user = address(0x3);

    address public constant WETH = address(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);
    address public constant USDC = address(0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48);
    address public constant DAI = address(0x6B175474E89094C44Da98b954EedeAC495271d0F);

    function setUp() public {
        vm.prank(owner);
        registry = new FeedRegistry(owner);
    }

    function test_CreateFeed() public {
        IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
            symbol: "ETH-USD",
            baseToken: WETH,
            quoteToken: USDC,
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 100_000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        vm.prank(owner);
        bytes32 feedId = registry.createFeed(params);

        assertTrue(registry.feedExists(feedId));
        assertTrue(registry.isFeedActive(feedId));

        IFeedRegistry.FeedSpec memory spec = registry.getFeed(feedId);
        assertEq(spec.symbol, "ETH-USD");
        assertEq(spec.baseToken, WETH);
        assertEq(spec.quoteToken, USDC);
        assertEq(spec.decimals, 8);
        assertEq(spec.heartbeatSeconds, 3600);
        assertEq(spec.minOracles, 3);
        assertEq(spec.quorumThreshold, 2);
    }

    function test_CreateFeedWithDefaults() public {
        IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
            symbol: "BTC-USD",
            baseToken: address(0x100),
            quoteToken: USDC,
            decimals: 0,  // Will use default
            heartbeatSeconds: 0,  // Will use default
            twapWindowSeconds: 0,  // Will use default
            minLiquidityUSD: 0,  // Will use default
            maxDeviationBps: 0,  // Will use default
            minOracles: 0,  // Will use default
            quorumThreshold: 0,  // Will use default
            requiresConfidence: false,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        vm.prank(owner);
        bytes32 feedId = registry.createFeed(params);

        IFeedRegistry.FeedSpec memory spec = registry.getFeed(feedId);
        assertEq(spec.decimals, registry.DEFAULT_DECIMALS());
        assertEq(spec.heartbeatSeconds, registry.DEFAULT_HEARTBEAT());
        assertEq(spec.twapWindowSeconds, registry.DEFAULT_TWAP_WINDOW());
    }

    function test_GetFeedBySymbol() public {
        IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
            symbol: "ETH-USD",
            baseToken: WETH,
            quoteToken: USDC,
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 100_000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        vm.prank(owner);
        registry.createFeed(params);

        IFeedRegistry.FeedSpec memory spec = registry.getFeedBySymbol("ETH-USD");
        assertEq(spec.symbol, "ETH-USD");
        assertEq(spec.baseToken, WETH);
    }

    function test_UpdateFeed() public {
        // Create feed first
        IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
            symbol: "ETH-USD",
            baseToken: WETH,
            quoteToken: USDC,
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 100_000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        vm.prank(owner);
        bytes32 feedId = registry.createFeed(params);

        // Update feed
        vm.prank(owner);
        registry.updateFeed(feedId, 7200, 3600, 200_000 ether, 200);

        IFeedRegistry.FeedSpec memory spec = registry.getFeed(feedId);
        assertEq(spec.heartbeatSeconds, 7200);
        assertEq(spec.twapWindowSeconds, 3600);
        assertEq(spec.minLiquidityUSD, 200_000 ether);
        assertEq(spec.maxDeviationBps, 200);
    }

    function test_SetFeedActive() public {
        IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
            symbol: "ETH-USD",
            baseToken: WETH,
            quoteToken: USDC,
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 100_000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        vm.prank(owner);
        bytes32 feedId = registry.createFeed(params);

        assertTrue(registry.isFeedActive(feedId));

        vm.prank(owner);
        registry.setFeedActive(feedId, false);
        assertFalse(registry.isFeedActive(feedId));

        vm.prank(owner);
        registry.setFeedActive(feedId, true);
        assertTrue(registry.isFeedActive(feedId));
    }

    function test_GetAllFeeds() public {
        IFeedRegistry.FeedCreateParams memory params1 = IFeedRegistry.FeedCreateParams({
            symbol: "ETH-USD",
            baseToken: WETH,
            quoteToken: USDC,
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 100_000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        IFeedRegistry.FeedCreateParams memory params2 = IFeedRegistry.FeedCreateParams({
            symbol: "DAI-USD",
            baseToken: DAI,
            quoteToken: USDC,
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 100_000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: false,
            category: IFeedRegistry.FeedCategory.STABLECOIN_PEG
        });

        vm.startPrank(owner);
        registry.createFeed(params1);
        registry.createFeed(params2);
        vm.stopPrank();

        bytes32[] memory allFeeds = registry.getAllFeeds();
        assertEq(allFeeds.length, 2);
        assertEq(registry.totalFeeds(), 2);
    }

    function test_GetFeedsByCategory() public {
        IFeedRegistry.FeedCreateParams memory params1 = IFeedRegistry.FeedCreateParams({
            symbol: "ETH-USD",
            baseToken: WETH,
            quoteToken: USDC,
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 100_000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        IFeedRegistry.FeedCreateParams memory params2 = IFeedRegistry.FeedCreateParams({
            symbol: "DAI-USD",
            baseToken: DAI,
            quoteToken: USDC,
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 100_000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: false,
            category: IFeedRegistry.FeedCategory.STABLECOIN_PEG
        });

        vm.startPrank(owner);
        registry.createFeed(params1);
        registry.createFeed(params2);
        vm.stopPrank();

        bytes32[] memory spotFeeds = registry.getFeedsByCategory(IFeedRegistry.FeedCategory.SPOT_PRICE);
        assertEq(spotFeeds.length, 1);

        bytes32[] memory pegFeeds = registry.getFeedsByCategory(IFeedRegistry.FeedCategory.STABLECOIN_PEG);
        assertEq(pegFeeds.length, 1);
    }

    function test_RevertDuplicateFeed() public {
        IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
            symbol: "ETH-USD",
            baseToken: WETH,
            quoteToken: USDC,
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 100_000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        vm.prank(owner);
        registry.createFeed(params);

        // Should revert on duplicate
        bytes32 expectedFeedId = registry.computeFeedId(WETH, USDC);
        vm.expectRevert(abi.encodeWithSelector(IFeedRegistry.FeedAlreadyExists.selector, expectedFeedId));
        vm.prank(owner);
        registry.createFeed(params);
    }

    function test_RevertUnauthorized() public {
        IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
            symbol: "ETH-USD",
            baseToken: WETH,
            quoteToken: USDC,
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 100_000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        vm.expectRevert(IFeedRegistry.Unauthorized.selector);
        vm.prank(user);
        registry.createFeed(params);
    }

    function test_SetFeedManager() public {
        vm.prank(owner);
        registry.setFeedManager(manager, true);

        IFeedRegistry.FeedCreateParams memory params = IFeedRegistry.FeedCreateParams({
            symbol: "ETH-USD",
            baseToken: WETH,
            quoteToken: USDC,
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 100_000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        // Manager should be able to create feed
        vm.prank(manager);
        bytes32 feedId = registry.createFeed(params);
        assertTrue(registry.feedExists(feedId));
    }

    function test_CreateFeedsBatch() public {
        IFeedRegistry.FeedCreateParams[] memory paramsArray = new IFeedRegistry.FeedCreateParams[](2);

        paramsArray[0] = IFeedRegistry.FeedCreateParams({
            symbol: "ETH-USD",
            baseToken: WETH,
            quoteToken: USDC,
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 100_000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: true,
            category: IFeedRegistry.FeedCategory.SPOT_PRICE
        });

        paramsArray[1] = IFeedRegistry.FeedCreateParams({
            symbol: "DAI-USD",
            baseToken: DAI,
            quoteToken: USDC,
            decimals: 8,
            heartbeatSeconds: 3600,
            twapWindowSeconds: 1800,
            minLiquidityUSD: 100_000 ether,
            maxDeviationBps: 100,
            minOracles: 3,
            quorumThreshold: 2,
            requiresConfidence: false,
            category: IFeedRegistry.FeedCategory.STABLECOIN_PEG
        });

        vm.prank(owner);
        bytes32[] memory feedIds = registry.createFeedsBatch(paramsArray);

        assertEq(feedIds.length, 2);
        assertTrue(registry.feedExists(feedIds[0]));
        assertTrue(registry.feedExists(feedIds[1]));
        assertEq(registry.totalFeeds(), 2);
    }
}
