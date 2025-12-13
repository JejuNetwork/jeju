/**
 * Tests for the real quote-service.ts
 * These tests exercise actual service logic, not mocks
 */
import { describe, it, expect, beforeAll, mock } from 'bun:test';

// Mock viem's createPublicClient to avoid real RPC calls
const mockReadContract = mock(() => Promise.resolve({
  solver: '0x1234567890123456789012345678901234567890' as const,
  stakedAmount: 1000000000000000000n,
  slashedAmount: 0n,
  totalFills: 100n,
  successfulFills: 95n,
  supportedChains: [1n, 42161n, 10n, 8453n],
  isActive: true,
  registeredAt: 1700000000n,
}));

const mockGetGasPrice = mock(() => Promise.resolve(20000000000n));

const mockPublicClient = {
  readContract: mockReadContract,
  getGasPrice: mockGetGasPrice,
};

mock.module('viem', () => ({
  createPublicClient: () => mockPublicClient,
  http: () => ({}),
  keccak256: (data: Uint8Array | string) => {
    // Simple deterministic hash for testing
    const str = typeof data === 'string' ? data : Array.from(data).join('');
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return ('0x' + Math.abs(hash).toString(16).padStart(64, '0')) as `0x${string}`;
  },
  encodePacked: (_types: string[], values: (string | bigint)[]) => {
    return '0x' + values.map(v => v.toString()).join('');
  },
}));

// Import the real service after mocking viem
import { getQuotes, type QuoteParams } from '../../src/services/quote-service';

describe('Quote Service (Real)', () => {
  const baseParams: QuoteParams = {
    sourceChain: 1,
    destinationChain: 42161,
    sourceToken: '0x0000000000000000000000000000000000000000',
    destinationToken: '0x0000000000000000000000000000000000000000',
    amount: '1000000000000000000', // 1 ETH
  };

  describe('getQuotes - Basic Behavior', () => {
    it('should return at least one quote', async () => {
      const quotes = await getQuotes(baseParams);
      expect(quotes.length).toBeGreaterThan(0);
    });

    it('should return quotes sorted by output amount (best first)', async () => {
      const quotes = await getQuotes(baseParams);
      for (let i = 1; i < quotes.length; i++) {
        const prev = BigInt(quotes[i - 1].outputAmount);
        const curr = BigInt(quotes[i].outputAmount);
        expect(prev >= curr).toBe(true);
      }
    });

    it('should include quoteId in each quote', async () => {
      const quotes = await getQuotes(baseParams);
      for (const quote of quotes) {
        expect(quote.quoteId).toBeDefined();
        expect(quote.quoteId.startsWith('0x')).toBe(true);
      }
    });

    it('should have output amount less than input amount (fees deducted)', async () => {
      const quotes = await getQuotes(baseParams);
      for (const quote of quotes) {
        const input = BigInt(quote.inputAmount);
        const output = BigInt(quote.outputAmount);
        expect(output < input).toBe(true);
      }
    });

    it('should have valid fee percentage', async () => {
      const quotes = await getQuotes(baseParams);
      for (const quote of quotes) {
        expect(quote.feePercent).toBeGreaterThanOrEqual(0);
        expect(quote.feePercent).toBeLessThanOrEqual(100);
      }
    });

    it('should have valid expiration time', async () => {
      const now = Math.floor(Date.now() / 1000);
      const quotes = await getQuotes(baseParams);
      for (const quote of quotes) {
        expect(quote.validUntil).toBeGreaterThan(now);
        expect(quote.validUntil).toBeLessThanOrEqual(now + 600); // Max 10 minutes
      }
    });

    it('should preserve chain IDs in quote', async () => {
      const quotes = await getQuotes(baseParams);
      for (const quote of quotes) {
        expect(quote.sourceChainId).toBe(baseParams.sourceChain);
        expect(quote.destinationChainId).toBe(baseParams.destinationChain);
      }
    });

    it('should preserve token addresses in quote', async () => {
      const quotes = await getQuotes(baseParams);
      for (const quote of quotes) {
        expect(quote.sourceToken.toLowerCase()).toBe(baseParams.sourceToken.toLowerCase());
        expect(quote.destinationToken.toLowerCase()).toBe(baseParams.destinationToken.toLowerCase());
      }
    });
  });

  describe('getQuotes - L2 Route Optimization', () => {
    it('should calculate lower fees for L2-to-L2 routes', async () => {
      const l2Params: QuoteParams = {
        ...baseParams,
        sourceChain: 10, // Optimism
        destinationChain: 42161, // Arbitrum
      };
      
      const l1Params: QuoteParams = {
        ...baseParams,
        sourceChain: 1, // Ethereum
        destinationChain: 42161, // Arbitrum
      };
      
      const l2Quotes = await getQuotes(l2Params);
      const l1Quotes = await getQuotes(l1Params);
      
      // L2-to-L2 should have lower fee percentage (discount applied)
      expect(l2Quotes[0].feePercent).toBeLessThanOrEqual(l1Quotes[0].feePercent);
    });

    it('should estimate faster fill time for L2-to-L2', async () => {
      const l2Params: QuoteParams = {
        ...baseParams,
        sourceChain: 8453, // Base
        destinationChain: 10, // Optimism
      };
      
      const l1Params: QuoteParams = {
        ...baseParams,
        sourceChain: 1, // Ethereum
        destinationChain: 42161, // Arbitrum
      };
      
      const l2Quotes = await getQuotes(l2Params);
      const l1Quotes = await getQuotes(l1Params);
      
      // L2-to-L2 should be faster
      expect(l2Quotes[0].estimatedFillTimeSeconds).toBeLessThanOrEqual(l1Quotes[0].estimatedFillTimeSeconds);
    });
  });

  describe('getQuotes - Amount Handling', () => {
    it('should handle very small amounts', async () => {
      const smallParams: QuoteParams = {
        ...baseParams,
        amount: '1000', // 1000 wei
      };
      
      const quotes = await getQuotes(smallParams);
      expect(quotes.length).toBeGreaterThan(0);
      for (const quote of quotes) {
        const output = BigInt(quote.outputAmount);
        expect(output >= 0n).toBe(true);
      }
    });

    it('should handle very large amounts', async () => {
      const largeParams: QuoteParams = {
        ...baseParams,
        amount: '1000000000000000000000', // 1000 ETH
      };
      
      const quotes = await getQuotes(largeParams);
      expect(quotes.length).toBeGreaterThan(0);
      expect(BigInt(quotes[0].outputAmount)).toBeGreaterThan(0n);
    });

    it('should handle amount of 1 wei', async () => {
      const params: QuoteParams = {
        ...baseParams,
        amount: '1',
      };
      
      const quotes = await getQuotes(params);
      expect(quotes.length).toBeGreaterThan(0);
    });

    it('should handle 100 ETH amount', async () => {
      const params: QuoteParams = {
        ...baseParams,
        amount: '100000000000000000000', // 100 ETH
      };
      
      const quotes = await getQuotes(params);
      const input = BigInt(params.amount);
      const output = BigInt(quotes[0].outputAmount);
      const fee = BigInt(quotes[0].fee);
      
      // Verify fee math: input = output + fee
      expect(input).toBe(output + fee);
    });
  });

  describe('getQuotes - Fallback Quote', () => {
    it('should return fallback quote when no active solvers', async () => {
      // Without KNOWN_SOLVERS set, should fall back to static quote
      const quotes = await getQuotes(baseParams);
      expect(quotes.length).toBeGreaterThan(0);
      
      // Fallback quote characteristics
      const quote = quotes[quotes.length - 1]; // Fallback is usually last
      expect(quote.priceImpact).toBeGreaterThanOrEqual(0);
    });

    it('should generate valid quoteId for fallback', async () => {
      const quotes = await getQuotes(baseParams);
      for (const quote of quotes) {
        expect(quote.quoteId.startsWith('0x')).toBe(true);
        expect(quote.quoteId.length).toBeGreaterThanOrEqual(10);
      }
    });
  });

  describe('getQuotes - Fee Calculation', () => {
    it('should calculate fee correctly', async () => {
      const params: QuoteParams = {
        ...baseParams,
        amount: '10000000000000000000', // 10 ETH for easy calculation
      };
      
      const quotes = await getQuotes(params);
      const input = BigInt(params.amount);
      const output = BigInt(quotes[0].outputAmount);
      const fee = BigInt(quotes[0].fee);
      
      // Fee + output should equal input
      expect(output + fee).toBe(input);
    });

    it('should not have fee exceed input', async () => {
      const params: QuoteParams = {
        ...baseParams,
        amount: '100', // Very small amount
      };
      
      const quotes = await getQuotes(params);
      for (const quote of quotes) {
        const input = BigInt(quote.inputAmount);
        const fee = BigInt(quote.fee);
        expect(fee).toBeLessThanOrEqual(input);
      }
    });
  });

  describe('getQuotes - Validity Period', () => {
    it('should set validUntil to future timestamp', async () => {
      const now = Math.floor(Date.now() / 1000);
      const quotes = await getQuotes(baseParams);
      
      // Should be in the future
      expect(quotes[0].validUntil).toBeGreaterThan(now);
      // Should be within reasonable range (10 minutes)
      expect(quotes[0].validUntil).toBeLessThanOrEqual(now + 600);
    });
  });
});
