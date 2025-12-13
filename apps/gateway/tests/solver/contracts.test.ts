/**
 * Tests for solver/contracts.ts
 * Tests boundary conditions, edge cases, and utility functions
 */

import { describe, test, expect } from 'bun:test';
import { ethers } from 'ethers';
import {
  OUTPUT_SETTLER_ABI,
  ERC20_APPROVE_ABI,
  INPUT_SETTLERS,
  OUTPUT_SETTLERS,
  bytes32ToAddress,
  isNativeToken,
} from '../../src/solver/contracts';

describe('bytes32ToAddress', () => {
  test('should convert bytes32 with left-padded zeros to address', () => {
    // Standard bytes32 with 12 bytes of zero padding
    const bytes32 = '0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as `0x${string}`;
    const result = bytes32ToAddress(bytes32);
    expect(result).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  });

  test('should handle zero address', () => {
    const bytes32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;
    const result = bytes32ToAddress(bytes32);
    expect(result).toBe('0x0000000000000000000000000000000000000000');
  });

  test('should handle all-ff bytes32', () => {
    const bytes32 = ('0x' + 'ff'.repeat(32)) as `0x${string}`;
    const result = bytes32ToAddress(bytes32);
    expect(result).toBe('0xffffffffffffffffffffffffffffffffffffffff');
  });

  test('result should be valid 42-char hex address', () => {
    const bytes32 = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
    const result = bytes32ToAddress(bytes32);
    expect(result).toMatch(/^0x[a-f0-9]{40}$/);
    expect(result.length).toBe(42);
  });

  test('should handle mixed case bytes32', () => {
    const bytes32 = '0x000000000000000000000000A0B86991C6218B36C1D19D4A2E9EB0CE3606EB48' as `0x${string}`;
    const result = bytes32ToAddress(bytes32);
    // Result preserves case from input
    expect(result.toLowerCase()).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48');
  });
});

describe('isNativeToken', () => {
  test('should return true for zero address', () => {
    expect(isNativeToken('0x0000000000000000000000000000000000000000')).toBe(true);
  });

  test('should return true for empty string', () => {
    expect(isNativeToken('')).toBe(true);
  });

  test('should return true for 0x', () => {
    expect(isNativeToken('0x')).toBe(true);
  });

  test('should return false for valid ERC20 address', () => {
    expect(isNativeToken('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')).toBe(false);
    expect(isNativeToken('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')).toBe(false);
  });

  test('should return false for partial zero address', () => {
    expect(isNativeToken('0x0000000000000000000000000000000000000001')).toBe(false);
  });

  test('should handle undefined-like values', () => {
    // @ts-expect-error - testing runtime behavior
    expect(isNativeToken(null)).toBe(true);
    // @ts-expect-error - testing runtime behavior  
    expect(isNativeToken(undefined)).toBe(true);
  });
});

describe('ABI Definitions', () => {
  test('OUTPUT_SETTLER_ABI has fillDirect function', () => {
    const fillDirect = OUTPUT_SETTLER_ABI.find(
      (item) => item.type === 'function' && item.name === 'fillDirect'
    );
    expect(fillDirect).toBeDefined();
    expect(fillDirect!.inputs).toHaveLength(4);
    expect(fillDirect!.inputs[0].name).toBe('orderId');
    expect(fillDirect!.inputs[0].type).toBe('bytes32');
    expect(fillDirect!.inputs[1].name).toBe('token');
    expect(fillDirect!.inputs[2].name).toBe('amount');
    expect(fillDirect!.inputs[3].name).toBe('recipient');
  });

  test('OUTPUT_SETTLER_ABI has isFilled function', () => {
    const isFilled = OUTPUT_SETTLER_ABI.find(
      (item) => item.type === 'function' && item.name === 'isFilled'
    );
    expect(isFilled).toBeDefined();
    expect(isFilled!.inputs).toHaveLength(1);
    expect(isFilled!.outputs).toHaveLength(1);
    expect(isFilled!.outputs![0].type).toBe('bool');
  });

  test('ERC20_APPROVE_ABI has approve function', () => {
    expect(ERC20_APPROVE_ABI).toHaveLength(1);
    expect(ERC20_APPROVE_ABI[0].name).toBe('approve');
    expect(ERC20_APPROVE_ABI[0].inputs).toHaveLength(2);
  });

  test('ABIs can be used with ethers.Interface', () => {
    const outputIface = new ethers.Interface(OUTPUT_SETTLER_ABI);
    const erc20Iface = new ethers.Interface(ERC20_APPROVE_ABI);

    expect(outputIface.getFunction('fillDirect')).toBeDefined();
    expect(outputIface.getFunction('isFilled')).toBeDefined();
    expect(erc20Iface.getFunction('approve')).toBeDefined();
  });

  test('fillDirect ABI encodes correctly', () => {
    const iface = new ethers.Interface(OUTPUT_SETTLER_ABI);
    const data = iface.encodeFunctionData('fillDirect', [
      '0x' + 'ab'.repeat(32),
      '0x' + '11'.repeat(20),
      ethers.parseEther('1.0'),
      '0x' + '22'.repeat(20),
    ]);
    
    expect(data.length).toBe(2 + 8 + 4 * 64); // 0x + selector + 4 params
    expect(data.slice(0, 10)).toBe(iface.getFunction('fillDirect')!.selector);
  });
});

describe('Settler Loading', () => {
  test('INPUT_SETTLERS is a Record object', () => {
    expect(typeof INPUT_SETTLERS).toBe('object');
  });

  test('OUTPUT_SETTLERS is a Record object', () => {
    expect(typeof OUTPUT_SETTLERS).toBe('object');
  });

  test('settler addresses are valid hex if present', () => {
    for (const [chainId, address] of Object.entries(INPUT_SETTLERS)) {
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(parseInt(chainId)).toBeGreaterThan(0);
    }
    for (const [chainId, address] of Object.entries(OUTPUT_SETTLERS)) {
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(parseInt(chainId)).toBeGreaterThan(0);
    }
  });

  test('INPUT_SETTLERS and OUTPUT_SETTLERS have same chains', () => {
    const inputChains = Object.keys(INPUT_SETTLERS).sort();
    const outputChains = Object.keys(OUTPUT_SETTLERS).sort();
    expect(inputChains).toEqual(outputChains);
  });
});

describe('Edge Cases', () => {
  test('bytes32ToAddress with minimum input length', () => {
    // Ensure we handle the exact expected length
    const input = '0x' + '0'.repeat(64);
    expect(() => bytes32ToAddress(input as `0x${string}`)).not.toThrow();
  });

  test('fillDirect with zero amount', () => {
    const iface = new ethers.Interface(OUTPUT_SETTLER_ABI);
    const data = iface.encodeFunctionData('fillDirect', [
      '0x' + '00'.repeat(32),
      ethers.ZeroAddress,
      0n,
      ethers.ZeroAddress,
    ]);
    expect(data).toBeDefined();
  });

  test('fillDirect with max uint256', () => {
    const iface = new ethers.Interface(OUTPUT_SETTLER_ABI);
    const maxUint256 = 2n ** 256n - 1n;
    const data = iface.encodeFunctionData('fillDirect', [
      '0x' + 'ff'.repeat(32),
      '0x' + 'ff'.repeat(20),
      maxUint256,
      '0x' + 'ff'.repeat(20),
    ]);
    expect(data).toBeDefined();

    // Verify decoding works
    const decoded = iface.decodeFunctionData('fillDirect', data);
    expect(decoded[2]).toBe(maxUint256);
  });

  test('approve with max uint256 (infinite approval)', () => {
    const iface = new ethers.Interface(ERC20_APPROVE_ABI);
    const maxUint256 = 2n ** 256n - 1n;
    const data = iface.encodeFunctionData('approve', [
      '0x' + '11'.repeat(20),
      maxUint256,
    ]);
    
    const decoded = iface.decodeFunctionData('approve', data);
    expect(decoded[1]).toBe(maxUint256);
  });
});

