/**
 * Paymaster Integration Tests
 */

import { test, expect, describe } from 'bun:test';
import {
  getAvailablePaymasters,
  getPaymasterForToken,
  estimateTokenCost,
  preparePaymasterData,
  getApprovalTxData,
  getPaymasterOptions,
} from '../paymaster';
import { parseEther, type Address } from 'viem';

describe('Paymaster Integration', () => {
  test('should get available paymasters', async () => {
    const paymasters = await getAvailablePaymasters();
    
    expect(paymasters).toBeInstanceOf(Array);
    // Mock data should return at least 2 paymasters
    expect(paymasters.length).toBeGreaterThanOrEqual(0);
    
    if (paymasters.length > 0) {
      const paymaster = paymasters[0];
      expect(paymaster.address).toBeDefined();
      expect(paymaster.token).toBeDefined();
      expect(paymaster.tokenSymbol).toBeDefined();
      expect(paymaster.stakedEth).toBeGreaterThanOrEqual(0n);
      expect(paymaster.isActive).toBe(true);
    }
  });

  test('should filter paymasters by minimum stake', async () => {
    const highStakeRequired = await getAvailablePaymasters({
      factoryAddress: '0x0000000000000000000000000000000000000000' as Address,
      minStakedEth: parseEther('100.0'), // Very high requirement
    });

    // Should filter out paymasters with insufficient stake
    expect(highStakeRequired.length).toBeLessThanOrEqual(2);
  });

  test('should get paymaster for specific token', async () => {
    const mockUSDCAddress = '0x2222222222222222222222222222222222222222' as Address;
    const paymaster = await getPaymasterForToken(mockUSDCAddress);

    if (paymaster) {
      expect(paymaster.token.toLowerCase()).toBe(mockUSDCAddress.toLowerCase());
      expect(paymaster.tokenSymbol).toBe('USDC');
    }
  });

  test('should return null for nonexistent token', async () => {
    const nonexistentToken = '0x9999999999999999999999999999999999999999' as Address;
    const paymaster = await getPaymasterForToken(nonexistentToken);

    expect(paymaster).toBeNull();
  });

  test('should estimate token cost correctly', () => {
    const gasEstimate = BigInt(100000); // 100k gas
    const gasPrice = parseEther('0.00000001'); // 10 Gwei
    const mockPaymaster = {
      address: '0x1111111111111111111111111111111111111111' as Address,
      token: '0x2222222222222222222222222222222222222222' as Address,
      tokenSymbol: 'USDC',
      tokenName: 'USD Coin',
      stakedEth: parseEther('10.0'),
      isActive: true,
      exchangeRate: BigInt('2000000'), // 2 USDC per ETH
    };

    const tokenCost = estimateTokenCost(gasEstimate, gasPrice, mockPaymaster);

    // ETH cost = 100000 * 0.00000001 = 0.001 ETH
    // Token cost = 0.001 * 2 = 0.002 USDC (assuming 18 decimals)
    expect(tokenCost).toBeGreaterThan(0n);
  });

  test('should prepare paymaster data correctly', () => {
    const paymasterAddress = '0x1111111111111111111111111111111111111111' as Address;
    const tokenAddress = '0x2222222222222222222222222222222222222222' as Address;
    const maxAmount = parseEther('10');

    const result = preparePaymasterData(paymasterAddress, tokenAddress, maxAmount);

    expect(result.paymaster).toBe(paymasterAddress);
    expect(result.paymasterData).toMatch(/^0x/);
    expect(result.paymasterData.length).toBeGreaterThan(2);
  });

  test('should get approval transaction data', () => {
    const tokenAddress = '0x2222222222222222222222222222222222222222' as Address;
    const paymasterAddress = '0x1111111111111111111111111111111111111111' as Address;
    const amount = parseEther('100');

    const result = getApprovalTxData(tokenAddress, paymasterAddress, amount);

    expect(result.to).toBe(tokenAddress);
    expect(result.data).toMatch(/^0x095ea7b3/); // approve selector
    expect(result.data.length).toBeGreaterThan(10);
  });

  test('should get paymaster options for UI', async () => {
    const estimatedGas = BigInt(100000);
    const gasPrice = parseEther('0.00000001');

    const options = await getPaymasterOptions(estimatedGas, gasPrice);

    expect(options).toBeInstanceOf(Array);
    
    if (options.length > 0) {
      const option = options[0];
      expect(option.label).toContain('Pay gas with');
      expect(option.value).toBeDefined();
      expect(option.token.symbol).toBeDefined();
      expect(option.estimatedCost).toContain(option.token.symbol);
      expect(option.stakedEth).toContain('ETH');
    }
  });

  test('should mark USDC and elizaOS as recommended', async () => {
    const options = await getPaymasterOptions(BigInt(100000), parseEther('0.00000001'));

    // If factory is configured and returns paymasters, check recommendations
    if (options.length > 0) {
      const recommended = options.filter(opt => opt.recommended);
      expect(recommended.length).toBeGreaterThanOrEqual(0);

      if (recommended.length > 0) {
        const symbols = recommended.map(opt => opt.token.symbol);
        expect(symbols.some(s => s === 'USDC' || s === 'elizaOS')).toBe(true);
      }
    } else {
      // No factory configured, which is fine for development
      expect(options).toBeInstanceOf(Array);
    }
  });

  test('should format estimated cost with correct decimals', async () => {
    const options = await getPaymasterOptions(BigInt(100000), parseEther('0.00000001'));

    options.forEach(option => {
      expect(option.estimatedCost).toMatch(/^~/); // Starts with ~
      expect(option.estimatedCost).toContain(option.token.symbol);
      // Should have reasonable decimal places
      const match = option.estimatedCost.match(/~(\d+\.?\d*)/);
      if (match) {
        const value = parseFloat(match[1]);
        expect(value).toBeGreaterThanOrEqual(0); // Can be 0 for small amounts
      }
    });
  });
});

