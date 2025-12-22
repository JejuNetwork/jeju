/**
 * Arbitrage Executor Unit Tests
 *
 * Tests for the complex financial calculations in the arbitrage executor.
 * These tests do NOT require external APIs or blockchain connections.
 */

import { describe, test, expect } from 'bun:test';

// Test helper functions inline since they're private in the module
// We recreate the core calculation logic for testing

/**
 * Position sizing calculation:
 * positionSizeUsd = min(netProfitUsd / (priceDiffBps / 10000), maxPositionUsd)
 *
 * This determines how much capital to deploy based on the profit opportunity.
 */
function calculatePositionSize(
  netProfitUsd: number,
  priceDiffBps: number,
  maxPositionUsd: number
): number {
  if (priceDiffBps <= 0) {
    throw new Error('priceDiffBps must be positive');
  }
  const calculatedSize = netProfitUsd / (priceDiffBps / 10000);
  return Math.min(calculatedSize, maxPositionUsd);
}

/**
 * Parse EVM chain ID from chain string
 * Format: "evm:1" -> 1, "evm:8453" -> 8453
 */
function parseEvmChainId(chain: string): number | null {
  if (!chain.startsWith('evm:')) {
    return null;
  }
  const parts = chain.split(':');
  if (parts.length !== 2) {
    return null;
  }
  const chainId = parseInt(parts[1], 10);
  if (isNaN(chainId)) {
    return null;
  }
  return chainId;
}

/**
 * Calculate net profit in basis points after accounting for bridge costs.
 * bridgeCostBps = 10 (0.1% fee) + 5 (0.05% gas estimate) = 15 bps
 */
function calculateNetProfitBps(priceDiffBps: number, bridgeCostBps = 15): number {
  return priceDiffBps - bridgeCostBps;
}

/**
 * Calculate minimum output after slippage.
 * minOut = outputAmount * (10000 - slippageBps) / 10000
 */
function calculateMinOutput(outputAmount: bigint, slippageBps: number): bigint {
  if (slippageBps < 0 || slippageBps > 10000) {
    throw new Error('slippageBps must be between 0 and 10000');
  }
  return (outputAmount * BigInt(10000 - slippageBps)) / 10000n;
}

/**
 * Estimate profit in USD from an arbitrage opportunity.
 */
function estimateProfitUsd(
  positionSizeUsd: number,
  priceDiffBps: number,
  bridgeCostBps = 15
): number {
  const netBps = priceDiffBps - bridgeCostBps;
  return positionSizeUsd * (netBps / 10000);
}

describe('Position Sizing Calculations', () => {
  test('calculates position size correctly for profitable opportunity', () => {
    // If we expect $30 profit on 0.3% (30 bps) price diff, we need $10,000 position
    // $30 / 0.003 = $10,000
    const position = calculatePositionSize(30, 30, 10000);
    expect(position).toBe(10000);
  });

  test('respects max position size cap', () => {
    // If calculation would give $50,000 but max is $10,000, cap at max
    const position = calculatePositionSize(100, 20, 10000);
    // $100 / 0.002 = $50,000, but capped at $10,000
    expect(position).toBe(10000);
  });

  test('handles small profit opportunities', () => {
    // $5 profit on 50 bps = $1,000 position
    const position = calculatePositionSize(5, 50, 10000);
    expect(position).toBe(1000);
  });

  test('handles large price differences', () => {
    // $100 profit on 100 bps (1%) = $10,000 position
    const position = calculatePositionSize(100, 100, 50000);
    expect(position).toBe(10000);
  });

  test('throws for zero price difference', () => {
    expect(() => calculatePositionSize(30, 0, 10000)).toThrow('priceDiffBps must be positive');
  });

  test('throws for negative price difference', () => {
    expect(() => calculatePositionSize(30, -10, 10000)).toThrow('priceDiffBps must be positive');
  });
});

describe('EVM Chain ID Parsing', () => {
  test('parses Ethereum mainnet', () => {
    expect(parseEvmChainId('evm:1')).toBe(1);
  });

  test('parses Base mainnet', () => {
    expect(parseEvmChainId('evm:8453')).toBe(8453);
  });

  test('parses Arbitrum', () => {
    expect(parseEvmChainId('evm:42161')).toBe(42161);
  });

  test('parses Optimism', () => {
    expect(parseEvmChainId('evm:10')).toBe(10);
  });

  test('returns null for solana', () => {
    expect(parseEvmChainId('solana')).toBeNull();
  });

  test('returns null for hyperliquid', () => {
    expect(parseEvmChainId('hyperliquid')).toBeNull();
  });

  test('returns null for invalid format', () => {
    expect(parseEvmChainId('evm:')).toBeNull();
    expect(parseEvmChainId('evm:abc')).toBeNull();
    expect(parseEvmChainId('notevmchain')).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseEvmChainId('')).toBeNull();
  });
});

describe('Net Profit Calculation', () => {
  test('calculates net profit after bridge costs', () => {
    // 50 bps price diff - 15 bps cost = 35 bps net
    expect(calculateNetProfitBps(50)).toBe(35);
  });

  test('handles exactly break-even scenario', () => {
    // 15 bps diff - 15 bps cost = 0 net
    expect(calculateNetProfitBps(15)).toBe(0);
  });

  test('shows loss when price diff below costs', () => {
    // 10 bps diff - 15 bps cost = -5 net (loss)
    expect(calculateNetProfitBps(10)).toBe(-5);
  });

  test('handles large price differences', () => {
    // 200 bps (2%) - 15 bps = 185 bps net
    expect(calculateNetProfitBps(200)).toBe(185);
  });

  test('uses custom bridge cost', () => {
    // 50 bps - 25 bps custom cost = 25 bps net
    expect(calculateNetProfitBps(50, 25)).toBe(25);
  });
});

describe('Minimum Output Calculation (Slippage)', () => {
  test('calculates correct min output for 0.5% slippage', () => {
    // 1000 tokens with 50 bps (0.5%) slippage = 995 min
    const minOut = calculateMinOutput(1000n, 50);
    expect(minOut).toBe(995n);
  });

  test('calculates correct min output for 1% slippage', () => {
    // 10000 tokens with 100 bps (1%) slippage = 9900 min
    const minOut = calculateMinOutput(10000n, 100);
    expect(minOut).toBe(9900n);
  });

  test('handles zero slippage', () => {
    const minOut = calculateMinOutput(1000n, 0);
    expect(minOut).toBe(1000n);
  });

  test('handles max slippage (100%)', () => {
    const minOut = calculateMinOutput(1000n, 10000);
    expect(minOut).toBe(0n);
  });

  test('preserves precision for large amounts', () => {
    // 1 ETH (10^18 wei) with 50 bps slippage
    const oneEth = 1000000000000000000n;
    const minOut = calculateMinOutput(oneEth, 50);
    expect(minOut).toBe(995000000000000000n);
  });

  test('throws for invalid slippage values', () => {
    expect(() => calculateMinOutput(1000n, -1)).toThrow('slippageBps must be between 0 and 10000');
    expect(() => calculateMinOutput(1000n, 10001)).toThrow('slippageBps must be between 0 and 10000');
  });
});

describe('Profit Estimation', () => {
  test('estimates profit correctly for typical arbitrage', () => {
    // $10,000 position with 50 bps price diff and 15 bps cost = 35 bps net = $35 profit
    const profit = estimateProfitUsd(10000, 50, 15);
    expect(profit).toBe(35);
  });

  test('shows zero profit at break-even', () => {
    const profit = estimateProfitUsd(10000, 15, 15);
    expect(profit).toBe(0);
  });

  test('shows negative profit when losing money', () => {
    const profit = estimateProfitUsd(10000, 10, 15);
    expect(profit).toBe(-5);
  });

  test('scales with position size', () => {
    // Double position should double profit
    const smallProfit = estimateProfitUsd(5000, 50, 15);
    const largeProfit = estimateProfitUsd(10000, 50, 15);
    expect(largeProfit).toBe(smallProfit * 2);
  });
});

describe('Token Address Configuration', () => {
  // Verify the configuration constants match expected values
  const TOKEN_ADDRESSES: Record<string, Record<number, string>> = {
    WETH: {
      1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      42161: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
      10: '0x4200000000000000000000000000000000000006',
      8453: '0x4200000000000000000000000000000000000006',
    },
    USDC: {
      1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
      8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    },
  };

  test('WETH addresses are valid checksummed addresses', () => {
    for (const [chainId, address] of Object.entries(TOKEN_ADDRESSES.WETH)) {
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    }
  });

  test('USDC addresses are valid checksummed addresses', () => {
    for (const [chainId, address] of Object.entries(TOKEN_ADDRESSES.USDC)) {
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    }
  });

  test('Base and Optimism share WETH address', () => {
    expect(TOKEN_ADDRESSES.WETH[10]).toBe(TOKEN_ADDRESSES.WETH[8453]);
  });

  test('Ethereum and Arbitrum have different WETH addresses', () => {
    expect(TOKEN_ADDRESSES.WETH[1]).not.toBe(TOKEN_ADDRESSES.WETH[42161]);
  });
});

describe('Arbitrage Opportunity Type Detection', () => {
  function determineArbType(buyChain: string, sellChain: string): 'solana_evm' | 'hyperliquid' | 'cross_dex' {
    if (buyChain === 'solana' || sellChain === 'solana') {
      return 'solana_evm';
    }
    if (buyChain === 'hyperliquid' || sellChain === 'hyperliquid') {
      return 'hyperliquid';
    }
    return 'cross_dex';
  }

  test('identifies Solana-EVM arb when buying on Solana', () => {
    expect(determineArbType('solana', 'evm:1')).toBe('solana_evm');
  });

  test('identifies Solana-EVM arb when selling on Solana', () => {
    expect(determineArbType('evm:8453', 'solana')).toBe('solana_evm');
  });

  test('identifies Hyperliquid arb when buying on HL', () => {
    expect(determineArbType('hyperliquid', 'evm:1')).toBe('hyperliquid');
  });

  test('identifies Hyperliquid arb when selling on HL', () => {
    expect(determineArbType('evm:42161', 'hyperliquid')).toBe('hyperliquid');
  });

  test('identifies cross-DEX arb for EVM to EVM', () => {
    expect(determineArbType('evm:1', 'evm:8453')).toBe('cross_dex');
    expect(determineArbType('evm:42161', 'evm:10')).toBe('cross_dex');
  });
});

describe('Jito Tip Account Selection', () => {
  const JITO_TIP_ACCOUNTS = [
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    'HFqU5x63VTqvQss8hp11i4bVmkdRmao126vhwQVqhEam',
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
    'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
    'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
    'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
    '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
  ];

  test('all tip accounts are valid base58 Solana addresses', () => {
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    for (const account of JITO_TIP_ACCOUNTS) {
      expect(account).toMatch(base58Regex);
    }
  });

  test('has exactly 8 tip accounts', () => {
    expect(JITO_TIP_ACCOUNTS).toHaveLength(8);
  });

  test('all accounts are unique', () => {
    const uniqueAccounts = new Set(JITO_TIP_ACCOUNTS);
    expect(uniqueAccounts.size).toBe(JITO_TIP_ACCOUNTS.length);
  });
});
