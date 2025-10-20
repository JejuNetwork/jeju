import { test, expect } from 'bun:test';
import { PAYMENT_TIERS } from '../src/lib/x402';
import { getAvailablePaymasters } from '../src/lib/paymaster';

test('leaderboard x402 tiers', () => {
  expect(PAYMENT_TIERS.PREMIUM_ANALYTICS).toBeGreaterThan(0n);
});

test('leaderboard paymasters', async () => {
  const pms = await getAvailablePaymasters();
  expect(pms).toBeInstanceOf(Array);
});

