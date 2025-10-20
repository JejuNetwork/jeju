/**
 * x402 Tests for Crucible
 */

import { test, expect, describe } from 'bun:test';
import {
  createPaymentRequirement,
  verifyPayment,
  PAYMENT_TIERS,
  type PaymentPayload,
} from '../../src/lib/x402';
import { parseEther } from 'viem';

describe('Crucible x402', () => {
  const mockRecipient = '0x1234567890123456789012345678901234567890' as `0x${string}`;

  test('should create payment requirement', () => {
    const requirement = createPaymentRequirement(
      '/api/a2a',
      PAYMENT_TIERS.SECURITY_TEST,
      'Security test',
      mockRecipient
    );

    expect(requirement.x402Version).toBe(1);
    expect(requirement.accepts[0].description).toBe('Security test');
  });

  test('should verify valid payment with signature', async () => {
    const amount = parseEther('0.01');
    
    const { createPaymentPayload, signPaymentPayload } = await import('../../src/lib/x402');
    const testPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    
    const unsignedPayload = createPaymentPayload(
      '0x0000000000000000000000000000000000000000' as `0x${string}`,
      mockRecipient,
      amount,
      '/api/a2a',
      'base-sepolia'
    );

    const payload = await signPaymentPayload(unsignedPayload, testPrivateKey);

    const result = await verifyPayment(payload, amount, mockRecipient);
    expect(result.valid).toBe(true);
    expect(result.signer).toBeDefined();
  });

  test('payment tiers should be defined', () => {
    expect(PAYMENT_TIERS.SECURITY_TEST).toBeDefined();
    expect(PAYMENT_TIERS.VULNERABILITY_REPORT).toBeGreaterThan(0n);
    expect(PAYMENT_TIERS.PENETRATION_TEST).toBeGreaterThan(0n);
  });
});

