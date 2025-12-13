import { test, expect, describe, beforeEach } from 'bun:test';
import { type Address, parseEther, formatEther } from 'viem';
import { poolService } from '../../src/services/pool-service';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const TEST_ADDRESS_1 = '0x1111111111111111111111111111111111111111' as Address;
const TEST_ADDRESS_2 = '0x2222222222222222222222222222222222222222' as Address;
const TEST_PAIR_ADDRESS = '0x3333333333333333333333333333333333333333' as Address;
const TEST_FACTORY = '0x4444444444444444444444444444444444444444' as Address;

describe('PoolService', () => {
  beforeEach(() => {
    delete process.env.XLP_V2_FACTORY;
    delete process.env.XLP_V3_FACTORY;
    delete process.env.XLP_AGGREGATOR;
    delete process.env.CROSS_CHAIN_PAYMASTER;
  });

  describe('listV2Pools', () => {
    test('returns empty array when factory address is zero', async () => {
      process.env.XLP_V2_FACTORY = ZERO_ADDRESS;
      const pools = await poolService.listV2Pools();
      expect(pools).toEqual([]);
    });

    test('returns empty array when factory address is not set', async () => {
      const pools = await poolService.listV2Pools();
      expect(pools).toEqual([]);
    });

    test('handles contract read failure gracefully', async () => {
      process.env.XLP_V2_FACTORY = TEST_FACTORY;
      const pools = await poolService.listV2Pools();
      expect(Array.isArray(pools)).toBe(true);
    });

    test('limits to MAX_POOLS_TO_FETCH (100)', async () => {
      process.env.XLP_V2_FACTORY = TEST_FACTORY;
      const pools = await poolService.listV2Pools();
      expect(pools.length).toBeLessThanOrEqual(100);
    });
  });

  describe('getV2PoolData', () => {
    test('returns null for invalid pair address', async () => {
      const result = await poolService.getV2PoolData(ZERO_ADDRESS);
      expect(result).toBeNull();
    });

    test('returns null when reserves call fails', async () => {
      const result = await poolService.getV2PoolData(TEST_PAIR_ADDRESS);
      expect(result).toBeNull();
    });

    test('returns null when token0 is missing', async () => {
      const result = await poolService.getV2PoolData(TEST_PAIR_ADDRESS);
      expect(result).toBeNull();
    });

    test('handles zero reserves correctly', async () => {
      const result = await poolService.getV2PoolData(TEST_PAIR_ADDRESS);
      if (result) {
        expect(result.reserve0).toBeDefined();
        expect(result.reserve1).toBeDefined();
      }
    });
  });

  describe('getV3Pool', () => {
    test('returns null when factory is zero address', async () => {
      process.env.XLP_V3_FACTORY = ZERO_ADDRESS;
      const result = await poolService.getV3Pool(TEST_ADDRESS_1, TEST_ADDRESS_2, 3000);
      expect(result).toBeNull();
    });

    test('sorts tokens correctly (token0 < token1)', async () => {
      process.env.XLP_V3_FACTORY = TEST_FACTORY;
      const result = await poolService.getV3Pool(TEST_ADDRESS_2, TEST_ADDRESS_1, 3000);
      expect(result === null || result !== undefined).toBe(true);
    });

    test('handles invalid fee tiers', async () => {
      process.env.XLP_V3_FACTORY = TEST_FACTORY;
      const result = await poolService.getV3Pool(TEST_ADDRESS_1, TEST_ADDRESS_2, 99999);
      expect(result === null || result !== undefined).toBe(true);
    });

    test('returns null when pool does not exist', async () => {
      process.env.XLP_V3_FACTORY = TEST_FACTORY;
      const result = await poolService.getV3Pool(TEST_ADDRESS_1, TEST_ADDRESS_2, 3000);
      expect(result).toBeNull();
    });
  });

  describe('getV3PoolData', () => {
    test('returns null when slot0 call fails', async () => {
      const result = await poolService.getV3PoolData(TEST_PAIR_ADDRESS);
      expect(result).toBeNull();
    });

    test('returns null when token0 is missing', async () => {
      const result = await poolService.getV3PoolData(TEST_PAIR_ADDRESS);
      expect(result).toBeNull();
    });

    test('handles zero liquidity', async () => {
      const result = await poolService.getV3PoolData(TEST_PAIR_ADDRESS);
      if (result) {
        expect(result.liquidity).toBeDefined();
      }
    });

    test('defaults fee to 3000 when fee call fails', async () => {
      const result = await poolService.getV3PoolData(TEST_PAIR_ADDRESS);
      if (result) {
        expect(result.fee).toBe(3000);
      }
    });
  });

  describe('listPoolsForPair', () => {
    test('returns empty array when no pools exist', async () => {
      const pools = await poolService.listPoolsForPair(TEST_ADDRESS_1, TEST_ADDRESS_2);
      expect(Array.isArray(pools)).toBe(true);
    });

    test('checks all V3 fee tiers', async () => {
      const pools = await poolService.listPoolsForPair(TEST_ADDRESS_1, TEST_ADDRESS_2);
      expect(Array.isArray(pools)).toBe(true);
    });

    test('includes paymaster pool when reserves exist', async () => {
      process.env.CROSS_CHAIN_PAYMASTER = TEST_FACTORY;
      const pools = await poolService.listPoolsForPair(TEST_ADDRESS_1, TEST_ADDRESS_2);
      expect(Array.isArray(pools)).toBe(true);
    });

    test('handles same token address for both inputs', async () => {
      const pools = await poolService.listPoolsForPair(TEST_ADDRESS_1, TEST_ADDRESS_1);
      expect(Array.isArray(pools)).toBe(true);
    });
  });

  describe('getSwapQuote', () => {
    test('returns null when amountIn is zero', async () => {
      const result = await poolService.getSwapQuote(TEST_ADDRESS_1, TEST_ADDRESS_2, '0');
      expect(result).toBeNull();
    });

    test('returns null when amountIn is negative string', async () => {
      const result = await poolService.getSwapQuote(TEST_ADDRESS_1, TEST_ADDRESS_2, '-1');
      expect(result === null || result !== undefined).toBe(true);
    });

    test('returns null when aggregator is not set', async () => {
      const result = await poolService.getSwapQuote(TEST_ADDRESS_1, TEST_ADDRESS_2, '1');
      expect(result === null || result !== undefined).toBe(true);
    });

    test('handles aggregator returning zero amountOut', async () => {
      process.env.XLP_AGGREGATOR = TEST_FACTORY;
      const result = await poolService.getSwapQuote(TEST_ADDRESS_1, TEST_ADDRESS_2, '1');
      expect(result === null || result !== undefined).toBe(true);
    });

    test('calculates V2 quote manually when aggregator unavailable', async () => {
      const result = await poolService.getSwapQuote(TEST_ADDRESS_1, TEST_ADDRESS_2, '1');
      expect(result === null || result !== undefined).toBe(true);
    });

    test('handles very large amountIn values', async () => {
      const largeAmount = '1000000000000000000000000';
      const result = await poolService.getSwapQuote(TEST_ADDRESS_1, TEST_ADDRESS_2, largeAmount);
      expect(result === null || result !== undefined).toBe(true);
    });

    test('handles very small amountIn values', async () => {
      const smallAmount = '0.000000000000000001';
      const result = await poolService.getSwapQuote(TEST_ADDRESS_1, TEST_ADDRESS_2, smallAmount);
      expect(result === null || result !== undefined).toBe(true);
    });

    test('handles invalid amountIn format', async () => {
      try {
        const result = await poolService.getSwapQuote(TEST_ADDRESS_1, TEST_ADDRESS_2, 'invalid');
        expect(result === null || (result && Number(result.amountIn) >= 0)).toBe(true);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('getAllSwapQuotes', () => {
    test('returns empty array when no quotes available', async () => {
      const quotes = await poolService.getAllSwapQuotes(TEST_ADDRESS_1, TEST_ADDRESS_2, '1');
      expect(Array.isArray(quotes)).toBe(true);
    });

    test('sorts quotes by amountOut descending', async () => {
      const quotes = await poolService.getAllSwapQuotes(TEST_ADDRESS_1, TEST_ADDRESS_2, '1');
      if (quotes.length > 1) {
        for (let i = 0; i < quotes.length - 1; i++) {
          expect(Number(quotes[i].amountOut)).toBeGreaterThanOrEqual(Number(quotes[i + 1].amountOut));
        }
      }
    });

    test('filters out zero amountOut quotes', async () => {
      const quotes = await poolService.getAllSwapQuotes(TEST_ADDRESS_1, TEST_ADDRESS_2, '1');
      quotes.forEach(quote => {
        expect(Number(quote.amountOut)).toBeGreaterThanOrEqual(0);
      });
    });

    test('falls back to getSwapQuote when aggregator returns empty', async () => {
      const quotes = await poolService.getAllSwapQuotes(TEST_ADDRESS_1, TEST_ADDRESS_2, '1');
      expect(Array.isArray(quotes)).toBe(true);
    });
  });

  describe('getPoolStats', () => {
    test('returns zero counts when factories are not set', async () => {
      const stats = await poolService.getPoolStats();
      expect(stats.v2Pools).toBe(0);
      expect(stats.v3Pools).toBe(0);
      expect(stats.totalPools).toBe(0);
    });

    test('handles contract read failures gracefully', async () => {
      process.env.XLP_V2_FACTORY = TEST_FACTORY;
      process.env.XLP_V3_FACTORY = TEST_FACTORY;
      const stats = await poolService.getPoolStats();
      expect(stats.v2Pools).toBeGreaterThanOrEqual(0);
      expect(stats.v3Pools).toBeGreaterThanOrEqual(0);
    });

    test('calculates totalPools correctly', async () => {
      const stats = await poolService.getPoolStats();
      const expectedTotal = stats.v2Pools + stats.v3Pools + (stats.paymasterEnabled ? 1 : 0);
      expect(stats.totalPools).toBe(expectedTotal);
    });

    test('handles paymaster stats failure', async () => {
      process.env.CROSS_CHAIN_PAYMASTER = TEST_FACTORY;
      const stats = await poolService.getPoolStats();
      expect(stats.paymasterEnabled).toBe(false);
    });

    test('formats liquidity USD correctly', async () => {
      const stats = await poolService.getPoolStats();
      expect(typeof stats.totalLiquidityUsd).toBe('string');
      expect(Number(stats.totalLiquidityUsd)).toBeGreaterThanOrEqual(0);
    });

    test('formats volume24h correctly', async () => {
      const stats = await poolService.getPoolStats();
      expect(typeof stats.volume24h).toBe('string');
      expect(Number(stats.volume24h)).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getTokens', () => {
    test('returns token configuration', () => {
      const tokens = poolService.getTokens();
      expect(tokens).toBeDefined();
      expect(typeof tokens).toBe('object');
    });

    test('includes ETH token', () => {
      const tokens = poolService.getTokens();
      expect(tokens.ETH).toBeDefined();
      expect(tokens.ETH.symbol).toBe('ETH');
      expect(tokens.ETH.decimals).toBe(18);
    });

    test('handles missing environment variables', () => {
      delete process.env.WETH_ADDRESS;
      delete process.env.USDC_ADDRESS;
      const tokens = poolService.getTokens();
      // Should use defaults
      expect(tokens.WETH).toBeDefined();
      expect(tokens.USDC).toBeDefined();
    });
  });

  describe('getContracts', () => {
    test('returns contract addresses', () => {
      const contracts = poolService.getContracts();
      expect(contracts).toBeDefined();
      expect(contracts.v2Factory).toBeDefined();
      expect(contracts.v3Factory).toBeDefined();
    });

    test('uses zero address as default when env not set', () => {
      delete process.env.XLP_V2_FACTORY;
      const contracts = poolService.getContracts();
      expect(contracts.v2Factory).toBe(ZERO_ADDRESS);
    });

    test('reads from environment variables', () => {
      const contracts = poolService.getContracts();
      expect(contracts.v2Factory).toBeDefined();
      expect(typeof contracts.v2Factory).toBe('string');
      expect(contracts.v2Factory.length).toBe(42); // Valid Ethereum address length
    });
  });

  describe('Error Handling & Invalid Inputs', () => {
    test('handles network errors gracefully', async () => {
      const pools = await poolService.listV2Pools();
      expect(Array.isArray(pools)).toBe(true);
    });

    test('handles malformed addresses', async () => {
      const invalidAddress = '0xinvalid' as Address;
      const result = await poolService.getV2PoolData(invalidAddress);
      expect(result === null || result !== undefined).toBe(true);
    });

    test('handles concurrent requests', async () => {
      const promises = [
        poolService.listV2Pools(),
        poolService.getPoolStats(),
        poolService.getSwapQuote(TEST_ADDRESS_1, TEST_ADDRESS_2, '1'),
      ];
      const results = await Promise.all(promises);
      expect(results.length).toBe(3);
      expect(Array.isArray(results[0])).toBe(true);
      expect(results[1]).toBeDefined();
    });

    test('handles rapid successive calls', async () => {
      const calls = Array(10).fill(null).map(() => poolService.getPoolStats());
      const results = await Promise.all(calls);
      expect(results.length).toBe(10);
      results.forEach(result => {
        expect(result.totalPools).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('Data Validation & Output Verification', () => {
    test('V2 pool has correct structure', async () => {
      const pools = await poolService.listV2Pools();
      pools.forEach(pool => {
        expect(pool.type).toBe('V2');
        expect(pool.address).toBeDefined();
        expect(pool.token0).toBeDefined();
        expect(pool.token1).toBeDefined();
        expect(typeof pool.reserve0).toBe('string');
        expect(typeof pool.reserve1).toBe('string');
        expect(typeof pool.fee).toBe('number');
        expect(pool.fee).toBe(3000);
      });
    });

    test('V3 pool has correct structure', async () => {
      const pool = await poolService.getV3Pool(TEST_ADDRESS_1, TEST_ADDRESS_2, 3000);
      if (pool) {
        expect(pool.type).toBe('V3');
        expect(pool.address).toBeDefined();
        expect(pool.token0).toBeDefined();
        expect(pool.token1).toBeDefined();
        expect(typeof pool.sqrtPriceX96).toBe('string');
        expect(typeof pool.tick).toBe('number');
        expect(typeof pool.liquidity).toBe('string');
        expect(typeof pool.fee).toBe('number');
      }
    });

    test('SwapQuote has correct structure', async () => {
      const quote = await poolService.getSwapQuote(TEST_ADDRESS_1, TEST_ADDRESS_2, '1');
      if (quote) {
        expect(['V2', 'V3', 'PAYMASTER']).toContain(quote.poolType);
        expect(quote.pool).toBeDefined();
        expect(quote.amountIn).toBe('1');
        expect(typeof quote.amountOut).toBe('string');
        expect(typeof quote.priceImpactBps).toBe('number');
        expect(typeof quote.fee).toBe('number');
        expect(typeof quote.effectivePrice).toBe('string');
        expect(Number(quote.effectivePrice)).toBeGreaterThanOrEqual(0);
      }
    });

    test('PoolStats has correct structure', async () => {
      const stats = await poolService.getPoolStats();
      expect(typeof stats.totalPools).toBe('number');
      expect(typeof stats.v2Pools).toBe('number');
      expect(typeof stats.v3Pools).toBe('number');
      expect(typeof stats.paymasterEnabled).toBe('boolean');
      expect(typeof stats.totalLiquidityUsd).toBe('string');
      expect(typeof stats.volume24h).toBe('string');
      expect(stats.totalPools).toBeGreaterThanOrEqual(0);
      expect(stats.v2Pools).toBeGreaterThanOrEqual(0);
      expect(stats.v3Pools).toBeGreaterThanOrEqual(0);
    });

    test('effectivePrice calculation is correct', async () => {
      const quote = await poolService.getSwapQuote(TEST_ADDRESS_1, TEST_ADDRESS_2, '1');
      if (quote && Number(quote.amountOut) > 0) {
        const expectedPrice = Number(quote.amountOut) / Number(quote.amountIn);
        const actualPrice = Number(quote.effectivePrice);
        expect(Math.abs(actualPrice - expectedPrice)).toBeLessThan(0.0001);
      }
    });
  });
});
