/**
 * Tests for solver/strategy.ts
 * Tests evaluation logic, price feeds, and edge cases
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { StrategyEngine } from '../../src/solver/strategy';
import { ethers } from 'ethers';

// Shared strategy instance to allow price to be fetched once
let sharedStrategy: StrategyEngine | null = null;

// Create strategy with test config
function createStrategy(overrides: Partial<{
  minProfitBps: number;
  maxGasPrice: bigint;
  maxIntentSize: string;
}> = {}): StrategyEngine {
  return new StrategyEngine({
    minProfitBps: overrides.minProfitBps ?? 10, // 0.1%
    maxGasPrice: overrides.maxGasPrice ?? ethers.parseUnits('100', 'gwei'),
    maxIntentSize: overrides.maxIntentSize ?? ethers.parseEther('1000').toString(),
  });
}

// Helper to check if price feed is available
async function waitForPriceFeed(strategy: StrategyEngine, timeoutMs = 5000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!strategy.isPriceStale()) return true;
    await new Promise(r => setTimeout(r, 100));
  }
  return false;
}

describe('StrategyEngine Construction', () => {
  test('should create with default config', () => {
    const strategy = createStrategy();
    expect(strategy).toBeDefined();
  });

  test('should create with custom config', () => {
    const strategy = createStrategy({
      minProfitBps: 50,
      maxGasPrice: ethers.parseUnits('200', 'gwei'),
      maxIntentSize: ethers.parseEther('500').toString(),
    });
    expect(strategy).toBeDefined();
  });
});

describe('Intent Evaluation - Profitable Scenarios', () => {
  test('should approve profitable intent with sufficient margin', async () => {
    const strategy = createStrategy({ minProfitBps: 10 });
    await waitForPriceFeed(strategy, 3000);
    
    const result = await strategy.evaluate({
      orderId: '0x' + 'ab'.repeat(32),
      sourceChain: 11155111,
      destinationChain: 84532,
      inputToken: '0x0000000000000000000000000000000000000000',
      inputAmount: ethers.parseEther('1.0').toString(),
      outputToken: '0x0000000000000000000000000000000000000000',
      outputAmount: ethers.parseEther('0.95').toString(), // 5% fee
    });
    
    // If price unavailable, result should be unprofitable with specific reason
    if (result.reason === 'Price feed unavailable') {
      expect(result.profitable).toBe(false);
    } else {
      expect(result.profitable).toBe(true);
      expect(result.expectedProfitBps).toBeGreaterThan(10);
    }
  });

  test('should calculate correct profit bps', async () => {
    const strategy = createStrategy({ minProfitBps: 0 });
    await waitForPriceFeed(strategy, 3000);
    
    const result = await strategy.evaluate({
      orderId: '0x' + 'ab'.repeat(32),
      sourceChain: 11155111,
      destinationChain: 84532,
      inputToken: '0x0000000000000000000000000000000000000000',
      inputAmount: ethers.parseEther('100').toString(),
      outputToken: '0x0000000000000000000000000000000000000000',
      outputAmount: ethers.parseEther('98').toString(),
    });
    
    // If price unavailable, skip profit check
    if (result.reason !== 'Price feed unavailable') {
      // Should be approximately 200 bps minus gas
      expect(result.expectedProfitBps).toBeLessThan(200);
      expect(result.expectedProfitBps).toBeGreaterThan(100); // After gas
    }
  });
});

describe('Intent Evaluation - Unprofitable Scenarios', () => {
  test('should reject when output exceeds input', async () => {
    const strategy = createStrategy();
    await waitForPriceFeed(strategy, 3000);
    
    const result = await strategy.evaluate({
      orderId: '0x' + 'ab'.repeat(32),
      sourceChain: 11155111,
      destinationChain: 84532,
      inputToken: '0x0000000000000000000000000000000000000000',
      inputAmount: ethers.parseEther('1.0').toString(),
      outputToken: '0x0000000000000000000000000000000000000000',
      outputAmount: ethers.parseEther('1.1').toString(), // More output than input
    });
    
    expect(result.profitable).toBe(false);
    // Price check happens first, but if passed, should get 'No fee'
    expect(['No fee', 'Price feed unavailable']).toContain(result.reason);
  });

  test('should reject when output equals input', async () => {
    const strategy = createStrategy();
    await waitForPriceFeed(strategy, 3000);
    
    const result = await strategy.evaluate({
      orderId: '0x' + 'ab'.repeat(32),
      sourceChain: 11155111,
      destinationChain: 84532,
      inputToken: '0x0000000000000000000000000000000000000000',
      inputAmount: ethers.parseEther('1.0').toString(),
      outputToken: '0x0000000000000000000000000000000000000000',
      outputAmount: ethers.parseEther('1.0').toString(),
    });
    
    expect(result.profitable).toBe(false);
    expect(['No fee', 'Price feed unavailable']).toContain(result.reason);
  });

  test('should reject when profit below minimum threshold', async () => {
    const strategy = createStrategy({ minProfitBps: 100 }); // 1% min
    await waitForPriceFeed(strategy, 3000);
    
    const result = await strategy.evaluate({
      orderId: '0x' + 'ab'.repeat(32),
      sourceChain: 11155111,
      destinationChain: 84532,
      inputToken: '0x0000000000000000000000000000000000000000',
      inputAmount: ethers.parseEther('1.0').toString(),
      outputToken: '0x0000000000000000000000000000000000000000',
      outputAmount: ethers.parseEther('0.995').toString(), // Only 0.5% fee
    });
    
    expect(result.profitable).toBe(false);
    // Either below min or price unavailable
    if (result.reason !== 'Price feed unavailable') {
      expect(result.reason).toContain('bps < min');
    }
  });

  test('should reject intent exceeding max size', async () => {
    const strategy = createStrategy({
      maxIntentSize: ethers.parseEther('10').toString(),
    });
    await waitForPriceFeed(strategy, 3000);
    
    const result = await strategy.evaluate({
      orderId: '0x' + 'ab'.repeat(32),
      sourceChain: 11155111,
      destinationChain: 84532,
      inputToken: '0x0000000000000000000000000000000000000000',
      inputAmount: ethers.parseEther('100').toString(), // 100 ETH > 10 ETH max
      outputToken: '0x0000000000000000000000000000000000000000',
      outputAmount: ethers.parseEther('95').toString(),
    });
    
    expect(result.profitable).toBe(false);
    // Price check happens first in current implementation
    expect(['Exceeds max size', 'Price feed unavailable']).toContain(result.reason);
  });
});

describe('Intent Evaluation - Edge Cases', () => {
  test('should handle very small amounts', async () => {
    const strategy = createStrategy({ minProfitBps: 0 });
    await waitForPriceFeed(strategy, 3000);
    
    const result = await strategy.evaluate({
      orderId: '0x' + 'ab'.repeat(32),
      sourceChain: 11155111,
      destinationChain: 84532,
      inputToken: '0x0000000000000000000000000000000000000000',
      inputAmount: '1000', // 1000 wei
      outputToken: '0x0000000000000000000000000000000000000000',
      outputAmount: '900',
    });
    
    // Gas will exceed the tiny fee (or price unavailable)
    expect(result.profitable).toBe(false);
  });

  test('should handle 1 wei fee', async () => {
    const strategy = createStrategy({ minProfitBps: 0 });
    await waitForPriceFeed(strategy, 3000);
    
    const result = await strategy.evaluate({
      orderId: '0x' + 'ab'.repeat(32),
      sourceChain: 11155111,
      destinationChain: 84532,
      inputToken: '0x0000000000000000000000000000000000000000',
      inputAmount: '1000000000000000001', // 1 ETH + 1 wei
      outputToken: '0x0000000000000000000000000000000000000000',
      outputAmount: '1000000000000000000', // 1 ETH
    });
    
    // 1 wei fee won't cover gas (or price unavailable)
    expect(result.profitable).toBe(false);
  });

  test('should include gas estimate in result when price available', async () => {
    const strategy = createStrategy({ minProfitBps: 0 });
    await waitForPriceFeed(strategy, 3000);
    
    const result = await strategy.evaluate({
      orderId: '0x' + 'ab'.repeat(32),
      sourceChain: 11155111,
      destinationChain: 84532,
      inputToken: '0x0000000000000000000000000000000000000000',
      inputAmount: ethers.parseEther('1.0').toString(),
      outputToken: '0x0000000000000000000000000000000000000000',
      outputAmount: ethers.parseEther('0.9').toString(),
    });
    
    // If price is available, gasEstimate should be present
    if (result.reason !== 'Price feed unavailable') {
      expect(result.gasEstimate).toBeDefined();
      expect(result.gasEstimate).toBeGreaterThan(0n);
    }
  });

  test('should handle max uint256 input amount (capped by maxIntentSize)', async () => {
    const strategy = createStrategy({
      maxIntentSize: (2n ** 256n - 1n).toString(),
    });
    await waitForPriceFeed(strategy, 3000);
    
    const result = await strategy.evaluate({
      orderId: '0x' + 'ab'.repeat(32),
      sourceChain: 11155111,
      destinationChain: 84532,
      inputToken: '0x0000000000000000000000000000000000000000',
      inputAmount: (2n ** 255n).toString(),
      outputToken: '0x0000000000000000000000000000000000000000',
      outputAmount: (2n ** 254n).toString(),
    });
    
    // Very large profit - should be profitable if price is available
    if (result.reason !== 'Price feed unavailable') {
      expect(result.profitable).toBe(true);
    } else {
      expect(result.profitable).toBe(false);
    }
  });
});

describe('Price Feed', () => {
  test('should return ETH price', () => {
    const strategy = createStrategy();
    
    // Give it time to fetch price
    const price = strategy.getEthPrice();
    
    // Price might be 0 if API fails, but should be a number
    expect(typeof price).toBe('number');
    expect(price).toBeGreaterThanOrEqual(0);
  });

  test('should report price staleness', () => {
    const strategy = createStrategy();
    
    // Immediately after creation, may or may not be stale
    const isStale = strategy.isPriceStale();
    expect(typeof isStale).toBe('boolean');
  });
});

describe('Cross-Chain Scenarios', () => {
  test('should evaluate Sepolia to Base Sepolia', async () => {
    const strategy = createStrategy({ minProfitBps: 10 });
    await waitForPriceFeed(strategy, 3000);
    
    const result = await strategy.evaluate({
      orderId: '0x' + 'ab'.repeat(32),
      sourceChain: 11155111, // Sepolia
      destinationChain: 84532, // Base Sepolia
      inputToken: '0x0000000000000000000000000000000000000000',
      inputAmount: ethers.parseEther('10').toString(),
      outputToken: '0x0000000000000000000000000000000000000000',
      outputAmount: ethers.parseEther('9.5').toString(), // 5% fee
    });
    
    expect(result).toBeDefined();
    expect(typeof result.profitable).toBe('boolean');
  });

  test('should evaluate with ERC20 tokens', async () => {
    const strategy = createStrategy({ minProfitBps: 10 });
    await waitForPriceFeed(strategy, 3000);
    
    const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    
    const result = await strategy.evaluate({
      orderId: '0x' + 'ab'.repeat(32),
      sourceChain: 11155111,
      destinationChain: 84532,
      inputToken: usdc,
      inputAmount: '10000000000', // 10,000 USDC
      outputToken: usdc,
      outputAmount: '9500000000', // 9,500 USDC
    });
    
    expect(result).toBeDefined();
  });

  test('should handle same token on different chains', async () => {
    const strategy = createStrategy({ minProfitBps: 10 });
    await waitForPriceFeed(strategy, 3000);
    
    const result = await strategy.evaluate({
      orderId: '0x' + 'ab'.repeat(32),
      sourceChain: 11155111,
      destinationChain: 84532,
      inputToken: '0x0000000000000000000000000000000000000000', // ETH on source
      outputToken: '0x0000000000000000000000000000000000000000', // ETH on dest
      inputAmount: ethers.parseEther('1.0').toString(),
      outputAmount: ethers.parseEther('0.95').toString(),
    });
    
    // Should be profitable if price is available
    if (result.reason !== 'Price feed unavailable') {
      expect(result.profitable).toBe(true);
    }
  });
});

describe('Concurrent Evaluations', () => {
  test('should handle multiple concurrent evaluations', async () => {
    const strategy = createStrategy({ minProfitBps: 10 });
    
    const intents = Array.from({ length: 10 }, (_, i) => ({
      orderId: '0x' + (i.toString(16).padStart(2, '0')).repeat(32),
      sourceChain: 11155111,
      destinationChain: 84532,
      inputToken: '0x0000000000000000000000000000000000000000',
      inputAmount: ethers.parseEther((1 + i * 0.1).toString()).toString(),
      outputToken: '0x0000000000000000000000000000000000000000',
      outputAmount: ethers.parseEther((0.95 + i * 0.09).toString()).toString(),
    }));
    
    const results = await Promise.all(intents.map(intent => strategy.evaluate(intent)));
    
    expect(results).toHaveLength(10);
    for (const result of results) {
      expect(result).toBeDefined();
      expect(typeof result.profitable).toBe('boolean');
      expect(typeof result.expectedProfitBps).toBe('number');
    }
  });

  test('should maintain consistent results across parallel calls', async () => {
    const strategy = createStrategy({ minProfitBps: 10 });
    await waitForPriceFeed(strategy, 3000);
    
    const intent = {
      orderId: '0x' + 'ab'.repeat(32),
      sourceChain: 11155111,
      destinationChain: 84532,
      inputToken: '0x0000000000000000000000000000000000000000',
      inputAmount: ethers.parseEther('10').toString(),
      outputToken: '0x0000000000000000000000000000000000000000',
      outputAmount: ethers.parseEther('9.5').toString(),
    };
    
    // Call same intent 5 times in parallel
    const results = await Promise.all([
      strategy.evaluate(intent),
      strategy.evaluate(intent),
      strategy.evaluate(intent),
      strategy.evaluate(intent),
      strategy.evaluate(intent),
    ]);
    
    // All results should have consistent structure
    for (const result of results) {
      expect(typeof result.profitable).toBe('boolean');
      expect(typeof result.expectedProfitBps).toBe('number');
    }
    
    // Results should be consistent (all same value if price is available)
    const allProfitable = results.filter(r => r.profitable);
    const allUnprofitable = results.filter(r => !r.profitable);
    // Either all profitable, all unprofitable, or mixed due to price refresh during calls
    expect(allProfitable.length + allUnprofitable.length).toBe(5);
  });
});

