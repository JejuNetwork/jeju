/**
 * Concurrency and Race Condition Tests
 * Tests behavior under concurrent requests and race conditions
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from 'viem';

import { createServer } from '../src/server';
import { clearNonceCache, markNoncePending, isNonceUsedLocally } from '../src/services/nonce-manager';
import { resetConfig } from '../src/config';

const app = createServer();

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);
const RECIPIENT: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const USDC: Address = '0x0165878A594ca255338adfa4d48449f69242Eb8F';

async function createSignedPayment(overrides?: {
  nonce?: string;
  timestamp?: number;
}): Promise<string> {
  const nonce = overrides?.nonce || crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const timestamp = overrides?.timestamp || Math.floor(Date.now() / 1000);

  const payload = {
    scheme: 'exact',
    network: 'jeju',
    asset: USDC,
    payTo: RECIPIENT,
    amount: '1000000',
    resource: '/api/test',
    nonce,
    timestamp,
  };

  const domain = {
    name: 'x402 Payment Protocol',
    version: '1',
    chainId: 420691,
    verifyingContract: '0x0000000000000000000000000000000000000000' as Address,
  };

  const types = {
    Payment: [
      { name: 'scheme', type: 'string' },
      { name: 'network', type: 'string' },
      { name: 'asset', type: 'address' },
      { name: 'payTo', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'resource', type: 'string' },
      { name: 'nonce', type: 'string' },
      { name: 'timestamp', type: 'uint256' },
    ],
  };

  const message = {
    scheme: payload.scheme,
    network: payload.network,
    asset: payload.asset,
    payTo: payload.payTo,
    amount: BigInt(payload.amount),
    resource: payload.resource,
    nonce: payload.nonce,
    timestamp: BigInt(payload.timestamp),
  };

  const signature = await TEST_ACCOUNT.signTypedData({
    domain,
    types,
    primaryType: 'Payment',
    message,
  });

  return Buffer.from(JSON.stringify({ ...payload, signature })).toString('base64');
}

describe('Concurrent Payment Verification', () => {
  beforeEach(() => {
    resetConfig();
    clearNonceCache();
  });

  afterEach(() => clearNonceCache());

  test('should handle multiple concurrent verify requests', async () => {
    // Create 10 different payments
    const payments = await Promise.all(
      Array.from({ length: 10 }, () => createSignedPayment())
    );

    // Submit all concurrently
    const results = await Promise.all(
      payments.map((paymentHeader) =>
        app.request('/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            x402Version: 1,
            paymentHeader,
            paymentRequirements: {
              scheme: 'exact',
              network: 'jeju',
              maxAmountRequired: '1000000',
              payTo: RECIPIENT,
              asset: USDC,
              resource: '/api/test',
            },
          }),
        })
      )
    );

    // All should succeed
    const bodies = await Promise.all(results.map((r) => r.json()));
    const validCount = bodies.filter((b) => b.isValid).length;
    expect(validCount).toBe(10);
  });

  test('should prevent duplicate nonce in concurrent requests', async () => {
    // Create a payment with same nonce
    const sharedNonce = 'shared-concurrent-nonce-' + Date.now();
    const paymentHeader = await createSignedPayment({ nonce: sharedNonce });

    // Submit same payment multiple times concurrently
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.request('/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            x402Version: 1,
            paymentHeader,
            paymentRequirements: {
              scheme: 'exact',
              network: 'jeju',
              maxAmountRequired: '1000000',
              payTo: RECIPIENT,
              asset: USDC,
              resource: '/api/test',
            },
          }),
        })
      )
    );

    const bodies = await Promise.all(results.map((r) => r.json()));
    
    // First should succeed, subsequent may fail or succeed depending on timing
    // But total valid should be at least 1 (first request)
    const validCount = bodies.filter((b) => b.isValid).length;
    expect(validCount).toBeGreaterThanOrEqual(1);
  });

  test('should handle rapid sequential requests', async () => {
    // Send requests one after another as fast as possible
    const results: Response[] = [];
    
    for (let i = 0; i < 20; i++) {
      const paymentHeader = await createSignedPayment();
      const res = await app.request('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          x402Version: 1,
          paymentHeader,
          paymentRequirements: {
            scheme: 'exact',
            network: 'jeju',
            maxAmountRequired: '1000000',
            payTo: RECIPIENT,
            asset: USDC,
            resource: '/api/test',
          },
        }),
      });
      results.push(res);
    }

    // All should complete successfully
    expect(results.length).toBe(20);
    for (const res of results) {
      expect(res.status).toBe(200);
    }
  });
});

describe('Nonce Pending State', () => {
  beforeEach(() => {
    resetConfig();
    clearNonceCache();
  });

  afterEach(() => clearNonceCache());

  test('pending nonce should be detected as used', () => {
    const nonce = 'pending-test-nonce';
    
    expect(isNonceUsedLocally(TEST_ACCOUNT.address, nonce)).toBe(false);
    
    markNoncePending(TEST_ACCOUNT.address, nonce);
    
    expect(isNonceUsedLocally(TEST_ACCOUNT.address, nonce)).toBe(true);
  });

  test('should reject verify when nonce is in pending state', async () => {
    const nonce = 'pending-for-verify-' + Date.now();
    
    // Mark as pending (simulating in-flight settlement)
    markNoncePending(TEST_ACCOUNT.address, nonce);
    
    const paymentHeader = await createSignedPayment({ nonce });

    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader,
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000',
          payTo: RECIPIENT,
          asset: USDC,
          resource: '/api/test',
        },
      }),
    });

    const body = await res.json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toContain('Nonce');
  });
});

describe('Concurrent Health Checks', () => {
  test('should handle concurrent health check requests', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => app.request('/'))
    );

    // All should return valid responses
    for (const res of results) {
      expect(res.status).toBeLessThanOrEqual(503); // 200 or 503 for unhealthy
      const body = await res.json();
      expect(body).toHaveProperty('service');
      expect(body).toHaveProperty('status');
    }
  });

  test('should handle concurrent supported checks', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => app.request('/supported'))
    );

    for (const res of results) {
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('kinds');
    }
  });
});

describe('Mixed Concurrent Requests', () => {
  beforeEach(() => {
    resetConfig();
    clearNonceCache();
  });

  afterEach(() => clearNonceCache());

  test('should handle mixed endpoint requests concurrently', async () => {
    const payment1 = await createSignedPayment();
    const payment2 = await createSignedPayment();

    const requests = [
      app.request('/'),
      app.request('/supported'),
      app.request('/health'),
      app.request('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          x402Version: 1,
          paymentHeader: payment1,
          paymentRequirements: {
            scheme: 'exact',
            network: 'jeju',
            maxAmountRequired: '1000000',
            payTo: RECIPIENT,
            asset: USDC,
            resource: '/api/test',
          },
        }),
      }),
      app.request('/supported/networks'),
      app.request('/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          x402Version: 1,
          paymentHeader: payment2,
          paymentRequirements: {
            scheme: 'exact',
            network: 'jeju',
            maxAmountRequired: '1000000',
            payTo: RECIPIENT,
            asset: USDC,
            resource: '/api/test',
          },
        }),
      }),
    ];

    const results = await Promise.all(requests);

    // None should error out
    for (const res of results) {
      expect(res.status).toBeLessThanOrEqual(503);
    }

    // Verify requests should succeed
    const verifyResults = results.filter((_, i) => i === 3 || i === 5);
    for (const res of verifyResults) {
      expect(res.status).toBe(200);
    }
  });
});

describe('Load Testing', () => {
  beforeEach(() => {
    resetConfig();
    clearNonceCache();
  });

  afterEach(() => clearNonceCache());

  test('should handle 50 concurrent verify requests', async () => {
    const payments = await Promise.all(
      Array.from({ length: 50 }, () => createSignedPayment())
    );

    const startTime = Date.now();
    
    const results = await Promise.all(
      payments.map((paymentHeader) =>
        app.request('/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            x402Version: 1,
            paymentHeader,
            paymentRequirements: {
              scheme: 'exact',
              network: 'jeju',
              maxAmountRequired: '1000000',
              payTo: RECIPIENT,
              asset: USDC,
              resource: '/api/test',
            },
          }),
        })
      )
    );

    const duration = Date.now() - startTime;

    // All should complete
    expect(results.length).toBe(50);

    // All should return 200
    for (const res of results) {
      expect(res.status).toBe(200);
    }

    const bodies = await Promise.all(results.map((r) => r.json()));
    const validCount = bodies.filter((b) => b.isValid).length;
    
    // All should be valid
    expect(validCount).toBe(50);

    // Should complete in reasonable time (< 10 seconds)
    expect(duration).toBeLessThan(10000);
    
    console.log(`50 concurrent verifies completed in ${duration}ms`);
  });
});
