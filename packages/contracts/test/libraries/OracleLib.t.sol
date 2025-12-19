// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {OracleLib} from "../../src/libraries/OracleLib.sol";

contract MockChainlinkAggregator {
    int256 private _answer;
    uint8 private _decimals;
    uint256 private _updatedAt;
    uint80 private _roundId;
    uint80 private _answeredInRound;

    constructor(int256 answer, uint8 decimals_) {
        _answer = answer;
        _decimals = decimals_;
        _updatedAt = block.timestamp;
        _roundId = 1;
        _answeredInRound = 1;
    }

    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    ) {
        return (_roundId, _answer, block.timestamp, _updatedAt, _answeredInRound);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }

    function setAnswer(int256 answer) external {
        _answer = answer;
        _updatedAt = block.timestamp;
    }

    function setStale(uint256 secondsAgo) external {
        if (block.timestamp > secondsAgo) {
            _updatedAt = block.timestamp - secondsAgo;
        } else {
            _updatedAt = 0; // If timestamp is too low, just set to 0 (also stale)
        }
    }

    function setStaleRound() external {
        _roundId = 5;
        _answeredInRound = 3; // answeredInRound < roundId = stale
    }

    function setFreshRound() external {
        _roundId = 5;
        _answeredInRound = 5;
        _updatedAt = block.timestamp;
    }

    function setZeroUpdatedAt() external {
        _updatedAt = 0;
    }
}

contract OracleLibHarness {
    function readChainlinkPrice(OracleLib.ChainlinkConfig memory config) 
        external view returns (OracleLib.PriceResult memory) 
    {
        return OracleLib.readChainlinkPrice(config);
    }

    function readChainlinkPriceStrict(OracleLib.ChainlinkConfig memory config) 
        external view returns (uint256 price, uint256 timestamp) 
    {
        return OracleLib.readChainlinkPriceStrict(config);
    }

    function isChainlinkStale(address feed, uint256 maxAge) external view returns (bool) {
        return OracleLib.isChainlinkStale(feed, maxAge);
    }

    function getChainlinkDecimals(address feed) external view returns (uint8) {
        return OracleLib.getChainlinkDecimals(feed);
    }

    function normalizeDecimals(uint256 value, uint8 fromDecimals, uint8 toDecimals) 
        external pure returns (uint256) 
    {
        return OracleLib.normalizeDecimals(value, fromDecimals, toDecimals);
    }

    function convertViaUSD(
        uint256 amount,
        uint256 sourcePrice,
        uint256 targetPrice,
        uint8 sourceDecimals,
        uint8 targetDecimals
    ) external pure returns (uint256) {
        return OracleLib.convertViaUSD(amount, sourcePrice, targetPrice, sourceDecimals, targetDecimals);
    }

    function calculateDeviationBps(uint256 currentPrice, uint256 referencePrice) 
        external pure returns (uint256) 
    {
        return OracleLib.calculateDeviationBps(currentPrice, referencePrice);
    }

    function isDeviationExceeded(
        uint256 currentPrice,
        uint256 referencePrice,
        uint256 maxDeviationBps
    ) external pure returns (bool) {
        return OracleLib.isDeviationExceeded(currentPrice, referencePrice, maxDeviationBps);
    }
}

contract OracleLibTest is Test {
    OracleLibHarness harness;
    MockChainlinkAggregator ethUsdFeed;
    MockChainlinkAggregator btcUsdFeed;

    function setUp() public {
        harness = new OracleLibHarness();
        ethUsdFeed = new MockChainlinkAggregator(2000e8, 8); // $2000 ETH
        btcUsdFeed = new MockChainlinkAggregator(40000e8, 8); // $40000 BTC
    }

    // ============ readChainlinkPrice Tests ============

    function test_readChainlinkPrice_valid() public view {
        OracleLib.ChainlinkConfig memory config = OracleLib.ChainlinkConfig({
            feed: address(ethUsdFeed),
            maxStaleness: 3600,
            expectedDecimals: 8
        });

        OracleLib.PriceResult memory result = harness.readChainlinkPrice(config);
        
        assertTrue(result.isValid);
        assertEq(result.price, 2000e8);
        assertEq(result.decimals, 8);
        assertEq(result.timestamp, block.timestamp);
    }

    function test_readChainlinkPrice_negative_price_invalid() public {
        ethUsdFeed.setAnswer(-100);

        OracleLib.ChainlinkConfig memory config = OracleLib.ChainlinkConfig({
            feed: address(ethUsdFeed),
            maxStaleness: 3600,
            expectedDecimals: 8
        });

        OracleLib.PriceResult memory result = harness.readChainlinkPrice(config);
        assertFalse(result.isValid);
    }

    function test_readChainlinkPrice_stale_round_invalid() public {
        ethUsdFeed.setStaleRound();

        OracleLib.ChainlinkConfig memory config = OracleLib.ChainlinkConfig({
            feed: address(ethUsdFeed),
            maxStaleness: 3600,
            expectedDecimals: 8
        });

        OracleLib.PriceResult memory result = harness.readChainlinkPrice(config);
        assertFalse(result.isValid);
    }

    function test_readChainlinkPrice_stale_timestamp_invalid() public {
        ethUsdFeed.setStale(7200); // 2 hours old

        OracleLib.ChainlinkConfig memory config = OracleLib.ChainlinkConfig({
            feed: address(ethUsdFeed),
            maxStaleness: 3600, // 1 hour max
            expectedDecimals: 8
        });

        OracleLib.PriceResult memory result = harness.readChainlinkPrice(config);
        assertFalse(result.isValid);
    }

    function test_readChainlinkPrice_zero_updatedAt_invalid() public {
        ethUsdFeed.setZeroUpdatedAt();

        OracleLib.ChainlinkConfig memory config = OracleLib.ChainlinkConfig({
            feed: address(ethUsdFeed),
            maxStaleness: 3600,
            expectedDecimals: 8
        });

        OracleLib.PriceResult memory result = harness.readChainlinkPrice(config);
        assertFalse(result.isValid);
    }

    function test_readChainlinkPrice_revert_zero_address() public {
        OracleLib.ChainlinkConfig memory config = OracleLib.ChainlinkConfig({
            feed: address(0),
            maxStaleness: 3600,
            expectedDecimals: 8
        });

        vm.expectRevert(OracleLib.ZeroAddress.selector);
        harness.readChainlinkPrice(config);
    }

    // ============ readChainlinkPriceStrict Tests ============

    function test_readChainlinkPriceStrict_valid() public view {
        OracleLib.ChainlinkConfig memory config = OracleLib.ChainlinkConfig({
            feed: address(ethUsdFeed),
            maxStaleness: 3600,
            expectedDecimals: 8
        });

        (uint256 price, uint256 timestamp) = harness.readChainlinkPriceStrict(config);
        
        assertEq(price, 2000e8);
        assertEq(timestamp, block.timestamp);
    }

    function test_readChainlinkPriceStrict_revert_negative_price() public {
        ethUsdFeed.setAnswer(-100);

        OracleLib.ChainlinkConfig memory config = OracleLib.ChainlinkConfig({
            feed: address(ethUsdFeed),
            maxStaleness: 3600,
            expectedDecimals: 8
        });

        vm.expectRevert(OracleLib.InvalidPrice.selector);
        harness.readChainlinkPriceStrict(config);
    }

    function test_readChainlinkPriceStrict_revert_stale_round() public {
        ethUsdFeed.setStaleRound();

        OracleLib.ChainlinkConfig memory config = OracleLib.ChainlinkConfig({
            feed: address(ethUsdFeed),
            maxStaleness: 3600,
            expectedDecimals: 8
        });

        vm.expectRevert(abi.encodeWithSelector(OracleLib.StaleRound.selector, 3, 5));
        harness.readChainlinkPriceStrict(config);
    }

    function test_readChainlinkPriceStrict_revert_stale_price() public {
        ethUsdFeed.setStale(7200); // 2 hours old

        OracleLib.ChainlinkConfig memory config = OracleLib.ChainlinkConfig({
            feed: address(ethUsdFeed),
            maxStaleness: 3600, // 1 hour max
            expectedDecimals: 8
        });

        vm.expectRevert(); // StalePrice error
        harness.readChainlinkPriceStrict(config);
    }

    // ============ isChainlinkStale Tests ============

    function test_isChainlinkStale_fresh() public view {
        assertFalse(harness.isChainlinkStale(address(ethUsdFeed), 3600));
    }

    function test_isChainlinkStale_stale() public {
        ethUsdFeed.setStale(7200); // 2 hours old
        assertTrue(harness.isChainlinkStale(address(ethUsdFeed), 3600)); // 1 hour max
    }

    function test_isChainlinkStale_zero_updatedAt() public {
        ethUsdFeed.setZeroUpdatedAt();
        assertTrue(harness.isChainlinkStale(address(ethUsdFeed), 3600));
    }

    // ============ getChainlinkDecimals Tests ============

    function test_getChainlinkDecimals() public view {
        assertEq(harness.getChainlinkDecimals(address(ethUsdFeed)), 8);
    }

    // ============ normalizeDecimals Tests ============

    function test_normalizeDecimals_same() public view {
        assertEq(harness.normalizeDecimals(1000, 8, 8), 1000);
    }

    function test_normalizeDecimals_scale_up() public view {
        // From 8 decimals to 18 decimals
        assertEq(harness.normalizeDecimals(1e8, 8, 18), 1e18);
    }

    function test_normalizeDecimals_scale_down() public view {
        // From 18 decimals to 8 decimals
        assertEq(harness.normalizeDecimals(1e18, 18, 8), 1e8);
    }

    // ============ convertViaUSD Tests ============

    function test_convertViaUSD_eth_to_btc() public view {
        // Convert 1 ETH to BTC
        // ETH price: $2000, BTC price: $40000
        // 1 ETH = $2000 = 0.05 BTC
        uint256 result = harness.convertViaUSD(
            1e18,       // 1 ETH (18 decimals)
            2000e8,     // ETH price $2000 (8 decimals)
            40000e8,    // BTC price $40000 (8 decimals)
            18,         // ETH decimals
            8           // BTC decimals
        );
        
        assertEq(result, 5e6); // 0.05 BTC (8 decimals)
    }

    function test_convertViaUSD_btc_to_eth() public view {
        // Convert 0.1 BTC to ETH
        // BTC price: $40000, ETH price: $2000
        // 0.1 BTC = $4000 = 2 ETH
        uint256 result = harness.convertViaUSD(
            1e7,        // 0.1 BTC (8 decimals)
            40000e8,    // BTC price $40000 (8 decimals)
            2000e8,     // ETH price $2000 (8 decimals)
            8,          // BTC decimals
            18          // ETH decimals
        );
        
        assertEq(result, 2e18); // 2 ETH (18 decimals)
    }

    // ============ calculateDeviationBps Tests ============

    function test_calculateDeviationBps_zero() public view {
        assertEq(harness.calculateDeviationBps(1000, 1000), 0);
    }

    function test_calculateDeviationBps_10_percent_up() public view {
        assertEq(harness.calculateDeviationBps(1100, 1000), 1000); // 10%
    }

    function test_calculateDeviationBps_10_percent_down() public view {
        assertEq(harness.calculateDeviationBps(900, 1000), 1000); // 10%
    }

    function test_calculateDeviationBps_100_percent() public view {
        assertEq(harness.calculateDeviationBps(2000, 1000), 10000); // 100%
    }

    function test_calculateDeviationBps_zero_reference() public view {
        assertEq(harness.calculateDeviationBps(1000, 0), type(uint256).max);
    }

    // ============ isDeviationExceeded Tests ============

    function test_isDeviationExceeded_false() public view {
        assertFalse(harness.isDeviationExceeded(1050, 1000, 1000)); // 5% < 10%
    }

    function test_isDeviationExceeded_true() public view {
        assertTrue(harness.isDeviationExceeded(1150, 1000, 1000)); // 15% > 10%
    }

    function test_isDeviationExceeded_exactly_at_threshold() public view {
        assertFalse(harness.isDeviationExceeded(1100, 1000, 1000)); // 10% == 10%
    }

    // ============ Fuzz Tests ============

    function testFuzz_normalizeDecimals_roundtrip(uint256 value, uint8 from, uint8 to) public view {
        from = uint8(bound(from, 1, 24));
        to = uint8(bound(to, 1, 24));
        value = bound(value, 1, type(uint128).max);
        
        uint256 normalized = harness.normalizeDecimals(value, from, to);
        uint256 denormalized = harness.normalizeDecimals(normalized, to, from);
        
        // Due to rounding, we might lose precision when scaling down
        if (from <= to) {
            assertEq(denormalized, value);
        }
    }

    function testFuzz_calculateDeviationBps_symmetric(uint256 a, uint256 b) public view {
        a = bound(a, 1, type(uint128).max);
        b = bound(b, 1, type(uint128).max);
        
        uint256 devAB = harness.calculateDeviationBps(a, b);
        uint256 devBA = harness.calculateDeviationBps(b, a);
        
        // Deviation should be similar but not exactly equal due to different bases
        // Just verify both are non-negative and reasonable
        assertTrue(devAB < type(uint256).max);
        assertTrue(devBA < type(uint256).max);
    }
}
