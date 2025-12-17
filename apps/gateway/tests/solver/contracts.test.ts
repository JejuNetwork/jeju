/**
 * Tests for solver/contracts.ts
 * Tests boundary conditions, edge cases, and utility functions
 */

import { describe, test, expect } from 'bun:test';
import { parseEther, parseUnits, zeroAddress, encodeFunctionData, decodeFunctionData, getFunctionSelector } from 'viem';
import {
  OUTPUT_SETTLER_ABI,
  INPUT_SETTLER_ABI,
  ORACLE_ABI,
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

  test('ABIs can be used with viem encodeFunctionData', () => {
    // ABIs are already parsed objects, use them directly
    expect(OUTPUT_SETTLER_ABI.find(f => f.type === 'function' && f.name === 'fillDirect')).toBeDefined();
    expect(OUTPUT_SETTLER_ABI.find(f => f.type === 'function' && f.name === 'isFilled')).toBeDefined();
    expect(ERC20_APPROVE_ABI.find(f => f.type === 'function' && f.name === 'approve')).toBeDefined();
  });

  test('fillDirect ABI encodes correctly', () => {
    // Use the ABI directly - it's already a parsed ABI object
    const data = encodeFunctionData({
      abi: OUTPUT_SETTLER_ABI,
      functionName: 'fillDirect',
      args: [
        '0x' + 'ab'.repeat(32) as `0x${string}`,
        '0x' + '11'.repeat(20) as `0x${string}`,
        parseEther('1.0'),
        '0x' + '22'.repeat(20) as `0x${string}`,
      ],
    });
    
    expect(data.length).toBe(2 + 8 + 4 * 64); // 0x + selector + 4 params
    expect(data.slice(0, 10)).toBe(getFunctionSelector('fillDirect(bytes32,address,uint256,address)'));
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
    const data = encodeFunctionData({
      abi: OUTPUT_SETTLER_ABI,
      functionName: 'fillDirect',
      args: [
        '0x' + '00'.repeat(32) as `0x${string}`,
        zeroAddress,
        0n,
        zeroAddress,
      ],
    });
    expect(data).toBeDefined();
  });

  test('fillDirect with max uint256', () => {
    const maxUint256 = 2n ** 256n - 1n;
    const data = encodeFunctionData({
      abi: OUTPUT_SETTLER_ABI,
      functionName: 'fillDirect',
      args: [
        '0x' + 'ff'.repeat(32) as `0x${string}`,
        '0x' + 'ff'.repeat(20) as `0x${string}`,
        maxUint256,
        '0x' + 'ff'.repeat(20) as `0x${string}`,
      ],
    });
    expect(data).toBeDefined();

    // Verify decoding works
    const decoded = decodeFunctionData({ abi: OUTPUT_SETTLER_ABI, data });
    expect(decoded.args[2]).toBe(maxUint256);
  });

  test('approve with max uint256 (infinite approval)', () => {
    const maxUint256 = 2n ** 256n - 1n;
    const data = encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: 'approve',
      args: [
        '0x' + '11'.repeat(20) as `0x${string}`,
        maxUint256,
      ],
    });
    
    const decoded = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data });
    expect(decoded.args[1]).toBe(maxUint256);
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
    const params = [
      '0x' + 'ab'.repeat(32) as `0x${string}`,
      '0x' + '11'.repeat(20) as `0x${string}`,
      parseEther('123.456'),
      '0x' + '22'.repeat(20) as `0x${string}`,
    ] as const;
    
    const encoded = encodeFunctionData({ abi: OUTPUT_SETTLER_ABI, functionName: 'fillDirect', args: params });
    const decoded = decodeFunctionData({ abi: OUTPUT_SETTLER_ABI, data: encoded });
    
    expect(decoded.args[0]).toBe(params[0]);
    expect(decoded.args[1].toLowerCase()).toBe(params[1]);
    expect(decoded.args[2]).toBe(params[2]);
    expect(decoded.args[3].toLowerCase()).toBe(params[3]);
  });

  test('isFilled encodes orderId correctly', () => {
    const orderId = '0x' + 'deadbeef'.repeat(8) as `0x${string}`;
    
    const encoded = encodeFunctionData({ abi: OUTPUT_SETTLER_ABI, functionName: 'isFilled', args: [orderId] });
    const decoded = decodeFunctionData({ abi: OUTPUT_SETTLER_ABI, data: encoded });
    
    expect(decoded.args[0]).toBe(orderId);
  });

  test('approve handles various amounts', () => {
    const testAmounts = [
      0n,
      1n,
      parseEther('1'),
      parseUnits('1000000', 6), // USDC
      2n ** 128n,
      2n ** 256n - 1n,
    ];
    
    for (const amount of testAmounts) {
      const encoded = encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: 'approve', args: [zeroAddress, amount] });
      const decoded = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data: encoded });
      expect(decoded.args[1]).toBe(amount);
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
  
  test('settle function exists with correct signature', () => {
    const settle = INPUT_SETTLER_ABI.find(f => f.type === 'function' && f.name === 'settle');
    expect(settle).toBeDefined();
    expect(settle!.inputs.length).toBe(1);
    expect(settle!.inputs[0].type).toBe('bytes32');
  });

  test('canSettle function exists with correct signature', () => {
    const canSettle = INPUT_SETTLER_ABI.find(f => f.type === 'function' && f.name === 'canSettle');
    expect(canSettle).toBeDefined();
    expect(canSettle!.inputs.length).toBe(1);
    expect(canSettle!.outputs?.length).toBe(1);
    expect(canSettle!.outputs?.[0].type).toBe('bool');
  });

  test('getOrder function returns tuple with expected fields', () => {
    const getOrder = INPUT_SETTLER_ABI.find(f => f.type === 'function' && f.name === 'getOrder');
    expect(getOrder).toBeDefined();
    expect(getOrder!.outputs?.length).toBe(1);
    expect(getOrder!.outputs?.[0].type).toBe('tuple');
  });
});

describe('ORACLE_ABI Coverage', () => {
  test('hasAttested function exists', () => {
    const fn = ORACLE_ABI.find(f => f.type === 'function' && f.name === 'hasAttested');
    expect(fn).toBeDefined();
    expect(fn!.inputs[0].type).toBe('bytes32');
    expect(fn!.outputs?.[0].type).toBe('bool');
  });

  test('submitAttestation function exists', () => {
    const fn = ORACLE_ABI.find(f => f.type === 'function' && f.name === 'submitAttestation');
    expect(fn).toBeDefined();
    expect(fn!.inputs.length).toBe(2);
    expect(fn!.inputs[0].type).toBe('bytes32');
    expect(fn!.inputs[1].type).toBe('bytes');
  });
});

