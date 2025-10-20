import { test, expect } from 'bun:test';
import { PAYMENT_TIERS } from '../../../lib/x402';
import { getAvailablePaymasters } from '../../../lib/paymaster';

test('predimarket x402 tiers', () => {
  expect(PAYMENT_TIERS.MARKET_CREATION).toBeGreaterThan(0n);
  expect(PAYMENT_TIERS.TRADING_FEE).toBe(50);
});

test('predimarket paymasters', async () => {
  const pms = await getAvailablePaymasters();
  expect(pms).toBeInstanceOf(Array);
});

