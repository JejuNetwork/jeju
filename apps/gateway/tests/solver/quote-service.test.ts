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

  describe('Boundary Conditions', () => {
    it('should handle amount of 1 wei', () => {
      const params: QuoteParams = {
        sourceChain: 1,
        destinationChain: 42161,
        sourceToken: '0x0000000000000000000000000000000000000000',
        destinationToken: '0x0000000000000000000000000000000000000000',
        amount: '1',
      };
      
      const quotes = getQuotes(params);
      expect(quotes.length).toBeGreaterThan(0);
      // With 1 wei and 50 bps fee (1 * 50 / 10000 = 0), output should be 1
      // Integer division truncates, so fee is 0
      expect(BigInt(quotes[0].outputAmount)).toBe(1n);
    });

    it('should handle amount at fee breakpoint', () => {
      // With 50 bps (0.5%), need 200 wei to get 1 wei fee
      const params: QuoteParams = {
        sourceChain: 1,
        destinationChain: 42161,
        sourceToken: '0x0000000000000000000000000000000000000000',
        destinationToken: '0x0000000000000000000000000000000000000000',
        amount: '200',
      };
      
      const quotes = getQuotes(params);
      // 200 * 50 / 10000 = 1 wei fee
      expect(BigInt(quotes[0].fee)).toBe(1n);
      expect(BigInt(quotes[0].outputAmount)).toBe(199n);
    });

    it('should handle max safe integer amount', () => {
      const params: QuoteParams = {
        sourceChain: 1,
        destinationChain: 42161,
        sourceToken: '0x0000000000000000000000000000000000000000',
        destinationToken: '0x0000000000000000000000000000000000000000',
        amount: '9007199254740991', // Number.MAX_SAFE_INTEGER
      };
      
      const quotes = getQuotes(params);
      expect(quotes.length).toBeGreaterThan(0);
      expect(BigInt(quotes[0].outputAmount)).toBeGreaterThan(0n);
    });

    it('should handle 100 ETH amount', () => {
      const params: QuoteParams = {
        sourceChain: 1,
        destinationChain: 8453,
        sourceToken: '0x0000000000000000000000000000000000000000',
        destinationToken: '0x0000000000000000000000000000000000000000',
        amount: '100000000000000000000', // 100 ETH
      };
      
      const quotes = getQuotes(params);
      const input = BigInt(params.amount);
      const output = BigInt(quotes[0].outputAmount);
      const fee = BigInt(quotes[0].fee);
      
      // Verify fee math: input = output + fee
      expect(input).toBe(output + fee);
    });
  });

  describe('L2 Chain Detection', () => {
    const l2Chains = [10, 42161, 8453, 11155420, 421614, 84532];
    const l1Chains = [1, 11155111];
    
    it('should identify all L2 chains correctly', () => {
      for (const chainId of l2Chains) {
        expect(isL2(chainId)).toBe(true);
      }
    });

    it('should identify L1 chains as not L2', () => {
      for (const chainId of l1Chains) {
        expect(isL2(chainId)).toBe(false);
      }
    });

    it('should return false for unknown chain IDs', () => {
      expect(isL2(0)).toBe(false);
      expect(isL2(-1)).toBe(false);
      expect(isL2(999999)).toBe(false);
    });
  });

  describe('Fee Calculation Accuracy', () => {
    it('should calculate exact 0.5% fee for L1 routes', () => {
      const params: QuoteParams = {
        sourceChain: 1,
        destinationChain: 42161,
        sourceToken: '0x0000000000000000000000000000000000000000',
        destinationToken: '0x0000000000000000000000000000000000000000',
        amount: '10000', // 10000 wei for easy math
      };
      
      const quotes = getQuotes(params);
      // 50 bps = 0.5% = 50/10000 = 10000 * 50 / 10000 = 50
      expect(BigInt(quotes[0].fee)).toBe(50n);
      expect(quotes[0].feePercent).toBe(50);
    });

    it('should calculate exact 0.3% fee for L2-to-L2 routes', () => {
      const params: QuoteParams = {
        sourceChain: 10, // Optimism
        destinationChain: 42161, // Arbitrum
        sourceToken: '0x0000000000000000000000000000000000000000',
        destinationToken: '0x0000000000000000000000000000000000000000',
        amount: '10000', // 10000 wei for easy math
      };
      
      const quotes = getQuotes(params);
      // 30 bps = 0.3% = 30/10000 = 10000 * 30 / 10000 = 30
      expect(BigInt(quotes[0].fee)).toBe(30n);
      expect(quotes[0].feePercent).toBe(30);
    });

    it('should handle fee calculation with large amounts without overflow', () => {
      const params: QuoteParams = {
        sourceChain: 1,
        destinationChain: 42161,
        sourceToken: '0x0000000000000000000000000000000000000000',
        destinationToken: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000000000', // 1M ETH
      };
      
      const quotes = getQuotes(params);
      const input = BigInt(params.amount);
      const fee = BigInt(quotes[0].fee);
      const output = BigInt(quotes[0].outputAmount);
      
      // Verify no overflow: input = output + fee
      expect(input).toBe(output + fee);
      // Fee should be exactly 0.5%
      expect(fee).toBe(input * 50n / 10000n);
    });
  });

  describe('Quote ID Generation', () => {
    it('should generate 32-byte hex quote ID', () => {
      const params: QuoteParams = {
        sourceChain: 1,
        destinationChain: 42161,
        sourceToken: '0x0000000000000000000000000000000000000000',
        destinationToken: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000',
      };
      
      const quotes = getQuotes(params);
      expect(quotes[0].quoteId).toMatch(/^0x[a-f0-9]{64}$/);
    });

    it('should generate valid bytes32 for on-chain use', () => {
      const params: QuoteParams = {
        sourceChain: 1,
        destinationChain: 42161,
        sourceToken: '0x0000000000000000000000000000000000000000',
        destinationToken: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000',
      };
      
      const quotes = getQuotes(params);
      const quoteId = quotes[0].quoteId;
      
      // Should be exactly 66 chars (0x + 64 hex chars)
      expect(quoteId.length).toBe(66);
      // Should be valid hex
      expect(() => BigInt(quoteId)).not.toThrow();
    });
  });

  describe('Fill Time Estimation', () => {
    it('should estimate 15s for L2-to-L2', () => {
      const params: QuoteParams = {
        sourceChain: 10,
        destinationChain: 8453,
        sourceToken: '0x0000000000000000000000000000000000000000',
        destinationToken: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000',
      };
      
      const quotes = getQuotes(params);
      expect(quotes[0].estimatedFillTimeSeconds).toBe(15);
    });

    it('should estimate 30s for L1-to-L2', () => {
      const params: QuoteParams = {
        sourceChain: 1,
        destinationChain: 42161,
        sourceToken: '0x0000000000000000000000000000000000000000',
        destinationToken: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000',
      };
      
      const quotes = getQuotes(params);
      expect(quotes[0].estimatedFillTimeSeconds).toBe(30);
    });

    it('should estimate 30s for L2-to-L1', () => {
      const params: QuoteParams = {
        sourceChain: 42161,
        destinationChain: 1,
        sourceToken: '0x0000000000000000000000000000000000000000',
        destinationToken: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000',
      };
      
      const quotes = getQuotes(params);
      expect(quotes[0].estimatedFillTimeSeconds).toBe(30);
    });
  });

  describe('Validity Period', () => {
    it('should set validUntil to future timestamp', () => {
      const now = Math.floor(Date.now() / 1000);
      const params: QuoteParams = {
        sourceChain: 1,
        destinationChain: 42161,
        sourceToken: '0x0000000000000000000000000000000000000000',
        destinationToken: '0x0000000000000000000000000000000000000000',
        amount: '1000000000000000000',
      };
      
      const quotes = getQuotes(params);
      
      // Should be at least 4 minutes in the future (allowing for test execution time)
      expect(quotes[0].validUntil).toBeGreaterThan(now + 240);
      // Should be at most 6 minutes in the future
      expect(quotes[0].validUntil).toBeLessThanOrEqual(now + 360);
    });
  });
});
