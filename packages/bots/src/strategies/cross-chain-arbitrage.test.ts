/**
 * Cross-Chain Arbitrage Tests
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { CrossChainArbitrage } from './cross-chain-arbitrage';

describe('CrossChainArbitrage', () => {
  let arb: CrossChainArbitrage;

  beforeEach(() => {
    arb = new CrossChainArbitrage({
      minProfitBps: 50,
      minProfitUsd: 10,
      maxSlippageBps: 100,
      maxPositionUsd: 50000,
      bridgeTimeoutSeconds: 300,
      enableExecution: false,
    });
  });

  afterEach(() => {
    arb.stop();
  });

  test('should initialize with default config', () => {
    const defaultArb = new CrossChainArbitrage();
    expect(defaultArb).toBeDefined();
    defaultArb.stop();
  });

  test('should return empty opportunities initially', () => {
    const opportunities = arb.getOpportunities();
    expect(opportunities).toEqual([]);
  });

  test('should return initial stats', () => {
    const stats = arb.getStats();
    
    expect(stats.opportunitiesFound).toBe(0);
    expect(stats.totalProfitUsd).toBe(0);
    expect(stats.tradesExecuted).toBe(0);
    expect(stats.lastScan).toBe(0);
  });

  test('should update config', () => {
    arb.updateConfig({
      minProfitBps: 100,
      minProfitUsd: 20,
    });

    // Should not throw
    expect(arb).toBeDefined();
  });

  test('should emit started event', (done) => {
    arb.on('started', () => {
      expect(true).toBe(true);
      arb.stop();
      done();
    });

    arb.start();
  });

  test('should emit stopped event', (done) => {
    arb.start();

    arb.on('stopped', () => {
      expect(true).toBe(true);
      done();
    });

    arb.stop();
  });

  test('should not start twice', () => {
    arb.start();
    arb.start(); // Should be no-op
    
    expect(arb.getStats().lastScan).toBeGreaterThan(0);
    arb.stop();
  });

  test('should not stop if not running', () => {
    arb.stop(); // Should be no-op
    expect(true).toBe(true);
  });
});

describe('CrossChainArbitrage chain configuration', () => {
  test('should add custom chain', () => {
    const arb = new CrossChainArbitrage();

    arb.addChain({
      chainId: 420690,
      name: 'Jeju Testnet',
      rpcUrl: 'http://localhost:8545',
      type: 'evm',
      blockTimeMs: 1000,
      nativeSymbol: 'JEJU',
      dexes: [
        {
          name: 'JejuSwap',
          type: 'uniswap-v2',
          router: '0x1234567890123456789012345678901234567890' as `0x${string}`,
          factory: '0x2345678901234567890123456789012345678901' as `0x${string}`,
        },
      ],
      bridges: [],
    });

    expect(arb).toBeDefined();
    arb.stop();
  });
});

