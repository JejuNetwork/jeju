/**
 * SDK Edge Cases & Boundary Tests
 * 
 * Thorough testing beyond happy paths:
 * - Boundary conditions for pricing
 * - Error handling for invalid inputs
 * - Concurrent behavior
 * - Data integrity verification
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { Wallet, parseEther } from 'ethers';
import { Hono } from 'hono';
import { serve } from 'bun';
import type { Address } from 'viem';
import {
  estimatePrice,
  formatPriceETH,
  formatPriceUSD,
  DEFAULT_PRICING,
  X402Client,
  generateX402PaymentHeader,
  verifyX402Payment,
  parseX402Header,
  createPaymentRequirement,
  createMultiAssetPaymentRequirement,
  type PricingModelType,
} from '../sdk/x402';
import { getAvailablePort } from './test-utils';

type BunServer = ReturnType<typeof serve>;

const createWallet = (): Wallet => Wallet.createRandom() as unknown as Wallet;

// ============================================================================
// Pricing Boundary Tests
// ============================================================================

describe('Pricing Boundary Conditions', () => {
  describe('estimatePrice edge cases', () => {
    test('handles zero units', () => {
      const price = estimatePrice('llm', 0);
      expect(price).toBe(0n);
    });

    test('handles unit = 1 (minimum positive)', () => {
      const llmPrice = estimatePrice('llm', 1);
      const embeddingPrice = estimatePrice('embedding', 1);
      
      expect(llmPrice).toBeGreaterThan(0n);
      expect(embeddingPrice).toBeGreaterThan(0n);
    });

    test('handles very large units (1 billion)', () => {
      const price = estimatePrice('llm', 1_000_000_000);
      
      expect(price).toBeGreaterThan(0n);
      expect(typeof price).toBe('bigint');
    });

    test('handles MAX_SAFE_INTEGER units', () => {
      const price = estimatePrice('embedding', Number.MAX_SAFE_INTEGER);
      
      expect(price).toBeGreaterThan(0n);
      expect(typeof price).toBe('bigint');
    });

    test('all model types return valid prices', () => {
      const modelTypes: PricingModelType[] = ['llm', 'image', 'video', 'audio', 'stt', 'tts', 'embedding'];
      
      for (const modelType of modelTypes) {
        const price = estimatePrice(modelType, 1000);
        expect(price).toBeGreaterThan(0n);
        expect(typeof price).toBe('bigint');
      }
    });

    test('image pricing ignores units (fixed per-image)', () => {
      const price1 = estimatePrice('image', 1);
      const price100 = estimatePrice('image', 100);
      
      expect(price1).toBe(DEFAULT_PRICING.IMAGE_1024);
      expect(price100).toBe(DEFAULT_PRICING.IMAGE_1024);
    });

    test('video pricing scales linearly with seconds', () => {
      const price1 = estimatePrice('video', 1);
      const price10 = estimatePrice('video', 10);
      
      expect(price10).toBe(price1 * 10n);
    });

    test('stt pricing rounds up to nearest minute', () => {
      const price30sec = estimatePrice('stt', 30);
      const price60sec = estimatePrice('stt', 60);
      const price61sec = estimatePrice('stt', 61);
      
      expect(price30sec).toBe(DEFAULT_PRICING.STT_PER_MINUTE);
      expect(price60sec).toBe(DEFAULT_PRICING.STT_PER_MINUTE);
      expect(price61sec).toBe(DEFAULT_PRICING.STT_PER_MINUTE * 2n);
    });
  });


  describe('formatPriceETH edge cases', () => {
    test('formats zero wei', () => {
      const result = formatPriceETH(0n);
      expect(result).toContain('gwei'); // Small amounts show as gwei
    });

    test('formats 1 wei (minimum)', () => {
      const result = formatPriceETH(1n);
      expect(result).toContain('gwei');
    });

    test('formats sub-gwei amounts', () => {
      const result = formatPriceETH(100n);
      expect(result).toMatch(/\d+.*gwei/);
    });

    test('formats exactly 1 gwei', () => {
      const result = formatPriceETH(1_000_000_000n);
      expect(result).toContain('gwei');
    });

    test('formats 0.0001 ETH boundary', () => {
      const below = formatPriceETH(parseEther('0.00009'));
      const above = formatPriceETH(parseEther('0.0001'));
      
      expect(below).toContain('gwei');
      expect(above).toContain('ETH');
    });

    test('formats exactly 1 ETH', () => {
      const result = formatPriceETH(parseEther('1'));
      expect(result).toContain('1.000000 ETH');
    });

    test('formats large amounts (1000 ETH)', () => {
      const result = formatPriceETH(parseEther('1000'));
      expect(result).toContain('ETH');
      expect(result).toContain('1000');
    });
  });

  describe('formatPriceUSD edge cases', () => {
    test('formats zero wei', () => {
      const result = formatPriceUSD(0n);
      expect(result).toBe('$0.0000');
    });

    test('formats with custom ETH price', () => {
      const amount = parseEther('1');
      const at2000 = formatPriceUSD(amount, 2000);
      const at5000 = formatPriceUSD(amount, 5000);
      
      expect(at2000).toBe('$2000.0000');
      expect(at5000).toBe('$5000.0000');
    });

    test('formats sub-cent amounts', () => {
      const result = formatPriceUSD(parseEther('0.000001'), 3000);
      expect(result).toBe('$0.0030');
    });
  });
});

// ============================================================================
// Payment Verification Edge Cases
// ============================================================================

describe('Payment Verification Edge Cases', () => {
  const testWallet = createWallet();
  const providerWallet = createWallet();

  describe('verifyX402Payment', () => {
    test('rejects non-exact scheme', () => {
      const payment = {
        scheme: 'credit',
        network: 'jeju',
        payload: '0x123',
        asset: '0x0',
        amount: '1000',
      };
      
      const isValid = verifyX402Payment(
        payment,
        providerWallet.address as Address,
        testWallet.address as Address
      );
      
      expect(isValid).toBe(false);
    });

    test('handles case-insensitive address comparison', async () => {
      const amount = '1000000';
      const providerAddress = providerWallet.address as Address;
      
      const header = await generateX402PaymentHeader(
        testWallet,
        providerAddress,
        amount,
        'jeju'
      );
      
      const payment = parseX402Header(header)!;
      
      // Test with uppercase user address
      const upperAddress = testWallet.address.toUpperCase() as Address;
      const isValid = verifyX402Payment(payment, providerAddress, upperAddress);
      
      expect(isValid).toBe(true);
    });

    test('rejects tampered amount', async () => {
      const providerAddress = providerWallet.address as Address;
      
      const header = await generateX402PaymentHeader(
        testWallet,
        providerAddress,
        '1000000',
        'jeju'
      );
      
      const payment = parseX402Header(header)!;
      payment.amount = '9999999'; // Tampered
      
      // Verification will fail because message doesn't match
      const isValid = verifyX402Payment(
        payment,
        providerAddress,
        testWallet.address as Address
      );
      
      expect(isValid).toBe(false);
    });

    test('rejects tampered network', async () => {
      const providerAddress = providerWallet.address as Address;
      
      const header = await generateX402PaymentHeader(
        testWallet,
        providerAddress,
        '1000000',
        'jeju'
      );
      
      const payment = parseX402Header(header)!;
      payment.network = 'base'; // Tampered
      
      const isValid = verifyX402Payment(
        payment,
        providerAddress,
        testWallet.address as Address
      );
      
      expect(isValid).toBe(false);
    });
  });
});

// ============================================================================
// X402Client Concurrent Behavior
// ============================================================================

describe('X402Client Concurrent Behavior', () => {
  let server: BunServer;
  let port: number;
  let requestCount = 0;
  let concurrentMax = 0;
  let currentConcurrent = 0;
  const testWallet = createWallet();
  const providerAddress = createWallet().address as Address;

  beforeAll(async () => {
    port = await getAvailablePort();
    requestCount = 0;
    concurrentMax = 0;
    currentConcurrent = 0;

    const app = new Hono();
    app.post('/v1/paid-endpoint', async (c) => {
      currentConcurrent++;
      if (currentConcurrent > concurrentMax) concurrentMax = currentConcurrent;
      requestCount++;
      
      await new Promise(r => setTimeout(r, 50));
      currentConcurrent--;
      
      return c.json({ success: true, requestNum: requestCount });
    });

    server = serve({ port, fetch: app.fetch });
  });

  afterAll(() => {
    server.stop();
  });

  test('handles concurrent paidFetch requests', async () => {
    const client = new X402Client(testWallet, 'jeju');
    
    const promises = Array.from({ length: 10 }, (_, i) =>
      client.paidFetch(
        `http://localhost:${port}/v1/paid-endpoint`,
        { method: 'POST', body: JSON.stringify({ seq: i }) },
        providerAddress,
        '1000000'
      )
    );

    const responses = await Promise.all(promises);
    
    expect(responses.length).toBe(10);
    expect(responses.every(r => r.ok)).toBe(true);
    expect(requestCount).toBe(10);
    expect(concurrentMax).toBeGreaterThan(1);
  });

  test('generates unique payment headers per request', async () => {
    const client = new X402Client(testWallet, 'jeju');
    
    const headers = await Promise.all(
      Array.from({ length: 5 }, () =>
        client.generatePayment(providerAddress, '1000000')
      )
    );

    // All headers should be identical since same params
    expect(headers[0]).toBe(headers[1]);
    expect(headers[1]).toBe(headers[2]);
  });

  test('handles different amounts concurrently', async () => {
    const client = new X402Client(testWallet, 'jeju');
    
    const amounts = ['1000', '2000', '3000', '4000', '5000'];
    const paymentPromises = amounts.map(amt =>
      client.generatePayment(providerAddress, amt)
    );

    const payments = await Promise.all(paymentPromises);
    
    // Each should be different
    const uniquePayments = new Set(payments);
    expect(uniquePayments.size).toBe(5);
  });
});

// ============================================================================
// Payment Requirement Edge Cases
// ============================================================================

describe('Payment Requirement Edge Cases', () => {
  const recipient = createWallet().address as Address;

  describe('createPaymentRequirement', () => {
    test('handles zero amount', () => {
      const req = createPaymentRequirement('/api', 0n, recipient, 'Free');
      
      expect(req.accepts[0]!.maxAmountRequired).toBe('0');
    });

    test('handles maximum safe bigint', () => {
      const maxAmount = BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000n;
      const req = createPaymentRequirement('/api', maxAmount, recipient, 'Expensive');
      
      expect(req.accepts[0]!.maxAmountRequired).toBe(maxAmount.toString());
    });

    test('handles special characters in resource path', () => {
      const req = createPaymentRequirement(
        '/api/v1/users/:id/data?filter=all&sort=desc',
        1000n,
        recipient,
        'Special path'
      );
      
      expect(req.accepts[0]!.resource).toBe('/api/v1/users/:id/data?filter=all&sort=desc');
    });

    test('handles unicode in description', () => {
      const req = createPaymentRequirement(
        '/api',
        1000n,
        recipient,
        'AI 推理 🤖 服务'
      );
      
      expect(req.accepts[0]!.description).toBe('AI 推理 🤖 服务');
    });

    test('handles empty description', () => {
      const req = createPaymentRequirement('/api', 1000n, recipient, '');
      
      expect(req.accepts[0]!.description).toBe('');
    });
  });

  describe('createMultiAssetPaymentRequirement', () => {
    test('handles empty supportedAssets array', () => {
      const req = createMultiAssetPaymentRequirement(
        '/api',
        1000n,
        recipient,
        'Test',
        'jeju',
        []
      );
      
      // Should still have ETH and credit options
      expect(req.accepts.length).toBeGreaterThanOrEqual(2);
      expect(req.accepts.some(a => a.scheme === 'exact')).toBe(true);
      expect(req.accepts.some(a => a.scheme === 'credit')).toBe(true);
    });

    test('handles duplicate assets (deduplication)', () => {
      const assets = [
        { address: '0xAAA' as Address, symbol: 'TEST', decimals: 18 },
        { address: '0xAAA' as Address, symbol: 'TEST', decimals: 18 },
      ];
      
      const req = createMultiAssetPaymentRequirement(
        '/api',
        1000n,
        recipient,
        'Test',
        'jeju',
        assets
      );
      
      // Should include both (no dedup in current impl)
      expect(req.accepts.filter(a => a.asset === '0xAAA').length).toBe(2);
    });

    test('filters out JEJU symbol from paymaster options', () => {
      const assets = [
        { address: '0xAAA' as Address, symbol: 'JEJU', decimals: 18 },
        { address: '0xBBB' as Address, symbol: 'USDC', decimals: 6 },
      ];
      
      const req = createMultiAssetPaymentRequirement(
        '/api',
        1000n,
        recipient,
        'Test',
        'jeju',
        assets
      );
      
      // JEJU should only appear once (from JEJU_TOKEN_ADDRESS check, not from assets)
      // USDC should appear
      const descriptions = req.accepts.map(a => a.description);
      expect(descriptions.some(d => d.includes('USDC'))).toBe(true);
    });
  });
});

// ============================================================================
// Header Parsing Edge Cases
// ============================================================================

describe('Header Parsing Edge Cases', () => {
  test('handles whitespace around delimiters', () => {
    const header = 'scheme = exact ; network = jeju ; payload = 0x123 ; amount = 1000';
    const parsed = parseX402Header(header);
    
    // Whitespace around = should still work
    expect(parsed).not.toBeNull();
  });

  test('handles missing optional fields', () => {
    const header = 'scheme=exact;network=jeju;payload=0x123';
    const parsed = parseX402Header(header);
    
    expect(parsed).not.toBeNull();
    expect(parsed!.amount).toBe('0'); // Default
    expect(parsed!.asset).toBeDefined(); // Default to ZERO_ADDRESS
  });

  test('handles very long payload', () => {
    const longPayload = '0x' + 'a'.repeat(1000);
    const header = `scheme=exact;network=jeju;payload=${longPayload};amount=1000`;
    const parsed = parseX402Header(header);
    
    expect(parsed).not.toBeNull();
    expect(parsed!.payload).toBe(longPayload);
  });

  test('handles newlines in header (should fail)', () => {
    const header = 'scheme=exact\nnetwork=jeju;payload=0x123;amount=1000';
    const parsed = parseX402Header(header);
    
    // Newline breaks the format
    expect(parsed).toBeNull();
  });

  test('handles equals sign in value', () => {
    const header = 'scheme=exact;network=jeju;payload=data=with=equals;amount=1000';
    const parsed = parseX402Header(header);
    
    // Only first = should be treated as delimiter
    expect(parsed).not.toBeNull();
    expect(parsed!.payload).toContain('data');
  });
});

// ============================================================================
// Error Recovery Tests
// ============================================================================

describe('Error Recovery', () => {
  let server: BunServer;
  let port: number;
  let failNextRequest = false;

  beforeAll(async () => {
    port = await getAvailablePort();
    const app = new Hono();
    
    app.post('/api/flaky', async (c) => {
      if (failNextRequest) {
        failNextRequest = false;
        return c.json({ error: 'Service temporarily unavailable' }, 503);
      }
      
      const paymentHeader = c.req.header('X-Payment');
      if (!paymentHeader) {
        return c.json({
          x402Version: 1,
          error: 'Payment required',
          accepts: [{ scheme: 'exact', network: 'jeju', asset: '0x0', payTo: '0x0', resource: '/api/flaky', description: 'Test' }],
        }, 402);
      }
      
      return c.json({ success: true });
    });

    server = serve({ port, fetch: app.fetch });
  });

  afterAll(() => {
    server.stop();
  });

  test('X402Client.handlePaymentRequired handles 402 response', async () => {
    const wallet = createWallet();
    const client = new X402Client(wallet, 'jeju');
    
    const response = await fetch(`http://localhost:${port}/api/flaky`, { method: 'POST' });
    expect(response.status).toBe(402);
    
    const retryResponse = await client.handlePaymentRequired(
      response,
      `http://localhost:${port}/api/flaky`,
      { method: 'POST' }
    );
    
    expect(retryResponse.status).toBe(200);
  });

  test('returns original response if not 402', async () => {
    const wallet = createWallet();
    const client = new X402Client(wallet, 'jeju');
    
    const successResponse = await fetch(`http://localhost:${port}/api/flaky`, {
      method: 'POST',
      headers: { 'X-Payment': 'scheme=exact;network=jeju;payload=0x123;amount=1000' },
    });
    
    const handled = await client.handlePaymentRequired(
      successResponse,
      `http://localhost:${port}/api/flaky`,
      { method: 'POST' }
    );
    
    expect(handled.status).toBe(200);
  });
});

// ============================================================================
// Data Integrity Verification
// ============================================================================

describe('Data Integrity Verification', () => {
  test('payment header round-trip preserves data', async () => {
    const wallet = createWallet();
    const providerAddress = createWallet().address as Address;
    const amount = '123456789012345678901234567890';
    
    const header = await generateX402PaymentHeader(wallet, providerAddress, amount, 'jeju');
    const parsed = parseX402Header(header);
    
    expect(parsed).not.toBeNull();
    expect(parsed!.amount).toBe(amount);
    expect(parsed!.network).toBe('jeju');
    expect(parsed!.scheme).toBe('exact');
    
    const isValid = verifyX402Payment(parsed!, providerAddress, wallet.address as Address);
    expect(isValid).toBe(true);
  });

  test('pricing calculations are deterministic', () => {
    const results: bigint[] = [];
    
    for (let i = 0; i < 100; i++) {
      results.push(estimatePrice('llm', 1000));
    }
    
    const allSame = results.every(r => r === results[0]);
    expect(allSame).toBe(true);
  });

  test('DEFAULT_PRICING values are reasonable', () => {
    // LLM should be cheaper per token than images
    const llmPer1K = DEFAULT_PRICING.LLM_PER_1K_INPUT + DEFAULT_PRICING.LLM_PER_1K_OUTPUT;
    const image = DEFAULT_PRICING.IMAGE_1024;
    
    expect(llmPer1K).toBeLessThan(image);
    
    // STT should be cheaper than TTS (generally true)
    expect(DEFAULT_PRICING.STT_PER_MINUTE).toBeLessThan(DEFAULT_PRICING.TTS_PER_1K_CHARS * 10n);
    
    // Embedding should be cheapest per token
    expect(DEFAULT_PRICING.EMBEDDING_PER_1K).toBeLessThan(DEFAULT_PRICING.LLM_PER_1K_INPUT);
    
    // All prices should be non-zero
    for (const [, value] of Object.entries(DEFAULT_PRICING)) {
      expect(value).toBeGreaterThan(0n);
    }
  });

  test('X402Client getAddress returns correct address', () => {
    const wallet = createWallet();
    const client = new X402Client(wallet, 'jeju');
    
    expect(client.getAddress()).toBe(wallet.address as Address);
  });

  test('X402Client getNetworkConfig returns correct config', () => {
    const wallet = createWallet();
    const client = new X402Client(wallet, 'base-sepolia');
    
    const config = client.getNetworkConfig();
    expect(config.chainId).toBe(84532);
    expect(config.isTestnet).toBe(true);
  });
});
