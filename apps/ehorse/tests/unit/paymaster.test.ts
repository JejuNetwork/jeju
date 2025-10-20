import { test, expect, describe } from 'bun:test';
import { getAvailablePaymasters } from '../../src/lib/paymaster';

describe('eHorse Paymaster', () => {
  test('gets paymasters', async () => {
    const pms = await getAvailablePaymasters();
    expect(pms).toBeInstanceOf(Array);
  });
});

