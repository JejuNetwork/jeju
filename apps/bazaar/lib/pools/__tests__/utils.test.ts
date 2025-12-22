/**
 * Unit tests for pool utility functions
 * Tests complex math operations: tick/price conversion, sqrt price calculation, pool key validation
 */

import { describe, test, expect } from 'bun:test';
import {
  computePoolId,
  sortTokens,
  createPoolKey,
  formatFee,
  getTickSpacing,
  calculateSqrtPriceX96,
  sqrtPriceX96ToPrice,
  formatLiquidity,
  getFeeTiers,
  getZeroAddress,
  validatePoolKey,
  priceToTick,
  tickToPrice,
} from '../utils';
import type { Address } from 'viem';

// Test addresses
const TOKEN_A = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address; // USDC
const TOKEN_B = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address; // WETH
const TOKEN_C = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984' as Address; // UNI token (valid checksum)
const ZERO_HOOKS = '0x0000000000000000000000000000000000000000' as Address;

// =============================================================================
// SQRT PRICE CALCULATION TESTS
// =============================================================================

describe('calculateSqrtPriceX96', () => {
  const Q96 = 2n ** 96n;

  test('should calculate sqrtPriceX96 for 1:1 ratio', () => {
    const amount0 = 1000n * 10n ** 18n;
    const amount1 = 1000n * 10n ** 18n;

    const sqrtPriceX96 = calculateSqrtPriceX96(amount0, amount1);
    const price = sqrtPriceX96ToPrice(sqrtPriceX96);

    // Price should be ~1.0
    expect(price).toBeCloseTo(1.0, 5);
  });

  test('should calculate sqrtPriceX96 for 4:1 ratio', () => {
    const amount0 = 100n * 10n ** 18n;
    const amount1 = 400n * 10n ** 18n;

    const sqrtPriceX96 = calculateSqrtPriceX96(amount0, amount1);
    const price = sqrtPriceX96ToPrice(sqrtPriceX96);

    // Price should be ~4.0
    expect(price).toBeCloseTo(4.0, 4);
  });

  test('should calculate sqrtPriceX96 for 1:4 ratio', () => {
    const amount0 = 400n * 10n ** 18n;
    const amount1 = 100n * 10n ** 18n;

    const sqrtPriceX96 = calculateSqrtPriceX96(amount0, amount1);
    const price = sqrtPriceX96ToPrice(sqrtPriceX96);

    // Price should be ~0.25
    expect(price).toBeCloseTo(0.25, 4);
  });

  test('should throw for zero amount0', () => {
    const amount0 = 0n;
    const amount1 = 100n * 10n ** 18n;

    expect(() => calculateSqrtPriceX96(amount0, amount1)).toThrow('Amount0 cannot be zero');
  });

  test('should handle large numbers (realistic pool sizes)', () => {
    // 1000 ETH and 3,500,000 USDC (ETH @ $3500)
    const ethAmount = 1000n * 10n ** 18n;
    const usdcAmount = 3500000n * 10n ** 6n; // USDC has 6 decimals

    // Adjust for decimal difference (18 - 6 = 12)
    const adjustedUsdc = usdcAmount * 10n ** 12n;

    const sqrtPriceX96 = calculateSqrtPriceX96(ethAmount, adjustedUsdc);
    const price = sqrtPriceX96ToPrice(sqrtPriceX96);

    // Price should be ~3500
    expect(price).toBeCloseTo(3500, -1); // Within 10
  });
});

describe('sqrtPriceX96ToPrice', () => {
  const Q96 = 2n ** 96n;

  test('should convert Q96 to price 1.0', () => {
    const sqrtPriceX96 = Q96;
    const price = sqrtPriceX96ToPrice(sqrtPriceX96);

    expect(price).toBe(1.0);
  });

  test('should convert 2*Q96 to price 4.0', () => {
    const sqrtPriceX96 = Q96 * 2n;
    const price = sqrtPriceX96ToPrice(sqrtPriceX96);

    expect(price).toBe(4.0);
  });

  test('should convert Q96/2 to price 0.25', () => {
    const sqrtPriceX96 = Q96 / 2n;
    const price = sqrtPriceX96ToPrice(sqrtPriceX96);

    expect(price).toBe(0.25);
  });

  test('should handle very small prices', () => {
    const sqrtPriceX96 = Q96 / 100n; // sqrt(0.0001)
    const price = sqrtPriceX96ToPrice(sqrtPriceX96);

    expect(price).toBeCloseTo(0.0001, 6);
  });
});

// =============================================================================
// TICK/PRICE CONVERSION TESTS
// =============================================================================

describe('priceToTick', () => {
  test('should return tick 0 for price 1.0', () => {
    const tick = priceToTick(1.0);
    expect(tick).toBe(0);
  });

  test('should return positive tick for price > 1', () => {
    const tick = priceToTick(2.0);
    // log(2) / log(1.0001) ≈ 6931
    expect(tick).toBeGreaterThan(6900);
    expect(tick).toBeLessThan(6960);
  });

  test('should return negative tick for price < 1', () => {
    const tick = priceToTick(0.5);
    // log(0.5) / log(1.0001) ≈ -6931
    expect(tick).toBeLessThan(-6900);
    expect(tick).toBeGreaterThan(-6960);
  });

  test('should handle very small price', () => {
    const tick = priceToTick(0.0001);
    expect(tick).toBeLessThan(-90000);
  });

  test('should handle large price', () => {
    const tick = priceToTick(10000);
    // log(10000) / log(1.0001) ≈ 92103
    expect(tick).toBeGreaterThan(92000);
    expect(tick).toBeLessThan(92200);
  });
});

describe('tickToPrice', () => {
  test('should return price 1.0 for tick 0', () => {
    const price = tickToPrice(0);
    expect(price).toBe(1.0);
  });

  test('should return price > 1 for positive tick', () => {
    const price = tickToPrice(6931);
    expect(price).toBeCloseTo(2.0, 2);
  });

  test('should return price < 1 for negative tick', () => {
    const price = tickToPrice(-6931);
    expect(price).toBeCloseTo(0.5, 2);
  });

  test('should roundtrip price → tick → price', () => {
    const originalPrices = [0.5, 1.0, 2.0, 10.0, 100.0, 0.01];

    for (const originalPrice of originalPrices) {
      const tick = priceToTick(originalPrice);
      const recoveredPrice = tickToPrice(tick);
      // Allow some tolerance due to tick discretization
      expect(recoveredPrice / originalPrice).toBeCloseTo(1.0, 2);
    }
  });
});

// =============================================================================
// TOKEN SORTING AND POOL KEY TESTS
// =============================================================================

describe('sortTokens', () => {
  test('should sort tokens in ascending order', () => {
    const [sorted0, sorted1] = sortTokens(TOKEN_B, TOKEN_A);

    expect(sorted0.toLowerCase() < sorted1.toLowerCase()).toBe(true);
  });

  test('should keep already sorted tokens unchanged', () => {
    const [sorted0, sorted1] = sortTokens(TOKEN_A, TOKEN_B);

    expect(sorted0).toBe(TOKEN_A);
    expect(sorted1).toBe(TOKEN_B);
  });

  test('should handle case-insensitive comparison', () => {
    const lower = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as Address;
    const upper = '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as Address;

    const [sorted0, sorted1] = sortTokens(lower, upper);
    // Should treat them as the same (or consistently)
    expect(sorted0.toLowerCase()).toBe(sorted1.toLowerCase());
  });
});

describe('createPoolKey', () => {
  test('should create pool key with sorted tokens', () => {
    const poolKey = createPoolKey(TOKEN_B, TOKEN_A, 3000, 60);

    // Tokens should be sorted
    expect(poolKey.currency0.toLowerCase() < poolKey.currency1.toLowerCase()).toBe(true);
    expect(poolKey.fee).toBe(3000);
    expect(poolKey.tickSpacing).toBe(60);
    expect(poolKey.hooks).toBe(ZERO_HOOKS);
  });

  test('should accept custom hooks address', () => {
    const customHooks = '0x1234567890123456789012345678901234567890' as Address;
    const poolKey = createPoolKey(TOKEN_A, TOKEN_B, 500, 10, customHooks);

    expect(poolKey.hooks).toBe(customHooks);
  });
});

describe('computePoolId', () => {
  test('should compute deterministic pool id', () => {
    const poolKey = createPoolKey(TOKEN_A, TOKEN_B, 3000, 60);

    const poolId1 = computePoolId(poolKey);
    const poolId2 = computePoolId(poolKey);

    expect(poolId1).toBe(poolId2);
    expect(poolId1.startsWith('0x')).toBe(true);
    expect(poolId1.length).toBe(66); // 0x + 64 hex chars
  });

  test('should produce different ids for different fees', () => {
    const poolKey1 = createPoolKey(TOKEN_A, TOKEN_B, 3000, 60);
    const poolKey2 = createPoolKey(TOKEN_A, TOKEN_B, 500, 10);

    const poolId1 = computePoolId(poolKey1);
    const poolId2 = computePoolId(poolKey2);

    expect(poolId1).not.toBe(poolId2);
  });

  test('should produce different ids for different tokens', () => {
    const poolKey1 = createPoolKey(TOKEN_A, TOKEN_B, 3000, 60);
    const poolKey2 = createPoolKey(TOKEN_A, TOKEN_C, 3000, 60);

    const poolId1 = computePoolId(poolKey1);
    const poolId2 = computePoolId(poolKey2);

    expect(poolId1).not.toBe(poolId2);
  });
});

describe('validatePoolKey', () => {
  test('should validate correct pool key', () => {
    const poolKey = createPoolKey(TOKEN_A, TOKEN_B, 3000, 60);
    
    // Should not throw
    expect(() => validatePoolKey(poolKey)).not.toThrow();
  });

  test('should throw for same tokens', () => {
    expect(() => {
      validatePoolKey({
        currency0: TOKEN_A,
        currency1: TOKEN_A,
        fee: 3000,
        tickSpacing: 60,
        hooks: ZERO_HOOKS,
      });
    }).toThrow('Tokens must be different');
  });

  test('should throw for unsorted tokens', () => {
    expect(() => {
      validatePoolKey({
        currency0: TOKEN_B, // B > A alphabetically
        currency1: TOKEN_A,
        fee: 3000,
        tickSpacing: 60,
        hooks: ZERO_HOOKS,
      });
    }).toThrow('currency0 must be less than currency1');
  });

  test('should throw for invalid fee', () => {
    expect(() => {
      validatePoolKey({
        currency0: TOKEN_A,
        currency1: TOKEN_B,
        fee: -1,
        tickSpacing: 60,
        hooks: ZERO_HOOKS,
      });
    }).toThrow('Fee must be between 0 and 1000000');
  });

  test('should throw for non-positive tick spacing', () => {
    expect(() => {
      validatePoolKey({
        currency0: TOKEN_A,
        currency1: TOKEN_B,
        fee: 3000,
        tickSpacing: 0,
        hooks: ZERO_HOOKS,
      });
    }).toThrow();
  });
});

// =============================================================================
// FEE AND TICK SPACING TESTS
// =============================================================================

describe('getTickSpacing', () => {
  test('should return 10 for lowest fee tier (0.01%)', () => {
    expect(getTickSpacing(100)).toBe(10);
  });

  test('should return 10 for 0.05% fee tier', () => {
    expect(getTickSpacing(500)).toBe(10);
  });

  test('should return 60 for 0.3% fee tier', () => {
    expect(getTickSpacing(3000)).toBe(60);
  });

  test('should return 200 for 1% fee tier', () => {
    expect(getTickSpacing(10000)).toBe(200);
  });

  test('should return 200 for fees above 1%', () => {
    expect(getTickSpacing(50000)).toBe(200);
  });
});

describe('formatFee', () => {
  test('should format 100 bp as 0.01%', () => {
    expect(formatFee(100)).toBe('0.01%');
  });

  test('should format 500 bp as 0.05%', () => {
    expect(formatFee(500)).toBe('0.05%');
  });

  test('should format 3000 bp as 0.30%', () => {
    expect(formatFee(3000)).toBe('0.30%');
  });

  test('should format 10000 bp as 1.00%', () => {
    expect(formatFee(10000)).toBe('1.00%');
  });
});

describe('getFeeTiers', () => {
  test('should return all 4 fee tiers', () => {
    const tiers = getFeeTiers();

    expect(tiers).toHaveLength(4);
    expect(tiers[0]).toEqual({ value: 100, label: '0.01%' });
    expect(tiers[1]).toEqual({ value: 500, label: '0.05%' });
    expect(tiers[2]).toEqual({ value: 3000, label: '0.3%' });
    expect(tiers[3]).toEqual({ value: 10000, label: '1%' });
  });
});

// =============================================================================
// FORMATTING TESTS
// =============================================================================

describe('formatLiquidity', () => {
  test('should format small liquidity', () => {
    const liquidity = 100n * 10n ** 18n;
    expect(formatLiquidity(liquidity)).toBe('100.00');
  });

  test('should format thousands with K suffix', () => {
    const liquidity = 5000n * 10n ** 18n;
    expect(formatLiquidity(liquidity)).toBe('5.00K');
  });

  test('should format millions with M suffix', () => {
    const liquidity = 2500000n * 10n ** 18n;
    expect(formatLiquidity(liquidity)).toBe('2.50M');
  });

  test('should handle custom decimals', () => {
    const liquidity = 1000n * 10n ** 6n; // 1000 USDC (6 decimals)
    expect(formatLiquidity(liquidity, 6)).toBe('1.00K');
  });

  test('should handle zero liquidity', () => {
    expect(formatLiquidity(0n)).toBe('0.00');
  });
});

describe('getZeroAddress', () => {
  test('should return the zero address', () => {
    expect(getZeroAddress()).toBe('0x0000000000000000000000000000000000000000');
  });
});

// =============================================================================
// PROPERTY-BASED / FUZZING TESTS
// =============================================================================

describe('Property-based tests', () => {
  test('tick/price conversion should be monotonic', () => {
    // Higher price should always give higher tick
    const prices = [0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 50.0, 100.0];
    const ticks = prices.map(priceToTick);

    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
    }
  });

  test('tick/price should be approximately inverse', () => {
    const testTicks = [-50000, -10000, -1000, 0, 1000, 10000, 50000];

    for (const tick of testTicks) {
      const price = tickToPrice(tick);
      const recoveredTick = priceToTick(price);

      // Should recover within 1 tick
      expect(Math.abs(recoveredTick - tick)).toBeLessThanOrEqual(1);
    }
  });

  test('sqrtPriceX96 conversion should preserve ordering', () => {
    const Q96 = 2n ** 96n;
    const sqrtPrices = [Q96 / 10n, Q96 / 2n, Q96, Q96 * 2n, Q96 * 10n];
    const prices = sqrtPrices.map(sqrtPriceX96ToPrice);

    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]).toBeGreaterThan(prices[i - 1]);
    }
  });

  test('sortTokens should be idempotent', () => {
    const [first0, first1] = sortTokens(TOKEN_A, TOKEN_B);
    const [second0, second1] = sortTokens(first0, first1);

    expect(second0).toBe(first0);
    expect(second1).toBe(first1);
  });
});
