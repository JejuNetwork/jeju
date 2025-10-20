/**
 * Paymaster Tests for Crucible
 */

import { test, expect, describe } from 'bun:test';
import { getAvailablePaymasters, preparePaymasterData } from '../../src/lib/paymaster';
import { parseEther, type Address } from 'viem';

describe('Crucible Paymaster', () => {
  test('should get available paymasters', async () => {
    const paymasters = await getAvailablePaymasters();
    expect(paymasters).toBeInstanceOf(Array);
  });

  test('should prepare paymaster data', () => {
    const result = preparePaymasterData(
      '0x1111111111111111111111111111111111111111' as Address,
      '0x2222222222222222222222222222222222222222' as Address,
      parseEther('10')
    );

    expect(result.paymaster).toBeDefined();
    expect(result.paymasterData).toMatch(/^0x/);
  });
});

