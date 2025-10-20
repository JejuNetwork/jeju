import { test, expect, describe } from 'bun:test';
import { createPaymentRequirement, PAYMENT_TIERS } from '../../src/lib/x402';

describe('eHorse x402', () => {
  test('payment tiers defined', () => {
    expect(PAYMENT_TIERS.BET_FEE).toBe(100);
    expect(PAYMENT_TIERS.RACE_SUBSCRIPTION).toBeGreaterThan(0n);
  });

  test('creates payment requirement', () => {
    const req = createPaymentRequirement('/a2a', PAYMENT_TIERS.RACE_SUBSCRIPTION, 'Sub', '0x1234567890123456789012345678901234567890' as any);
    expect(req.x402Version).toBe(1);
  });
});

