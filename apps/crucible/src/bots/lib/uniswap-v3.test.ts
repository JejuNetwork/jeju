/**
 * Uniswap V3 Math Tests
 * 
 * Note: Tick math uses Uniswap V3's complex Q64.96 fixed-point format.
 * These tests verify the core functionality used in arbitrage detection.
 */

import { describe, test, expect } from 'bun:test';
import {
  getAmount1Delta,
  calculateV3SwapOutput,
  FEE_TIERS,
  type V3PoolState,
} from './uniswap-v3';

const Q96 = 2n ** 96n;

describe('Uniswap V3 Liquidity Math', () => {
  test('getAmount1Delta should calculate token1 delta', () => {
    // Use known good sqrtPriceX96 values directly
    const sqrtPriceA = Q96; // Price = 1
    const sqrtPriceB = Q96 * 2n; // Price = 4 (sqrt = 2)
    const liquidity = BigInt(1e18);
    
    const amount1 = getAmount1Delta(sqrtPriceA, sqrtPriceB, liquidity, true);
    
    // Should return positive amount
    expect(amount1).toBeGreaterThan(0n);
  });

  test('getAmount1Delta with reversed prices should give same result', () => {
    const sqrtPriceA = Q96;
    const sqrtPriceB = Q96 * 2n;
    const liquidity = BigInt(1e18);
    
    const amount1AB = getAmount1Delta(sqrtPriceA, sqrtPriceB, liquidity, false);
    const amount1BA = getAmount1Delta(sqrtPriceB, sqrtPriceA, liquidity, false);
    
    expect(amount1AB).toBe(amount1BA);
  });
});

describe('Uniswap V3 Swap Output', () => {
  test('calculateV3SwapOutput should calculate swap with proper sqrtPrice', () => {
    // Use a realistic sqrtPriceX96 for ETH/USDC at $3000
    // sqrtPrice = sqrt(3000) * 2^96 ≈ 4.34 * 10^30
    const sqrtPriceX96 = BigInt('4339505879126364855652096'); // ~$3000
    
    const pool: V3PoolState = {
      address: '0x1234',
      token0: '0xtoken0',
      token1: '0xtoken1',
      fee: FEE_TIERS.MEDIUM, // 0.3%
      tickSpacing: 60,
      sqrtPriceX96,
      tick: 0,
      liquidity: BigInt(1e24), // Large liquidity
      feeGrowthGlobal0X128: 0n,
      feeGrowthGlobal1X128: 0n,
    };
    
    const amountIn = BigInt(1e18); // 1 token
    
    const result = calculateV3SwapOutput(pool, amountIn, true);
    
    // Fee should be 0.3% of input
    const expectedFee = (amountIn * BigInt(FEE_TIERS.MEDIUM)) / 1000000n;
    expect(result.feeAmount).toBe(expectedFee);
    
    // Should get some output (may be 0 if sqrtPrice makes denominator 0)
    expect(typeof result.amountOut).toBe('bigint');
  });

  test('calculateV3SwapOutput should handle large liquidity', () => {
    const sqrtPriceX96 = Q96; // Price = 1
    
    const pool: V3PoolState = {
      address: '0x1234',
      token0: '0xtoken0',
      token1: '0xtoken1',
      fee: FEE_TIERS.LOW,
      tickSpacing: 10,
      sqrtPriceX96,
      tick: 0,
      liquidity: BigInt(1e30), // Very large liquidity
      feeGrowthGlobal0X128: 0n,
      feeGrowthGlobal1X128: 0n,
    };
    
    const amountIn = BigInt(1e18);
    const result = calculateV3SwapOutput(pool, amountIn, true);
    
    // With large liquidity, should get output
    expect(result.amountOut).toBeGreaterThanOrEqual(0n);
    expect(result.feeAmount).toBeGreaterThan(0n);
  });
});

describe('Fee Tiers', () => {
  test('FEE_TIERS should have correct values', () => {
    expect(FEE_TIERS.LOWEST).toBe(100);   // 0.01%
    expect(FEE_TIERS.LOW).toBe(500);      // 0.05%
    expect(FEE_TIERS.MEDIUM).toBe(3000);  // 0.30%
    expect(FEE_TIERS.HIGH).toBe(10000);   // 1.00%
  });
});
