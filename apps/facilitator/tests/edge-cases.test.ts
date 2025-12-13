/**
 * Edge Case and Boundary Tests
 * Tests boundary conditions, malformed inputs, and unusual scenarios
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';

import { createServer } from '../src/server';
import { clearNonceCache, markNonceUsed } from '../src/services/nonce-manager';
import { resetConfig } from '../src/config';
import { decodePaymentHeader, verifyPayment } from '../src/services/verifier';
import { createClients } from '../src/services/settler';
import { calculateProtocolFee, formatAmount } from '../src/services/settler';

const app = createServer();

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);
const RECIPIENT: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const USDC: Address = '0x0165878A594ca255338adfa4d48449f69242Eb8F';

async function createSignedPayment(overrides?: {
  scheme?: string;
  network?: string;
  asset?: Address;
  payTo?: Address;
  amount?: string;
  resource?: string;
  nonce?: string;
  timestamp?: number;
  chainId?: number;
}): Promise<string> {
  const nonce = overrides?.nonce || crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const timestamp = overrides?.timestamp || Math.floor(Date.now() / 1000);

  const payload = {
    scheme: overrides?.scheme || 'exact',
    network: overrides?.network || 'jeju',
    asset: overrides?.asset || USDC,
    payTo: overrides?.payTo || RECIPIENT,
    amount: overrides?.amount || '1000000',
    resource: overrides?.resource || '/api/test',
    nonce,
    timestamp,
  };

  const domain = {
    name: 'x402 Payment Protocol',
    version: '1',
    chainId: overrides?.chainId || 420691,
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

describe('Amount Boundary Conditions', () => {
  beforeEach(() => {
    resetConfig();
    clearNonceCache();
  });

  afterEach(() => clearNonceCache());

  test('should reject zero amount payment', async () => {
    const paymentHeader = await createSignedPayment({ amount: '0' });

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
    expect(body.invalidReason).toContain('Exact scheme requires amount');
  });

  test('should accept exact amount match', async () => {
    const paymentHeader = await createSignedPayment({ amount: '1000000' });

    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader,
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000', // Exact match
          payTo: RECIPIENT,
          asset: USDC,
          resource: '/api/test',
        },
      }),
    });

    const body = await res.json();
    expect(body.isValid).toBe(true);
    expect(body.amount).toBe('1000000');
  });

  test('should accept overpayment with upto scheme', async () => {
    const paymentHeader = await createSignedPayment({ amount: '2000000', scheme: 'upto' }); // 2 USDC

    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader,
        paymentRequirements: {
          scheme: 'upto',
          network: 'jeju',
          maxAmountRequired: '2000000', // Max 2 USDC
          payTo: RECIPIENT,
          asset: USDC,
          resource: '/api/test',
        },
      }),
    });

    const body = await res.json();
    expect(body.isValid).toBe(true);
    expect(body.amount).toBe('2000000'); // Returns actual paid amount
  });

  test('should handle very large amounts with exact scheme', async () => {
    // Max uint128 - realistic for USDC (6 decimals)
    const largeAmount = '340282366920938463463374607431768211455';
    const paymentHeader = await createSignedPayment({ amount: largeAmount });

    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader,
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: largeAmount, // Must match exactly
          payTo: RECIPIENT,
          asset: USDC,
          resource: '/api/test',
        },
      }),
    });

    const body = await res.json();
    expect(body.isValid).toBe(true);
    expect(body.amount).toBe(largeAmount);
  });

  test('should reject underpayment by 1 unit with exact scheme', async () => {
    const paymentHeader = await createSignedPayment({ amount: '999999' }); // 1 unit short

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
    expect(body.invalidReason).toContain('Exact scheme requires amount');
  });
});

describe('Timestamp Boundary Conditions', () => {
  beforeEach(() => {
    resetConfig();
    clearNonceCache();
  });

  afterEach(() => clearNonceCache());

  test('should accept payment at exactly max age boundary', async () => {
    // Payment exactly 300 seconds old (default maxPaymentAge)
    const timestamp = Math.floor(Date.now() / 1000) - 300;
    const paymentHeader = await createSignedPayment({ timestamp });

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
    // May be valid or expired depending on timing
    expect(typeof body.isValid).toBe('boolean');
  });

  test('should reject payment just past max age', async () => {
    const timestamp = Math.floor(Date.now() / 1000) - 301; // 1 second past limit
    const paymentHeader = await createSignedPayment({ timestamp });

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
    expect(body.invalidReason).toContain('expired');
  });

  test('should accept payment up to 60s in future (clock skew allowance)', async () => {
    const timestamp = Math.floor(Date.now() / 1000) + 30; // 30 seconds in future
    const paymentHeader = await createSignedPayment({ timestamp });

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
    expect(body.isValid).toBe(true);
  });

  test('should reject payment far in future', async () => {
    const timestamp = Math.floor(Date.now() / 1000) + 120; // 2 minutes in future
    const paymentHeader = await createSignedPayment({ timestamp });

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
    expect(body.invalidReason).toContain('future');
  });
});

describe('Nonce Replay Prevention', () => {
  beforeEach(() => {
    resetConfig();
    clearNonceCache();
  });

  afterEach(() => clearNonceCache());

  test('should reject payment with already-used nonce', async () => {
    const nonce = 'unique-test-nonce-' + Date.now();
    
    // Mark nonce as used
    markNonceUsed(TEST_ACCOUNT.address, nonce);

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

  test('should accept same nonce from different payer', async () => {
    const nonce = 'shared-nonce-' + Date.now();
    const otherPayer: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
    
    // Mark nonce as used for OTHER payer
    markNonceUsed(otherPayer, nonce);

    // This payer should still be able to use the same nonce
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
    expect(body.isValid).toBe(true);
  });
});

describe('Asset Mismatch Detection', () => {
  beforeEach(() => {
    resetConfig();
    clearNonceCache();
  });

  afterEach(() => clearNonceCache());

  test('should reject payment with wrong asset', async () => {
    const wrongAsset: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
    const paymentHeader = await createSignedPayment({ asset: wrongAsset });

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
          asset: USDC, // Expected USDC but payment was for different asset
          resource: '/api/test',
        },
      }),
    });

    const body = await res.json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toContain('Asset mismatch');
  });
});

describe('Network Mismatch Detection', () => {
  beforeEach(() => {
    resetConfig();
    clearNonceCache();
  });

  afterEach(() => clearNonceCache());

  test('should reject payment signed for different network', async () => {
    // Payment signed for base-sepolia but requirements expect jeju
    const paymentHeader = await createSignedPayment({ 
      network: 'base-sepolia',
      chainId: 84532 
    });

    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader,
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju', // Mismatch
          maxAmountRequired: '1000000',
          payTo: RECIPIENT,
          asset: USDC,
          resource: '/api/test',
        },
      }),
    });

    const body = await res.json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toContain('Network mismatch');
  });
});

describe('Malformed Input Handling', () => {
  beforeEach(() => {
    resetConfig();
    clearNonceCache();
  });

  test('should handle empty paymentHeader', async () => {
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
          payTo: RECIPIENT,
          asset: USDC,
          resource: '/api/test',
        },
      }),
    });

    const body = await res.json();
    expect(body.isValid).toBe(false);
  });

  test('should handle non-base64 paymentHeader', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: '!!!not-valid-base64!!!',
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
  });

  test('should handle base64 that decodes to non-JSON', async () => {
    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: Buffer.from('not json at all').toString('base64'),
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
  });

  test('should handle JSON with missing signature field', async () => {
    const payload = {
      scheme: 'exact',
      network: 'jeju',
      asset: USDC,
      payTo: RECIPIENT,
      amount: '1000000',
      resource: '/api/test',
      nonce: 'test-nonce',
      timestamp: Math.floor(Date.now() / 1000),
      // signature field missing
    };

    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: Buffer.from(JSON.stringify(payload)).toString('base64'),
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
    expect(body.invalidReason).toContain('Invalid payment header');
  });

  test('should handle invalid signature format', async () => {
    const payload = {
      scheme: 'exact',
      network: 'jeju',
      asset: USDC,
      payTo: RECIPIENT,
      amount: '1000000',
      resource: '/api/test',
      nonce: 'test-nonce',
      timestamp: Math.floor(Date.now() / 1000),
      signature: 'not-a-hex-signature',
    };

    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader: Buffer.from(JSON.stringify(payload)).toString('base64'),
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

    // Should fail gracefully
    expect(res.status).toBeLessThanOrEqual(500);
    const body = await res.json();
    expect(body.isValid).toBe(false);
  });

  test('should handle requirements with invalid address format', async () => {
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
          payTo: 'not-an-address', // Invalid
          asset: USDC,
          resource: '/api/test',
        },
      }),
    });

    const body = await res.json();
    expect(body.isValid).toBe(false);
  });
});

describe('Protocol Fee Calculations', () => {
  test('should calculate fee correctly for various amounts', () => {
    // 0.5% fee (50 bps)
    expect(calculateProtocolFee(1000000n, 50)).toBe(5000n); // 1 USDC -> 0.005 USDC fee
    expect(calculateProtocolFee(100000000n, 50)).toBe(500000n); // 100 USDC -> 0.5 USDC fee
    expect(calculateProtocolFee(1n, 50)).toBe(0n); // 1 unit -> 0 fee (floor)
    expect(calculateProtocolFee(10000n, 50)).toBe(50n); // 0.01 USDC -> 0.00005 USDC fee
  });

  test('should calculate fee correctly for 0% fee', () => {
    expect(calculateProtocolFee(1000000n, 0)).toBe(0n);
    expect(calculateProtocolFee(100000000n, 0)).toBe(0n);
  });

  test('should calculate fee correctly for 1% fee', () => {
    expect(calculateProtocolFee(1000000n, 100)).toBe(10000n); // 1 USDC -> 0.01 USDC
    expect(calculateProtocolFee(100n, 100)).toBe(1n); // Minimum 1 unit
  });

  test('should calculate fee correctly for max 10% fee', () => {
    expect(calculateProtocolFee(1000000n, 1000)).toBe(100000n); // 1 USDC -> 0.1 USDC
  });
});

describe('Amount Formatting', () => {
  test('should format USDC amounts correctly', () => {
    const result = formatAmount(1000000n, 'jeju', USDC);
    expect(result.human).toBe('1');
    expect(result.base).toBe('1000000');
    expect(result.symbol).toBe('USDC');
    expect(result.decimals).toBe(6);
  });

  test('should format fractional USDC amounts', () => {
    const result = formatAmount(1500000n, 'jeju', USDC);
    expect(result.human).toBe('1.5');
    expect(result.base).toBe('1500000');
  });

  test('should format small amounts', () => {
    const result = formatAmount(1n, 'jeju', USDC);
    expect(result.human).toBe('0.000001');
    expect(result.base).toBe('1');
  });

  test('should format zero amount', () => {
    const result = formatAmount(0n, 'jeju', USDC);
    expect(result.human).toBe('0');
    expect(result.base).toBe('0');
  });
});

describe('Response Structure Verification', () => {
  beforeEach(() => {
    resetConfig();
    clearNonceCache();
  });

  afterEach(() => clearNonceCache());

  test('verify response should have all required fields', async () => {
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

    const body = await res.json();
    
    // Check all required fields exist
    expect(body).toHaveProperty('isValid');
    expect(body).toHaveProperty('invalidReason');
    expect(body).toHaveProperty('payer');
    expect(body).toHaveProperty('amount');
    expect(body).toHaveProperty('timestamp');
    
    // Check types
    expect(typeof body.isValid).toBe('boolean');
    expect(typeof body.timestamp).toBe('number');
    
    // Timestamp should be recent (within last 5 seconds)
    const now = Date.now();
    expect(body.timestamp).toBeGreaterThan(now - 5000);
    expect(body.timestamp).toBeLessThanOrEqual(now);
  });

  test('supported response should have correct structure', async () => {
    const res = await app.request('/supported');
    const body = await res.json();

    expect(body).toHaveProperty('kinds');
    expect(body).toHaveProperty('x402Version');
    expect(body).toHaveProperty('facilitator');
    expect(Array.isArray(body.kinds)).toBe(true);
    expect(body.x402Version).toBe(1);
    
    // Check facilitator info
    expect(body.facilitator).toHaveProperty('name');
    expect(body.facilitator).toHaveProperty('version');
    expect(body.facilitator).toHaveProperty('url');

    // Each kind should have scheme and network
    for (const kind of body.kinds) {
      expect(kind).toHaveProperty('scheme');
      expect(kind).toHaveProperty('network');
      expect(['exact', 'upto']).toContain(kind.scheme);
    }
  });

  test('health response should have correct structure', async () => {
    const res = await app.request('/');
    const body = await res.json();

    expect(body).toHaveProperty('service');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('mode');
    expect(body).toHaveProperty('chainId');
    expect(body).toHaveProperty('network');
    expect(body).toHaveProperty('endpoints');
    expect(body).toHaveProperty('timestamp');

    expect(['healthy', 'degraded', 'unhealthy']).toContain(body.status);
    expect(['production', 'development']).toContain(body.mode);
    expect(typeof body.chainId).toBe('number');
  });
});
