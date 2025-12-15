/**
 * Custom RPC Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CustomRPCService } from './index';

// Mock storage
vi.mock('../../platform/storage', () => ({
  storage: {
    get: vi.fn(() => Promise.resolve(null)),
    set: vi.fn(() => Promise.resolve(undefined)),
    remove: vi.fn(() => Promise.resolve(undefined)),
  },
}));

// Mock fetch for RPC testing - handles different chain IDs
const mockFetch = vi.fn((url: string) => {
  let chainIdResult = '0x1'; // Default to mainnet
  
  if (url.includes('base')) chainIdResult = '0x2105'; // Base (8453)
  if (url.includes('mychain') || url.includes('chain1')) chainIdResult = '0x3039'; // 12345
  if (url.includes('duplicate')) chainIdResult = '0x3039';
  
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ result: chainIdResult }),
  });
});
globalThis.fetch = mockFetch as unknown as typeof fetch;

describe('CustomRPCService', () => {
  let customRPCService: CustomRPCService;

  beforeEach(async () => {
    customRPCService = new CustomRPCService();
    await customRPCService.initialize();
  });

  describe('addCustomRPC', () => {
    it('should add a custom RPC', async () => {
      const rpc = await customRPCService.addCustomRPC({
        chainId: 1,
        name: 'My Ethereum RPC',
        url: 'https://my-eth-rpc.example.com',
      });

      expect(rpc.name).toBe('My Ethereum RPC');
      expect(rpc.url).toBe('https://my-eth-rpc.example.com');
      expect(rpc.chainId).toBe(1);
      expect(rpc.isHealthy).toBe(true);
    });

    it('should reject invalid URLs', async () => {
      await expect(
        customRPCService.addCustomRPC({
          chainId: 1,
          name: 'Invalid',
          url: 'not-a-url',
        })
      ).rejects.toThrow('Invalid RPC URL');
    });
  });

  describe('getCustomRPCs', () => {
    it('should return all RPCs', async () => {
      await customRPCService.addCustomRPC({
        chainId: 1,
        name: 'RPC 1',
        url: 'https://eth-rpc.example.com',
      });
      await customRPCService.addCustomRPC({
        chainId: 8453,
        name: 'RPC 2',
        url: 'https://base-rpc.example.com',
      });

      const rpcs = customRPCService.getCustomRPCs();
      expect(rpcs).toHaveLength(2);
    });

    it('should filter by chain ID', async () => {
      await customRPCService.addCustomRPC({
        chainId: 1,
        name: 'Eth RPC',
        url: 'https://eth.example.com',
      });
      await customRPCService.addCustomRPC({
        chainId: 8453,
        name: 'Base RPC',
        url: 'https://base.example.com',
      });

      const ethRpcs = customRPCService.getCustomRPCs(1);
      expect(ethRpcs).toHaveLength(1);
      expect(ethRpcs[0].name).toBe('Eth RPC');
    });
  });

  describe('updateCustomRPC', () => {
    it('should update RPC name', async () => {
      const rpc = await customRPCService.addCustomRPC({
        chainId: 1,
        name: 'Old Name',
        url: 'https://rpc.example.com',
      });

      const updated = await customRPCService.updateCustomRPC(rpc.id, {
        name: 'New Name',
      });

      expect(updated.name).toBe('New Name');
    });

    it('should throw for non-existent RPC', async () => {
      await expect(
        customRPCService.updateCustomRPC('invalid-id', { name: 'Test' })
      ).rejects.toThrow('RPC not found');
    });
  });

  describe('deleteCustomRPC', () => {
    it('should remove RPC', async () => {
      const rpc = await customRPCService.addCustomRPC({
        chainId: 1,
        name: 'To Delete',
        url: 'https://rpc.example.com',
      });

      await customRPCService.deleteCustomRPC(rpc.id);

      const rpcs = customRPCService.getCustomRPCs();
      expect(rpcs).toHaveLength(0);
    });
  });

  describe('setPreferredRPC', () => {
    it('should set preferred RPC for chain', async () => {
      const rpc = await customRPCService.addCustomRPC({
        chainId: 1,
        name: 'Preferred',
        url: 'https://preferred.example.com',
      });

      await customRPCService.setPreferredRPC(1, rpc.id);

      const preferredUrl = customRPCService.getPreferredRPCUrl(1);
      expect(preferredUrl).toBe('https://preferred.example.com');
    });

    it('should clear preference with null', async () => {
      const rpc = await customRPCService.addCustomRPC({
        chainId: 1,
        name: 'Preferred',
        url: 'https://preferred.example.com',
      });

      await customRPCService.setPreferredRPC(1, rpc.id);
      await customRPCService.setPreferredRPC(1, null);

      const preferredUrl = customRPCService.getPreferredRPCUrl(1);
      expect(preferredUrl).toBeNull();
    });
  });

  describe('testRPC', () => {
    it('should test RPC health', async () => {
      const isHealthy = await customRPCService.testRPC('https://rpc.example.com');
      expect(isHealthy).toBe(true);
    });

    it('should verify chain ID if provided', async () => {
      const isHealthy = await customRPCService.testRPC('https://rpc.example.com', 1);
      expect(isHealthy).toBe(true);
    });
  });

  describe('addCustomChain', () => {
    it('should add custom chain with RPC', async () => {
      const chain = await customRPCService.addCustomChain({
        chainId: 12345,
        name: 'My Chain',
        nativeCurrency: {
          name: 'My Token',
          symbol: 'MYT',
          decimals: 18,
        },
        rpcUrl: 'https://mychain.example.com',
      });

      expect(chain.id).toBe(12345);
      expect(chain.name).toBe('My Chain');
      expect(chain.nativeCurrency.symbol).toBe('MYT');
    });

    it('should reject duplicate chain IDs', async () => {
      await customRPCService.addCustomChain({
        chainId: 12345,
        name: 'My Chain',
        nativeCurrency: { name: 'MYT', symbol: 'MYT', decimals: 18 },
        rpcUrl: 'https://mychain.example.com',
      });

      await expect(
        customRPCService.addCustomChain({
          chainId: 12345,
          name: 'Duplicate',
          nativeCurrency: { name: 'DUP', symbol: 'DUP', decimals: 18 },
          rpcUrl: 'https://duplicate.example.com',
        })
      ).rejects.toThrow('already exists');
    });
  });

  describe('getCustomChains', () => {
    it('should return all custom chains', async () => {
      await customRPCService.addCustomChain({
        chainId: 12345,
        name: 'Chain 1',
        nativeCurrency: { name: 'T1', symbol: 'T1', decimals: 18 },
        rpcUrl: 'https://chain1.example.com',
      });

      const chains = customRPCService.getCustomChains();
      expect(chains).toHaveLength(1);
    });
  });
});

