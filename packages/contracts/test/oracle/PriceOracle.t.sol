// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {PriceOracle} from "../../src/oracle/PriceOracle.sol";

contract PriceOracleTest is Test {
    PriceOracle public oracle;
    
    address public owner;
    address public tokenA;
    address public tokenB;
    address public tokenC;
    
    function setUp() public {
        owner = makeAddr("owner");
        tokenA = makeAddr("tokenA");
        tokenB = makeAddr("tokenB");
        tokenC = makeAddr("tokenC");
        
        vm.prank(owner);
        oracle = new PriceOracle();
    }
    
    // ============ Set Price Tests ============
    
    function test_SetPrice() public {
        vm.prank(owner);
        oracle.setPrice(tokenA, 2000 * 10**8, 8); // $2000 with 8 decimals
        
        (uint256 price, uint256 decimals) = oracle.getPrice(tokenA);
        assertEq(price, 2000 * 10**8);
        assertEq(decimals, 8);
    }
    
    function test_SetPrice_UpdateExisting() public {
        vm.startPrank(owner);
        oracle.setPrice(tokenA, 2000 * 10**8, 8);
        oracle.setPrice(tokenA, 2500 * 10**8, 8);
        vm.stopPrank();
        
        (uint256 price,) = oracle.getPrice(tokenA);
        assertEq(price, 2500 * 10**8);
    }
    
    function test_SetPrice_RevertIfNotOwner() public {
        vm.prank(makeAddr("notOwner"));
        vm.expectRevert();
        oracle.setPrice(tokenA, 2000 * 10**8, 8);
    }
    
    // ============ Get Price Tests ============
    
    function test_GetPrice() public {
        vm.prank(owner);
        oracle.setPrice(tokenA, 100 * 10**18, 18);
        
        (uint256 price, uint256 decimals) = oracle.getPrice(tokenA);
        assertEq(price, 100 * 10**18);
        assertEq(decimals, 18);
    }
    
    function test_GetPrice_RevertIfNotAvailable() public {
        vm.expectRevert(PriceOracle.PriceNotAvailable.selector);
        oracle.getPrice(tokenA);
    }
    
    function test_GetPriceUSD() public {
        vm.prank(owner);
        oracle.setPrice(tokenA, 1500 * 10**8, 8);
        
        uint256 priceUSD = oracle.getPriceUSD(tokenA);
        assertEq(priceUSD, 1500 * 10**8);
    }
    
    // ============ Price Freshness Tests ============
    
    function test_IsPriceFresh() public {
        vm.prank(owner);
        oracle.setPrice(tokenA, 2000 * 10**8, 8);
        
        assertTrue(oracle.isPriceFresh(tokenA));
    }
    
    function test_IsPriceFresh_Stale() public {
        vm.prank(owner);
        oracle.setPrice(tokenA, 2000 * 10**8, 8);
        
        // Move time forward past staleness threshold
        vm.warp(block.timestamp + 2 hours);
        
        assertFalse(oracle.isPriceFresh(tokenA));
    }
    
    function test_IsPriceFresh_NotSet() public {
        assertFalse(oracle.isPriceFresh(tokenA));
    }
    
    function test_SetStalenessThreshold() public {
        vm.prank(owner);
        oracle.setStalenessThreshold(30 minutes);
        
        assertEq(oracle.stalenessThreshold(), 30 minutes);
        
        // Set price
        vm.prank(owner);
        oracle.setPrice(tokenA, 2000 * 10**8, 8);
        
        // Price should still be fresh before 30 minutes
        vm.warp(block.timestamp + 20 minutes);
        assertTrue(oracle.isPriceFresh(tokenA));
        
        // Price should be stale after 30 minutes
        vm.warp(block.timestamp + 15 minutes);
        assertFalse(oracle.isPriceFresh(tokenA));
    }
    
    // ============ Convert Amount Tests ============
    
    function test_ConvertAmount() public {
        // Set prices: tokenA = $2000, tokenB = $1
        vm.startPrank(owner);
        oracle.setPrice(tokenA, 2000 * 10**8, 8);
        oracle.setPrice(tokenB, 1 * 10**8, 8);
        vm.stopPrank();
        
        // 1 tokenA = 2000 tokenB
        uint256 converted = oracle.convertAmount(tokenA, tokenB, 1 * 10**18);
        assertEq(converted, 2000 * 10**18);
    }
    
    function test_ConvertAmount_DifferentDecimals() public {
        // tokenA: $100 with 8 decimals
        // tokenB: $50 with 18 decimals
        vm.startPrank(owner);
        oracle.setPrice(tokenA, 100 * 10**8, 8);
        oracle.setPrice(tokenB, 50 * 10**18, 18);
        vm.stopPrank();
        
        // 1 tokenA at $100 = 2 tokenB at $50
        uint256 converted = oracle.convertAmount(tokenA, tokenB, 1 * 10**8);
        // Expect: 1 * 100 * 10^18 / (50 * 10^8) = 2 * 10^10
        assertEq(converted, 2 * 10**10);
    }
    
    function test_ConvertAmount_RevertIfFromNotAvailable() public {
        vm.prank(owner);
        oracle.setPrice(tokenB, 1 * 10**8, 8);
        
        vm.expectRevert(PriceOracle.PriceNotAvailable.selector);
        oracle.convertAmount(tokenA, tokenB, 1 * 10**18);
    }
    
    function test_ConvertAmount_RevertIfToNotAvailable() public {
        vm.prank(owner);
        oracle.setPrice(tokenA, 2000 * 10**8, 8);
        
        vm.expectRevert(PriceOracle.PriceNotAvailable.selector);
        oracle.convertAmount(tokenA, tokenB, 1 * 10**18);
    }
    
    // ============ Multi-Token Scenarios ============
    
    function test_MultipleTokenPrices() public {
        vm.startPrank(owner);
        oracle.setPrice(tokenA, 2000 * 10**8, 8);  // ETH: $2000
        oracle.setPrice(tokenB, 1 * 10**8, 8);     // USDC: $1
        oracle.setPrice(tokenC, 30000 * 10**8, 8); // BTC: $30000
        vm.stopPrank();
        
        // Verify all prices
        (uint256 priceA,) = oracle.getPrice(tokenA);
        (uint256 priceB,) = oracle.getPrice(tokenB);
        (uint256 priceC,) = oracle.getPrice(tokenC);
        
        assertEq(priceA, 2000 * 10**8);
        assertEq(priceB, 1 * 10**8);
        assertEq(priceC, 30000 * 10**8);
        
        // Convert BTC to ETH: 1 BTC = 15 ETH
        uint256 btcToEth = oracle.convertAmount(tokenC, tokenA, 1 * 10**8);
        assertEq(btcToEth, 15 * 10**8);
    }
}
