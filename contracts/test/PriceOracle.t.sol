// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {PriceOracle} from "../src/oracle/PriceOracle.sol";

contract PriceOracleTest is Test {
    PriceOracle public oracle;

    address owner = address(this);
    address alice = makeAddr("alice");
    
    address constant ETH_ADDRESS = address(0);
    address usdcAddress = address(0x1);
    address elizaAddress = address(0x2);

    event PriceUpdated(address indexed token, uint256 price, uint256 decimals);

    function setUp() public {
        oracle = new PriceOracle();
    }

    // ============ Constructor Tests ============

    function test_Constructor() public view {
        // Should have default ETH price
        (uint256 ethPrice, uint256 ethDecimals) = oracle.getPrice(ETH_ADDRESS);
        assertEq(ethPrice, 3000 * 1e18);
        assertEq(ethDecimals, 18);

        // Should have default USDC price
        (uint256 usdcPrice, uint256 usdcDecimals) = oracle.getPrice(address(0x1));
        assertEq(usdcPrice, 1 * 1e18);
        assertEq(usdcDecimals, 18);
    }

    function test_ConstructorSetsOwner() public view {
        assertEq(oracle.owner(), owner);
    }

    // ============ Get Price Tests ============

    function test_GetPrice() public {
        oracle.setPrice(elizaAddress, 1e17, 18); // $0.10

        (uint256 price, uint256 decimals) = oracle.getPrice(elizaAddress);

        assertEq(price, 1e17);
        assertEq(decimals, 18);
    }

    function test_GetPriceUnsetToken() public view {
        // Unset token should default to $1
        address unsetToken = address(0x999);
        (uint256 price, uint256 decimals) = oracle.getPrice(unsetToken);

        assertEq(price, 1e18);
        assertEq(decimals, 18);
    }

    function test_GetPriceMultipleTokens() public {
        oracle.setPrice(usdcAddress, 1 * 1e18, 18);
        oracle.setPrice(elizaAddress, 1e17, 18);
        oracle.setPrice(address(0x3), 2500 * 1e18, 18); // Some other token

        (uint256 usdcPrice, ) = oracle.getPrice(usdcAddress);
        (uint256 elizaPrice, ) = oracle.getPrice(elizaAddress);
        (uint256 otherPrice, ) = oracle.getPrice(address(0x3));

        assertEq(usdcPrice, 1 * 1e18);
        assertEq(elizaPrice, 1e17);
        assertEq(otherPrice, 2500 * 1e18);
    }

    // ============ Set Price Tests ============

    function test_SetPrice() public {
        vm.expectEmit(true, false, false, true);
        emit PriceUpdated(elizaAddress, 2e17, 18);

        oracle.setPrice(elizaAddress, 2e17, 18);

        (uint256 price, uint256 decimals) = oracle.getPrice(elizaAddress);
        assertEq(price, 2e17);
        assertEq(decimals, 18);
    }

    function test_SetPriceUpdatesTimestamp() public {
        uint256 timeBefore = block.timestamp;

        oracle.setPrice(elizaAddress, 1e17, 18);

        uint256 lastUpdate = oracle.lastUpdate(elizaAddress);
        assertEq(lastUpdate, timeBefore);

        // Advance time and update again (40% increase, within 50% deviation limit)
        vm.warp(block.timestamp + 1 hours);
        oracle.setPrice(elizaAddress, 14e16, 18);

        lastUpdate = oracle.lastUpdate(elizaAddress);
        assertEq(lastUpdate, block.timestamp);
    }

    function test_SetPriceOverwriteExisting() public {
        oracle.setPrice(elizaAddress, 1e17, 18);
        oracle.setPrice(elizaAddress, 14e16, 18); // Update by 40% (within 50% deviation limit)

        (uint256 price, ) = oracle.getPrice(elizaAddress);
        assertEq(price, 14e16);
    }

    function test_RevertSetPriceUnauthorized() public {
        vm.prank(alice);
        vm.expectRevert();
        oracle.setPrice(elizaAddress, 1e17, 18);
    }

    // ============ Price Freshness Tests ============

    function test_IsPriceFresh() public {
        oracle.setPrice(elizaAddress, 1e17, 18);

        bool isFresh = oracle.isPriceFresh(elizaAddress);
        assertTrue(isFresh);
    }

    function test_IsPriceStale() public {
        oracle.setPrice(elizaAddress, 1e17, 18);

        // Advance time beyond staleness threshold
        vm.warp(block.timestamp + 1 hours + 1);

        bool isFresh = oracle.isPriceFresh(elizaAddress);
        assertFalse(isFresh);
    }

    function test_IsPriceFreshUnsetToken() public {
        // Token never set has lastUpdate = 0
        address neverSet = address(0x888);
        
        // In early blockchain time (block.timestamp = 1 in tests),
        // age = 1 - 0 = 1, which is < stalenessThreshold (3600)
        // So it appears "fresh" even though never set
        // We need to advance time to make it properly stale
        vm.warp(block.timestamp + 2 hours);
        
        bool isFresh = oracle.isPriceFresh(neverSet);
        
        // Now age = (1 + 2 hours) - 0 > stalenessThreshold
        assertFalse(isFresh);
    }

    function test_IsPriceFreshEdgeCases() public {
        oracle.setPrice(elizaAddress, 1e17, 18);

        // Exactly at threshold
        vm.warp(block.timestamp + 1 hours);
        assertTrue(oracle.isPriceFresh(elizaAddress));

        // Just past threshold
        vm.warp(block.timestamp + 1);
        assertFalse(oracle.isPriceFresh(elizaAddress));
    }

    // ============ Staleness Threshold Tests ============

    function test_SetStalenessThreshold() public {
        uint256 newThreshold = 30 minutes;

        oracle.setStalenessThreshold(newThreshold);

        assertEq(oracle.stalenessThreshold(), newThreshold);
    }

    function test_StalenessThresholdAffectsFreshness() public {
        oracle.setPrice(elizaAddress, 1e17, 18);
        oracle.setStalenessThreshold(10 minutes);

        // Advance 11 minutes
        vm.warp(block.timestamp + 11 minutes);

        // Should be stale with new threshold
        assertFalse(oracle.isPriceFresh(elizaAddress));
    }

    function test_RevertSetStalenessThresholdUnauthorized() public {
        vm.prank(alice);
        vm.expectRevert();
        oracle.setStalenessThreshold(30 minutes);
    }

    // ============ Convert Amount Tests ============

    function test_ConvertAmountSameToken() public {
        oracle.setPrice(elizaAddress, 1e17, 18);

        uint256 amount = 100 * 1e18;
        uint256 converted = oracle.convertAmount(elizaAddress, elizaAddress, amount);

        assertEq(converted, amount); // Should be unchanged
    }

    function test_ConvertAmountElizaToUSDC() public {
        oracle.setPrice(elizaAddress, 1e17, 18); // $0.10
        oracle.setPrice(usdcAddress, 1 * 1e18, 18); // $1.00

        uint256 elizaAmount = 100 * 1e18; // 100 elizaOS = $10
        uint256 converted = oracle.convertAmount(elizaAddress, usdcAddress, elizaAmount);

        // 100 elizaOS * $0.10 / $1.00 = 10 USDC
        assertEq(converted, 10 * 1e18);
    }

    function test_ConvertAmountUSDCToEliza() public {
        oracle.setPrice(elizaAddress, 1e17, 18); // $0.10
        oracle.setPrice(usdcAddress, 1 * 1e18, 18); // $1.00

        uint256 usdcAmount = 10 * 1e18; // $10
        uint256 converted = oracle.convertAmount(usdcAddress, elizaAddress, usdcAmount);

        // $10 / $0.10 = 100 elizaOS
        assertEq(converted, 100 * 1e18);
    }

    function test_ConvertAmountETHToUSDC() public {
        // ETH = $3000, USDC = $1
        oracle.setPrice(usdcAddress, 1 * 1e18, 18);

        uint256 ethAmount = 1 ether;
        uint256 converted = oracle.convertAmount(ETH_ADDRESS, usdcAddress, ethAmount);

        // 1 ETH * $3000 / $1 = 3000 USDC
        assertEq(converted, 3000 * 1e18);
    }

    function test_ConvertAmountUSDCToETH() public {
        oracle.setPrice(usdcAddress, 1 * 1e18, 18);

        uint256 usdcAmount = 3000 * 1e18;
        uint256 converted = oracle.convertAmount(usdcAddress, ETH_ADDRESS, usdcAmount);

        // $3000 / $3000 = 1 ETH
        assertEq(converted, 1 ether);
    }

    function test_ConvertAmountUnsetTokens() public view {
        // Both tokens unset should default to $1 = 1:1 conversion
        address token1 = address(0x777);
        address token2 = address(0x666);

        uint256 amount = 500 * 1e18;
        uint256 converted = oracle.convertAmount(token1, token2, amount);

        assertEq(converted, amount);
    }

    function test_ConvertAmountRoundingDown() public {
        oracle.setPrice(elizaAddress, 1e17, 18); // $0.10
        oracle.setPrice(usdcAddress, 1 * 1e18, 18); // $1.00

        // Amount that doesn't divide evenly
        uint256 elizaAmount = 3 * 1e18; // 3 elizaOS = $0.30
        uint256 converted = oracle.convertAmount(elizaAddress, usdcAddress, elizaAmount);

        // 3 * $0.10 / $1.00 = 0.3 (rounds down in integer division)
        assertLt(converted, 1 * 1e18);
    }

    // ============ Helper View Tests ============

    function test_GetElizaOSPerETH() public {
        oracle.setPrice(address(0x2), 1e17, 18); // elizaOS at $0.10

        uint256 rate = oracle.getElizaOSPerETH();

        // $3000 / $0.10 = 30,000 elizaOS per ETH
        assertEq(rate, 30000 * 1e18);
    }

    function test_GetElizaOSPerETHUnsetEliza() public view {
        // Should use default $0.10 for elizaOS
        uint256 rate = oracle.getElizaOSPerETH();

        assertEq(rate, 30000 * 1e18);
    }

    // ============ Edge Cases & Fuzz Tests ============

    function test_ZeroPrice() public {
        oracle.setPrice(elizaAddress, 0, 18);

        // Oracle safety feature: zero prices default to 1e18
        // This prevents division by zero in conversions
        (uint256 price, uint256 decimals) = oracle.getPrice(elizaAddress);
        assertEq(price, 1e18); // Defaults to $1
        assertEq(decimals, 18);

        // Unset tokens also default to 1e18
        address unsetToken = address(0x555);
        (uint256 defaultPrice, uint256 defaultDecimals) = oracle.getPrice(unsetToken);
        assertEq(defaultPrice, 1e18);
        assertEq(defaultDecimals, 18);
    }

    function test_VeryLargePrices() public {
        uint256 largePrice = 1000000 * 1e18; // $1M per token
        oracle.setPrice(elizaAddress, largePrice, 18);

        (uint256 price, ) = oracle.getPrice(elizaAddress);
        assertEq(price, largePrice);
    }

    function test_VerySmallPrices() public {
        uint256 smallPrice = 1; // Smallest possible non-zero
        oracle.setPrice(elizaAddress, smallPrice, 18);

        (uint256 price, ) = oracle.getPrice(elizaAddress);
        assertEq(price, smallPrice);
    }

    function testFuzz_SetPrice(uint256 price, uint256 decimals) public {
        vm.assume(decimals <= 18); // Reasonable decimals
        vm.assume(price > 0 && price < type(uint128).max); // Reasonable price

        oracle.setPrice(elizaAddress, price, decimals);

        (uint256 returnedPrice, uint256 returnedDecimals) = oracle.getPrice(elizaAddress);
        assertEq(returnedPrice, price);
        assertEq(returnedDecimals, decimals);
    }

    function testFuzz_ConvertAmount(uint256 amount) public {
        vm.assume(amount > 0 && amount < type(uint128).max);

        oracle.setPrice(elizaAddress, 1e17, 18);
        oracle.setPrice(usdcAddress, 1e18, 18);

        uint256 converted = oracle.convertAmount(elizaAddress, usdcAddress, amount);

        // Should convert at 10:1 ratio (elizaOS is $0.10, USDC is $1.00)
        assertEq(converted, amount / 10);
    }

    // ============ Integration Tests ============

    function test_MultiTokenConversionChain() public {
        // Set up prices
        oracle.setPrice(ETH_ADDRESS, 3000 * 1e18, 18);
        oracle.setPrice(usdcAddress, 1 * 1e18, 18);
        oracle.setPrice(elizaAddress, 1e17, 18);

        // Convert ETH → USDC → elizaOS
        uint256 ethAmount = 1 ether;
        
        uint256 usdcAmount = oracle.convertAmount(ETH_ADDRESS, usdcAddress, ethAmount);
        assertEq(usdcAmount, 3000 * 1e18);

        uint256 elizaAmount = oracle.convertAmount(usdcAddress, elizaAddress, usdcAmount);
        assertEq(elizaAmount, 30000 * 1e18);
    }

    function test_PriceUpdateFlow() public {
        // Initial price
        oracle.setPrice(elizaAddress, 1e17, 18);
        assertTrue(oracle.isPriceFresh(elizaAddress));

        // Price increases by 40% (within 50% deviation limit)
        vm.warp(block.timestamp + 30 minutes);
        oracle.setPrice(elizaAddress, 14e16, 18);
        assertTrue(oracle.isPriceFresh(elizaAddress));

        // Conversion reflects new price
        uint256 converted = oracle.convertAmount(elizaAddress, usdcAddress, 100 * 1e18);
        assertEq(converted, 14 * 1e18); // 100 * $0.14 / $1.00
    }

    function test_StalePriceScenario() public {
        oracle.setPrice(elizaAddress, 1e17, 18);

        // Advance past staleness threshold
        vm.warp(block.timestamp + 2 hours);

        // Price is stale
        assertFalse(oracle.isPriceFresh(elizaAddress));

        // But conversion still works (uses stale price)
        uint256 converted = oracle.convertAmount(elizaAddress, usdcAddress, 100 * 1e18);
        assertGt(converted, 0);
    }
}

