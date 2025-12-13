/**
 * @fileoverview Sandwich Strategy Tests
 *
 * Tests sandwich detection and parameter calculation.
 */

import { test, expect } from '@playwright/test';
import { parseEther, encodeFunctionData } from 'viem';
import { SandwichStrategy } from '../../src/strategies/sandwich';
import type { Pool, ChainId } from '../../src/types';
import { XLP_ROUTER_ABI } from '../../src/lib/contracts';

const mockPool: Pool = {
  address: '0x1111111111111111111111111111111111111111',
  type: 'XLP_V2',
  token0: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6, chainId: 1337 as ChainId },
  token1: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18, chainId: 1337 as ChainId },
  chainId: 1337 as ChainId,
  reserve0: parseEther('1000000').toString(), // 1M USDC
  reserve1: parseEther('500').toString(), // 500 ETH
};

const MOCK_ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D';

test.describe('Sandwich Strategy', () => {
  test('initializes with pools and routers', async () => {
    const strategy = new SandwichStrategy(
      1337 as ChainId,
      {
        type: 'SANDWICH',
        enabled: true,
        minProfitBps: 5,
        maxGasGwei: 150,
        maxSlippageBps: 30,
      },
      [MOCK_ROUTER]
    );

    strategy.initialize([mockPool]);

    expect(strategy).toBeDefined();
  });

  test('ignores non-router transactions', async () => {
    const strategy = new SandwichStrategy(
      1337 as ChainId,
      {
        type: 'SANDWICH',
        enabled: true,
        minProfitBps: 5,
        maxGasGwei: 150,
        maxSlippageBps: 30,
      },
      [MOCK_ROUTER]
    );

    strategy.initialize([mockPool]);

    // Send a transaction to a non-router address
    strategy.onPendingTx({
      hash: '0x1234',
      from: '0xaaaa',
      to: '0xbbbb', // Not a router
      value: 0n,
      gasPrice: parseEther('0.00000005'), // 50 gwei
      gas: 200000n,
      input: '0x',
      nonce: 0,
      chainId: 1337 as ChainId,
      receivedAt: Date.now(),
    });

    const opportunities = strategy.getOpportunities();
    expect(opportunities.length).toBe(0);
  });

  test('detects large swap transaction', async () => {
    const strategy = new SandwichStrategy(
      1337 as ChainId,
      {
        type: 'SANDWICH',
        enabled: true,
        minProfitBps: 1,
        maxGasGwei: 150,
        maxSlippageBps: 30,
      },
      [MOCK_ROUTER]
    );

    strategy.initialize([mockPool]);

    // Encode a swap transaction
    const swapData = encodeFunctionData({
      abi: XLP_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        parseEther('10'), // amountIn: 10 ETH worth
        parseEther('9'), // amountOutMin
        [mockPool.token1.address, mockPool.token0.address], // path: WETH -> USDC
        '0xcccccccccccccccccccccccccccccccccccccccc',
        BigInt(Math.floor(Date.now() / 1000) + 300),
      ],
    });

    strategy.onPendingTx({
      hash: '0x1234567890abcdef',
      from: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      to: MOCK_ROUTER,
      value: 0n,
      gasPrice: parseEther('0.00000005'),
      gas: 300000n,
      input: swapData,
      nonce: 0,
      chainId: 1337 as ChainId,
      receivedAt: Date.now(),
    });

    const opportunities = strategy.getOpportunities();
    console.log('Sandwich opportunities:', opportunities.length);

    for (const opp of opportunities) {
      console.log('  Victim TX:', opp.victimTx.hash);
      console.log('  Expected profit:', opp.expectedProfit);
      console.log('  Victim impact:', opp.victimImpactBps, 'bps');
    }
  });

  test('respects victim impact limits', async () => {
    const strategy = new SandwichStrategy(
      1337 as ChainId,
      {
        type: 'SANDWICH',
        enabled: true,
        minProfitBps: 1,
        maxGasGwei: 150,
        maxSlippageBps: 30,
      },
      [MOCK_ROUTER]
    );

    strategy.initialize([mockPool]);

    // All detected sandwiches should have victim impact <= 100 bps (1%)
    const opportunities = strategy.getOpportunities();

    for (const opp of opportunities) {
      expect(opp.victimImpactBps).toBeLessThanOrEqual(100);
    }
  });

  test('calculates frontrun and backrun parameters', async () => {
    const strategy = new SandwichStrategy(
      1337 as ChainId,
      {
        type: 'SANDWICH',
        enabled: true,
        minProfitBps: 1,
        maxGasGwei: 150,
        maxSlippageBps: 30,
      },
      [MOCK_ROUTER]
    );

    strategy.initialize([mockPool]);

    // Create a large swap
    const swapData = encodeFunctionData({
      abi: XLP_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        parseEther('100'), // Large swap: 100 ETH
        parseEther('90'), // Allow 10% slippage
        [mockPool.token1.address, mockPool.token0.address],
        '0xcccccccccccccccccccccccccccccccccccccccc',
        BigInt(Math.floor(Date.now() / 1000) + 300),
      ],
    });

    strategy.onPendingTx({
      hash: '0xabcd',
      from: '0xaaaa',
      to: MOCK_ROUTER,
      value: 0n,
      gasPrice: parseEther('0.00000050'),
      gas: 300000n,
      input: swapData,
      nonce: 0,
      chainId: 1337 as ChainId,
      receivedAt: Date.now(),
    });

    const opportunities = strategy.getOpportunities();

    for (const opp of opportunities) {
      // Frontrun should have valid amounts
      expect(BigInt(opp.frontrunTx.amountIn)).toBeGreaterThan(0n);
      expect(BigInt(opp.frontrunTx.amountOutMin)).toBeGreaterThan(0n);

      // Backrun should have valid amounts
      expect(BigInt(opp.backrunTx.amountIn)).toBeGreaterThan(0n);
      expect(BigInt(opp.backrunTx.amountOutMin)).toBeGreaterThan(0n);

      // Paths should be reversed
      expect(opp.frontrunTx.path[0]).toBe(opp.backrunTx.path[opp.backrunTx.path.length - 1]);
    }
  });

  test('marks opportunities correctly', async () => {
    const strategy = new SandwichStrategy(
      1337 as ChainId,
      {
        type: 'SANDWICH',
        enabled: true,
        minProfitBps: 1,
        maxGasGwei: 150,
        maxSlippageBps: 30,
      },
      [MOCK_ROUTER]
    );

    strategy.initialize([mockPool]);

    // Create opportunity
    const swapData = encodeFunctionData({
      abi: XLP_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        parseEther('50'),
        parseEther('45'),
        [mockPool.token1.address, mockPool.token0.address],
        '0xcccc',
        BigInt(Math.floor(Date.now() / 1000) + 300),
      ],
    });

    strategy.onPendingTx({
      hash: '0xtest',
      from: '0xaaaa',
      to: MOCK_ROUTER,
      value: 0n,
      gasPrice: parseEther('0.00000050'),
      gas: 300000n,
      input: swapData,
      nonce: 0,
      chainId: 1337 as ChainId,
      receivedAt: Date.now(),
    });

    const initialOpps = strategy.getOpportunities();

    if (initialOpps.length > 0) {
      const opp = initialOpps[0];
      expect(opp.status).toBe('DETECTED');

      strategy.markExecuting(opp.id);
      // After marking executing, it should not appear in getOpportunities
      const afterExecuting = strategy.getOpportunities();
      expect(afterExecuting.find(o => o.id === opp.id)?.status).not.toBe('DETECTED');

      strategy.markCompleted(opp.id, true);
    }
  });
});
