/**
 * Unit Tests for shared/chains.ts
 * Tests boundary conditions, edge cases, and all exports
 */

import { describe, test, expect } from 'bun:test';
import {
  PUBLIC_RPCS,
  CHAIN_NAMES,
  TESTNET_CHAIN_IDS,
  MAINNET_CHAIN_IDS,
  getChainIds,
  chainName,
  rpcUrl,
} from './chains';

describe('PUBLIC_RPCS', () => {
  test('should have all testnet chains', () => {
    expect(PUBLIC_RPCS[11155111]).toBe('https://ethereum-sepolia-rpc.publicnode.com');
    expect(PUBLIC_RPCS[84532]).toBe('https://sepolia.base.org');
    expect(PUBLIC_RPCS[421614]).toBe('https://sepolia-rollup.arbitrum.io/rpc');
    expect(PUBLIC_RPCS[11155420]).toBe('https://sepolia.optimism.io');
    expect(PUBLIC_RPCS[420690]).toBe('https://testnet-rpc.jeju.network');
  });

  test('should have all mainnet chains', () => {
    expect(PUBLIC_RPCS[1]).toBe('https://eth.llamarpc.com');
    expect(PUBLIC_RPCS[8453]).toBe('https://mainnet.base.org');
    expect(PUBLIC_RPCS[42161]).toBe('https://arb1.arbitrum.io/rpc');
    expect(PUBLIC_RPCS[10]).toBe('https://mainnet.optimism.io');
    expect(PUBLIC_RPCS[420691]).toBe('https://rpc.jeju.network');
  });

  test('should return undefined for unknown chain', () => {
    expect(PUBLIC_RPCS[999999]).toBeUndefined();
    expect(PUBLIC_RPCS[0]).toBeUndefined();
    expect(PUBLIC_RPCS[-1]).toBeUndefined();
  });

  test('all URLs should be valid https URLs', () => {
    for (const [chainId, url] of Object.entries(PUBLIC_RPCS)) {
      expect(url).toMatch(/^https:\/\/.+/);
      expect(url.endsWith('/')).toBe(false); // No trailing slash
    }
  });
});

describe('CHAIN_NAMES', () => {
  test('should have human-readable names for all testnets', () => {
    expect(CHAIN_NAMES[11155111]).toBe('Sepolia');
    expect(CHAIN_NAMES[84532]).toBe('Base Sepolia');
    expect(CHAIN_NAMES[421614]).toBe('Arbitrum Sepolia');
    expect(CHAIN_NAMES[11155420]).toBe('Optimism Sepolia');
    expect(CHAIN_NAMES[420690]).toBe('Jeju Testnet');
  });

  test('should have human-readable names for all mainnets', () => {
    expect(CHAIN_NAMES[1]).toBe('Ethereum');
    expect(CHAIN_NAMES[8453]).toBe('Base');
    expect(CHAIN_NAMES[42161]).toBe('Arbitrum One');
    expect(CHAIN_NAMES[10]).toBe('OP Mainnet');
    expect(CHAIN_NAMES[420691]).toBe('Jeju Mainnet');
  });

  test('coverage: every PUBLIC_RPCS key has a CHAIN_NAMES entry', () => {
    for (const chainId of Object.keys(PUBLIC_RPCS)) {
      expect(CHAIN_NAMES[Number(chainId)]).toBeDefined();
      expect(CHAIN_NAMES[Number(chainId)].length).toBeGreaterThan(0);
    }
  });
});

describe('TESTNET_CHAIN_IDS', () => {
  test('should contain exactly 5 testnet chains', () => {
    expect(TESTNET_CHAIN_IDS).toHaveLength(5);
  });

  test('should contain correct chain IDs', () => {
    expect(TESTNET_CHAIN_IDS).toContain(11155111); // Sepolia
    expect(TESTNET_CHAIN_IDS).toContain(84532);    // Base Sepolia
    expect(TESTNET_CHAIN_IDS).toContain(421614);   // Arbitrum Sepolia
    expect(TESTNET_CHAIN_IDS).toContain(11155420); // Optimism Sepolia
    expect(TESTNET_CHAIN_IDS).toContain(420690);   // Jeju Testnet
  });

  test('should not contain mainnet chains', () => {
    expect(TESTNET_CHAIN_IDS).not.toContain(1);
    expect(TESTNET_CHAIN_IDS).not.toContain(8453);
    expect(TESTNET_CHAIN_IDS).not.toContain(42161);
    expect(TESTNET_CHAIN_IDS).not.toContain(10);
    expect(TESTNET_CHAIN_IDS).not.toContain(420691);
  });
});

describe('MAINNET_CHAIN_IDS', () => {
  test('should contain exactly 5 mainnet chains', () => {
    expect(MAINNET_CHAIN_IDS).toHaveLength(5);
  });

  test('should contain correct chain IDs', () => {
    expect(MAINNET_CHAIN_IDS).toContain(1);      // Ethereum
    expect(MAINNET_CHAIN_IDS).toContain(8453);   // Base
    expect(MAINNET_CHAIN_IDS).toContain(42161);  // Arbitrum One
    expect(MAINNET_CHAIN_IDS).toContain(10);     // OP Mainnet
    expect(MAINNET_CHAIN_IDS).toContain(420691); // Jeju Mainnet
  });

  test('should not contain testnet chains', () => {
    expect(MAINNET_CHAIN_IDS).not.toContain(11155111);
    expect(MAINNET_CHAIN_IDS).not.toContain(84532);
    expect(MAINNET_CHAIN_IDS).not.toContain(421614);
    expect(MAINNET_CHAIN_IDS).not.toContain(11155420);
    expect(MAINNET_CHAIN_IDS).not.toContain(420690);
  });
});

describe('getChainIds()', () => {
  test('should return testnet IDs for "testnet"', () => {
    const result = getChainIds('testnet');
    expect(result).toEqual(TESTNET_CHAIN_IDS);
    expect(result).toHaveLength(5);
  });

  test('should return mainnet IDs for "mainnet"', () => {
    const result = getChainIds('mainnet');
    expect(result).toEqual(MAINNET_CHAIN_IDS);
    expect(result).toHaveLength(5);
  });

  test('should return different arrays for different networks', () => {
    const testnet = getChainIds('testnet');
    const mainnet = getChainIds('mainnet');
    expect(testnet).not.toEqual(mainnet);
    
    // No overlap
    for (const id of testnet) {
      expect(mainnet).not.toContain(id);
    }
  });
});

describe('chainName()', () => {
  test('should return name for known chains', () => {
    expect(chainName(1)).toBe('Ethereum');
    expect(chainName(11155111)).toBe('Sepolia');
    expect(chainName(8453)).toBe('Base');
    expect(chainName(84532)).toBe('Base Sepolia');
  });

  test('should return fallback for unknown chains', () => {
    expect(chainName(999999)).toBe('Chain 999999');
    expect(chainName(0)).toBe('Chain 0');
  });

  test('should handle boundary values', () => {
    expect(chainName(Number.MAX_SAFE_INTEGER)).toBe(`Chain ${Number.MAX_SAFE_INTEGER}`);
  });
});

describe('rpcUrl()', () => {
  test('should return URL for known chains', () => {
    expect(rpcUrl(1)).toBe('https://eth.llamarpc.com');
    expect(rpcUrl(11155111)).toBe('https://ethereum-sepolia-rpc.publicnode.com');
    expect(rpcUrl(8453)).toBe('https://mainnet.base.org');
  });

  test('should throw for unknown chains', () => {
    expect(() => rpcUrl(999999)).toThrow('No RPC URL for chain 999999');
    expect(() => rpcUrl(0)).toThrow('No RPC URL for chain 0');
  });

  test('should throw with specific chain ID in message', () => {
    expect(() => rpcUrl(12345)).toThrow('12345');
  });
});

describe('data consistency', () => {
  test('PUBLIC_RPCS and CHAIN_NAMES have same keys', () => {
    const rpcKeys = Object.keys(PUBLIC_RPCS).map(Number).sort((a, b) => a - b);
    const nameKeys = Object.keys(CHAIN_NAMES).map(Number).sort((a, b) => a - b);
    expect(rpcKeys).toEqual(nameKeys);
  });

  test('all chain ID arrays reference valid chains', () => {
    for (const id of [...TESTNET_CHAIN_IDS, ...MAINNET_CHAIN_IDS]) {
      expect(PUBLIC_RPCS[id]).toBeDefined();
      expect(CHAIN_NAMES[id]).toBeDefined();
    }
  });

  test('total chains equals testnets plus mainnets', () => {
    const totalChains = Object.keys(PUBLIC_RPCS).length;
    expect(totalChains).toBe(TESTNET_CHAIN_IDS.length + MAINNET_CHAIN_IDS.length);
  });
});
