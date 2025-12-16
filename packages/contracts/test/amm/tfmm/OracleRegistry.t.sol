// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {OracleRegistry} from "../../../src/amm/tfmm/OracleRegistry.sol";

contract MockChainlinkFeed {
    int256 private _answer;
    uint8 private _decimals;
    uint256 private _updatedAt;

    constructor(int256 answer, uint8 decimals_) {
        _answer = answer;
        _decimals = decimals_;
        _updatedAt = block.timestamp;
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (1, _answer, block.timestamp, _updatedAt, 1);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function setAnswer(int256 answer) external {
        _answer = answer;
        _updatedAt = block.timestamp;
    }

    function setStale(uint256 timestamp) external {
        _updatedAt = timestamp > 3600 ? timestamp - 3600 : 0; // 1 hour ago, or 0 if underflow
    }
    
    function refresh() external {
        _updatedAt = block.timestamp; // Reset to current timestamp (fresh)
    }
}

contract MockPyth {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }

    mapping(bytes32 => Price) private _prices;

    function setPrice(bytes32 id, int64 price, int32 expo) external {
        _prices[id] = Price({
            price: price,
            conf: 100,
            expo: expo,
            publishTime: block.timestamp
        });
    }

    function getPriceUnsafe(bytes32 id) external view returns (Price memory) {
        return _prices[id];
    }

    function getPriceNoOlderThan(bytes32 id, uint256) external view returns (Price memory) {
        return _prices[id];
    }
}

contract OracleRegistryTest is Test {
    OracleRegistry public registry;
    MockChainlinkFeed public ethFeed;
    MockChainlinkFeed public btcFeed;
    MockPyth public pyth;
    
    address public owner = address(1);
    address public governance = address(2);
    address public weth = address(0x1111);
    address public wbtc = address(0x2222);
    
    function setUp() public {
        pyth = new MockPyth();
        
        vm.prank(owner);
        registry = new OracleRegistry(address(pyth), governance);
        
        // Deploy mock Chainlink feeds
        ethFeed = new MockChainlinkFeed(3000_00000000, 8); // $3000 with 8 decimals
        btcFeed = new MockChainlinkFeed(60000_00000000, 8); // $60000 with 8 decimals
    }

    function test_RegisterChainlinkOracle() public {
        vm.prank(owner);
        registry.registerChainlinkOracle(weth, address(ethFeed), 3600);

        OracleRegistry.OracleConfig memory config = registry.getOracleConfig(weth);
        assertEq(config.feed, address(ethFeed));
        assertEq(config.heartbeat, 3600);
        assertTrue(config.active);
    }

    function test_GetChainlinkPrice() public {
        vm.prank(owner);
        registry.registerChainlinkOracle(weth, address(ethFeed), 3600);

        uint256 price = registry.getPrice(weth);
        assertEq(price, 3000_00000000); // $3000 with 8 decimals
    }

    function test_GetMultiplePrices() public {
        vm.startPrank(owner);
        registry.registerChainlinkOracle(weth, address(ethFeed), 3600);
        registry.registerChainlinkOracle(wbtc, address(btcFeed), 3600);
        vm.stopPrank();

        address[] memory tokens = new address[](2);
        tokens[0] = weth;
        tokens[1] = wbtc;

        uint256[] memory prices = registry.getPrices(tokens);

        assertEq(prices.length, 2);
        assertEq(prices[0], 3000_00000000);
        assertEq(prices[1], 60000_00000000);
    }

    function test_RevertOnStalePrice() public {
        // Set block.timestamp to a reasonable value
        vm.warp(10000);
        
        vm.prank(owner);
        registry.registerChainlinkOracle(weth, address(ethFeed), 60); // 60 second heartbeat

        // Make feed stale
        ethFeed.setStale(block.timestamp);

        vm.expectRevert();
        registry.getPrice(weth);
    }

    function test_IsPriceStale() public {
        // Set block.timestamp to a reasonable value
        vm.warp(10000);
        
        // Refresh the feed so its updatedAt is current
        ethFeed.refresh();
        
        vm.prank(owner);
        registry.registerChainlinkOracle(weth, address(ethFeed), 60);

        // Initially not stale (just refreshed)
        assertFalse(registry.isPriceStale(weth));

        // Make stale by setting updatedAt to 1 hour ago
        ethFeed.setStale(block.timestamp);
        
        // Now check staleness - the feed updatedAt is at block.timestamp - 3600
        // And heartbeat is 60 seconds, so it should be stale
        assertTrue(registry.isPriceStale(weth));
    }

    function test_RegisterPythOracle() public {
        bytes32 pythId = bytes32(uint256(1));
        
        // Set Pyth price
        pyth.setPrice(pythId, 3000_00000000, -8);

        vm.prank(owner);
        registry.registerPythOracle(weth, pythId, 60);

        assertEq(registry.getPythId(weth), pythId);
    }

    function test_DeactivateOracle() public {
        vm.startPrank(owner);
        registry.registerChainlinkOracle(weth, address(ethFeed), 3600);
        registry.deactivateOracle(weth);
        vm.stopPrank();

        vm.expectRevert();
        registry.getPrice(weth);
    }

    function test_RevertOnUnregisteredToken() public {
        vm.expectRevert();
        registry.getPrice(address(0x9999));
    }

    function test_GetOracleType() public {
        vm.prank(owner);
        registry.registerChainlinkOracle(weth, address(ethFeed), 3600);

        OracleRegistry.OracleType oracleType = registry.getOracleType(weth);
        assertEq(uint(oracleType), uint(OracleRegistry.OracleType.CHAINLINK));
    }

    function test_SetGovernance() public {
        address newGovernance = address(5);

        vm.prank(governance);
        registry.setGovernance(newGovernance);

        // Old governance should not work
        vm.prank(governance);
        vm.expectRevert();
        registry.setCacheDuration(30);

        // New governance should work
        vm.prank(newGovernance);
        registry.setCacheDuration(30);
    }

    function test_SetCacheDuration() public {
        vm.prank(governance);
        registry.setCacheDuration(30);

        assertEq(registry.cacheDuration(), 30);
    }

    function test_NormalizeDecimals() public {
        // Create feed with 18 decimals
        MockChainlinkFeed highDecimalFeed = new MockChainlinkFeed(3000_000000000000000000, 18);

        vm.prank(owner);
        registry.registerChainlinkOracle(weth, address(highDecimalFeed), 3600);

        uint256 price = registry.getPrice(weth);
        // Should be normalized to 8 decimals
        assertEq(price, 3000_00000000);
    }
}

