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

describe('Boundary Conditions - bytes32ToAddress', () => {
  test('extracts last 40 chars correctly for all-zero prefix', () => {
    // 12 bytes of zeros, 20 bytes of address
    const addr = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const bytes32 = `0x${'00'.repeat(12)}${addr}` as `0x${string}`;
    expect(bytes32ToAddress(bytes32)).toBe(`0x${addr}`);
  });

  test('extracts last 40 chars when prefix has data', () => {
    // Non-zero prefix bytes should be truncated
    const bytes32 = '0xffffffffffffffffffffffff1234567890abcdef1234567890abcdef12345678' as `0x${string}`;
    const result = bytes32ToAddress(bytes32);
    expect(result).toBe('0x1234567890abcdef1234567890abcdef12345678');
  });

  test('handles checksum address in bytes32', () => {
    // USDC checksum address
    const checksumAddr = 'A0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const bytes32 = `0x${'00'.repeat(12)}${checksumAddr}` as `0x${string}`;
    const result = bytes32ToAddress(bytes32);
    // Result preserves the case
    expect(result.slice(2).toLowerCase()).toBe(checksumAddr.toLowerCase());
  });

  test('slice(26) boundary is correct for 66-char input', () => {
    // 0x (2) + 64 chars = 66 total, slice(26) gives last 40
    const input = '0x' + '1'.repeat(24) + '2'.repeat(40);
    const result = bytes32ToAddress(input as `0x${string}`);
    expect(result).toBe('0x' + '2'.repeat(40));
  });
});

describe('Boundary Conditions - isNativeToken', () => {
  test('false for address with single non-zero byte', () => {
    expect(isNativeToken('0x0000000000000000000000000000000000000001')).toBe(false);
    expect(isNativeToken('0x1000000000000000000000000000000000000000')).toBe(false);
    expect(isNativeToken('0x0000000000000000000100000000000000000000')).toBe(false);
  });

  test('true for various zero address formats', () => {
    expect(isNativeToken('0x0000000000000000000000000000000000000000')).toBe(true);
    expect(isNativeToken('0x' + '0'.repeat(40))).toBe(true);
  });

  test('handles mixed case zero address', () => {
    // This tests actual runtime behavior - mixed case shouldn't matter
    const mixedCase = '0x0000000000000000000000000000000000000000';
    expect(isNativeToken(mixedCase)).toBe(true);
  });

  test('WETH address is not native', () => {
    // Common WETH addresses
    const wethAddresses = [
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // Mainnet
      '0x4200000000000000000000000000000000000006', // OP/Base
      '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // Arbitrum
    ];
    for (const addr of wethAddresses) {
      expect(isNativeToken(addr)).toBe(false);
    }
  });
});

describe('ABI Encoding/Decoding Roundtrip', () => {
  test('fillDirect encodes and decodes identically', () => {
    const iface = new ethers.Interface(OUTPUT_SETTLER_ABI);
    const params = [
      '0x' + 'ab'.repeat(32),
      '0x' + '11'.repeat(20),
      ethers.parseEther('123.456'),
      '0x' + '22'.repeat(20),
    ] as const;
    
    const encoded = iface.encodeFunctionData('fillDirect', params);
    const decoded = iface.decodeFunctionData('fillDirect', encoded);
    
    expect(decoded[0]).toBe(params[0]);
    expect(decoded[1].toLowerCase()).toBe(params[1]);
    expect(decoded[2]).toBe(params[2]);
    expect(decoded[3].toLowerCase()).toBe(params[3]);
  });

  test('isFilled encodes orderId correctly', () => {
    const iface = new ethers.Interface(OUTPUT_SETTLER_ABI);
    const orderId = '0x' + 'deadbeef'.repeat(8);
    
    const encoded = iface.encodeFunctionData('isFilled', [orderId]);
    const decoded = iface.decodeFunctionData('isFilled', encoded);
    
    expect(decoded[0]).toBe(orderId);
  });

  test('approve handles various amounts', () => {
    const iface = new ethers.Interface(ERC20_APPROVE_ABI);
    const testAmounts = [
      0n,
      1n,
      ethers.parseEther('1'),
      ethers.parseUnits('1000000', 6), // USDC
      2n ** 128n,
      2n ** 256n - 1n,
    ];
    
    for (const amount of testAmounts) {
      const encoded = iface.encodeFunctionData('approve', [ethers.ZeroAddress, amount]);
      const decoded = iface.decodeFunctionData('approve', encoded);
      expect(decoded[1]).toBe(amount);
    }
  });
});

describe('Deployed Contract Verification', () => {
  test('deployed settlers have valid addresses', () => {
    const inputCount = Object.keys(INPUT_SETTLERS).length;
    const outputCount = Object.keys(OUTPUT_SETTLERS).length;
    
    // Should have same number of input and output settlers
    expect(inputCount).toBe(outputCount);
    
    // Each address should be unique
    const inputAddrs = new Set(Object.values(INPUT_SETTLERS));
    const outputAddrs = new Set(Object.values(OUTPUT_SETTLERS));
    expect(inputAddrs.size).toBe(inputCount);
    expect(outputAddrs.size).toBe(outputCount);
  });

  test('settler chain IDs are valid EVM chain IDs', () => {
    for (const chainId of Object.keys(INPUT_SETTLERS)) {
      const id = parseInt(chainId);
      expect(id).toBeGreaterThan(0);
      // Chain ID should be reasonable (testnets can be up to ~420 million)
      expect(id).toBeLessThan(500_000_000);
    }
  });

  test('deployed addresses are not zero address', () => {
    for (const [, addr] of Object.entries(INPUT_SETTLERS)) {
      expect(addr).not.toBe('0x0000000000000000000000000000000000000000');
    }
    for (const [, addr] of Object.entries(OUTPUT_SETTLERS)) {
      expect(addr).not.toBe('0x0000000000000000000000000000000000000000');
    }
  });
});

describe('INPUT_SETTLER_ABI Coverage', () => {
  // Import the ABI
  const { INPUT_SETTLER_ABI } = require('../../src/solver/contracts');
  
  test('settle function exists with correct signature', () => {
    const iface = new ethers.Interface(INPUT_SETTLER_ABI);
    const settle = iface.getFunction('settle');
    expect(settle).toBeDefined();
    expect(settle!.inputs.length).toBe(1);
    expect(settle!.inputs[0].type).toBe('bytes32');
  });

  test('canSettle function exists with correct signature', () => {
    const iface = new ethers.Interface(INPUT_SETTLER_ABI);
    const canSettle = iface.getFunction('canSettle');
    expect(canSettle).toBeDefined();
    expect(canSettle!.inputs.length).toBe(1);
    expect(canSettle!.outputs?.length).toBe(1);
    expect(canSettle!.outputs?.[0].type).toBe('bool');
  });

  test('getOrder function returns tuple with expected fields', () => {
    const iface = new ethers.Interface(INPUT_SETTLER_ABI);
    const getOrder = iface.getFunction('getOrder');
    expect(getOrder).toBeDefined();
    expect(getOrder!.outputs?.length).toBe(1);
    expect(getOrder!.outputs?.[0].type).toBe('tuple');
  });
});

describe('ORACLE_ABI Coverage', () => {
  const { ORACLE_ABI } = require('../../src/solver/contracts');
  
  test('hasAttested function exists', () => {
    const iface = new ethers.Interface(ORACLE_ABI);
    const fn = iface.getFunction('hasAttested');
    expect(fn).toBeDefined();
    expect(fn!.inputs[0].type).toBe('bytes32');
    expect(fn!.outputs?.[0].type).toBe('bool');
  });

  test('submitAttestation function exists', () => {
    const iface = new ethers.Interface(ORACLE_ABI);
    const fn = iface.getFunction('submitAttestation');
    expect(fn).toBeDefined();
    expect(fn!.inputs.length).toBe(2);
    expect(fn!.inputs[0].type).toBe('bytes32');
    expect(fn!.inputs[1].type).toBe('bytes');
  });
});

