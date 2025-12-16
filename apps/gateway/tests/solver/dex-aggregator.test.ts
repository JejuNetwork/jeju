/**
 * DEX Aggregator Tests
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { mainnet } from 'viem/chains';

import {
  DexAggregator,
  UNISWAP_V3_QUOTER,
  UNISWAP_V2_ROUTER,
  BALANCER_VAULT,
  INTERMEDIATE_TOKENS,
} from '../../src/solver/external/dex-aggregator';

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address;
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address;

describe('DEX Contract Addresses', () => {
  describe('Uniswap V3 Quoter', () => {
    it('should have quoter on major chains', () => {
      expect(UNISWAP_V3_QUOTER[1]).toBeDefined();
      expect(UNISWAP_V3_QUOTER[42161]).toBeDefined();
      expect(UNISWAP_V3_QUOTER[10]).toBeDefined();
      expect(UNISWAP_V3_QUOTER[8453]).toBeDefined();
      expect(UNISWAP_V3_QUOTER[137]).toBeDefined();
    });

    it('should have valid addresses', () => {
      for (const [, address] of Object.entries(UNISWAP_V3_QUOTER)) {
        expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      }
    });
  });

  describe('Uniswap V2 Router', () => {
    it('should have router on Ethereum', () => {
      expect(UNISWAP_V2_ROUTER[1]).toBe('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D');
    });

    it('should have valid addresses', () => {
      for (const [, address] of Object.entries(UNISWAP_V2_ROUTER)) {
        expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      }
    });
  });

  describe('Balancer Vault', () => {
    it('should have same vault address on all chains', () => {
      const expectedVault = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
      expect(BALANCER_VAULT[1]).toBe(expectedVault);
      expect(BALANCER_VAULT[42161]).toBe(expectedVault);
      expect(BALANCER_VAULT[10]).toBe(expectedVault);
    });
  });
});

describe('Intermediate Tokens', () => {
  it('should have intermediate tokens for Ethereum', () => {
    const ethTokens = INTERMEDIATE_TOKENS[1];
    expect(ethTokens).toBeDefined();
    expect(ethTokens.length).toBeGreaterThan(0);
    expect(ethTokens.some(t => t.toLowerCase() === WETH.toLowerCase())).toBe(true);
    expect(ethTokens.some(t => t.toLowerCase() === USDC.toLowerCase())).toBe(true);
  });

  it('should have intermediate tokens for L2s', () => {
    expect(INTERMEDIATE_TOKENS[42161]).toBeDefined();
    expect(INTERMEDIATE_TOKENS[8453]).toBeDefined();
  });
});

describe('DexAggregator Instantiation', () => {
  it('should instantiate with empty clients', () => {
    const clients = new Map<number, PublicClient>();
    const aggregator = new DexAggregator(clients);
    expect(aggregator).toBeDefined();
  });

  it('should instantiate with clients', () => {
    const clients = new Map<number, PublicClient>();
    clients.set(1, createPublicClient({
      chain: mainnet,
      transport: http('https://eth.llamarpc.com'),
    }));
    
    const aggregator = new DexAggregator(clients);
    expect(aggregator).toBeDefined();
  });
});

describe('Live DEX Quotes', () => {
  let aggregator: DexAggregator;

  beforeAll(() => {
    const clients = new Map<number, PublicClient>();
    clients.set(1, createPublicClient({
      chain: mainnet,
      transport: http('https://eth.llamarpc.com'),
    }));
    aggregator = new DexAggregator(clients);
  });

  it('should get Uniswap V2 quote for USDC to WETH', async () => {
    const amountIn = BigInt('1000000000');
    
    const quotes = await aggregator.getBestQuote(1, USDC, WETH, amountIn);
    
    expect(quotes).toBeDefined();
    if (quotes) {
      expect(quotes.all.length).toBeGreaterThan(0);
      expect(Number(quotes.best.amountOut)).toBeGreaterThan(0);
    }
  }, 20000);

  it('should get best quote across DEXes', async () => {
    const amountIn = BigInt('10000000000');
    
    const quotes = await aggregator.getBestQuote(1, USDC, WETH, amountIn);
    
    if (quotes) {
      expect(quotes.best).toBeDefined();
      expect(Number(quotes.best.amountOut)).toBeGreaterThan(0);
      expect(['uniswap_v2', 'uniswap_v3', 'balancer']).toContain(quotes.best.dex);
      expect(quotes.timestamp).toBeGreaterThan(0);
    }
  }, 20000);

  it('should sort quotes by output amount', async () => {
    const amountIn = BigInt('5000000000');
    
    const quotes = await aggregator.getBestQuote(1, USDC, WETH, amountIn);
    
    if (quotes && quotes.all.length > 1) {
      for (const quote of quotes.all) {
        expect(quote.amountOut).toBeLessThanOrEqual(quotes.best.amountOut);
      }
    }
  }, 20000);

  it('should return null for unsupported chain', async () => {
    const amountIn = BigInt('1000000000');
    const quotes = await aggregator.getBestQuote(99999, USDC, WETH, amountIn);
    expect(quotes).toBeNull();
  });
});

describe('Quote Comparison', () => {
  let aggregator: DexAggregator;

  beforeAll(() => {
    const clients = new Map<number, PublicClient>();
    clients.set(1, createPublicClient({
      chain: mainnet,
      transport: http('https://eth.llamarpc.com'),
    }));
    aggregator = new DexAggregator(clients);
  });

  it('should compare with internal quote', async () => {
    const amountIn = BigInt('1000000000');
    const internalAmountOut = BigInt('300000000000000000');
    
    // The comparison may return null if external quote fails
    const comparison = await aggregator.compareWithInternal(
      1,
      USDC,
      WETH,
      amountIn,
      internalAmountOut
    );
    
    // Should always return an object with these fields
    expect(comparison).toBeDefined();
    expect(typeof comparison.shouldUseExternal).toBe('boolean');
    expect(typeof comparison.improvementBps).toBe('number');
  }, 20000);
});



