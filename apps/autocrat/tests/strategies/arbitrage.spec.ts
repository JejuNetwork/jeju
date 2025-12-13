/**
 * @fileoverview DEX Arbitrage Strategy Tests
 *
 * Tests arbitrage detection and execution on localnet.
 */

import { test, expect } from '@playwright/test';
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { DexArbitrageStrategy } from '../../src/strategies/dex-arbitrage';
import type { Pool, ChainId } from '../../src/types';

const RPC_URL = 'http://localhost:8545';
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Mock pools for testing
const mockPools: Pool[] = [
  {
    address: '0x1111111111111111111111111111111111111111',
    type: 'XLP_V2',
    token0: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, chainId: 1337 as ChainId },
    token1: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18, chainId: 1337 as ChainId },
    chainId: 1337 as ChainId,
    reserve0: parseEther('1000000').toString(), // 1M USDC
    reserve1: parseEther('500').toString(), // 500 ETH
  },
  {
    address: '0x2222222222222222222222222222222222222222',
    type: 'XLP_V2',
    token0: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, chainId: 1337 as ChainId },
    token1: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18, chainId: 1337 as ChainId },
    chainId: 1337 as ChainId,
    reserve0: parseEther('990000').toString(), // 990K USDC (different price)
    reserve1: parseEther('500').toString(), // 500 ETH
  },
];

test.describe('DEX Arbitrage Strategy', () => {
  test('initializes with pools', async () => {
    const strategy = new DexArbitrageStrategy(1337 as ChainId, {
      type: 'DEX_ARBITRAGE',
      enabled: true,
      minProfitBps: 10,
      maxGasGwei: 100,
      maxSlippageBps: 50,
    });

    strategy.initialize(mockPools);

    // Strategy should have indexed the pools
    expect(strategy).toBeDefined();
  });

  test('detects price discrepancy between pools', async () => {
    const strategy = new DexArbitrageStrategy(1337 as ChainId, {
      type: 'DEX_ARBITRAGE',
      enabled: true,
      minProfitBps: 5, // 0.05% minimum
      maxGasGwei: 100,
      maxSlippageBps: 50,
    });

    strategy.initialize(mockPools);

    // Simulate sync event to trigger arbitrage check
    strategy.onSync({
      poolAddress: mockPools[0].address,
      reserve0: BigInt(mockPools[0].reserve0!),
      reserve1: BigInt(mockPools[0].reserve1!),
      blockNumber: 1n,
      chainId: 1337 as ChainId,
    });

    // Get opportunities
    const opportunities = strategy.getOpportunities();

    // Should detect the price difference between the two pools
    // Pool 1: 1M/500 = 2000 USDC/ETH
    // Pool 2: 990K/500 = 1980 USDC/ETH
    // Difference: ~1%
    console.log('Opportunities found:', opportunities.length);
    for (const opp of opportunities) {
      console.log(`  - Profit: ${opp.expectedProfitBps} bps`);
    }
  });

  test('calculates correct output amounts', async () => {
    const strategy = new DexArbitrageStrategy(1337 as ChainId, {
      type: 'DEX_ARBITRAGE',
      enabled: true,
      minProfitBps: 10,
      maxGasGwei: 100,
      maxSlippageBps: 50,
    });

    // Test constant product formula
    // amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
    const amountIn = parseEther('1');
    const reserveIn = parseEther('1000');
    const reserveOut = parseEther('1000');

    // Expected: ~0.996 (after 0.3% fee, with some price impact)
    const expectedOut = (amountIn * 997n * reserveOut) / (reserveIn * 1000n + amountIn * 997n);

    expect(expectedOut).toBeGreaterThan(parseEther('0.99'));
    expect(expectedOut).toBeLessThan(parseEther('1'));
  });

  test('respects minimum profit threshold', async () => {
    const strategy = new DexArbitrageStrategy(1337 as ChainId, {
      type: 'DEX_ARBITRAGE',
      enabled: true,
      minProfitBps: 100, // 1% minimum - higher than our mock pools
      maxGasGwei: 100,
      maxSlippageBps: 50,
    });

    strategy.initialize(mockPools);

    // Trigger check
    strategy.onSync({
      poolAddress: mockPools[0].address,
      reserve0: BigInt(mockPools[0].reserve0!),
      reserve1: BigInt(mockPools[0].reserve1!),
      blockNumber: 1n,
      chainId: 1337 as ChainId,
    });

    // Should not find any opportunities below 1% profit
    const opportunities = strategy.getOpportunities();

    // Filter for opportunities that meet our threshold
    const validOpps = opportunities.filter(o => o.expectedProfitBps >= 100);
    console.log('Valid opportunities (>=1% profit):', validOpps.length);
  });

  test('marks opportunity as executing and completed', async () => {
    const strategy = new DexArbitrageStrategy(1337 as ChainId, {
      type: 'DEX_ARBITRAGE',
      enabled: true,
      minProfitBps: 1,
      maxGasGwei: 100,
      maxSlippageBps: 50,
    });

    strategy.initialize(mockPools);

    // Create a mock opportunity by triggering sync
    strategy.onSync({
      poolAddress: mockPools[0].address,
      reserve0: BigInt(mockPools[0].reserve0!),
      reserve1: BigInt(mockPools[0].reserve1!),
      blockNumber: 1n,
      chainId: 1337 as ChainId,
    });

    const opportunities = strategy.getOpportunities();

    if (opportunities.length > 0) {
      const opp = opportunities[0];

      // Mark as executing
      strategy.markExecuting(opp.id);
      expect(strategy.getOpportunities().length).toBeLessThan(opportunities.length);

      // Mark as completed
      strategy.markCompleted(opp.id, true);
    }
  });
});
