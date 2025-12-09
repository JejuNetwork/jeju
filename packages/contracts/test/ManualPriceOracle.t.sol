// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {ManualPriceOracle} from "../src/oracle/ManualPriceOracle.sol";

contract ManualPriceOracleTest is Test {
    ManualPriceOracle public oracle;

    address public owner = address(this);
    address public updater = address(0x123);

    uint256 constant INITIAL_ETH_PRICE = 300000000000; // $3,000 (8 decimals)
    uint256 constant INITIAL_ELIZA_PRICE = 10000000; // $0.10 (8 decimals)

    function setUp() public {
        oracle = new ManualPriceOracle(INITIAL_ETH_PRICE, INITIAL_ELIZA_PRICE, owner);
        oracle.setPriceUpdater(updater);
    }

    function testInitialPrices() public view {
        assertEq(oracle.ethUsdPrice(), INITIAL_ETH_PRICE);
        assertEq(oracle.elizaUsdPrice(), INITIAL_ELIZA_PRICE);
    }

    function testGetElizaOSPerETH() public view {
        // ETH = $3,000, elizaOS = $0.10
        // 1 ETH = 30,000 elizaOS
        uint256 rate = oracle.getElizaOSPerETH();
        assertEq(rate, 30000e18); // 30,000 tokens per ETH
    }

    function testUpdatePrices() public {
        uint256 newETHPrice = 320000000000; // $3,200
        uint256 newElizaPrice = 11000000; // $0.11

        vm.prank(updater);
        oracle.updatePrices(newETHPrice, newElizaPrice);

        assertEq(oracle.ethUsdPrice(), newETHPrice);
        assertEq(oracle.elizaUsdPrice(), newElizaPrice);
    }

    function testCannotUpdateWithLargeDeviation() public {
        uint256 newETHPrice = 500000000000; // $5,000 (67% increase)
        uint256 newElizaPrice = 10000000;

        vm.prank(updater);
        vm.expectRevert(ManualPriceOracle.PriceDeviationTooLarge.selector);
        oracle.updatePrices(newETHPrice, newElizaPrice);
    }

    function testOwnerCanEmergencyUpdate() public {
        uint256 newETHPrice = 500000000000; // Large jump
        uint256 newElizaPrice = 20000000;

        oracle.emergencyPriceUpdate(newETHPrice, newElizaPrice);

        assertEq(oracle.ethUsdPrice(), newETHPrice);
    }

    function testPriceOutOfBounds() public {
        uint256 tooHigh = 2000000000000; // $20,000 (exceeds max)

        vm.prank(updater);
        vm.expectRevert(ManualPriceOracle.PriceOutOfBounds.selector);
        oracle.updatePrices(tooHigh, INITIAL_ELIZA_PRICE);
    }

    function testIsPriceFresh() public {
        assertTrue(oracle.isPriceFresh());

        // Warp time 2 hours
        vm.warp(block.timestamp + 2 hours);

        assertFalse(oracle.isPriceFresh());
    }

    function testOnlyAuthorizedCanUpdate() public {
        vm.prank(address(0x999));
        vm.expectRevert(ManualPriceOracle.NotAuthorized.selector);
        oracle.updatePrices(INITIAL_ETH_PRICE, INITIAL_ELIZA_PRICE);
    }

    function testPreviewConversion() public view {
        uint256 result = oracle.previewConversion(1 ether);
        assertEq(result, 30000e18); // 1 ETH = 30,000 elizaOS
    }
}
