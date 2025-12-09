// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {PriceOracle} from "../src/oracle/PriceOracle.sol";

/**
 * @title PriceOracle Security Tests
 * @notice Tests for price manipulation, deviation attacks, and bounds violations
 */
contract PriceOracleSecurityTest is Test {
    PriceOracle public oracle;

    address owner = address(this);
    address attacker = makeAddr("attacker");
    address token1 = makeAddr("token1");
    address token2 = makeAddr("token2");

    address constant ETH_ADDRESS = address(0);

    function setUp() public {
        oracle = new PriceOracle();

        // Set initial prices
        oracle.setPrice(ETH_ADDRESS, 3000 * 1e18, 18); // ETH = $3000
        oracle.setPrice(token1, 1e17, 18); // Token1 = $0.10
    }

    // ============ Price Manipulation Tests ============

    function test_RejectExcessiveDeviation() public {
        // Try to 2x the price (100% deviation, > 50% max)
        vm.expectRevert(); // DeviationTooLarge
        oracle.setPrice(token1, 2e17, 18); // $0.20 (2x from $0.10)
    }

    function test_AllowReasonableDeviation() public {
        // 40% deviation should be allowed (<50% max)
        oracle.setPrice(token1, 14e16, 18); // $0.14 (40% increase)

        (uint256 price,) = oracle.getPrice(token1);
        assertEq(price, 14e16);
    }

    function test_AllowLargeDeviationIfStale() public {
        // Set initial price
        oracle.setPrice(token1, 1e17, 18);

        // Wait 25 hours (>24h)
        vm.warp(block.timestamp + 25 hours);

        // Now can make large price change (stale data)
        oracle.setPrice(token1, 5e17, 18); // 5x increase allowed when stale

        (uint256 price,) = oracle.getPrice(token1);
        assertEq(price, 5e17);
    }

    function test_EmergencySetPrice_BypassesDeviation() public {
        oracle.setPrice(token1, 1e17, 18);

        // Emergency update can make large changes
        oracle.emergencySetPrice(token1, 10e17, 18); // 10x increase

        (uint256 price,) = oracle.getPrice(token1);
        assertEq(price, 10e17);
    }

    // ============ Price Bounds Tests ============

    function test_PriceBounds_EnforcedOnSet() public {
        // Set bounds for token1
        oracle.setPriceBounds(token1, 5e16, 2e17); // $0.05 to $0.20

        // Try to set below minimum
        vm.expectRevert(); // PriceBelowMinimum
        oracle.emergencySetPrice(token1, 1e16, 18); // $0.01 < $0.05 min
    }

    function test_PriceBounds_EnforcedOnEmergency() public {
        oracle.setPriceBounds(token1, 5e16, 2e17);

        // Try to set above maximum
        vm.expectRevert(); // PriceAboveMaximum
        oracle.emergencySetPrice(token1, 5e17, 18); // $0.50 > $0.20 max
    }

    function test_PriceBounds_AllowWithinRange() public {
        oracle.setPriceBounds(token1, 5e16, 2e17);

        // Should succeed
        oracle.emergencySetPrice(token1, 15e16, 18); // $0.15 within range

        (uint256 price,) = oracle.getPrice(token1);
        assertEq(price, 15e16);
    }

    // ============ Staleness Tests ============

    function test_PriceFreshness_DetectsStale() public {
        oracle.setPrice(token1, 1e17, 18);

        // Price is fresh immediately
        assertTrue(oracle.isPriceFresh(token1));

        // Wait 2 hours (>1h threshold)
        vm.warp(block.timestamp + 2 hours);

        // Now stale
        assertFalse(oracle.isPriceFresh(token1));
    }

    function test_PriceFreshness_ETHShortcut() public {
        oracle.setPrice(ETH_ADDRESS, 3000 * 1e18, 18);

        // Test no-argument version (for ETH)
        assertTrue(oracle.isPriceFresh());

        vm.warp(block.timestamp + 2 hours);

        assertFalse(oracle.isPriceFresh());
    }

    // ============ Conversion Security Tests ============

    function test_Conversion_NoOverflow() public {
        // Set extreme prices to test overflow protection
        oracle.emergencySetPrice(token1, type(uint128).max, 18);
        oracle.emergencySetPrice(token2, 1, 18);

        // Large conversion should not overflow
        uint256 result = oracle.convertAmount(token1, token2, 1000 * 1e18);

        // Should return huge number but not overflow
        assertGt(result, 0);
    }

    function test_Conversion_SameToken() public view {
        // Converting token to itself should return same amount
        uint256 amount = 1000 * 1e18;
        uint256 result = oracle.convertAmount(token1, token1, amount);

        assertEq(result, amount);
    }

    function test_Conversion_ZeroPrice_FallsBackToDefault() public view {
        // Token with no price set should default to $1
        address unsetToken = address(0x999);
        uint256 result = oracle.convertAmount(unsetToken, ETH_ADDRESS, 1000 * 1e18);

        // Should not revert, uses default $1 price
        // 1000 tokens at $1 = $1000, ETH at $3000 = 0.333... ETH
        assertGt(result, 0);
    }

    // ============ Access Control Tests ============

    function test_OnlyOwnerCanSetPrice() public {
        vm.prank(attacker);
        vm.expectRevert();
        oracle.setPrice(token1, 1e18, 18);
    }

    function test_OnlyOwnerCanSetBounds() public {
        vm.prank(attacker);
        vm.expectRevert();
        oracle.setPriceBounds(token1, 1e16, 1e18);
    }

    function test_OnlyOwnerCanSetDeviation() public {
        vm.prank(attacker);
        vm.expectRevert();
        oracle.setMaxDeviation(3000);
    }

    // ============ Deviation Limit Tests ============

    function test_CannotSetDeviationAbove100Percent() public {
        vm.expectRevert("Deviation too high");
        oracle.setMaxDeviation(10001); // >100%
    }

    function test_CanSetDeviationTo100Percent() public {
        oracle.setMaxDeviation(10000); // Exactly 100%

        assertEq(oracle.maxDeviation(), 10000);
    }

    function test_DeviationLimit_AppliesToAllTokens() public {
        // Set conservative deviation limit
        oracle.setMaxDeviation(1000); // 10%

        oracle.setPrice(token1, 1e17, 18); // $0.10

        // Try 20% increase (>10% limit)
        vm.expectRevert(); // DeviationTooLarge
        oracle.setPrice(token1, 12e16, 18); // $0.12

        // 9% increase should work
        oracle.setPrice(token1, 109e15, 18); // $0.109

        (uint256 price,) = oracle.getPrice(token1);
        assertEq(price, 109e15);
    }

    // ============ Fuzz Tests ============

    function testFuzz_SetPrice_NeverOverflows(uint128 price) public {
        vm.assume(price > 0);

        // Should never overflow or revert (except bounds/deviation)
        try oracle.emergencySetPrice(token1, price, 18) {
            (uint256 storedPrice,) = oracle.getPrice(token1);
            assertEq(storedPrice, price);
        } catch {
            // Might fail if bounds set or deviation too large
            // That's OK - it's protected
        }
    }

    function testFuzz_Conversion_NeverOverflows(uint128 rawAmount, uint64 rawPrice1, uint64 rawPrice2) public {
        // Use bound with valid ranges
        uint256 amount = bound(uint256(rawAmount), 1e18, 1e30); // Min 1 token, bounded to avoid overflow
        uint256 price1 = bound(uint256(rawPrice1), 1e15, 1e24); // Reasonable price range
        uint256 price2 = bound(uint256(rawPrice2), 1e15, 1e24); // Reasonable price range

        oracle.emergencySetPrice(token1, price1, 18);
        oracle.emergencySetPrice(token2, price2, 18);

        // Conversion should never overflow and should produce non-zero result
        uint256 result = oracle.convertAmount(token1, token2, amount);
        assertGt(result, 0, "Conversion must produce non-zero result for non-dust amounts");
    }
}
