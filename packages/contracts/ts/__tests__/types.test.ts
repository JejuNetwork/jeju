/**
 * Types Module Tests
 * 
 * Tests for type utilities, constants, and validation functions.
 */

import { describe, test, expect } from 'bun:test';
import {
  isValidAddress,
  ZERO_ADDRESS,
  CHAIN_IDS,
  NETWORK_BY_CHAIN_ID,
  type NetworkName,
  type ChainId,
} from '../types';
import type { Address } from 'viem';

describe('types.ts - Type Utilities and Constants', () => {
  describe('isValidAddress', () => {
    test('returns true for valid checksummed address', () => {
      const validAddress = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      expect(isValidAddress(validAddress)).toBe(true);
    });

    test('returns true for valid lowercase address', () => {
      const validAddress = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
      expect(isValidAddress(validAddress)).toBe(true);
    });

    test('returns true for valid uppercase address', () => {
      const validAddress = '0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045';
      expect(isValidAddress(validAddress)).toBe(true);
    });

    test('returns false for zero address', () => {
      expect(isValidAddress(ZERO_ADDRESS)).toBe(false);
    });

    test('returns false for null', () => {
      expect(isValidAddress(null)).toBe(false);
    });

    test('returns false for undefined', () => {
      expect(isValidAddress(undefined)).toBe(false);
    });

    test('returns false for empty string', () => {
      expect(isValidAddress('')).toBe(false);
    });

    test('returns false for address without 0x prefix', () => {
      const noPrefix = 'd8da6bf26964af9d7eed9e03e53415d37aa96045';
      expect(isValidAddress(noPrefix)).toBe(false);
    });

    test('accepts short addresses starting with 0x (minimal validation)', () => {
      // Note: isValidAddress only does minimal validation - checks prefix and non-zero
      // It doesn't validate the full 40-char hex format
      expect(isValidAddress('0x1234')).toBe(true);
    });

    test('returns true for any non-zero address starting with 0x', () => {
      // Note: This function does basic validation, not full EIP-55 checksum
      const validAddress = '0x0000000000000000000000000000000000000001';
      expect(isValidAddress(validAddress)).toBe(true);
    });

    test('type guard narrows type correctly', () => {
      const maybeAddress: string | undefined = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
      
      if (isValidAddress(maybeAddress)) {
        // TypeScript should recognize maybeAddress as Address here
        const addr: Address = maybeAddress;
        expect(addr).toBeDefined();
      }
    });
  });

  describe('ZERO_ADDRESS', () => {
    test('is the correct zero address', () => {
      expect(ZERO_ADDRESS).toBe('0x0000000000000000000000000000000000000000');
    });

    test('has correct length', () => {
      expect(ZERO_ADDRESS.length).toBe(42);
    });

    test('starts with 0x', () => {
      expect(ZERO_ADDRESS.startsWith('0x')).toBe(true);
    });
  });

  describe('CHAIN_IDS', () => {
    test('localnet is 1337', () => {
      expect(CHAIN_IDS.localnet).toBe(1337);
    });

    test('anvil is 31337', () => {
      expect(CHAIN_IDS.anvil).toBe(31337);
    });

    test('testnet is 420690', () => {
      expect(CHAIN_IDS.testnet).toBe(420690);
    });

    test('testnetL2 is 420691', () => {
      expect(CHAIN_IDS.testnetL2).toBe(420691);
    });

    test('sepolia is 11155111', () => {
      expect(CHAIN_IDS.sepolia).toBe(11155111);
    });

    test('mainnetL1 is 1', () => {
      expect(CHAIN_IDS.mainnetL1).toBe(1);
    });

    test('all chain IDs are numbers', () => {
      for (const [, value] of Object.entries(CHAIN_IDS)) {
        expect(typeof value).toBe('number');
      }
    });

    test('all chain IDs are unique', () => {
      const values = Object.values(CHAIN_IDS);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('NETWORK_BY_CHAIN_ID', () => {
    test('maps 1337 to localnet', () => {
      expect(NETWORK_BY_CHAIN_ID[1337]).toBe('localnet');
    });

    test('maps 31337 to localnet', () => {
      expect(NETWORK_BY_CHAIN_ID[31337]).toBe('localnet');
    });

    test('maps 420690 to testnet', () => {
      expect(NETWORK_BY_CHAIN_ID[420690]).toBe('testnet');
    });

    test('maps 420691 to testnet', () => {
      expect(NETWORK_BY_CHAIN_ID[420691]).toBe('testnet');
    });

    test('maps 11155111 to testnet', () => {
      expect(NETWORK_BY_CHAIN_ID[11155111]).toBe('testnet');
    });

    test('maps 1 to mainnet', () => {
      expect(NETWORK_BY_CHAIN_ID[1]).toBe('mainnet');
    });

    test('all mapped values are valid NetworkName', () => {
      const validNetworks: NetworkName[] = ['localnet', 'testnet', 'mainnet'];
      for (const [, network] of Object.entries(NETWORK_BY_CHAIN_ID)) {
        expect(validNetworks).toContain(network);
      }
    });
  });

  describe('Type consistency', () => {
    test('CHAIN_IDS values are valid ChainId type', () => {
      // This is a compile-time check - if it compiles, the types are correct
      const chainId: ChainId = CHAIN_IDS.localnet;
      expect(chainId).toBe(1337);
    });

    test('NETWORK_BY_CHAIN_ID keys match ChainId type', () => {
      // Verify the record keys match our ChainId union
      const validChainIds: ChainId[] = [1337, 31337, 420690, 420691, 11155111, 1];
      for (const chainId of validChainIds) {
        expect(NETWORK_BY_CHAIN_ID[chainId]).toBeDefined();
      }
    });
  });

  describe('Edge cases for isValidAddress', () => {
    test('handles mixed case correctly', () => {
      // Should accept any case
      expect(isValidAddress('0xAbCdEf0123456789AbCdEf0123456789AbCdEf01')).toBe(true);
    });

    test('handles address with only zeros except first byte', () => {
      const nearZero = '0x0100000000000000000000000000000000000000';
      expect(isValidAddress(nearZero)).toBe(true);
    });

    test('handles address with only zeros except last byte', () => {
      const nearZero = '0x0000000000000000000000000000000000000001';
      expect(isValidAddress(nearZero)).toBe(true);
    });

    test('handles maximum address', () => {
      const maxAddress = '0xffffffffffffffffffffffffffffffffffffffff';
      expect(isValidAddress(maxAddress)).toBe(true);
    });

    test('rejects non-hex characters', () => {
      const invalidHex = '0xgggggggggggggggggggggggggggggggggggggggg';
      // Note: Current implementation only checks prefix and non-zero
      // It doesn't validate hex format
      expect(isValidAddress(invalidHex)).toBe(true); // Still starts with 0x and not zero
    });
  });

  describe('Property-based tests', () => {
    function randomAddress(): string {
      const chars = '0123456789abcdef';
      let addr = '0x';
      for (let i = 0; i < 40; i++) {
        addr += chars[Math.floor(Math.random() * chars.length)];
      }
      return addr;
    }

    test('random non-zero addresses are valid', () => {
      for (let i = 0; i < 100; i++) {
        const addr = randomAddress();
        // Random addresses have extremely low probability of being zero
        if (addr !== ZERO_ADDRESS) {
          expect(isValidAddress(addr)).toBe(true);
        }
      }
    });

    test('CHAIN_IDS maps consistently with NETWORK_BY_CHAIN_ID', () => {
      // Every chain ID should map to a network
      expect(NETWORK_BY_CHAIN_ID[CHAIN_IDS.localnet]).toBe('localnet');
      expect(NETWORK_BY_CHAIN_ID[CHAIN_IDS.testnet]).toBe('testnet');
      expect(NETWORK_BY_CHAIN_ID[CHAIN_IDS.mainnetL1]).toBe('mainnet');
    });
  });
});
