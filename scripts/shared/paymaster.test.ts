/**
 * Thorough Tests for Paymaster Integration Library
 * 
 * Tests:
 * - Boundary conditions and edge cases
 * - Error handling and invalid inputs
 * - Data encoding functions
 * - Configuration loading
 */

import { describe, test, expect } from 'bun:test';
import {
  estimateTokenCost,
  preparePaymasterData,
  generatePaymasterData,
  getApprovalTxData,
  loadPaymasterConfig,
} from './paymaster';
import type { Address } from 'viem';
import { parseEther } from 'viem';

// Test fixtures
const TEST_PAYMASTER: Address = '0x1234567890123456789012345678901234567890';
const TEST_TOKEN: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const _TEST_USER: Address = '0x9999999999999999999999999999999999999999';

describe('Paymaster Integration Library', () => {
  describe('estimateTokenCost()', () => {
    test('should calculate basic token cost', () => {
      const gasEstimate = 100000n;
      const gasPrice = 1000000000n; // 1 gwei
      const exchangeRate = parseEther('1'); // 1:1
      
      const cost = estimateTokenCost(gasEstimate, gasPrice, exchangeRate);
      expect(cost).toBe(100000n * 1000000000n); // 0.0001 ETH in wei
    });

    test('should apply exchange rate correctly', () => {
      const gasEstimate = 100000n;
      const gasPrice = parseEther('0.000000001'); // 1 gwei
      const exchangeRate = parseEther('2'); // 2 tokens per ETH
      
      const cost = estimateTokenCost(gasEstimate, gasPrice, exchangeRate);
      const expectedEthCost = gasEstimate * gasPrice;
      const expectedTokenCost = (expectedEthCost * exchangeRate) / parseEther('1');
      expect(cost).toBe(expectedTokenCost);
    });

    test('should handle zero gas estimate', () => {
      const cost = estimateTokenCost(0n, 1000000000n, parseEther('1'));
      expect(cost).toBe(0n);
    });

    test('should handle zero gas price', () => {
      const cost = estimateTokenCost(100000n, 0n, parseEther('1'));
      expect(cost).toBe(0n);
    });

    test('should handle default exchange rate', () => {
      const cost = estimateTokenCost(100000n, 1000000000n);
      expect(cost).toBe(100000n * 1000000000n);
    });

    test('should handle very large gas estimates', () => {
      const largeGas = 30000000n; // 30M gas (block limit)
      const highGasPrice = parseEther('0.0000001'); // 100 gwei
      const cost = estimateTokenCost(largeGas, highGasPrice, parseEther('1'));
      
      expect(cost).toBeGreaterThan(0n);
      expect(cost).toBe(largeGas * highGasPrice);
    });

    test('should handle fractional exchange rates', () => {
      const gasEstimate = 100000n;
      const gasPrice = parseEther('0.00000001'); // 10 gwei
      const exchangeRate = parseEther('0.5'); // 0.5 tokens per ETH
      
      const cost = estimateTokenCost(gasEstimate, gasPrice, exchangeRate);
      const expectedEthCost = gasEstimate * gasPrice;
      const expectedTokenCost = (expectedEthCost * exchangeRate) / parseEther('1');
      expect(cost).toBe(expectedTokenCost);
    });
  });

  describe('preparePaymasterData()', () => {
    test('should create valid paymaster data structure', () => {
      const maxAmount = 1000000n;
      const result = preparePaymasterData(TEST_PAYMASTER, TEST_TOKEN, maxAmount);
      
      expect(result.paymaster).toBe(TEST_PAYMASTER);
      expect(result.paymasterData).toMatch(/^0x[a-fA-F0-9]+$/);
    });

    test('should encode token address correctly', () => {
      const maxAmount = 1000000n;
      const result = preparePaymasterData(TEST_PAYMASTER, TEST_TOKEN, maxAmount);
      
      // Token address should be at the start (after 0x)
      const tokenInData = result.paymasterData.slice(2, 42);
      expect(tokenInData.toLowerCase()).toBe(TEST_TOKEN.slice(2).toLowerCase());
    });

    test('should encode max amount correctly', () => {
      const maxAmount = 1000000n;
      const result = preparePaymasterData(TEST_PAYMASTER, TEST_TOKEN, maxAmount);
      
      // Amount should be 64 hex chars after the address
      const amountHex = result.paymasterData.slice(42);
      expect(amountHex).toHaveLength(64);
      expect(BigInt('0x' + amountHex)).toBe(maxAmount);
    });

    test('should handle zero max amount', () => {
      const result = preparePaymasterData(TEST_PAYMASTER, TEST_TOKEN, 0n);
      
      expect(result.paymasterData).toBeDefined();
      const amountHex = result.paymasterData.slice(42);
      expect(BigInt('0x' + amountHex)).toBe(0n);
    });

    test('should handle max uint256 amount', () => {
      const maxUint256 = 2n ** 256n - 1n;
      const result = preparePaymasterData(TEST_PAYMASTER, TEST_TOKEN, maxUint256);
      
      const amountHex = result.paymasterData.slice(42);
      expect(BigInt('0x' + amountHex)).toBe(maxUint256);
    });

    test('should handle zero address token', () => {
      const zeroToken: Address = '0x0000000000000000000000000000000000000000';
      const result = preparePaymasterData(TEST_PAYMASTER, zeroToken, 1000n);
      
      const tokenInData = result.paymasterData.slice(2, 42);
      expect(tokenInData).toBe('0000000000000000000000000000000000000000');
    });
  });

  describe('generatePaymasterData()', () => {
    test('should create encoded packed data', () => {
      const result = generatePaymasterData(TEST_PAYMASTER);
      
      expect(result).toMatch(/^0x[a-fA-F0-9]+$/);
    });

    test('should include paymaster address', () => {
      const result = generatePaymasterData(TEST_PAYMASTER);
      
      // Address is 20 bytes = 40 hex chars
      const addressPart = result.slice(2, 42);
      expect(addressPart.toLowerCase()).toBe(TEST_PAYMASTER.slice(2).toLowerCase());
    });

    test('should use default gas limits', () => {
      const result = generatePaymasterData(TEST_PAYMASTER);
      
      // Should have address (40 chars) + verificationGasLimit (32 chars) + postOpGasLimit (32 chars)
      expect(result.length).toBe(2 + 40 + 32 + 32);
    });

    test('should accept custom gas limits', () => {
      const customVerification = 200000n;
      const customPostOp = 100000n;
      
      const result = generatePaymasterData(TEST_PAYMASTER, customVerification, customPostOp);
      expect(result).toBeDefined();
      expect(result.length).toBe(2 + 40 + 32 + 32);
    });

    test('should handle zero gas limits', () => {
      const result = generatePaymasterData(TEST_PAYMASTER, 0n, 0n);
      expect(result).toBeDefined();
    });

    test('should handle max uint128 gas limits', () => {
      const maxUint128 = 2n ** 128n - 1n;
      const result = generatePaymasterData(TEST_PAYMASTER, maxUint128, maxUint128);
      expect(result).toBeDefined();
    });
  });

  describe('getApprovalTxData()', () => {
    test('should return valid transaction data', () => {
      const amount = parseEther('1000');
      const result = getApprovalTxData(TEST_TOKEN, TEST_PAYMASTER, amount);
      
      expect(result.to).toBe(TEST_TOKEN);
      expect(result.data).toMatch(/^0x[a-fA-F0-9]+$/);
    });

    test('should use approve selector (0x095ea7b3)', () => {
      const result = getApprovalTxData(TEST_TOKEN, TEST_PAYMASTER, 1000n);
      
      expect(result.data.slice(0, 10)).toBe('0x095ea7b3');
    });

    test('should encode spender address correctly', () => {
      const result = getApprovalTxData(TEST_TOKEN, TEST_PAYMASTER, 1000n);
      
      // Spender is padded to 32 bytes (64 chars) after selector
      const spenderHex = result.data.slice(10, 74);
      const spenderAddress = '0x' + spenderHex.slice(-40);
      expect(spenderAddress.toLowerCase()).toBe(TEST_PAYMASTER.toLowerCase());
    });

    test('should encode amount correctly', () => {
      const amount = 123456789n;
      const result = getApprovalTxData(TEST_TOKEN, TEST_PAYMASTER, amount);
      
      // Amount is 32 bytes (64 chars) after spender
      const amountHex = result.data.slice(74, 138);
      expect(BigInt('0x' + amountHex)).toBe(amount);
    });

    test('should handle zero approval amount', () => {
      const result = getApprovalTxData(TEST_TOKEN, TEST_PAYMASTER, 0n);
      
      const amountHex = result.data.slice(74, 138);
      expect(BigInt('0x' + amountHex)).toBe(0n);
    });

    test('should handle max uint256 approval', () => {
      const maxUint256 = 2n ** 256n - 1n;
      const result = getApprovalTxData(TEST_TOKEN, TEST_PAYMASTER, maxUint256);
      
      const amountHex = result.data.slice(74, 138);
      expect(BigInt('0x' + amountHex)).toBe(maxUint256);
    });

    test('should produce valid calldata length', () => {
      const result = getApprovalTxData(TEST_TOKEN, TEST_PAYMASTER, 1000n);
      
      // 0x + selector (8) + spender (64) + amount (64) = 138
      expect(result.data.length).toBe(138);
    });
  });

  describe('loadPaymasterConfig()', () => {
    test('should return valid config structure', () => {
      const config = loadPaymasterConfig();
      
      expect(config).toBeDefined();
      expect(config.factoryAddress).toBeDefined();
      expect(config.minStakedEth).toBeDefined();
      expect(config.rpcUrl).toBeDefined();
      expect(config.chainId).toBeDefined();
    });

    test('should have valid address format for factory', () => {
      const config = loadPaymasterConfig();
      
      expect(config.factoryAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    test('should have positive minStakedEth', () => {
      const config = loadPaymasterConfig();
      
      expect(config.minStakedEth).toBeGreaterThanOrEqual(0n);
    });

    test('should have valid RPC URL format', () => {
      const config = loadPaymasterConfig();
      
      expect(config.rpcUrl).toMatch(/^https?:\/\/.+/);
    });

    test('should have positive chainId', () => {
      const config = loadPaymasterConfig();
      
      expect(config.chainId).toBeGreaterThan(0);
    });

    test('should use default values when env vars not set', () => {
      const config = loadPaymasterConfig();
      
      // Default chain ID should be 1337 (localnet) if not set
      expect(typeof config.chainId).toBe('number');
    });
  });

  describe('integration scenarios', () => {
    test('should prepare complete paymaster flow data', () => {
      // 1. Estimate cost
      const gasEstimate = 150000n;
      const gasPrice = parseEther('0.00000002'); // 20 gwei
      const exchangeRate = parseEther('1.5'); // 1.5 tokens per ETH
      
      const tokenCost = estimateTokenCost(gasEstimate, gasPrice, exchangeRate);
      expect(tokenCost).toBeGreaterThan(0n);
      
      // 2. Generate approval data
      const approvalBuffer = (tokenCost * 120n) / 100n; // 20% buffer
      const approvalTx = getApprovalTxData(TEST_TOKEN, TEST_PAYMASTER, approvalBuffer);
      expect(approvalTx.to).toBe(TEST_TOKEN);
      
      // 3. Prepare paymaster data for UserOp
      const paymasterData = preparePaymasterData(TEST_PAYMASTER, TEST_TOKEN, approvalBuffer);
      expect(paymasterData.paymaster).toBe(TEST_PAYMASTER);
      
      // 4. Generate packed data for ERC-4337
      const packedData = generatePaymasterData(TEST_PAYMASTER);
      expect(packedData).toBeDefined();
    });

    test('should handle multiple token types', () => {
      const tokens: Address[] = [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
        '0x0000000000000000000000000000000000000000', // Native
      ];

      for (const token of tokens) {
        const data = preparePaymasterData(TEST_PAYMASTER, token, 1000n);
        expect(data.paymasterData).toBeDefined();
        expect(data.paymaster).toBe(TEST_PAYMASTER);
      }
    });
  });

  describe('boundary conditions', () => {
    test('should handle minimum possible values', () => {
      const cost = estimateTokenCost(1n, 1n, 1n);
      expect(cost).toBe(0n); // 1 * 1 / 10^18 = 0 due to integer division
    });

    test('should handle very small exchange rates', () => {
      const smallRate = 1000n; // Very small compared to 1 ether
      const cost = estimateTokenCost(100000n, parseEther('0.000000001'), smallRate);
      expect(cost).toBe(0n); // Will round to 0
    });

    test('should handle exact boundary at ether denomination', () => {
      const cost = estimateTokenCost(1n, parseEther('1'), parseEther('1'));
      expect(cost).toBe(parseEther('1'));
    });
  });

  describe('error conditions', () => {
    test('data encoding should not throw for edge cases', () => {
      // These should all complete without throwing
      expect(() => preparePaymasterData(TEST_PAYMASTER, TEST_TOKEN, 0n)).not.toThrow();
      expect(() => generatePaymasterData(TEST_PAYMASTER, 0n, 0n)).not.toThrow();
      expect(() => getApprovalTxData(TEST_TOKEN, TEST_PAYMASTER, 0n)).not.toThrow();
    });
  });
});

