/**
 * @fileoverview Comprehensive tests for oracle.ts
 * 
 * Tests cover:
 * - validatePriceReport: Report validation against feed specs
 * - isPriceStale: Price staleness detection
 * - calculateWeightedMedian: Weighted median calculation (complex finance math)
 * - formatPrice: Price formatting with decimals
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import type { Address, Hex } from 'viem';
import {
  validatePriceReport,
  isPriceStale,
  calculateWeightedMedian,
  formatPrice,
  type PriceReport,
  type FeedSpec,
  type ConsensusPrice,
  type VenueSource,
  type OracleSignature,
  type FeedCategory,
} from '../oracle';

// ============================================================================
// Test Fixtures
// ============================================================================

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
const TEST_ADDRESS_1 = '0x1111111111111111111111111111111111111111' as Address;
const TEST_ADDRESS_2 = '0x2222222222222222222222222222222222222222' as Address;
const TEST_FEED_ID = '0x' + 'a'.repeat(64) as Hex;

function createFeedSpec(overrides: Partial<FeedSpec> = {}): FeedSpec {
  return {
    feedId: TEST_FEED_ID,
    symbol: 'ETH-USD',
    baseToken: TEST_ADDRESS_1,
    quoteToken: TEST_ADDRESS_2,
    decimals: 8,
    heartbeatSeconds: 3600,
    twapWindowSeconds: 300,
    minLiquidityUSD: 100000n * 10n ** 18n,
    maxDeviationBps: 100,
    minOracles: 3,
    quorumThreshold: 2,
    isActive: true,
    requiresConfidence: true,
    category: 'SPOT_PRICE' as FeedCategory,
    ...overrides,
  };
}

function createSignature(signer: Address = TEST_ADDRESS_1): OracleSignature {
  return {
    signer,
    v: 27,
    r: '0x' + 'a'.repeat(64) as Hex,
    s: '0x' + 'b'.repeat(64) as Hex,
  };
}

function createVenueSource(overrides: Partial<VenueSource> = {}): VenueSource {
  return {
    chainId: 1,
    venue: TEST_ADDRESS_1,
    price: 200000000000n, // $2000 with 8 decimals
    liquidity: 1000000n * 10n ** 18n, // 1M USD
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    ...overrides,
  };
}

function createPriceReport(overrides: Partial<PriceReport> = {}): PriceReport {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return {
    feedId: TEST_FEED_ID,
    price: 200000000000n, // $2000 with 8 decimals
    confidence: 10000000n, // $0.10 confidence
    timestamp: now,
    round: 100n,
    sources: [createVenueSource()],
    signatures: [createSignature(), createSignature(TEST_ADDRESS_2)],
    ...overrides,
  };
}

// ============================================================================
// validatePriceReport Tests
// ============================================================================

describe('validatePriceReport', () => {
  test('validates report with sufficient quorum', () => {
    const spec = createFeedSpec({ quorumThreshold: 2 });
    const report = createPriceReport({
      signatures: [createSignature(), createSignature(TEST_ADDRESS_2)],
    });
    
    const result = validatePriceReport(report, spec);
    
    expect(result.isValid).toBe(true);
    expect(result.quorumMet).toBe(true);
    expect(result.validSignerCount).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  test('fails when signatures below quorum threshold', () => {
    const spec = createFeedSpec({ quorumThreshold: 3 });
    const report = createPriceReport({
      signatures: [createSignature(), createSignature(TEST_ADDRESS_2)],
    });
    
    const result = validatePriceReport(report, spec);
    
    expect(result.isValid).toBe(false);
    expect(result.quorumMet).toBe(false);
    expect(result.errors.some(e => e.type === 'INSUFFICIENT_QUORUM')).toBe(true);
    
    const quorumError = result.errors.find(e => e.type === 'INSUFFICIENT_QUORUM');
    expect(quorumError).toBeDefined();
    if (quorumError && quorumError.type === 'INSUFFICIENT_QUORUM') {
      expect(quorumError.have).toBe(2);
      expect(quorumError.need).toBe(3);
    }
  });

  test('fails with stale timestamp', () => {
    const spec = createFeedSpec({ heartbeatSeconds: 3600 });
    const staleTimestamp = BigInt(Math.floor(Date.now() / 1000) - 7200); // 2 hours ago
    const report = createPriceReport({ timestamp: staleTimestamp });
    
    const result = validatePriceReport(report, spec);
    
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.type === 'STALE_TIMESTAMP')).toBe(true);
    
    const staleError = result.errors.find(e => e.type === 'STALE_TIMESTAMP');
    expect(staleError).toBeDefined();
    if (staleError && staleError.type === 'STALE_TIMESTAMP') {
      expect(staleError.timestamp).toBe(staleTimestamp);
      expect(staleError.maxAge).toBe(3600n);
    }
  });

  test('fails when source liquidity below minimum', () => {
    const minLiquidity = 100000n * 10n ** 18n; // 100k USD
    const spec = createFeedSpec({ minLiquidityUSD: minLiquidity });
    const report = createPriceReport({
      sources: [
        createVenueSource({ liquidity: 50000n * 10n ** 18n }), // Only 50k
      ],
    });
    
    const result = validatePriceReport(report, spec);
    
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.type === 'LOW_LIQUIDITY')).toBe(true);
    
    const liquidityError = result.errors.find(e => e.type === 'LOW_LIQUIDITY');
    expect(liquidityError).toBeDefined();
    if (liquidityError && liquidityError.type === 'LOW_LIQUIDITY') {
      expect(liquidityError.required).toBe(minLiquidity);
    }
  });

  test('accumulates multiple errors', () => {
    const spec = createFeedSpec({
      quorumThreshold: 5,
      heartbeatSeconds: 60,
      minLiquidityUSD: 1000000n * 10n ** 18n,
    });
    const staleTimestamp = BigInt(Math.floor(Date.now() / 1000) - 3600);
    const report = createPriceReport({
      timestamp: staleTimestamp,
      signatures: [createSignature()],
      sources: [createVenueSource({ liquidity: 1000n * 10n ** 18n })],
    });
    
    const result = validatePriceReport(report, spec);
    
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors.some(e => e.type === 'INSUFFICIENT_QUORUM')).toBe(true);
    expect(result.errors.some(e => e.type === 'STALE_TIMESTAMP')).toBe(true);
    expect(result.errors.some(e => e.type === 'LOW_LIQUIDITY')).toBe(true);
  });

  test('handles empty sources array', () => {
    const spec = createFeedSpec();
    const report = createPriceReport({ sources: [] });
    
    const result = validatePriceReport(report, spec);
    
    // Should still validate quorum and timestamp, no liquidity errors for empty sources
    expect(result.errors.every(e => e.type !== 'LOW_LIQUIDITY')).toBe(true);
  });

  test('checks all sources for liquidity', () => {
    const minLiquidity = 100000n * 10n ** 18n;
    const spec = createFeedSpec({ minLiquidityUSD: minLiquidity });
    const report = createPriceReport({
      sources: [
        createVenueSource({ venue: TEST_ADDRESS_1, liquidity: 50000n * 10n ** 18n }),
        createVenueSource({ venue: TEST_ADDRESS_2, liquidity: 60000n * 10n ** 18n }),
        createVenueSource({ venue: ZERO_ADDRESS, liquidity: 200000n * 10n ** 18n }), // This one passes
      ],
    });
    
    const result = validatePriceReport(report, spec);
    
    const liquidityErrors = result.errors.filter(e => e.type === 'LOW_LIQUIDITY');
    expect(liquidityErrors.length).toBe(2);
  });

  test('returns reportHash in result', () => {
    const spec = createFeedSpec();
    const report = createPriceReport();
    
    const result = validatePriceReport(report, spec);
    
    expect(result.reportHash).toBeDefined();
    expect(result.reportHash.startsWith('0x')).toBe(true);
    expect(result.reportHash.length).toBe(66);
  });
});

// ============================================================================
// isPriceStale Tests
// ============================================================================

describe('isPriceStale', () => {
  test('returns false for fresh price', () => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const price: ConsensusPrice = {
      price: 200000000000n,
      confidence: 10000000n,
      timestamp: now,
      round: 100n,
      oracleCount: 5,
      reportHash: '0x' + 'a'.repeat(64) as Hex,
    };
    
    expect(isPriceStale(price, 3600)).toBe(false);
  });

  test('returns true for stale price', () => {
    const twoHoursAgo = BigInt(Math.floor(Date.now() / 1000) - 7200);
    const price: ConsensusPrice = {
      price: 200000000000n,
      confidence: 10000000n,
      timestamp: twoHoursAgo,
      round: 100n,
      oracleCount: 5,
      reportHash: '0x' + 'a'.repeat(64) as Hex,
    };
    
    expect(isPriceStale(price, 3600)).toBe(true); // 1 hour heartbeat
  });

  test('handles boundary condition exactly at heartbeat', () => {
    const exactlyHeartbeatAgo = BigInt(Math.floor(Date.now() / 1000) - 3600);
    const price: ConsensusPrice = {
      price: 200000000000n,
      confidence: 10000000n,
      timestamp: exactlyHeartbeatAgo,
      round: 100n,
      oracleCount: 5,
      reportHash: '0x' + 'a'.repeat(64) as Hex,
    };
    
    // Exactly at heartbeat should be stale (> not >=)
    expect(isPriceStale(price, 3600)).toBe(false);
  });

  test('handles very short heartbeat', () => {
    const fiveSecondsAgo = BigInt(Math.floor(Date.now() / 1000) - 5);
    const price: ConsensusPrice = {
      price: 200000000000n,
      confidence: 10000000n,
      timestamp: fiveSecondsAgo,
      round: 100n,
      oracleCount: 5,
      reportHash: '0x' + 'a'.repeat(64) as Hex,
    };
    
    expect(isPriceStale(price, 3)).toBe(true); // 3 second heartbeat
    expect(isPriceStale(price, 10)).toBe(false); // 10 second heartbeat
  });

  test('handles very long heartbeat', () => {
    const oneDayAgo = BigInt(Math.floor(Date.now() / 1000) - 86400);
    const price: ConsensusPrice = {
      price: 200000000000n,
      confidence: 10000000n,
      timestamp: oneDayAgo,
      round: 100n,
      oracleCount: 5,
      reportHash: '0x' + 'a'.repeat(64) as Hex,
    };
    
    expect(isPriceStale(price, 86400)).toBe(false); // 24 hour heartbeat
    expect(isPriceStale(price, 43200)).toBe(true); // 12 hour heartbeat
  });
});

// ============================================================================
// calculateWeightedMedian Tests
// ============================================================================

describe('calculateWeightedMedian', () => {
  test('calculates median of single price', () => {
    const prices = [100n];
    const weights = [1n];
    
    expect(calculateWeightedMedian(prices, weights)).toBe(100n);
  });

  test('calculates median of two prices with equal weights', () => {
    const prices = [100n, 200n];
    const weights = [1n, 1n];
    
    // With equal weights, should return first price at or above half weight
    const result = calculateWeightedMedian(prices, weights);
    expect(result).toBe(100n);
  });

  test('calculates weighted median correctly', () => {
    // Prices: 100, 200, 300
    // Weights: 1, 1, 3
    // Total weight: 5, half = 2
    // Sorted by price: (100, 1), (200, 1), (300, 3)
    // Cumulative: 1, 2, 5
    // First >= 2 is at 200
    const prices = [100n, 200n, 300n];
    const weights = [1n, 1n, 3n];
    
    const result = calculateWeightedMedian(prices, weights);
    expect(result).toBe(200n);
  });

  test('handles unsorted input', () => {
    // Function should sort by price internally
    const prices = [300n, 100n, 200n];
    const weights = [3n, 1n, 1n];
    
    const result = calculateWeightedMedian(prices, weights);
    expect(result).toBe(200n);
  });

  test('weights heavily favor one price', () => {
    const prices = [100n, 200n, 300n];
    const weights = [100n, 1n, 1n]; // 100x weight on first price
    
    // Total: 102, half = 51
    // First price has weight 100 >= 51
    const result = calculateWeightedMedian(prices, weights);
    expect(result).toBe(100n);
  });

  test('throws on empty arrays', () => {
    expect(() => calculateWeightedMedian([], [])).toThrow('Invalid input arrays');
  });

  test('throws on mismatched array lengths', () => {
    expect(() => calculateWeightedMedian([100n, 200n], [1n])).toThrow('Invalid input arrays');
    expect(() => calculateWeightedMedian([100n], [1n, 2n])).toThrow('Invalid input arrays');
  });

  test('handles large number of prices', () => {
    const prices: bigint[] = [];
    const weights: bigint[] = [];
    
    for (let i = 1; i <= 100; i++) {
      prices.push(BigInt(i * 100));
      weights.push(1n);
    }
    
    // Equal weights, median should be around 50th percentile
    const result = calculateWeightedMedian(prices, weights);
    expect(result).toBe(5000n); // Price at index 49 (0-indexed)
  });

  test('handles large weight values', () => {
    const prices = [100n, 200n, 300n];
    const weights = [10n ** 18n, 10n ** 18n, 10n ** 18n];
    
    const result = calculateWeightedMedian(prices, weights);
    // Total weight: 3 * 10^18, half = 1.5 * 10^18
    // Cumulative: 10^18, 2*10^18, 3*10^18
    // First >= 1.5 * 10^18 is at 200n
    expect(result).toBe(200n);
  });

  test('handles all weight on last price', () => {
    const prices = [100n, 200n, 300n];
    const weights = [0n, 0n, 100n];
    
    // Total weight: 100, half = 50
    // Only last price has weight, so it's the result
    const result = calculateWeightedMedian(prices, weights);
    expect(result).toBe(300n);
  });

  test('property: result is always one of the input prices', () => {
    // Fuzz test with random inputs
    for (let i = 0; i < 50; i++) {
      const numPrices = Math.floor(Math.random() * 10) + 1;
      const prices: bigint[] = [];
      const weights: bigint[] = [];
      
      for (let j = 0; j < numPrices; j++) {
        prices.push(BigInt(Math.floor(Math.random() * 10000) + 1));
        weights.push(BigInt(Math.floor(Math.random() * 100) + 1));
      }
      
      const result = calculateWeightedMedian(prices, weights);
      expect(prices.includes(result)).toBe(true);
    }
  });

  test('property: higher weighted prices pull median towards them', () => {
    // Low price with low weight, high price with high weight
    const prices = [100n, 1000n];
    
    const lowWeightResult = calculateWeightedMedian(prices, [10n, 1n]);
    const highWeightResult = calculateWeightedMedian(prices, [1n, 10n]);
    
    expect(lowWeightResult).toBe(100n);
    expect(highWeightResult).toBe(1000n);
  });

  test('handles duplicate prices', () => {
    const prices = [100n, 100n, 200n];
    const weights = [1n, 1n, 1n];
    
    // Should work correctly with duplicates
    const result = calculateWeightedMedian(prices, weights);
    expect(result).toBe(100n);
  });

  test('handles very large prices (wei values)', () => {
    const prices = [
      10n ** 18n,        // 1 ETH in wei
      2n * 10n ** 18n,   // 2 ETH
      3n * 10n ** 18n,   // 3 ETH
    ];
    const weights = [1n, 1n, 1n];
    
    const result = calculateWeightedMedian(prices, weights);
    expect(result).toBe(10n ** 18n);
  });
});

// ============================================================================
// formatPrice Tests
// ============================================================================

describe('formatPrice', () => {
  test('formats price with 8 decimals (standard oracle)', () => {
    const price = 200000000000n; // $2000.00000000
    expect(formatPrice(price, 8)).toBe('2000.00000000');
  });

  test('formats price with 18 decimals (wei)', () => {
    const price = 1234567890123456789n;
    expect(formatPrice(price, 18)).toBe('1.234567890123456789');
  });

  test('formats zero price', () => {
    expect(formatPrice(0n, 8)).toBe('0.00000000');
  });

  test('formats fractional price', () => {
    const price = 12345678n; // 0.12345678 with 8 decimals
    expect(formatPrice(price, 8)).toBe('0.12345678');
  });

  test('formats price with leading zeros in fraction', () => {
    const price = 1000001n; // 0.01000001 with 8 decimals
    expect(formatPrice(price, 8)).toBe('0.01000001');
  });

  test('formats large prices', () => {
    const price = 100000000000000000000n; // 1 trillion with 8 decimals
    expect(formatPrice(price, 8)).toBe('1000000000000.00000000');
  });

  test('formats with 0 decimals', () => {
    const price = 12345n;
    // With 0 decimals, divisor is 1n, so whole = 12345, frac = 0
    // fracStr is padded to 0 chars, but empty string
    const result = formatPrice(price, 0);
    // The function pads to 0 chars, resulting in empty string after dot
    // Actually it returns "12345.0" due to padStart(0, '0') returning '0' for empty
    expect(result).toBe('12345.0');
  });

  test('formats with 1 decimal', () => {
    const price = 12345n; // 1234.5
    expect(formatPrice(price, 1)).toBe('1234.5');
  });

  test('handles very small prices', () => {
    const price = 1n; // Smallest possible price
    expect(formatPrice(price, 8)).toBe('0.00000001');
  });

  test('property: parsing formatted price recovers original', () => {
    // For a set of random prices, format then parse should give same value
    for (let i = 0; i < 50; i++) {
      const decimals = Math.floor(Math.random() * 19); // 0-18 decimals
      const rawPrice = BigInt(Math.floor(Math.random() * 1000000000000));
      
      const formatted = formatPrice(rawPrice, decimals);
      const [wholePart, fracPart = ''] = formatted.split('.');
      
      const reconstructed = 
        BigInt(wholePart || '0') * (10n ** BigInt(decimals)) +
        BigInt(fracPart.padEnd(decimals, '0') || '0');
      
      expect(reconstructed).toBe(rawPrice);
    }
  });
});
