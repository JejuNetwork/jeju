/**
 * Unit tests for XLP V2 utility functions
 * Tests V2 constant product AMM calculations
 */

import { describe, test, expect } from 'bun:test';
import { calculateV2SwapOutput } from '../useXLPV2';

// =============================================================================
// V2 SWAP OUTPUT CALCULATION TESTS
// =============================================================================

describe('calculateV2SwapOutput', () => {
  const ONE_ETH = 10n ** 18n;
  const THOUSAND_ETH = 1000n * ONE_ETH;

  test('should return zero for zero input', () => {
    const result = calculateV2SwapOutput(0n, THOUSAND_ETH, THOUSAND_ETH);

    expect(result.amountOut).toBe(0n);
    expect(result.priceImpact).toBe(0);
    expect(result.fee).toBe(0n);
  });

  test('should return zero for zero reserve in', () => {
    const result = calculateV2SwapOutput(ONE_ETH, 0n, THOUSAND_ETH);

    expect(result.amountOut).toBe(0n);
    expect(result.priceImpact).toBe(0);
    expect(result.fee).toBe(0n);
  });

  test('should return zero for zero reserve out', () => {
    const result = calculateV2SwapOutput(ONE_ETH, THOUSAND_ETH, 0n);

    expect(result.amountOut).toBe(0n);
    expect(result.priceImpact).toBe(0);
    expect(result.fee).toBe(0n);
  });

  test('should calculate correct output for balanced pool', () => {
    // 1000 ETH / 1000 ETH pool, swap 10 ETH
    const amountIn = 10n * ONE_ETH;
    const reserveIn = THOUSAND_ETH;
    const reserveOut = THOUSAND_ETH;

    const result = calculateV2SwapOutput(amountIn, reserveIn, reserveOut);

    // Expected: (10 * 997 * 1000) / (1000 * 1000 + 10 * 997)
    // = 9970000 / 1009970 ≈ 9.87 ETH
    const expectedApprox = 9n * ONE_ETH + 870n * 10n ** 15n; // ~9.87 ETH
    
    expect(result.amountOut).toBeGreaterThan(9n * ONE_ETH);
    expect(result.amountOut).toBeLessThan(10n * ONE_ETH);
    expect(result.fee).toBe(amountIn * 3n / 1000n); // 0.3% fee
  });

  test('should calculate 0.3% fee correctly', () => {
    const amountIn = 1000n * ONE_ETH;
    const result = calculateV2SwapOutput(amountIn, THOUSAND_ETH, THOUSAND_ETH);

    // Fee should be exactly 0.3% of input
    const expectedFee = (amountIn * 3n) / 1000n;
    expect(result.fee).toBe(expectedFee);
  });

  test('should have positive price impact for large trades', () => {
    // Large trade relative to pool size should have significant price impact
    const amountIn = 100n * ONE_ETH; // 10% of pool
    const result = calculateV2SwapOutput(amountIn, THOUSAND_ETH, THOUSAND_ETH);

    expect(result.priceImpact).toBeGreaterThan(0);
  });

  test('should have higher price impact for larger trades', () => {
    const smallTrade = calculateV2SwapOutput(1n * ONE_ETH, THOUSAND_ETH, THOUSAND_ETH);
    const largeTrade = calculateV2SwapOutput(100n * ONE_ETH, THOUSAND_ETH, THOUSAND_ETH);

    expect(largeTrade.priceImpact).toBeGreaterThan(smallTrade.priceImpact);
  });

  test('should never output more than reserve out', () => {
    // Even with a huge input, output cannot exceed reserve
    const hugeInput = 10000000n * ONE_ETH;
    const result = calculateV2SwapOutput(hugeInput, THOUSAND_ETH, THOUSAND_ETH);

    expect(result.amountOut).toBeLessThan(THOUSAND_ETH);
  });

  test('should handle asymmetric pools correctly', () => {
    // ETH/USDC pool: 1000 ETH / 3,500,000 USDC (1 ETH = 3500 USDC)
    const ethReserve = 1000n * ONE_ETH;
    const usdcReserve = 3500000n * 10n ** 6n; // USDC has 6 decimals
    
    // Swap 1 ETH for USDC
    const amountIn = 1n * ONE_ETH;
    const result = calculateV2SwapOutput(amountIn, ethReserve, usdcReserve);

    // Should get approximately 3500 USDC minus fees and slippage
    expect(result.amountOut).toBeGreaterThan(3400n * 10n ** 6n);
    expect(result.amountOut).toBeLessThan(3500n * 10n ** 6n);
  });

  test('should maintain constant product invariant (approximately)', () => {
    const amountIn = 10n * ONE_ETH;
    const reserveIn = THOUSAND_ETH;
    const reserveOut = THOUSAND_ETH;

    const result = calculateV2SwapOutput(amountIn, reserveIn, reserveOut);

    // k = reserveIn * reserveOut before trade
    const kBefore = reserveIn * reserveOut;

    // After trade: (reserveIn + amountIn) * (reserveOut - amountOut)
    // Due to fees, k should increase slightly
    const amountInAfterFee = amountIn * 997n / 1000n;
    const kAfter = (reserveIn + amountInAfterFee) * (reserveOut - result.amountOut);

    // k should be preserved or increased (fees increase it)
    expect(kAfter).toBeGreaterThanOrEqual(kBefore);
  });
});

// =============================================================================
// EDGE CASE TESTS
// =============================================================================

describe('calculateV2SwapOutput edge cases', () => {
  test('should handle very small amounts', () => {
    const smallAmount = 1n; // 1 wei
    const reserve = 10n ** 18n;

    const result = calculateV2SwapOutput(smallAmount, reserve, reserve);

    // Should still calculate without overflow/underflow
    expect(result.amountOut).toBeGreaterThanOrEqual(0n);
    expect(result.fee).toBe(0n); // Fee rounds down to 0 for tiny amounts
  });

  test('should handle amounts close to reserve size', () => {
    const reserve = 1000n * 10n ** 18n;
    const almostAllReserve = 900n * 10n ** 18n;

    const result = calculateV2SwapOutput(almostAllReserve, reserve, reserve);

    // Should not overflow and should return valid output
    expect(result.amountOut).toBeGreaterThan(0n);
    expect(result.amountOut).toBeLessThan(reserve);
  });
});
