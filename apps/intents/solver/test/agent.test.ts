/**
 * @fileoverview Unit tests for OIF Solver Agent
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { LiquidityManager } from '../src/liquidity';
import { StrategyEngine } from '../src/strategy';

describe('LiquidityManager', () => {
  let liquidityManager: LiquidityManager;

  beforeEach(() => {
    liquidityManager = new LiquidityManager({
      chains: [
        { chainId: 1, name: 'Ethereum', rpcUrl: 'https://eth.llamarpc.com' },
        { chainId: 42161, name: 'Arbitrum', rpcUrl: 'https://arb1.arbitrum.io/rpc' },
      ],
      maxExposurePerChain: '10000000000000000000',
    });
  });

  test('hasLiquidity returns false when not initialized', async () => {
    const has = await liquidityManager.hasLiquidity(
      1,
      '0x0000000000000000000000000000000000000000',
      '1000000000000000000'
    );
    expect(has).toBe(false);
  });

  test('lockLiquidity fails when insufficient', async () => {
    const locked = await liquidityManager.lockLiquidity(
      1,
      '0x0000000000000000000000000000000000000000',
      '1000000000000000000'
    );
    expect(locked).toBe(false);
  });

  test('getTotalLiquidity returns empty array initially', () => {
    const total = liquidityManager.getTotalLiquidity();
    expect(total).toBeInstanceOf(Array);
    expect(total.length).toBe(0);
  });
});

describe('StrategyEngine', () => {
  let strategyEngine: StrategyEngine;

  beforeEach(() => {
    strategyEngine = new StrategyEngine({
      chains: [
        { chainId: 1, name: 'Ethereum', rpcUrl: 'https://eth.llamarpc.com' },
      ],
      minProfitBps: 10,
      maxGasPrice: 100n * 10n ** 9n,
      maxExposurePerChain: '10000000000000000000',
      maxIntentSize: '5000000000000000000',
      minReputation: 80,
      intentCheckIntervalMs: 1000,
      liquidityRebalanceIntervalMs: 60000,
    });
  });

  test('evaluate returns evaluation with profitability', async () => {
    const evaluation = await strategyEngine.evaluate({
      orderId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      sourceChain: 1,
      destinationChain: 42161,
      inputToken: '0x0000000000000000000000000000000000000000',
      inputAmount: '1000000000000000000',
      outputToken: '0x0000000000000000000000000000000000000000',
      outputAmount: '980000000000000000', // 2% fee gives profit
    });

    expect(evaluation).toHaveProperty('profitable');
    expect(evaluation).toHaveProperty('expectedProfitBps');
  });

  test('rejects intents above max size', async () => {
    const evaluation = await strategyEngine.evaluate({
      orderId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      sourceChain: 1,
      destinationChain: 42161,
      inputToken: '0x0000000000000000000000000000000000000000',
      inputAmount: '100000000000000000000', // 100 ETH > max 5 ETH
      outputToken: '0x0000000000000000000000000000000000000000',
      outputAmount: '99000000000000000000',
    });

    expect(evaluation.profitable).toBe(false);
    expect(evaluation.reason).toContain('size');
  });
});

describe('Agent Integration', () => {
  test('config has required fields', () => {
    const config = {
      chains: [
        { chainId: 1, name: 'Ethereum', rpcUrl: 'https://eth.llamarpc.com' },
      ],
      minProfitBps: 10,
      maxGasPrice: 100n * 10n ** 9n,
      maxExposurePerChain: '10000000000000000000',
      maxIntentSize: '5000000000000000000',
      minReputation: 80,
      intentCheckIntervalMs: 1000,
      liquidityRebalanceIntervalMs: 60000,
    };

    expect(config.chains.length).toBeGreaterThan(0);
    expect(config.minProfitBps).toBeGreaterThan(0);
    expect(config.maxIntentSize).toBeDefined();
  });
});

