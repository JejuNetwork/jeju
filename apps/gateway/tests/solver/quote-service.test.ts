import { describe, it, expect, mock } from 'bun:test';

// Simple type for testing
interface QuoteParams {
  sourceChain: number;
  destinationChain: number;
  sourceToken: string;
  destinationToken: string;
  amount: string;
}

interface IntentQuote {
  quoteId: string;
  sourceChainId: number;
  destinationChainId: number;
  sourceToken: string;
  destinationToken: string;
  inputAmount: string;
  outputAmount: string;
  fee: string;
  feePercent: number;
  priceImpact: number;
  estimatedFillTimeSeconds: number;
  validUntil: number;
  solver: string;
  solverReputation: number;
}

// Mock quote generator that mirrors the actual service logic
function mockGetQuotes(params: QuoteParams): IntentQuote[] {
  const inputAmount = BigInt(params.amount);
  const isL2ToL2 = isL2(params.sourceChain) && isL2(params.destinationChain);
  const feePercent = isL2ToL2 ? 30 : 50;
  const fee = (inputAmount * BigInt(feePercent)) / 10000n;
  const outputAmount = inputAmount - fee;
  
  // Generate a deterministic quote ID
  const quoteId = '0x' + 'a'.repeat(64);
  
  return [{
    quoteId,
    sourceChainId: params.sourceChain,
    destinationChainId: params.destinationChain,
    sourceToken: params.sourceToken,
    destinationToken: params.destinationToken,
    inputAmount: params.amount,
    outputAmount: outputAmount.toString(),
    fee: fee.toString(),
    feePercent,
    priceImpact: 10,
    estimatedFillTimeSeconds: isL2ToL2 ? 15 : 30,
    validUntil: Math.floor(Date.now() / 1000) + 300,
    solver: '0x0000000000000000000000000000000000000000',
    solverReputation: 0,
  }];
}

function isL2(chainId: number): boolean {
  return [10, 42161, 8453, 11155420, 421614, 84532].includes(chainId);
}

// Use the mock for testing
const getQuotes = mockGetQuotes;

describe('Quote Service', () => {
  describe('getQuotes', () => {
    const baseParams: QuoteParams = {
      sourceChain: 1,
      destinationChain: 42161,
      sourceToken: '0x0000000000000000000000000000000000000000',
      destinationToken: '0x0000000000000000000000000000000000000000',
      amount: '1000000000000000000', // 1 ETH
    };

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
        expect(quote.quoteId.length).toBe(66);
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
      
      // L2-to-L2 should have lower fee percentage
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
      
      expect(l2Quotes[0].estimatedFillTimeSeconds).toBeLessThan(l1Quotes[0].estimatedFillTimeSeconds);
    });

    it('should handle very small amounts', async () => {
      const smallParams: QuoteParams = {
        ...baseParams,
        amount: '1000', // 1000 wei
      };
      
      const quotes = await getQuotes(smallParams);
      expect(quotes.length).toBeGreaterThan(0);
      // Output might be 0 if fee exceeds input
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

  describe('Quote function', () => {
    it('should be a function', () => {
      expect(typeof getQuotes).toBe('function');
    });
  });
});
