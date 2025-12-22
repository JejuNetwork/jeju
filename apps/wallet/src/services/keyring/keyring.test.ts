/**
 * Keyring Service Tests
 * Comprehensive tests for HD wallet, signing, and encryption functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { KeyringService } from './index';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import type { Hex, Address } from 'viem';

// Mock localStorage for Node/Bun environment
const mockStore: Record<string, string> = {};
if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => mockStore[key] ?? null,
    setItem: (key: string, value: string) => { mockStore[key] = value; },
    removeItem: (key: string) => { delete mockStore[key]; },
    clear: () => { Object.keys(mockStore).forEach(k => delete mockStore[k]); },
  };
}

// Known test vectors for HD wallet derivation
const TEST_VECTORS = {
  // From BIP-39 test vectors
  mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  // First account at m/44'/60'/0'/0/0
  expectedAddress0: '0x9858EfFD232B4033E47d90003D41EC34EcaEda94',
  // Second account at m/44'/60'/0'/0/1 (not used but for reference)
  expectedAddress1: '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0',
};

// Foundry's first private key for deterministic testing
const FOUNDRY_PRIVATE_KEY_1 = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as Hex;
const FOUNDRY_ADDRESS_1 = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;
const FOUNDRY_PRIVATE_KEY_2 = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as Hex;
const FOUNDRY_ADDRESS_2 = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address;

describe('KeyringService', () => {
  let service: KeyringService;

  beforeEach(() => {
    // Clear mock localStorage
    Object.keys(mockStore).forEach(k => delete mockStore[k]);
    service = new KeyringService();
  });

  afterEach(() => {
    service.lock();
  });

  describe('lock state', () => {
    it('should start locked', () => {
      expect(service.isUnlocked()).toBe(false);
    });

    it('should unlock with valid password', async () => {
      const password = 'testpassword123';
      const result = await service.unlock(password);
      expect(result).toBe(true);
      expect(service.isUnlocked()).toBe(true);
    });

    it('should throw when unlocking with empty password', async () => {
      await expect(service.unlock('')).rejects.toThrow('Password is required');
    });

    it('should lock and clear session', async () => {
      await service.unlock('password123');
      expect(service.isUnlocked()).toBe(true);
      
      service.lock();
      expect(service.isUnlocked()).toBe(false);
    });
  });

  describe('HD Wallet Creation', () => {
    it('should generate valid 12-word mnemonic', async () => {
      const password = 'testpassword123';
      const { mnemonic, address } = await service.createHDWallet(password);
      
      // Verify mnemonic format
      const words = mnemonic.split(' ');
      expect(words.length).toBe(12);
      
      // Verify mnemonic is valid BIP-39
      expect(validateMnemonic(mnemonic, wordlist)).toBe(true);
      
      // Verify address format
      expect(address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should create account marked as HD type', async () => {
      const password = 'testpassword123';
      const { address } = await service.createHDWallet(password);
      
      const account = service.getAccount(address);
      expect(account).toBeDefined();
      expect(account?.type).toBe('hd');
      expect(account?.name).toBe('Account 1');
    });

    it('should store HD path and index', async () => {
      const password = 'testpassword123';
      const { address } = await service.createHDWallet(password);
      
      const account = service.getAccount(address);
      expect(account?.hdPath).toBe("m/44'/60'/0'/0");
      expect(account?.index).toBe(0);
    });

    it('should generate different addresses for different mnemonics', async () => {
      const password = 'testpassword123';
      
      const { address: address1 } = await service.createHDWallet(password);
      
      // Create new service for second wallet
      const service2 = new KeyringService();
      const { address: address2 } = await service2.createHDWallet(password);
      
      expect(address1.toLowerCase()).not.toBe(address2.toLowerCase());
    });
  });

  describe('Mnemonic Import', () => {
    it('should derive correct address from known mnemonic', async () => {
      const password = 'testpassword123';
      const address = await service.importMnemonic(TEST_VECTORS.mnemonic, password);
      
      // The expected address from the test mnemonic at m/44'/60'/0'/0/0
      expect(address.toLowerCase()).toBe(TEST_VECTORS.expectedAddress0.toLowerCase());
    });

    it('should reject invalid mnemonic', async () => {
      const invalidMnemonic = 'invalid words that are not a valid mnemonic phrase at all';
      const password = 'testpassword123';
      
      await expect(service.importMnemonic(invalidMnemonic, password))
        .rejects.toThrow('Invalid mnemonic phrase');
    });

    it('should reject mnemonic with wrong word count', async () => {
      const shortMnemonic = 'abandon abandon abandon';
      const password = 'testpassword123';
      
      await expect(service.importMnemonic(shortMnemonic, password))
        .rejects.toThrow('Invalid mnemonic phrase');
    });

    it('should prevent duplicate mnemonic import', async () => {
      const password = 'testpassword123';
      
      await service.importMnemonic(TEST_VECTORS.mnemonic, password);
      
      await expect(service.importMnemonic(TEST_VECTORS.mnemonic, password))
        .rejects.toThrow('Account already exists');
    });
  });

  describe('Private Key Import', () => {
    it('should import valid private key and derive correct address', async () => {
      const address = await service.importPrivateKey(FOUNDRY_PRIVATE_KEY_1, 'password');
      expect(address.toLowerCase()).toBe(FOUNDRY_ADDRESS_1.toLowerCase());
    });

    it('should derive correct address from second test key', async () => {
      const address = await service.importPrivateKey(FOUNDRY_PRIVATE_KEY_2, 'password');
      expect(address.toLowerCase()).toBe(FOUNDRY_ADDRESS_2.toLowerCase());
    });

    it('should mark account as imported type', async () => {
      const address = await service.importPrivateKey(FOUNDRY_PRIVATE_KEY_1, 'password');
      const account = service.getAccount(address);
      expect(account?.type).toBe('imported');
    });

    it('should prevent duplicate private key import', async () => {
      await service.importPrivateKey(FOUNDRY_PRIVATE_KEY_1, 'password');
      
      await expect(service.importPrivateKey(FOUNDRY_PRIVATE_KEY_1, 'password'))
        .rejects.toThrow('Account already exists');
    });
  });

  describe('Private Key Export', () => {
    it('should export imported private key correctly', async () => {
      const password = 'testpassword123';
      const address = await service.importPrivateKey(FOUNDRY_PRIVATE_KEY_1, password);
      
      const exportedKey = await service.exportPrivateKey(address, password);
      expect(exportedKey.toLowerCase()).toBe(FOUNDRY_PRIVATE_KEY_1.toLowerCase());
    });

    it('should export HD wallet private key correctly', async () => {
      const password = 'testpassword123';
      const address = await service.importMnemonic(TEST_VECTORS.mnemonic, password);
      
      const exportedKey = await service.exportPrivateKey(address, password);
      
      // Verify exported key is valid hex
      expect(exportedKey).toMatch(/^0x[a-fA-F0-9]{64}$/);
      
      // Re-import should give same address
      const service2 = new KeyringService();
      const reimportedAddress = await service2.importPrivateKey(exportedKey, password);
      expect(reimportedAddress.toLowerCase()).toBe(address.toLowerCase());
    });

    it('should throw for watch-only account export', async () => {
      const watchAddress = '0x1234567890123456789012345678901234567890' as Address;
      service.addWatchAddress(watchAddress, 'Watch');
      
      await expect(service.exportPrivateKey(watchAddress, 'password'))
        .rejects.toThrow('Cannot export key for this account type');
    });

    it('should throw for non-existent account', async () => {
      const nonExistent = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as Address;
      
      await expect(service.exportPrivateKey(nonExistent, 'password'))
        .rejects.toThrow('Account not found');
    });
  });

  describe('Message Signing', () => {
    it('should sign message with imported key', async () => {
      const password = 'testpassword123';
      const address = await service.importPrivateKey(FOUNDRY_PRIVATE_KEY_1, password);
      
      const message = 'Hello, World!';
      const signature = await service.signMessage(address, message, password);
      
      // Verify signature format (65 bytes = 130 hex chars + 0x prefix)
      expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/);
    });

    it('should produce deterministic signatures', async () => {
      const password = 'testpassword123';
      const address = await service.importPrivateKey(FOUNDRY_PRIVATE_KEY_1, password);
      
      const message = 'Deterministic test';
      const sig1 = await service.signMessage(address, message, password);
      const sig2 = await service.signMessage(address, message, password);
      
      expect(sig1).toBe(sig2);
    });

    it('should throw when signing with watch-only account', async () => {
      const watchAddress = '0x1234567890123456789012345678901234567890' as Address;
      service.addWatchAddress(watchAddress, 'Watch');
      
      await expect(service.signMessage(watchAddress, 'test', 'password'))
        .rejects.toThrow('Cannot sign with watch-only account');
    });

    it('should sign with HD wallet account', async () => {
      const password = 'testpassword123';
      const address = await service.importMnemonic(TEST_VECTORS.mnemonic, password);
      
      const signature = await service.signMessage(address, 'HD wallet signing', password);
      expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/);
    });
  });

  describe('Transaction Signing', () => {
    it('should sign EIP-1559 transaction', async () => {
      const password = 'testpassword123';
      const address = await service.importPrivateKey(FOUNDRY_PRIVATE_KEY_1, password);
      
      const tx = {
        to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
        value: 1000000000000000000n, // 1 ETH
        data: '0x' as Hex,
        nonce: 0,
        gas: 21000n,
        maxFeePerGas: 20000000000n,
        maxPriorityFeePerGas: 1000000000n,
        chainId: 1,
      };
      
      const signedTx = await service.signTransaction(address, tx, password);
      
      // Verify signature exists
      expect(signedTx).toMatch(/^0x/);
      expect(signedTx.length).toBeGreaterThan(100);
    });

    it('should sign legacy transaction', async () => {
      const password = 'testpassword123';
      const address = await service.importPrivateKey(FOUNDRY_PRIVATE_KEY_1, password);
      
      const tx = {
        to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
        value: 1000000000000000000n,
        data: '0x' as Hex,
        nonce: 0,
        gas: 21000n,
        gasPrice: 20000000000n,
        chainId: 1,
      };
      
      const signedTx = await service.signTransaction(address, tx, password);
      expect(signedTx).toMatch(/^0x/);
    });

    it('should throw when signing tx with watch account', async () => {
      const watchAddress = '0x1234567890123456789012345678901234567890' as Address;
      service.addWatchAddress(watchAddress, 'Watch');
      
      const tx = {
        to: FOUNDRY_ADDRESS_2,
        value: 1n,
        data: '0x' as Hex,
        nonce: 0,
        gas: 21000n,
        gasPrice: 1n,
        chainId: 1,
      };
      
      await expect(service.signTransaction(watchAddress, tx, 'password'))
        .rejects.toThrow('Cannot sign with watch-only account');
    });
  });

  describe('Typed Data Signing (EIP-712)', () => {
    it('should sign EIP-712 typed data', async () => {
      const password = 'testpassword123';
      const address = await service.importPrivateKey(FOUNDRY_PRIVATE_KEY_1, password);
      
      const domain = {
        name: 'Test App',
        version: '1',
        chainId: 1,
        verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC',
      };
      
      const types = {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
      };
      
      const message = {
        name: 'Alice',
        wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826',
      };
      
      const signature = await service.signTypedData(
        address,
        { domain, types, primaryType: 'Person', message },
        password
      );
      
      expect(signature).toMatch(/^0x[a-fA-F0-9]{130}$/);
    });
  });

  describe('Watch Address Management', () => {
    it('should add watch-only address', () => {
      const address = '0x1234567890123456789012345678901234567890' as Address;
      service.addWatchAddress(address, 'Watch Account');
      
      const account = service.getAccount(address);
      expect(account).toBeDefined();
      expect(account?.type).toBe('watch');
      expect(account?.name).toBe('Watch Account');
    });

    it('should use default name when not provided', () => {
      const address = '0x1234567890123456789012345678901234567890' as Address;
      service.addWatchAddress(address);
      
      const account = service.getAccount(address);
      expect(account?.name).toBe('Watch Account');
    });

    it('should throw for duplicate watch address', () => {
      const address = '0x1234567890123456789012345678901234567890' as Address;
      service.addWatchAddress(address);
      
      expect(() => service.addWatchAddress(address))
        .toThrow('Address already exists');
    });
  });

  describe('Account Management', () => {
    it('should return empty array when no accounts', () => {
      expect(service.getAccounts()).toEqual([]);
    });

    it('should list all accounts', async () => {
      const password = 'testpassword123';
      
      await service.importPrivateKey(FOUNDRY_PRIVATE_KEY_1, password);
      service.addWatchAddress('0x1111111111111111111111111111111111111111' as Address);
      
      const accounts = service.getAccounts();
      expect(accounts.length).toBe(2);
    });

    it('should remove account', async () => {
      const address = await service.importPrivateKey(FOUNDRY_PRIVATE_KEY_1, 'password');
      expect(service.getAccounts().length).toBe(1);
      
      service.removeAccount(address);
      expect(service.getAccounts().length).toBe(0);
    });

    it('should rename account', async () => {
      const address = await service.importPrivateKey(FOUNDRY_PRIVATE_KEY_1, 'password');
      
      service.renameAccount(address, 'My Wallet');
      
      expect(service.getAccount(address)?.name).toBe('My Wallet');
    });
  });

  describe('Encryption Security', () => {
    it('should encrypt and decrypt with correct password', async () => {
      const password = 'correctpassword';
      const address = await service.importPrivateKey(FOUNDRY_PRIVATE_KEY_1, password);
      
      // If encryption works, export should succeed with correct password
      const exportedKey = await service.exportPrivateKey(address, password);
      expect(exportedKey.toLowerCase()).toBe(FOUNDRY_PRIVATE_KEY_1.toLowerCase());
    });

    it('should fail decryption with wrong password', async () => {
      const password = 'correctpassword';
      const wrongPassword = 'wrongpassword';
      
      const address = await service.importPrivateKey(FOUNDRY_PRIVATE_KEY_1, password);
      
      // Export with wrong password should fail
      await expect(service.exportPrivateKey(address, wrongPassword))
        .rejects.toThrow();
    });
  });
});
