/**
 * Ledger Hardware Wallet Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LedgerKeyring } from './ledger';

// Mock TransportWebHID
vi.mock('@ledgerhq/hw-transport-webhid', () => ({
  default: {
    isSupported: vi.fn().mockResolvedValue(true),
    create: vi.fn().mockResolvedValue({
      close: vi.fn(),
    }),
  },
}));

// Mock LedgerEth
vi.mock('@ledgerhq/hw-app-eth', () => ({
  default: vi.fn().mockImplementation(() => ({
    getAddress: vi.fn().mockResolvedValue({
      address: '0x1234567890abcdef1234567890abcdef12345678',
      publicKey: '0xpubkey',
    }),
    signTransaction: vi.fn().mockResolvedValue({
      v: '1b',
      r: '0000000000000000000000000000000000000000000000000000000000000001',
      s: '0000000000000000000000000000000000000000000000000000000000000002',
    }),
    signPersonalMessage: vi.fn().mockResolvedValue({
      v: '1b',
      r: '0000000000000000000000000000000000000000000000000000000000000001',
      s: '0000000000000000000000000000000000000000000000000000000000000002',
    }),
  })),
}));

describe('LedgerKeyring', () => {
  let keyring: LedgerKeyring;

  beforeEach(() => {
    keyring = new LedgerKeyring();
  });

  describe('isSupported', () => {
    it('should check WebHID support', async () => {
      const supported = await keyring.isSupported();
      expect(typeof supported).toBe('boolean');
    });
  });

  describe('isUnlocked', () => {
    it('should return false when not connected', () => {
      expect(keyring.isUnlocked()).toBe(false);
    });
  });

  describe('setHdPath', () => {
    it('should set LedgerLive path type', () => {
      keyring.setHdPath('LedgerLive');
      // Path should be set internally
    });

    it('should set BIP44 path type', () => {
      keyring.setHdPath('BIP44');
    });

    it('should set Legacy path type', () => {
      keyring.setHdPath('Legacy');
    });
  });

  describe('serialization', () => {
    it('should serialize state', () => {
      const serialized = keyring.serialize();
      expect(serialized).toHaveProperty('accounts');
      expect(serialized).toHaveProperty('accountDetails');
      expect(serialized).toHaveProperty('hdPath');
      expect(serialized).toHaveProperty('hdPathType');
    });

    it('should deserialize state', () => {
      const data = {
        accounts: ['0x1234567890abcdef1234567890abcdef12345678'],
        accountDetails: {},
        hdPath: "m/44'/60'/0'",
        hdPathType: 'Legacy',
      };
      keyring.deserialize(data);
      const addresses = keyring.getAddresses();
      expect(addresses).toHaveLength(1);
    });
  });
});

