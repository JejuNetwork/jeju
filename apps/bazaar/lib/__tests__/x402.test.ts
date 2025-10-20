/**
 * x402 Payment Protocol Tests
 */

import { test, expect, describe } from 'bun:test';
import {
  createPaymentRequirement,
  verifyPayment,
  calculatePercentageFee,
  parsePaymentHeader,
  PAYMENT_TIERS,
  type PaymentPayload,
} from '../x402';
import { parseEther } from 'viem';

describe('x402 Payment Protocol', () => {
  const mockRecipient = '0x1234567890123456789012345678901234567890' as `0x${string}`;
  const mockToken = '0x0000000000000000000000000000000000000000' as `0x${string}`;

  test('should create payment requirement with correct structure', () => {
    const requirement = createPaymentRequirement(
      '/api/test',
      parseEther('0.01'),
      'Test payment',
      mockRecipient,
      mockToken
    );

    expect(requirement.x402Version).toBe(1);
    expect(requirement.accepts).toHaveLength(1);
    expect(requirement.accepts[0].scheme).toBe('exact');
    expect(requirement.accepts[0].maxAmountRequired).toBe(parseEther('0.01').toString());
    expect(requirement.accepts[0].payTo).toBe(mockRecipient);
    expect(requirement.accepts[0].resource).toBe('/api/test');
  });

  test('should verify valid payment with signature', async () => {
    const amount = parseEther('1.0');
    
    // Create and sign payload
    const { createPaymentPayload, signPaymentPayload } = await import('../x402');
    
    // Use Hardhat test account #0 private key for testing
    const testPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    
    const unsignedPayload = createPaymentPayload(
      mockToken,
      mockRecipient,
      amount,
      '/api/test',
      'base-sepolia'
    );

    const payload = await signPaymentPayload(unsignedPayload, testPrivateKey);

    const result = await verifyPayment(payload, amount, mockRecipient);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.signer).toBeDefined();
    // Signer should be the test account address
    expect(result.signer?.toLowerCase()).toBe('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
  });

  test('should reject payment with insufficient amount', async () => {
    const required = parseEther('1.0');
    const provided = parseEther('0.5');
    
    const { createPaymentPayload, signPaymentPayload } = await import('../x402');
    const testPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    
    const unsignedPayload = createPaymentPayload(
      mockToken,
      mockRecipient,
      provided,
      '/api/test'
    );

    const payload = await signPaymentPayload(unsignedPayload, testPrivateKey);

    const result = await verifyPayment(payload, required, mockRecipient);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Insufficient payment');
  });

  test('should reject payment to wrong recipient', async () => {
    const wrongRecipient = '0x9999999999999999999999999999999999999999' as `0x${string}`;
    const amount = parseEther('1.0');
    
    const { createPaymentPayload, signPaymentPayload } = await import('../x402');
    const testPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    
    const unsignedPayload = createPaymentPayload(
      mockToken,
      wrongRecipient,
      amount,
      '/api/test'
    );

    const payload = await signPaymentPayload(unsignedPayload, testPrivateKey);

    const result = await verifyPayment(payload, amount, mockRecipient);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid recipient');
  });

  test('should reject expired payment', async () => {
    const amount = parseEther('1.0');
    const oldTimestamp = Math.floor(Date.now() / 1000) - 400; // 400 seconds ago
    
    const { signPaymentPayload } = await import('../x402');
    const testPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    
    const unsignedPayload = {
      scheme: 'exact' as const,
      network: 'base-sepolia',
      asset: mockToken,
      payTo: mockRecipient,
      amount: amount.toString(),
      resource: '/api/test',
      nonce: '123',
      timestamp: oldTimestamp,
    };

    const payload = await signPaymentPayload(unsignedPayload, testPrivateKey);

    const result = await verifyPayment(payload, amount, mockRecipient);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
  });

  test('should calculate percentage fees correctly', () => {
    const amount = parseEther('100'); // 100 ETH
    
    // 0.3% fee (30 basis points)
    const fee = calculatePercentageFee(amount, 30);
    expect(fee).toBe(parseEther('0.3'));

    // 2.5% fee (250 basis points)  
    const fee2 = calculatePercentageFee(amount, 250);
    expect(fee2).toBe(parseEther('2.5'));

    // 10% fee (1000 basis points)
    const fee3 = calculatePercentageFee(amount, 1000);
    expect(fee3).toBe(parseEther('10'));
  });

  test('should parse payment header', () => {
    const payload: PaymentPayload = {
      scheme: 'exact',
      network: 'base-sepolia',
      asset: mockToken,
      payTo: mockRecipient,
      amount: '1000000000000000000',
      resource: '/api/test',
      nonce: '123',
      timestamp: Date.now(),
    };

    const headerValue = JSON.stringify(payload);
    const parsed = parsePaymentHeader(headerValue);

    expect(parsed).not.toBeNull();
    expect(parsed?.scheme).toBe('exact');
    expect(parsed?.amount).toBe('1000000000000000000');
  });

  test('should return null for invalid payment header', () => {
    expect(parsePaymentHeader(null)).toBeNull();
    expect(parsePaymentHeader('invalid-json')).toBeNull();
    expect(parsePaymentHeader('')).toBeNull();
  });

  test('payment tiers should be defined', () => {
    expect(PAYMENT_TIERS.NFT_LISTING).toBeDefined();
    expect(PAYMENT_TIERS.NFT_PURCHASE_FEE).toBe(250); // 2.5%
    expect(PAYMENT_TIERS.SWAP_FEE).toBe(30); // 0.3%
    expect(PAYMENT_TIERS.TOKEN_DEPLOYMENT).toBeGreaterThan(0n);
  });

  test('should reject payment without signature', async () => {
    const amount = parseEther('1.0');
    const payload: PaymentPayload = {
      scheme: 'exact',
      network: 'base-sepolia',
      asset: mockToken,
      payTo: mockRecipient,
      amount: amount.toString(),
      resource: '/api/test',
      nonce: '123',
      timestamp: Math.floor(Date.now() / 1000),
      // No signature!
    };

    const result = await verifyPayment(payload, amount, mockRecipient);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('signature required');
  });

  test('should handle missing payment fields', async () => {
    const payload = {
      scheme: 'exact',
      // Missing required fields
    } as unknown as PaymentPayload;

    const result = await verifyPayment(payload, parseEther('1'), mockRecipient);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Missing required');
  });
});

