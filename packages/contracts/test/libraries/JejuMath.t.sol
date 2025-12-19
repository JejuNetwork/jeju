// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {JejuMath} from "../../src/libraries/JejuMath.sol";

contract JejuMathHarness {
    function exp(uint256 x) external pure returns (uint256) {
        return JejuMath.exp(x);
    }

    function ln(uint256 x) external pure returns (uint256) {
        return JejuMath.ln(x);
    }

    function lnSigned(uint256 x) external pure returns (uint256 result, bool isNegative) {
        return JejuMath.lnSigned(x);
    }

    function sqrt(uint256 x) external pure returns (uint256) {
        return JejuMath.sqrt(x);
    }

    function lmsrCost(uint256 qYes, uint256 qNo, uint256 b) external pure returns (uint256) {
        return JejuMath.lmsrCost(qYes, qNo, b);
    }

    function lmsrPrice(uint256 qYes, uint256 qNo, uint256 b, bool forYes) external pure returns (uint256) {
        return JejuMath.lmsrPrice(qYes, qNo, b, forYes);
    }

    function lmsrSharesForCost(
        uint256 qYes,
        uint256 qNo,
        uint256 b,
        uint256 cost,
        bool buyYes
    ) external pure returns (uint256) {
        return JejuMath.lmsrSharesForCost(qYes, qNo, b, cost, buyYes);
    }

    function mulDiv(uint256 a, uint256 b, uint256 denominator) external pure returns (uint256) {
        return JejuMath.mulDiv(a, b, denominator);
    }

    function bps(uint256 value, uint256 bps_) external pure returns (uint256) {
        return JejuMath.bps(value, bps_);
    }

    function absDiff(uint256 a, uint256 b) external pure returns (uint256) {
        return JejuMath.absDiff(a, b);
    }

    function PRECISION() external pure returns (uint256) {
        return JejuMath.PRECISION;
    }

    function MAX_EXP_INPUT() external pure returns (uint256) {
        return JejuMath.MAX_EXP_INPUT;
    }
}

contract JejuMathTest is Test {
    JejuMathHarness harness;
    uint256 constant PRECISION = 1e18;
    uint256 constant E = 2718281828459045235; // e with 18 decimals

    function setUp() public {
        harness = new JejuMathHarness();
    }

    // ============ exp() Tests ============

    function test_exp_zero() public view {
        assertEq(harness.exp(0), PRECISION);
    }

    function test_exp_one() public view {
        uint256 result = harness.exp(PRECISION);
        // e^1 ≈ 2.718...
        assertApproxEqRel(result, E, 0.01e18); // 1% tolerance
    }

    function test_exp_two() public view {
        uint256 result = harness.exp(2 * PRECISION);
        // e^2 ≈ 7.389...
        uint256 expected = 7389056098930650227;
        assertApproxEqRel(result, expected, 0.01e18);
    }

    function test_exp_small_value() public view {
        uint256 result = harness.exp(0.5e18);
        // e^0.5 ≈ 1.6487...
        uint256 expected = 1648721270700128146;
        assertApproxEqRel(result, expected, 0.01e18);
    }

    function test_exp_large_value_uses_recursion() public view {
        uint256 result = harness.exp(20e18);
        // e^20 is large but should not overflow
        assertTrue(result > 0);
        assertTrue(result > E);
    }

    function test_exp_revert_overflow() public {
        vm.expectRevert(JejuMath.MathOverflow.selector);
        harness.exp(131e18); // > MAX_EXP_INPUT
    }

    // ============ ln() Tests ============

    function test_ln_one() public view {
        assertEq(harness.ln(PRECISION), 0);
    }

    function test_ln_e() public view {
        uint256 result = harness.ln(E);
        // ln(e) = 1
        assertApproxEqRel(result, PRECISION, 0.02e18); // 2% tolerance
    }

    function test_ln_two() public view {
        uint256 result = harness.ln(2 * PRECISION);
        // ln(2) ≈ 0.693...
        uint256 expected = 693147180559945309;
        assertApproxEqRel(result, expected, 0.05e18); // 5% tolerance
    }

    function test_ln_ten() public view {
        uint256 result = harness.ln(10 * PRECISION);
        // ln(10) ≈ 2.302...
        uint256 expected = 2302585092994045684;
        assertApproxEqRel(result, expected, 0.05e18);
    }

    function test_ln_revert_zero() public {
        vm.expectRevert(JejuMath.InvalidInput.selector);
        harness.ln(0);
    }

    function test_ln_revert_less_than_one() public {
        vm.expectRevert(JejuMath.InvalidInput.selector);
        harness.ln(0.5e18); // x < 1
    }

    // ============ lnSigned() Tests ============

    function test_lnSigned_greater_than_one() public view {
        (uint256 result, bool isNegative) = harness.lnSigned(2 * PRECISION);
        assertFalse(isNegative);
        assertTrue(result > 0);
    }

    function test_lnSigned_less_than_one() public view {
        (uint256 result, bool isNegative) = harness.lnSigned(0.5e18);
        assertTrue(isNegative);
        // |ln(0.5)| = ln(2) ≈ 0.693
        assertApproxEqRel(result, 693147180559945309, 0.05e18);
    }

    function test_lnSigned_one() public view {
        (uint256 result, bool isNegative) = harness.lnSigned(PRECISION);
        assertEq(result, 0);
        assertFalse(isNegative);
    }

    // ============ sqrt() Tests ============

    function test_sqrt_zero() public view {
        assertEq(harness.sqrt(0), 0);
    }

    function test_sqrt_one() public view {
        assertEq(harness.sqrt(PRECISION), PRECISION);
    }

    function test_sqrt_four() public view {
        uint256 result = harness.sqrt(4 * PRECISION);
        assertApproxEqRel(result, 2 * PRECISION, 0.001e18);
    }

    function test_sqrt_two() public view {
        uint256 result = harness.sqrt(2 * PRECISION);
        // sqrt(2) ≈ 1.414...
        uint256 expected = 1414213562373095048;
        assertApproxEqRel(result, expected, 0.001e18);
    }

    // ============ LMSR Tests ============

    function test_lmsrCost_equal_shares() public view {
        uint256 b = 100e18;
        uint256 cost = harness.lmsrCost(0, 0, b);
        // C(0,0) = b * ln(e^0 + e^0) = b * ln(2)
        uint256 expected = (b * 693147180559945309) / PRECISION;
        assertApproxEqRel(cost, expected, 0.05e18);
    }

    function test_lmsrPrice_equal_shares() public view {
        uint256 b = 100e18;
        uint256 yesPrice = harness.lmsrPrice(0, 0, b, true);
        uint256 noPrice = harness.lmsrPrice(0, 0, b, false);
        
        // With equal shares, prices should be ~50% each
        assertApproxEqRel(yesPrice, 5000, 0.01e18);
        assertApproxEqRel(noPrice, 5000, 0.01e18);
        assertEq(yesPrice + noPrice, 10000); // Sum to 100%
    }

    function test_lmsrPrice_more_yes_shares() public view {
        uint256 b = 100e18;
        uint256 yesPrice = harness.lmsrPrice(50e18, 0, b, true);
        uint256 noPrice = harness.lmsrPrice(50e18, 0, b, false);
        
        // More yes shares means higher yes price
        assertTrue(yesPrice > 5000);
        assertTrue(noPrice < 5000);
        // Sum should be 10000 or 9999 due to rounding
        assertTrue(yesPrice + noPrice >= 9999 && yesPrice + noPrice <= 10000);
    }

    function test_lmsrSharesForCost_returns_positive() public view {
        uint256 b = 100e18;
        uint256 shares = harness.lmsrSharesForCost(0, 0, b, 10e18, true);
        assertTrue(shares > 0);
    }

    function test_lmsrSharesForCost_zero_cost() public view {
        uint256 b = 100e18;
        uint256 shares = harness.lmsrSharesForCost(0, 0, b, 0, true);
        assertEq(shares, 0);
    }

    function test_lmsrCost_revert_zero_b() public {
        vm.expectRevert(JejuMath.DivisionByZero.selector);
        harness.lmsrCost(0, 0, 0);
    }

    // ============ Utility Tests ============

    function test_mulDiv_basic() public view {
        uint256 result = harness.mulDiv(10, 20, 5);
        assertEq(result, 40);
    }

    function test_mulDiv_precision() public view {
        uint256 result = harness.mulDiv(PRECISION, PRECISION, PRECISION);
        assertEq(result, PRECISION);
    }

    function test_mulDiv_large_numbers() public view {
        uint256 result = harness.mulDiv(type(uint128).max, type(uint128).max, type(uint128).max);
        assertEq(result, type(uint128).max);
    }

    function test_mulDiv_revert_zero_denominator() public {
        vm.expectRevert(JejuMath.DivisionByZero.selector);
        harness.mulDiv(10, 20, 0);
    }

    function test_bps_basic() public view {
        uint256 result = harness.bps(10000, 500);
        assertEq(result, 500); // 5% of 10000
    }

    function test_bps_full() public view {
        uint256 result = harness.bps(10000, 10000);
        assertEq(result, 10000); // 100%
    }

    function test_absDiff() public view {
        assertEq(harness.absDiff(10, 5), 5);
        assertEq(harness.absDiff(5, 10), 5);
        assertEq(harness.absDiff(10, 10), 0);
    }

    // ============ Fuzz Tests ============

    function testFuzz_exp_ln_inverse(uint256 x) public view {
        // Bound x to reasonable range where exp and ln are both valid
        x = bound(x, PRECISION, 5 * PRECISION); // 1 <= x <= 5
        
        uint256 expResult = harness.exp(x);
        uint256 lnResult = harness.ln(expResult);
        
        // ln(exp(x)) should approximately equal x
        assertApproxEqRel(lnResult, x, 0.1e18); // 10% tolerance for numerical precision
    }

    function testFuzz_sqrt_squared(uint256 x) public view {
        // Input x is in 18-decimal format, so minimum should be PRECISION (1.0)
        // to avoid precision loss with very small fractional inputs
        x = bound(x, PRECISION, 1000 * PRECISION);
        
        uint256 sqrtResult = harness.sqrt(x);
        uint256 squared = (sqrtResult * sqrtResult) / PRECISION;
        
        // sqrt(x)^2 should approximately equal x (within 1% due to rounding)
        assertApproxEqRel(squared, x, 0.01e18);
    }

    function testFuzz_lmsr_prices_sum_to_100(uint256 qYes, uint256 qNo, uint256 b) public view {
        // Bound b first, then bound q values relative to b to avoid overflow in exp()
        // exp() overflows when input > 130e18, so qYes/b and qNo/b must be < 130
        b = bound(b, PRECISION, 1000 * PRECISION);
        qYes = bound(qYes, 0, 100 * b / PRECISION); // q/b < 100, well under 130
        qNo = bound(qNo, 0, 100 * b / PRECISION);
        
        uint256 yesPrice = harness.lmsrPrice(qYes, qNo, b, true);
        uint256 noPrice = harness.lmsrPrice(qYes, qNo, b, false);
        
        // Prices should sum to 10000 (100%) or 9999 due to rounding
        uint256 sum = yesPrice + noPrice;
        assertTrue(sum >= 9999 && sum <= 10000, "Prices should sum to ~100%");
    }

    function testFuzz_absDiff_commutative(uint256 a, uint256 b) public view {
        assertEq(harness.absDiff(a, b), harness.absDiff(b, a));
    }
}
