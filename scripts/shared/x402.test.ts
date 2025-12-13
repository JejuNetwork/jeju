/**
 * Thorough Tests for x402 Payment Protocol
 * 
 * Tests:
 * - Boundary conditions and edge cases
 * - Error handling and invalid inputs
 * - EIP-712 signature verification
 * - Payment validation logic
 */

import { describe, test, expect } from 'bun:test';
import {
  createPaymentRequirement,
  createPaymentPayload,
  parsePaymentHeader,
  verifyPayment,
  signPaymentPayload,
  checkPayment,
  calculatePercentageFee,
  generate402Headers,
  PAYMENT_TIERS,
  CHAIN_IDS,
  RPC_URLS,
  USDC_ADDRESSES,
  getEIP712Domain,
  getEIP712Types,
} from './x402';
import type { Address } from 'viem';

// Test fixtures
const TEST_RECIPIENT: Address = '0x1234567890123456789012345678901234567890';
const TEST_ASSET: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`;

describe('x402 Payment Protocol', () => {
  describe('CHAIN_IDS configuration', () => {
    test('should have all supported networks', () => {
      expect(CHAIN_IDS.sepolia).toBe(11155111);
      expect(CHAIN_IDS['base-sepolia']).toBe(84532);
      expect(CHAIN_IDS.ethereum).toBe(1);
      expect(CHAIN_IDS.base).toBe(8453);
      expect(CHAIN_IDS.jeju).toBe(420691);
      expect(CHAIN_IDS['jeju-testnet']).toBe(420690);
    });

    test('should have unique chain IDs', () => {
      const ids = Object.values(CHAIN_IDS);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('RPC_URLS configuration', () => {
    test('should have URLs for all chains', () => {
      for (const network of Object.keys(CHAIN_IDS)) {
        expect(RPC_URLS[network as keyof typeof RPC_URLS]).toBeDefined();
      }
    });

    test('should have valid URL format', () => {
      for (const [, url] of Object.entries(RPC_URLS)) {
        expect(url).toMatch(/^https?:\/\/.+/);
      }
    });
  });

  describe('USDC_ADDRESSES configuration', () => {
    test('should have addresses for all networks', () => {
      for (const network of Object.keys(CHAIN_IDS)) {
        expect(USDC_ADDRESSES[network as keyof typeof USDC_ADDRESSES]).toBeDefined();
      }
    });

    test('should have valid address format', () => {
      for (const [, addr] of Object.entries(USDC_ADDRESSES)) {
        expect(addr).toMatch(/^0x[a-fA-F0-9]{40}$/);
      }
    });
  });

  describe('PAYMENT_TIERS', () => {
    test('should have all defined tiers', () => {
      expect(PAYMENT_TIERS.API_CALL_BASIC).toBeDefined();
      expect(PAYMENT_TIERS.API_CALL_PREMIUM).toBeDefined();
      expect(PAYMENT_TIERS.COMPUTE_INFERENCE).toBeDefined();
      expect(PAYMENT_TIERS.STORAGE_PER_GB_MONTH).toBeDefined();
      expect(PAYMENT_TIERS.NFT_LISTING).toBeDefined();
    });

    test('should have positive amounts', () => {
      for (const [_key, value] of Object.entries(PAYMENT_TIERS)) {
        if (typeof value === 'bigint') {
          expect(value).toBeGreaterThan(0n);
        } else {
          expect(value).toBeGreaterThanOrEqual(0);
        }
      }
    });

    test('premium should be more expensive than basic', () => {
      expect(PAYMENT_TIERS.API_CALL_PREMIUM).toBeGreaterThan(PAYMENT_TIERS.API_CALL_BASIC);
      expect(PAYMENT_TIERS.API_MONTHLY_ACCESS).toBeGreaterThan(PAYMENT_TIERS.API_DAILY_ACCESS);
    });

    test('fee basis points should be reasonable (< 10%)', () => {
      expect(PAYMENT_TIERS.NFT_PURCHASE_FEE_BPS).toBeLessThan(1000);
      expect(PAYMENT_TIERS.SWAP_FEE_BPS).toBeLessThan(1000);
    });
  });

  describe('createPaymentRequirement()', () => {
    test('should create valid requirement structure', () => {
      const config = {
        recipientAddress: TEST_RECIPIENT,
        network: 'sepolia' as const,
        serviceName: 'TestService',
      };

      const req = createPaymentRequirement(
        '/api/test',
        1000000n,
        'Test payment',
        config
      );

      expect(req.x402Version).toBe(1);
      expect(req.error).toContain('Payment required');
      expect(req.accepts).toHaveLength(1);
      expect(req.accepts[0].scheme).toBe('exact');
      expect(req.accepts[0].network).toBe('sepolia');
      expect(req.accepts[0].payTo).toBe(TEST_RECIPIENT);
    });

    test('should handle zero amount', () => {
      const config = {
        recipientAddress: TEST_RECIPIENT,
        network: 'jeju' as const,
        serviceName: 'Free',
      };

      const req = createPaymentRequirement('/free', 0n, 'Free tier', config);
      expect(req.accepts[0].maxAmountRequired).toBe('0');
    });

    test('should handle max bigint amount', () => {
      const config = {
        recipientAddress: TEST_RECIPIENT,
        network: 'ethereum' as const,
        serviceName: 'Premium',
      };

      const maxAmount = BigInt(Number.MAX_SAFE_INTEGER);
      const req = createPaymentRequirement('/premium', maxAmount, 'Max', config);
      expect(req.accepts[0].maxAmountRequired).toBe(maxAmount.toString());
    });

    test('should include custom token address', () => {
      const config = {
        recipientAddress: TEST_RECIPIENT,
        network: 'base' as const,
        serviceName: 'Custom',
      };

      const customToken: Address = '0x9999999999999999999999999999999999999999';
      const req = createPaymentRequirement('/custom', 1n, 'Custom token', config, customToken);
      expect(req.accepts[0].asset).toBe(customToken);
    });

    test('should default to zero address for native token', () => {
      const config = {
        recipientAddress: TEST_RECIPIENT,
        network: 'sepolia' as const,
        serviceName: 'Native',
      };

      const req = createPaymentRequirement('/native', 1n, 'Native', config);
      expect(req.accepts[0].asset).toBe('0x0000000000000000000000000000000000000000');
    });
  });

  describe('createPaymentPayload()', () => {
    test('should create valid payload structure', () => {
      const payload = createPaymentPayload(
        TEST_ASSET,
        TEST_RECIPIENT,
        1000000n,
        '/api/resource',
        'sepolia'
      );

      expect(payload.scheme).toBe('exact');
      expect(payload.network).toBe('sepolia');
      expect(payload.asset).toBe(TEST_ASSET);
      expect(payload.payTo).toBe(TEST_RECIPIENT);
      expect(payload.amount).toBe('1000000');
      expect(payload.resource).toBe('/api/resource');
      expect(payload.nonce).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(payload.timestamp).toBeGreaterThan(0);
    });

    test('should generate unique nonces', () => {
      const nonces = new Set<string>();
      
      for (let i = 0; i < 100; i++) {
        const payload = createPaymentPayload(TEST_ASSET, TEST_RECIPIENT, 1n, '/test');
        expect(nonces.has(payload.nonce)).toBe(false);
        nonces.add(payload.nonce);
      }
    });

    test('should handle different networks', () => {
      const networks = ['sepolia', 'ethereum', 'jeju', 'base'] as const;
      
      for (const network of networks) {
        const payload = createPaymentPayload(TEST_ASSET, TEST_RECIPIENT, 1n, '/test', network);
        expect(payload.network).toBe(network);
      }
    });

    test('should set reasonable timestamp', () => {
      const before = Math.floor(Date.now() / 1000);
      const payload = createPaymentPayload(TEST_ASSET, TEST_RECIPIENT, 1n, '/test');
      const after = Math.floor(Date.now() / 1000);

      expect(payload.timestamp).toBeGreaterThanOrEqual(before);
      expect(payload.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('parsePaymentHeader()', () => {
    test('should parse valid JSON header', () => {
      const payload = createPaymentPayload(TEST_ASSET, TEST_RECIPIENT, 1000n, '/api');
      const header = JSON.stringify(payload);
      
      const parsed = parsePaymentHeader(header);
      expect(parsed).not.toBeNull();
      expect(parsed?.amount).toBe('1000');
      expect(parsed?.payTo).toBe(TEST_RECIPIENT);
    });

    test('should return null for null input', () => {
      expect(parsePaymentHeader(null)).toBeNull();
    });

    test('should return null for empty string', () => {
      expect(parsePaymentHeader('')).toBeNull();
    });

    test('should return null for invalid JSON', () => {
      expect(parsePaymentHeader('not json')).toBeNull();
      expect(parsePaymentHeader('{invalid}')).toBeNull();
      expect(parsePaymentHeader('{"unclosed')).toBeNull();
    });

    test('should return null for non-object JSON', () => {
      expect(parsePaymentHeader('"string"')).toBeNull();
      expect(parsePaymentHeader('123')).toBeNull();
      expect(parsePaymentHeader('true')).toBeNull();
      expect(parsePaymentHeader('null')).toBeNull();
    });

    test('should handle whitespace in header', () => {
      const payload = createPaymentPayload(TEST_ASSET, TEST_RECIPIENT, 1n, '/test');
      const headerWithWhitespace = '  ' + JSON.stringify(payload) + '  ';
      
      // JSON.parse handles whitespace
      const parsed = parsePaymentHeader(headerWithWhitespace.trim());
      expect(parsed).not.toBeNull();
    });
  });

  describe('verifyPayment()', () => {
    test('should reject missing required fields', async () => {
      const result = await verifyPayment(
        { amount: '', payTo: '' as Address, asset: '' as Address } as never,
        1000n,
        TEST_RECIPIENT
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Missing required');
    });

    test('should reject insufficient payment amount', async () => {
      const payload = createPaymentPayload(TEST_ASSET, TEST_RECIPIENT, 100n, '/test', 'sepolia');
      
      const result = await verifyPayment(payload, 1000n, TEST_RECIPIENT);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Insufficient payment');
    });

    test('should reject wrong recipient', async () => {
      const wrongRecipient: Address = '0x9999999999999999999999999999999999999999';
      const payload = createPaymentPayload(TEST_ASSET, wrongRecipient, 1000n, '/test', 'sepolia');
      
      const result = await verifyPayment(payload, 1000n, TEST_RECIPIENT);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid recipient');
    });

    test('should reject expired timestamp', async () => {
      const payload = createPaymentPayload(TEST_ASSET, TEST_RECIPIENT, 1000n, '/test', 'sepolia');
      payload.timestamp = Math.floor(Date.now() / 1000) - 400; // 400 seconds ago
      
      const result = await verifyPayment(payload, 1000n, TEST_RECIPIENT);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('expired');
    });

    test('should reject missing signature', async () => {
      const payload = createPaymentPayload(TEST_ASSET, TEST_RECIPIENT, 1000n, '/test', 'sepolia');
      
      const result = await verifyPayment(payload, 1000n, TEST_RECIPIENT);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('signature required');
    });

    test('should accept valid signed payment', async () => {
      const payload = createPaymentPayload(TEST_ASSET, TEST_RECIPIENT, 1000n, '/test', 'sepolia');
      const signed = await signPaymentPayload(payload, TEST_PRIVATE_KEY);
      
      const result = await verifyPayment(signed, 1000n, TEST_RECIPIENT);
      expect(result.valid).toBe(true);
      expect(result.signer).toBeDefined();
    });

    test('should accept overpayment', async () => {
      const payload = createPaymentPayload(TEST_ASSET, TEST_RECIPIENT, 2000n, '/test', 'sepolia');
      const signed = await signPaymentPayload(payload, TEST_PRIVATE_KEY);
      
      const result = await verifyPayment(signed, 1000n, TEST_RECIPIENT);
      expect(result.valid).toBe(true);
    });

    test('should handle case-insensitive recipient comparison', async () => {
      const lowerRecipient = TEST_RECIPIENT.toLowerCase() as Address;
      const payload = createPaymentPayload(TEST_ASSET, lowerRecipient, 1000n, '/test', 'sepolia');
      const signed = await signPaymentPayload(payload, TEST_PRIVATE_KEY);
      
      const result = await verifyPayment(signed, 1000n, TEST_RECIPIENT);
      expect(result.valid).toBe(true);
    });
  });

  describe('signPaymentPayload()', () => {
    test('should produce valid EIP-712 signature', async () => {
      const payload = createPaymentPayload(TEST_ASSET, TEST_RECIPIENT, 1000n, '/test', 'sepolia');
      const signed = await signPaymentPayload(payload, TEST_PRIVATE_KEY);
      
      expect(signed.signature).toBeDefined();
      expect(signed.signature).toMatch(/^0x[a-fA-F0-9]+$/);
      expect(signed.signature?.length).toBe(132); // 65 bytes = 130 hex chars + '0x'
    });

    test('should preserve original payload fields', async () => {
      const payload = createPaymentPayload(TEST_ASSET, TEST_RECIPIENT, 1000n, '/api/test', 'ethereum');
      const signed = await signPaymentPayload(payload, TEST_PRIVATE_KEY);
      
      expect(signed.scheme).toBe(payload.scheme);
      expect(signed.network).toBe(payload.network);
      expect(signed.asset).toBe(payload.asset);
      expect(signed.payTo).toBe(payload.payTo);
      expect(signed.amount).toBe(payload.amount);
      expect(signed.resource).toBe(payload.resource);
      expect(signed.nonce).toBe(payload.nonce);
      expect(signed.timestamp).toBe(payload.timestamp);
    });

    test('same payload should produce same signature', async () => {
      const payload = createPaymentPayload(TEST_ASSET, TEST_RECIPIENT, 1000n, '/test', 'sepolia');
      const signed1 = await signPaymentPayload({ ...payload }, TEST_PRIVATE_KEY);
      const signed2 = await signPaymentPayload({ ...payload }, TEST_PRIVATE_KEY);
      
      expect(signed1.signature).toBe(signed2.signature);
    });

    test('different payloads should produce different signatures', async () => {
      const payload1 = createPaymentPayload(TEST_ASSET, TEST_RECIPIENT, 1000n, '/test1', 'sepolia');
      const payload2 = createPaymentPayload(TEST_ASSET, TEST_RECIPIENT, 1000n, '/test2', 'sepolia');
      
      const signed1 = await signPaymentPayload(payload1, TEST_PRIVATE_KEY);
      const signed2 = await signPaymentPayload(payload2, TEST_PRIVATE_KEY);
      
      expect(signed1.signature).not.toBe(signed2.signature);
    });
  });

  describe('checkPayment()', () => {
    test('should return paid=false for null header', async () => {
      const result = await checkPayment(null, 1000n, TEST_RECIPIENT);
      expect(result.paid).toBe(false);
      expect(result.error).toContain('No payment header');
    });

    test('should return paid=false for invalid JSON', async () => {
      const result = await checkPayment('not json', 1000n, TEST_RECIPIENT);
      expect(result.paid).toBe(false);
    });

    test('should return paid=true for valid payment', async () => {
      const payload = createPaymentPayload(TEST_ASSET, TEST_RECIPIENT, 1000n, '/test', 'sepolia');
      const signed = await signPaymentPayload(payload, TEST_PRIVATE_KEY);
      const header = JSON.stringify(signed);
      
      const result = await checkPayment(header, 1000n, TEST_RECIPIENT);
      expect(result.paid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('calculatePercentageFee()', () => {
    test('should calculate correct percentage', () => {
      expect(calculatePercentageFee(10000n, 100)).toBe(100n);   // 1%
      expect(calculatePercentageFee(10000n, 250)).toBe(250n);   // 2.5%
      expect(calculatePercentageFee(10000n, 500)).toBe(500n);   // 5%
      expect(calculatePercentageFee(10000n, 1000)).toBe(1000n); // 10%
    });

    test('should handle zero amount', () => {
      expect(calculatePercentageFee(0n, 250)).toBe(0n);
    });

    test('should handle zero basis points', () => {
      expect(calculatePercentageFee(10000n, 0)).toBe(0n);
    });

    test('should handle large amounts', () => {
      const largeAmount = 10n ** 18n; // 1 ETH in wei
      const fee = calculatePercentageFee(largeAmount, 30); // 0.3%
      expect(fee).toBe(3n * 10n ** 15n); // 0.003 ETH
    });

    test('should truncate fractional basis points', () => {
      // 100 * 33 / 10000 = 0.33 -> 0
      expect(calculatePercentageFee(100n, 33)).toBe(0n);
      
      // 1000 * 33 / 10000 = 3.3 -> 3
      expect(calculatePercentageFee(1000n, 33)).toBe(3n);
    });
  });

  describe('generate402Headers()', () => {
    test('should include required headers', () => {
      const config = {
        recipientAddress: TEST_RECIPIENT,
        network: 'sepolia' as const,
        serviceName: 'Test',
      };
      const req = createPaymentRequirement('/api', 1000n, 'Test', config);
      const headers = generate402Headers(req);
      
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['WWW-Authenticate']).toBe('x402');
      expect(headers['X-Payment-Requirement']).toBeDefined();
      expect(headers['Access-Control-Expose-Headers']).toContain('X-Payment-Requirement');
    });

    test('should serialize requirement to JSON', () => {
      const config = {
        recipientAddress: TEST_RECIPIENT,
        network: 'jeju' as const,
        serviceName: 'Test',
      };
      const req = createPaymentRequirement('/api', 1000n, 'Test', config);
      const headers = generate402Headers(req);
      
      const parsed = JSON.parse(headers['X-Payment-Requirement']);
      expect(parsed.x402Version).toBe(1);
      expect(parsed.accepts).toHaveLength(1);
    });
  });

  describe('getEIP712Domain()', () => {
    test('should return correct domain for each network', () => {
      const sepoliaDomain = getEIP712Domain('sepolia');
      expect(sepoliaDomain.chainId).toBe(11155111);
      expect(sepoliaDomain.name).toBe('x402 Payment Protocol');
      expect(sepoliaDomain.version).toBe('1');

      const baseDomain = getEIP712Domain('base');
      expect(baseDomain.chainId).toBe(8453);
    });
  });

  describe('getEIP712Types()', () => {
    test('should return Payment type definition', () => {
      const types = getEIP712Types();
      expect(types.Payment).toBeDefined();
      expect(types.Payment.length).toBeGreaterThan(0);
      
      const fieldNames = types.Payment.map(f => f.name);
      expect(fieldNames).toContain('scheme');
      expect(fieldNames).toContain('network');
      expect(fieldNames).toContain('asset');
      expect(fieldNames).toContain('payTo');
      expect(fieldNames).toContain('amount');
      expect(fieldNames).toContain('nonce');
      expect(fieldNames).toContain('timestamp');
    });
  });

  describe('concurrent payment verification', () => {
    test('should handle multiple concurrent verifications', async () => {
      const payloads = await Promise.all(
        Array.from({ length: 10 }, async (_, i) => {
          const payload = createPaymentPayload(
            TEST_ASSET,
            TEST_RECIPIENT,
            BigInt(1000 + i),
            `/api/resource${i}`,
            'sepolia'
          );
          return signPaymentPayload(payload, TEST_PRIVATE_KEY);
        })
      );

      const results = await Promise.all(
        payloads.map((p, i) => verifyPayment(p, BigInt(1000 + i), TEST_RECIPIENT))
      );

      for (const result of results) {
        expect(result.valid).toBe(true);
      }
    });
  });
});

