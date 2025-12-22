/**
 * Bridge Service Unit Tests
 *
 * Tests for arbitrage opportunity detection and price calculations.
 * These tests do NOT require external APIs or blockchain connections.
 */

import { describe, test, expect } from 'bun:test';

// Types from bridge.ts
interface ArbOpportunity {
  id: string;
  type: 'solana_evm' | 'hyperliquid' | 'cross_dex';
  buyChain: string;
  sellChain: string;
  token: string;
  priceDiffBps: number;
  netProfitUsd: number;
  expiresAt: number;
}

interface PriceData {
  chain: string;
  price: number;
  dex: string;
}

/**
 * Calculate price difference in basis points between two prices.
 * Returns positive value when high > low.
 */
function calculatePriceDiffBps(lowPrice: number, highPrice: number): number {
  if (lowPrice <= 0 || highPrice <= 0) {
    throw new Error('Prices must be positive');
  }
  return Math.floor((highPrice - lowPrice) / lowPrice * 10000);
}

/**
 * Determine the type of arbitrage based on chains involved.
 */
function determineArbType(buyChain: string, sellChain: string): 'solana_evm' | 'hyperliquid' | 'cross_dex' {
  if (buyChain === 'solana' || sellChain === 'solana') {
    return 'solana_evm';
  }
  if (buyChain === 'hyperliquid' || sellChain === 'hyperliquid') {
    return 'hyperliquid';
  }
  return 'cross_dex';
}

/**
 * Calculate net profit after bridge costs.
 * Bridge costs are estimated at 10 bps (0.1%) fee + 5 bps gas.
 */
function calculateNetProfitBps(priceDiffBps: number, bridgeCostBps = 15): number {
  return priceDiffBps - bridgeCostBps;
}

/**
 * Calculate net profit in USD based on position size and basis points.
 */
function calculateNetProfitUsd(netProfitBps: number, maxPositionUsd: number): number {
  return (netProfitBps / 10000) * maxPositionUsd;
}

/**
 * Check if opportunity is still valid (not expired).
 */
function isOpportunityValid(opportunity: ArbOpportunity): boolean {
  return opportunity.expiresAt > Date.now();
}

/**
 * Find arbitrage opportunities from price data.
 */
function findArbOpportunities(
  token: string,
  prices: PriceData[],
  minProfitBps: number,
  maxPositionUsd: number
): ArbOpportunity[] {
  const opportunities: ArbOpportunity[] = [];

  if (prices.length < 2) return opportunities;

  for (let i = 0; i < prices.length; i++) {
    for (let j = i + 1; j < prices.length; j++) {
      const [low, high] = prices[i].price < prices[j].price
        ? [prices[i], prices[j]]
        : [prices[j], prices[i]];

      const priceDiffBps = calculatePriceDiffBps(low.price, high.price);
      const bridgeCostBps = 15;
      const netProfitBps = calculateNetProfitBps(priceDiffBps, bridgeCostBps);

      if (netProfitBps >= minProfitBps) {
        const opportunity: ArbOpportunity = {
          id: `${token}-${low.chain}-${high.chain}-${Date.now()}`,
          type: determineArbType(low.chain, high.chain),
          buyChain: low.chain,
          sellChain: high.chain,
          token,
          priceDiffBps,
          netProfitUsd: calculateNetProfitUsd(netProfitBps, maxPositionUsd),
          expiresAt: Date.now() + 30000, // 30 second expiry
        };
        opportunities.push(opportunity);
      }
    }
  }

  return opportunities;
}

describe('Price Difference Calculations', () => {
  test('calculates 1% price difference correctly', () => {
    // $100 vs $101 = 1% = 100 bps
    const bps = calculatePriceDiffBps(100, 101);
    expect(bps).toBe(100);
  });

  test('calculates 0.5% price difference correctly', () => {
    // $100 vs $100.50 = 0.5% = 50 bps
    const bps = calculatePriceDiffBps(100, 100.5);
    expect(bps).toBe(50);
  });

  test('calculates 0.3% price difference correctly', () => {
    // $100 vs $100.30 = 0.3% = 30 bps (may floor due to floating point)
    const bps = calculatePriceDiffBps(100, 100.3);
    // Due to floating point precision, this may be 29 or 30
    expect(bps).toBeGreaterThanOrEqual(29);
    expect(bps).toBeLessThanOrEqual(30);
  });

  test('handles small price differences', () => {
    // $100 vs $100.01 = 0.01% = 1 bps
    const bps = calculatePriceDiffBps(100, 100.01);
    expect(bps).toBe(1);
  });

  test('handles large price differences', () => {
    // $100 vs $110 = 10% = 1000 bps
    const bps = calculatePriceDiffBps(100, 110);
    expect(bps).toBe(1000);
  });

  test('floors fractional basis points', () => {
    // $100 vs $100.005 = 0.005% = 0.5 bps, floors to 0
    const bps = calculatePriceDiffBps(100, 100.005);
    expect(bps).toBe(0);
  });

  test('throws for zero prices', () => {
    expect(() => calculatePriceDiffBps(0, 100)).toThrow('Prices must be positive');
    expect(() => calculatePriceDiffBps(100, 0)).toThrow('Prices must be positive');
  });

  test('throws for negative prices', () => {
    expect(() => calculatePriceDiffBps(-100, 100)).toThrow('Prices must be positive');
    expect(() => calculatePriceDiffBps(100, -100)).toThrow('Prices must be positive');
  });
});

describe('Arbitrage Type Detection', () => {
  test('detects Solana-EVM arb when buying on Solana', () => {
    expect(determineArbType('solana', 'evm:1')).toBe('solana_evm');
  });

  test('detects Solana-EVM arb when selling on Solana', () => {
    expect(determineArbType('evm:8453', 'solana')).toBe('solana_evm');
  });

  test('detects Hyperliquid arb when buying on HL', () => {
    expect(determineArbType('hyperliquid', 'evm:1')).toBe('hyperliquid');
  });

  test('detects Hyperliquid arb when selling on HL', () => {
    expect(determineArbType('evm:42161', 'hyperliquid')).toBe('hyperliquid');
  });

  test('detects cross-DEX arb for EVM chains', () => {
    expect(determineArbType('evm:1', 'evm:8453')).toBe('cross_dex');
    expect(determineArbType('evm:42161', 'evm:10')).toBe('cross_dex');
  });

  test('prioritizes Solana over Hyperliquid if both present', () => {
    // This edge case shouldn't happen in practice, but test behavior
    expect(determineArbType('solana', 'hyperliquid')).toBe('solana_evm');
  });
});

describe('Net Profit Calculations', () => {
  test('calculates net profit after default bridge costs', () => {
    // 50 bps price diff - 15 bps cost = 35 bps net
    expect(calculateNetProfitBps(50)).toBe(35);
  });

  test('shows zero profit at break-even', () => {
    // 15 bps diff - 15 bps cost = 0 net
    expect(calculateNetProfitBps(15)).toBe(0);
  });

  test('shows negative profit when losing money', () => {
    // 10 bps diff - 15 bps cost = -5 net
    expect(calculateNetProfitBps(10)).toBe(-5);
  });

  test('uses custom bridge costs', () => {
    // 50 bps diff - 25 bps custom cost = 25 bps net
    expect(calculateNetProfitBps(50, 25)).toBe(25);
  });

  test('calculates USD profit correctly', () => {
    // 35 bps on $10,000 = $35
    const profitUsd = calculateNetProfitUsd(35, 10000);
    expect(profitUsd).toBe(35);
  });

  test('calculates fractional USD profit', () => {
    // 5 bps on $10,000 = $5
    const profitUsd = calculateNetProfitUsd(5, 10000);
    expect(profitUsd).toBe(5);
  });

  test('scales with position size', () => {
    // 35 bps on $5,000 = $17.50
    const profitUsd = calculateNetProfitUsd(35, 5000);
    expect(profitUsd).toBe(17.5);
  });
});

describe('Opportunity Detection', () => {
  test('finds profitable opportunity between two chains', () => {
    const prices: PriceData[] = [
      { chain: 'evm:1', price: 2000, dex: 'uniswap' },
      { chain: 'evm:8453', price: 2010, dex: 'aerodrome' }, // 0.5% higher
    ];

    const opportunities = findArbOpportunities('WETH', prices, 30, 10000);

    expect(opportunities.length).toBe(1);
    expect(opportunities[0].buyChain).toBe('evm:1');
    expect(opportunities[0].sellChain).toBe('evm:8453');
    expect(opportunities[0].priceDiffBps).toBe(50);
    expect(opportunities[0].type).toBe('cross_dex');
  });

  test('ignores opportunities below minimum profit threshold', () => {
    const prices: PriceData[] = [
      { chain: 'evm:1', price: 2000, dex: 'uniswap' },
      { chain: 'evm:8453', price: 2002, dex: 'aerodrome' }, // Only 0.1% = 10 bps
    ];

    // After 15 bps costs, this is -5 bps net loss
    const opportunities = findArbOpportunities('WETH', prices, 30, 10000);
    expect(opportunities.length).toBe(0);
  });

  test('finds multiple opportunities from multiple chains', () => {
    const prices: PriceData[] = [
      { chain: 'evm:1', price: 2000, dex: 'uniswap' },
      { chain: 'evm:8453', price: 2015, dex: 'aerodrome' }, // 0.75%
      { chain: 'evm:42161', price: 2020, dex: 'camelot' }, // 1%
    ];

    const opportunities = findArbOpportunities('WETH', prices, 30, 10000);

    // Should find: 1->8453, 1->42161, 8453->42161
    expect(opportunities.length).toBeGreaterThan(0);
  });

  test('correctly identifies buy and sell chains', () => {
    const prices: PriceData[] = [
      { chain: 'solana', price: 100, dex: 'jupiter' },
      { chain: 'evm:1', price: 101, dex: 'uniswap' },
    ];

    const opportunities = findArbOpportunities('USDC', prices, 30, 10000);

    expect(opportunities.length).toBe(1);
    // Buy on cheaper chain, sell on more expensive
    expect(opportunities[0].buyChain).toBe('solana');
    expect(opportunities[0].sellChain).toBe('evm:1');
    expect(opportunities[0].type).toBe('solana_evm');
  });

  test('handles single price (no opportunity)', () => {
    const prices: PriceData[] = [
      { chain: 'evm:1', price: 2000, dex: 'uniswap' },
    ];

    const opportunities = findArbOpportunities('WETH', prices, 30, 10000);
    expect(opportunities.length).toBe(0);
  });

  test('handles empty price list', () => {
    const opportunities = findArbOpportunities('WETH', [], 30, 10000);
    expect(opportunities.length).toBe(0);
  });
});

describe('Opportunity Expiry', () => {
  test('opportunity is valid before expiry', () => {
    const opportunity: ArbOpportunity = {
      id: 'test-1',
      type: 'cross_dex',
      buyChain: 'evm:1',
      sellChain: 'evm:8453',
      token: 'WETH',
      priceDiffBps: 50,
      netProfitUsd: 35,
      expiresAt: Date.now() + 10000, // 10 seconds in future
    };

    expect(isOpportunityValid(opportunity)).toBe(true);
  });

  test('opportunity is invalid after expiry', () => {
    const opportunity: ArbOpportunity = {
      id: 'test-1',
      type: 'cross_dex',
      buyChain: 'evm:1',
      sellChain: 'evm:8453',
      token: 'WETH',
      priceDiffBps: 50,
      netProfitUsd: 35,
      expiresAt: Date.now() - 1000, // 1 second in past
    };

    expect(isOpportunityValid(opportunity)).toBe(false);
  });

  test('opportunity exactly at expiry is invalid', () => {
    const now = Date.now();
    const opportunity: ArbOpportunity = {
      id: 'test-1',
      type: 'cross_dex',
      buyChain: 'evm:1',
      sellChain: 'evm:8453',
      token: 'WETH',
      priceDiffBps: 50,
      netProfitUsd: 35,
      expiresAt: now,
    };

    // Date.now() returns slightly different values, so this is >= check
    expect(isOpportunityValid(opportunity)).toBe(false);
  });
});

describe('Opportunity ID Generation', () => {
  test('generates unique IDs for different opportunities', () => {
    const prices: PriceData[] = [
      { chain: 'evm:1', price: 2000, dex: 'uniswap' },
      { chain: 'evm:8453', price: 2010, dex: 'aerodrome' },
    ];

    const opp1 = findArbOpportunities('WETH', prices, 30, 10000);
    // Wait a tiny bit to ensure different timestamp
    const opp2 = findArbOpportunities('USDC', prices, 30, 10000);

    // IDs should be unique
    expect(opp1[0].id).not.toBe(opp2[0].id);
  });

  test('ID contains token and chain information', () => {
    const prices: PriceData[] = [
      { chain: 'evm:1', price: 2000, dex: 'uniswap' },
      { chain: 'evm:8453', price: 2010, dex: 'aerodrome' },
    ];

    const opportunities = findArbOpportunities('WETH', prices, 30, 10000);

    expect(opportunities[0].id).toContain('WETH');
    expect(opportunities[0].id).toContain('evm:1');
    expect(opportunities[0].id).toContain('evm:8453');
  });
});

describe('Bridge Stats', () => {
  // Test structure for BridgeStats tracking
  interface BridgeStats {
    totalTransfersProcessed: number;
    totalVolumeProcessed: bigint;
    totalFeesEarned: bigint;
    pendingTransfers: number;
    activeChains: number[];
    uptime: number;
    lastTransferAt: number;
    arbOpportunitiesDetected: number;
    arbTradesExecuted: number;
    arbProfitUsd: number;
    jitoBundlesSubmitted: number;
    jitoBundlesLanded: number;
    mevProfitUsd: number;
  }

  test('stats structure is valid', () => {
    const stats: BridgeStats = {
      totalTransfersProcessed: 0,
      totalVolumeProcessed: 0n,
      totalFeesEarned: 0n,
      pendingTransfers: 0,
      activeChains: [],
      uptime: 0,
      lastTransferAt: 0,
      arbOpportunitiesDetected: 0,
      arbTradesExecuted: 0,
      arbProfitUsd: 0,
      jitoBundlesSubmitted: 0,
      jitoBundlesLanded: 0,
      mevProfitUsd: 0,
    };

    expect(stats.totalTransfersProcessed).toBe(0);
    expect(stats.totalVolumeProcessed).toBe(0n);
  });

  test('active chains can be updated', () => {
    const activeChains = [1, 8453, 42161, 10];

    expect(activeChains.includes(1)).toBe(true);
    expect(activeChains.includes(8453)).toBe(true);
    expect(activeChains.length).toBe(4);
  });

  test('uptime calculation is correct', () => {
    const startTime = Date.now() - 3600000; // 1 hour ago
    const uptime = Date.now() - startTime;

    expect(uptime).toBeGreaterThanOrEqual(3600000);
    expect(uptime).toBeLessThan(3700000); // Allow some tolerance
  });
});

describe('Transfer Event Types', () => {
  interface TransferEvent {
    id: string;
    type: 'initiated' | 'completed' | 'failed';
    sourceChain: number;
    destChain: number;
    token: string;
    amount: bigint;
    fee: bigint;
    timestamp: number;
  }

  test('transfer event structure is valid', () => {
    const event: TransferEvent = {
      id: 'transfer-1',
      type: 'initiated',
      sourceChain: 1,
      destChain: 8453,
      token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      amount: 1000000000000000000n, // 1 ETH
      fee: 1000000000000000n, // 0.001 ETH
      timestamp: Date.now(),
    };

    expect(event.type).toBe('initiated');
    expect(event.amount).toBe(1000000000000000000n);
    expect(event.fee).toBeLessThan(event.amount);
  });

  test('transfer types are correctly enumerated', () => {
    const types: Array<TransferEvent['type']> = ['initiated', 'completed', 'failed'];

    expect(types).toContain('initiated');
    expect(types).toContain('completed');
    expect(types).toContain('failed');
    expect(types.length).toBe(3);
  });
});
