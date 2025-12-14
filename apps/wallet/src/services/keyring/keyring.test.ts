/**
 * Keyring Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { KeyringService } from './index';

// Mock localStorage for Node/Bun environment
if (typeof globalThis.localStorage === 'undefined') {
  const store: Record<string, string> = {};
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
  };
}

describe('KeyringService', () => {
  let service: KeyringService;

  beforeEach(() => {
    service = new KeyringService();
  });

  describe('lock state', () => {
    it('should start locked', () => {
      expect(service.isUnlocked()).toBe(false);
    });

    it('should lock the keyring', () => {
      service.lock();
      expect(service.isUnlocked()).toBe(false);
    });
  });

  describe('getAccounts', () => {
    it('should return empty array when no accounts', () => {
      const accounts = service.getAccounts();
      expect(accounts).toEqual([]);
    });
  });

  describe('importPrivateKey', () => {
    it('should import valid private key', async () => {
      const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      const password = 'testpassword123';
      
      const address = await service.importPrivateKey(privateKey as `0x${string}`, password);
      
      expect(address.toLowerCase()).toBe('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
      
      // Verify account was created
      const account = service.getAccount(address);
      expect(account).toBeDefined();
      expect(account?.type).toBe('imported');
    });

    it('should derive correct address from second private key', async () => {
      const privateKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
      const password = 'testpassword123';
      
      const address = await service.importPrivateKey(privateKey as `0x${string}`, password);
      
      expect(address.toLowerCase()).toBe('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
    });

    it('should throw if account already exists', async () => {
      const privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
      const password = 'testpassword123';
      
      await service.importPrivateKey(privateKey as `0x${string}`, password);
      
      await expect(
        service.importPrivateKey(privateKey as `0x${string}`, password)
      ).rejects.toThrow('Account already exists');
    });
  });

  describe('addWatchAddress', () => {
    it('should add watch-only address', () => {
      const address = '0x1234567890123456789012345678901234567890' as const;
      
      service.addWatchAddress(address, 'Watch Account');
      
      const account = service.getAccount(address);
      expect(account).toBeDefined();
      expect(account?.address.toLowerCase()).toBe(address.toLowerCase());
      expect(account?.type).toBe('watch');
      expect(account?.name).toBe('Watch Account');
    });

    it('should appear in getAccounts', () => {
      const address = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as const;
      
      service.addWatchAddress(address, 'Watch Test');
      
      const accounts = service.getAccounts();
      expect(accounts.length).toBe(1);
      expect(accounts[0].address.toLowerCase()).toBe(address.toLowerCase());
    });

    it('should throw if address already exists', () => {
      const address = '0x1234567890123456789012345678901234567890' as const;
      
      service.addWatchAddress(address, 'First');
      
      expect(() => service.addWatchAddress(address, 'Second')).toThrow('Address already exists');
    });
  });

  describe('removeAccount', () => {
    it('should remove existing account', () => {
      const address = '0x1234567890123456789012345678901234567890' as const;
      service.addWatchAddress(address, 'Test');
      
      expect(service.getAccounts().length).toBe(1);
      
      service.removeAccount(address);
      
      expect(service.getAccounts().length).toBe(0);
      expect(service.getAccount(address)).toBeUndefined();
    });

    it('should not throw for non-existent account', () => {
      const address = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as const;
      
      // Should not throw
      expect(() => service.removeAccount(address)).not.toThrow();
    });
  });

  describe('getAccount', () => {
    it('should find account by address', () => {
      const address = '0x1111111111111111111111111111111111111111' as const;
      service.addWatchAddress(address, 'Find Me');
      
      const found = service.getAccount(address);
      expect(found).toBeDefined();
      expect(found?.name).toBe('Find Me');
    });

    it('should return undefined for non-existent address', () => {
      const address = '0x2222222222222222222222222222222222222222' as const;
      const found = service.getAccount(address);
      expect(found).toBeUndefined();
    });
  });

  describe('renameAccount', () => {
    it('should rename existing account', () => {
      const address = '0x1111111111111111111111111111111111111111' as const;
      service.addWatchAddress(address, 'Original Name');
      
      service.renameAccount(address, 'New Name');
      
      const account = service.getAccount(address);
      expect(account?.name).toBe('New Name');
    });
  });
});
