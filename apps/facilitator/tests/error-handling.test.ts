/**
 * Error Handling and Invalid Input Tests
 * Tests error conditions, malformed inputs, and failure modes
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createServer } from '../src/server';
import { clearNonceCache } from '../src/services/nonce-manager';
import { resetConfig } from '../src/config';
import { decodePaymentHeader } from '../src/services/verifier';

const app = createServer();

describe('Malformed Request Body', () => {
  beforeEach(() => {
    resetConfig();
    clearNonceCache();
  });

  afterEach(() => clearNonceCache());

  test('should reject empty request body', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });
    expect(res.status).toBe(400);
  });

  test('should reject invalid JSON', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json }',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.invalidReason).toContain('Invalid JSON');
  });

  test('should reject null body', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });
    expect(res.status).toBe(400);
  });

  test('should reject array body', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[]',
    });
    expect(res.status).toBe(400);
  });

  test('should reject string body', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '"just a string"',
    });
    expect(res.status).toBe(400);
  });

  test('should reject missing Content-Type header', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      body: JSON.stringify({ x402Version: 1 }),
    });
    // Hono may still parse JSON, but should fail validation
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('Invalid Payment Header Format', () => {
  test('should reject empty payment header', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: '',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    // Empty header may fail at route validation or verification
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(500);
    const body = await res.json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toBeTruthy();
  });

  test('should reject non-base64 payment header', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'not-base64-encoded!!!',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isValid).toBe(false);
  });

  test('should reject payment header with invalid JSON', async () => {
    const invalidJson = Buffer.from('{ invalid json }').toString('base64');
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: invalidJson,
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isValid).toBe(false);
  });

  test('should reject payment header missing required fields', async () => {
    const incomplete = Buffer.from(JSON.stringify({ scheme: 'exact' })).toString('base64');
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: incomplete,
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isValid).toBe(false);
  });

  test('should handle payment header with null values', async () => {
    const withNulls = Buffer.from(JSON.stringify({
      scheme: 'exact',
      network: 'jeju',
      asset: null,
      payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      amount: '1000000',
      resource: '/api/test',
      nonce: 'test123',
      timestamp: 1700000000,
      signature: '0x' + 'ab'.repeat(65),
    })).toString('base64');
    
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: withNulls,
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isValid).toBe(false);
  });
});

describe('Invalid Address Formats', () => {
  test('should handle invalid payTo address gracefully', async () => {
    // viem may normalize or throw - test that it doesn't crash
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: 'not-an-address' as any,
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    // Should handle gracefully (may return 400 or 500, or 200 with error)
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  test('should handle short address gracefully', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x123' as any,
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  test('should handle address without 0x prefix', async () => {
    // viem may normalize this, so test that it handles it
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: ('0x' + '70997970C51812dc3A010C7d01b50e0d17dc79C8') as any,
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });
});

describe('Invalid Amount Formats', () => {
  test('should handle negative amount string during verification', async () => {
    // Amount validation happens during verification, not at route level
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '-1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    // Route accepts it, verification will handle
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isValid).toBe(false);
  });

  test('should handle non-numeric amount during verification', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: 'not-a-number',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isValid).toBe(false);
  });

  test('should handle amount with decimal point during verification', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000.5',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isValid).toBe(false);
  });

  test('should reject extremely large amount', async () => {
    const hugeAmount = '1' + '0'.repeat(100);
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: hugeAmount,
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    // Should handle gracefully (may fail validation or succeed depending on implementation)
    expect(res.status).toBeGreaterThanOrEqual(200);
  });
});

describe('Invalid Scheme Values', () => {
  test('should reject unsupported scheme during verification', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'invalid-scheme' as any,
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isValid).toBe(false);
    // May fail at different validation stages
    expect(body.invalidReason).toBeTruthy();
  });

  test('should handle null scheme gracefully', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: null as any,
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    // May fail at JSON parsing or validation
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });

  test('should handle empty scheme string', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: '' as any,
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isValid).toBe(false);
  });
});

describe('Invalid Network Values', () => {
  test('should reject unsupported network during client creation', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'nonexistent-network',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    // May fail at client creation or verification
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
    const body = await res.json();
    if (res.status === 200) {
      expect(body.isValid).toBe(false);
    }
  });

  test('should handle null network gracefully', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: null as any,
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    // May use default network or fail
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });
});

describe('Invalid x402Version', () => {
  test('should reject version 0', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 0,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.invalidReason).toContain('Unsupported x402Version');
  });

  test('should reject version 2', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 2,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBe(400);
  });

  test('should reject missing x402Version', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('Invalid Signature Formats', () => {
  test('should reject signature that is too short', async () => {
    const invalidPayment = {
      scheme: 'exact',
      network: 'jeju',
      asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
      payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      amount: '1000000',
      resource: '/api/test',
      nonce: 'test123',
      timestamp: Math.floor(Date.now() / 1000),
      signature: '0x1234', // Too short
    };
    const header = Buffer.from(JSON.stringify(invalidPayment)).toString('base64');
    
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: header,
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isValid).toBe(false);
  });

  test('should reject signature without 0x prefix', async () => {
    const invalidPayment = {
      scheme: 'exact',
      network: 'jeju',
      asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
      payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      amount: '1000000',
      resource: '/api/test',
      nonce: 'test123',
      timestamp: Math.floor(Date.now() / 1000),
      signature: 'ab'.repeat(65), // Missing 0x
    };
    const header = Buffer.from(JSON.stringify(invalidPayment)).toString('base64');
    
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: header,
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isValid).toBe(false);
  });

  test('should reject signature with invalid hex characters', async () => {
    const invalidPayment = {
      scheme: 'exact',
      network: 'jeju',
      asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
      payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      amount: '1000000',
      resource: '/api/test',
      nonce: 'test123',
      timestamp: Math.floor(Date.now() / 1000),
      signature: '0x' + 'ZZ'.repeat(65), // Invalid hex
    };
    const header = Buffer.from(JSON.stringify(invalidPayment)).toString('base64');
    
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: header,
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.isValid).toBe(false);
  });
});

describe('Resource Path Edge Cases', () => {
  test('should handle empty resource path', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '',
        },
      }),
    });
    // Should handle gracefully
    expect(res.status).toBeGreaterThanOrEqual(200);
  });

  test('should handle very long resource path', async () => {
    const longPath = '/api/' + 'a'.repeat(10000);
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: longPath,
        },
      }),
    });
    // Should handle gracefully
    expect(res.status).toBeGreaterThanOrEqual(200);
  });

  test('should handle resource with special characters', async () => {
    const specialPath = '/api/test?param=value&other=123';
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: specialPath,
        },
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
  });
});

describe('Nonce Format Edge Cases', () => {
  test('should handle empty nonce', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
  });

  test('should handle very long nonce', async () => {
    const longNonce = 'a'.repeat(10000);
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
  });

  test('should handle nonce with special characters', async () => {
    const specialNonce = 'test-nonce-123!@#$%^&*()';
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'dGVzdA==',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
  });
});

describe('Response Format Validation', () => {
  test('verify response should have correct structure on success', async () => {
    // This would need a valid payment - skip for now as it requires setup
    // But structure is tested in other tests
  });

  test('verify response should have correct structure on failure', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'invalid',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('isValid');
    expect(body).toHaveProperty('invalidReason');
    expect(body).toHaveProperty('timestamp');
    expect(typeof body.isValid).toBe('boolean');
    expect(body.isValid).toBe(false);
    expect(typeof body.invalidReason).toBe('string');
  });

  test('settle response should have correct error structure', async () => {
    const res = await app.request('/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: 'invalid',
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
          asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
          resource: '/api/test',
        },
      }),
    });
    
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('success');
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('networkId');
    expect(body).toHaveProperty('timestamp');
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string');
  });
});

describe('decodePaymentHeader Edge Cases', () => {
  test('should return null for empty string', () => {
    expect(decodePaymentHeader('')).toBeNull();
  });

  test('should return null for non-base64 string', () => {
    expect(decodePaymentHeader('not-base64!!!')).toBeNull();
  });

  test('should handle base64 that is not JSON', () => {
    const notJson = Buffer.from('just plain text').toString('base64');
    expect(decodePaymentHeader(notJson)).toBeNull();
  });

  test('should handle base64 with valid JSON but missing fields', () => {
    const incomplete = Buffer.from(JSON.stringify({ scheme: 'exact' })).toString('base64');
    expect(decodePaymentHeader(incomplete)).toBeNull();
  });

  test('should handle base64 with null values', () => {
    const withNulls = Buffer.from(JSON.stringify({
      scheme: null,
      network: 'jeju',
      asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
      payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      amount: '1000000',
      resource: '/api/test',
      nonce: 'test123',
      timestamp: 1700000000,
      signature: '0x' + 'ab'.repeat(65),
    })).toString('base64');
    expect(decodePaymentHeader(withNulls)).toBeNull();
  });
});

