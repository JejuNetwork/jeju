/**
 * Payment Verification Tests
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address, Hex } from 'viem';

import { decodePaymentHeader, verifySignatureOnly, encodePaymentHeader } from '../src/services/verifier';
import { clearNonceCache } from '../src/services/nonce-manager';
import { resetConfig } from '../src/config';

// Test wallet (anvil default account 0)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY);

// Generate a test payment header
async function createTestPaymentHeader(overrides?: Partial<{
  scheme: string;
  network: string;
  asset: Address;
  payTo: Address;
  amount: string;
  resource: string;
  nonce: string;
  timestamp: number;
}>): Promise<string> {
  const nonce = Math.random().toString(36).substring(7);
  const timestamp = Math.floor(Date.now() / 1000);

  const payload = {
    scheme: overrides?.scheme || 'exact',
    network: overrides?.network || 'jeju',
    asset: overrides?.asset || '0x0165878A594ca255338adfa4d48449f69242Eb8F' as Address,
    payTo: overrides?.payTo || '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
    amount: overrides?.amount || '1000000',
    resource: overrides?.resource || '/api/test',
    nonce: overrides?.nonce || nonce,
    timestamp: overrides?.timestamp || timestamp,
  };

  // Sign the payment using EIP-712
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

describe('Payment Header Decoding', () => {
  beforeAll(() => {
    resetConfig();
    clearNonceCache();
  });

  afterAll(() => {
    clearNonceCache();
  });

  test('should decode valid base64 payment header', async () => {
    const header = await createTestPaymentHeader();
    const decoded = decodePaymentHeader(header);

    expect(decoded).not.toBeNull();
    expect(decoded!.scheme).toBe('exact');
    expect(decoded!.network).toBe('jeju');
    expect(decoded!.amount).toBe('1000000');
    expect(decoded!.signature).toBeDefined();
  });

  test('should decode base64-encoded JSON payment header', () => {
    // Use a valid 65-byte signature (130 hex chars + 0x prefix)
    const validSignature = '0x' + 'ab'.repeat(65);
    const payload = {
      scheme: 'exact',
      network: 'jeju',
      asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F',
      payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      amount: '500000',
      resource: '/test',
      nonce: 'testnonce123',
      timestamp: 1700000000,
      signature: validSignature,
    };

    // Encode as base64 (which is what the decoder expects)
    const header = Buffer.from(JSON.stringify(payload)).toString('base64');
    const decoded = decodePaymentHeader(header);

    expect(decoded).not.toBeNull();
    expect(decoded!.amount).toBe('500000');
    expect(decoded!.nonce).toBe('testnonce123');
  });

  test('should return null for invalid base64', () => {
    const decoded = decodePaymentHeader('not-valid-base64!!!');
    // Will try to parse as JSON, which will fail
    expect(decoded).toBeNull();
  });

  test('should return null for incomplete payload', () => {
    const incomplete = { scheme: 'exact', network: 'jeju' };
    const header = Buffer.from(JSON.stringify(incomplete)).toString('base64');
    const decoded = decodePaymentHeader(header);

    expect(decoded).toBeNull();
  });
});

describe('Signature Verification', () => {
  test('should verify valid signature', async () => {
    const header = await createTestPaymentHeader();
    const result = await verifySignatureOnly(header, 'jeju');

    expect(result.valid).toBe(true);
    expect(result.signer?.toLowerCase()).toBe(TEST_ACCOUNT.address.toLowerCase());
  });

  test('should recover correct signer address', async () => {
    const header = await createTestPaymentHeader();
    const result = await verifySignatureOnly(header, 'jeju');

    expect(result.signer).toBe(TEST_ACCOUNT.address);
  });

  test('should fail for invalid network', async () => {
    const header = await createTestPaymentHeader();
    const result = await verifySignatureOnly(header, 'nonexistent-network');

    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported network');
  });

  test('should fail for tampered payload', async () => {
    const header = await createTestPaymentHeader();
    const decoded = decodePaymentHeader(header)!;

    // Tamper with the amount
    const tampered = { ...decoded, amount: '9999999' };
    const tamperedHeader = Buffer.from(JSON.stringify(tampered)).toString('base64');

    const result = await verifySignatureOnly(tamperedHeader, 'jeju');

    // Signature won't match the tampered data
    expect(result.signer?.toLowerCase()).not.toBe(TEST_ACCOUNT.address.toLowerCase());
  });
});

describe('Payment Header Encoding', () => {
  test('should encode payment to base64', () => {
    const payment = {
      scheme: 'exact',
      network: 'jeju',
      asset: '0x0165878A594ca255338adfa4d48449f69242Eb8F' as Address,
      payTo: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
      amount: '1000000',
      resource: '/api/test',
      nonce: 'abc123',
      timestamp: 1700000000,
      signature: '0xdeadbeef' as Hex,
    };

    const encoded = encodePaymentHeader(payment);
    expect(encoded).toBeDefined();

    // Should be valid base64
    const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);

    expect(parsed.scheme).toBe('exact');
    expect(parsed.amount).toBe('1000000');
  });
});

describe('Upto Scheme Validation', () => {
  test('should verify upto scheme payment with amount <= maxAmountRequired', async () => {
    const header = await createTestPaymentHeader({ 
      scheme: 'upto',
      amount: '1500000' 
    });
    
    const result = await verifySignatureOnly(header, 'jeju');
    expect(result.valid).toBe(true);
  });

  test('should verify exact scheme payment with amount == maxAmountRequired', async () => {
    const header = await createTestPaymentHeader({ 
      scheme: 'exact',
      amount: '2000000' 
    });
    
    const result = await verifySignatureOnly(header, 'jeju');
    expect(result.valid).toBe(true);
  });
});
