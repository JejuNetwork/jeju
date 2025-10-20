import { test, expect, describe } from 'bun:test';
import { createPaymentRequirement, PAYMENT_TIERS } from '../../src/lib/x402';

describe('Gateway x402', () => {
  test('payment tiers defined', () => {
    expect(PAYMENT_TIERS.NODE_REGISTRATION).toBeGreaterThan(0n);
    expect(PAYMENT_TIERS.PAYMASTER_DEPLOYMENT).toBeGreaterThan(0n);
  });

  test('creates payment requirement', () => {
    const req = createPaymentRequirement('/a2a', PAYMENT_TIERS.NODE_REGISTRATION, 'Node fee', '0x1234567890123456789012345678901234567890' as any);
    expect(req.x402Version).toBe(1);
    expect(req.accepts[0].description).toBe('Node fee');
  });
});

