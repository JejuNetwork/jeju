/**
 * Integration Tests - Full x402 Payment Flow
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';

import { createServer } from '../src/server';
import { clearNonceCache } from '../src/services/nonce-manager';
import { resetConfig } from '../src/config';

const app = createServer();

// Test wallet (anvil default account 0)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);
const RECIPIENT: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const USDC: Address = '0x0165878A594ca255338adfa4d48449f69242Eb8F';

async function createSignedPayment(overrides?: {
  amount?: string;
  nonce?: string;
  timestamp?: number;
  resource?: string;
}): Promise<string> {
  const nonce = overrides?.nonce || Math.random().toString(36).substring(7);
  const timestamp = overrides?.timestamp || Math.floor(Date.now() / 1000);

  const payload = {
    scheme: 'exact',
    network: 'jeju',
    asset: USDC,
    payTo: RECIPIENT,
    amount: overrides?.amount || '1000000', // 1 USDC
    resource: overrides?.resource || '/api/test',
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

  const fullPayload = { ...payload, signature };
  return Buffer.from(JSON.stringify(fullPayload)).toString('base64');
}

describe('Full Payment Verification Flow', () => {
  beforeAll(() => {
    resetConfig();
    clearNonceCache();
  });

  afterAll(() => {
    clearNonceCache();
  });

  test('should verify a valid signed payment', async () => {
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

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.isValid).toBe(true);
    expect(body.payer?.toLowerCase()).toBe(TEST_ACCOUNT.address.toLowerCase());
    expect(body.amount).toBe('1000000');
  });

  test('should reject insufficient payment amount with exact scheme', async () => {
    const paymentHeader = await createSignedPayment({ amount: '500000' }); // 0.5 USDC

    const res = await app.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        x402Version: 1,
        paymentHeader,
        paymentRequirements: {
          scheme: 'exact',
          network: 'jeju',
          maxAmountRequired: '1000000', // Requires exactly 1 USDC
          payTo: RECIPIENT,
          asset: USDC,
          resource: '/api/test',
        },
      }),
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toContain('Exact scheme requires amount');
  });

  test('should reject expired payment', async () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
    const paymentHeader = await createSignedPayment({ timestamp: oldTimestamp });

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

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toContain('expired');
  });

  test('should reject wrong recipient', async () => {
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
          payTo: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address, // Wrong recipient
          asset: USDC,
          resource: '/api/test',
        },
      }),
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toContain('Recipient mismatch');
  });

  test('should reject wrong resource', async () => {
    const paymentHeader = await createSignedPayment({ resource: '/api/test' });

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
          resource: '/api/different', // Different resource
        },
      }),
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.isValid).toBe(false);
    expect(body.invalidReason).toContain('Resource mismatch');
  });
});

describe('Settle Flow (Development Mode)', () => {
  test('should fail settle when facilitator not configured', async () => {
    const paymentHeader = await createSignedPayment();

    const res = await app.request('/settle', {
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

    // Should return an error since facilitator contract is not configured
    const body = await res.json();
    expect(body.success).toBe(false);
    // Either "Settlement wallet not configured" or "Facilitator contract not configured"
    expect(body.error).toBeDefined();
  });
});

describe('Signature-Only Verification', () => {
  test('should verify signature without full requirements', async () => {
    const paymentHeader = await createSignedPayment();

    const res = await app.request('/verify/signature', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paymentHeader,
        network: 'jeju',
      }),
    });

    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.signer?.toLowerCase()).toBe(TEST_ACCOUNT.address.toLowerCase());
    expect(body.payment).toBeDefined();
    expect(body.payment.amount).toBe('1000000');
  });
});
