/**
 * RPC Proxy Tests
 */

import { describe, test, expect } from 'bun:test';
import { getChainStats, getEndpointHealth } from '../../src/rpc/proxy/rpc-proxy.js';
import { isChainSupported, getChain, CHAINS } from '../../src/rpc/config/chains.js';

describe('Chain Configuration', () => {
  test('supports expected chains', () => {
    expect(isChainSupported(1)).toBe(true);       // Ethereum
    expect(isChainSupported(420691)).toBe(true);  // Jeju
    expect(isChainSupported(8453)).toBe(true);    // Base
    expect(isChainSupported(42161)).toBe(true);   // Arbitrum
    expect(isChainSupported(10)).toBe(true);      // Optimism
    expect(isChainSupported(999999)).toBe(false); // Unknown
  });

  test('returns correct chain config', () => {
    const ethereum = getChain(1);
    expect(ethereum.name).toBe('Ethereum');
    expect(ethereum.isTestnet).toBe(false);

    const sepolia = getChain(11155111);
    expect(sepolia.name).toBe('Sepolia');
    expect(sepolia.isTestnet).toBe(true);
  });

  test('throws for unsupported chain', () => {
    expect(() => getChain(999999)).toThrow('Unsupported chain');
  });

  test('has correct chain count', () => {
    const stats = getChainStats();
    expect(stats.supported).toBeGreaterThanOrEqual(9);
    expect(stats.mainnet).toBeGreaterThanOrEqual(4);
    expect(stats.testnet).toBeGreaterThanOrEqual(5);
  });
});

describe('Endpoint Health', () => {
  test('returns health for all chains', () => {
    const health = getEndpointHealth();
    
    const chainCount = Object.keys(CHAINS).length;
    expect(Object.keys(health).length).toBeGreaterThanOrEqual(chainCount);
  });

  test('new endpoints are healthy by default', () => {
    const health = getEndpointHealth();
    
    for (const [_url, status] of Object.entries(health)) {
      expect(status.healthy).toBe(true);
      expect(status.failures).toBe(0);
    }
  });
});

describe('Chain Stats', () => {
  test('returns correct structure', () => {
    const stats = getChainStats();
    
    expect(stats).toHaveProperty('supported');
    expect(stats).toHaveProperty('mainnet');
    expect(stats).toHaveProperty('testnet');
    expect(stats).toHaveProperty('chains');
    expect(Array.isArray(stats.chains)).toBe(true);
  });

  test('includes all chain details', () => {
    const stats = getChainStats();
    
    for (const chain of stats.chains) {
      expect(chain).toHaveProperty('chainId');
      expect(chain).toHaveProperty('name');
      expect(chain).toHaveProperty('isTestnet');
    }
  });
});
