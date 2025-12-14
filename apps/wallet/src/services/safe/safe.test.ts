/**
 * Safe (Gnosis) Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SafeService } from './index';

// Mock RPC service
vi.mock('../rpc', () => ({
  rpcService: {
    getClient: () => ({
      readContract: ({ functionName }: { functionName: string }) => {
        switch (functionName) {
          case 'getOwners':
            return Promise.resolve([
              '0x1111111111111111111111111111111111111111',
              '0x2222222222222222222222222222222222222222',
            ]);
          case 'getThreshold':
            return Promise.resolve(2n);
          case 'nonce':
            return Promise.resolve(5n);
          case 'VERSION':
            return Promise.resolve('1.3.0');
          case 'getModulesPaginated':
            return Promise.resolve([[], '0x0000000000000000000000000000000000000001']);
          default:
            return Promise.resolve(null);
        }
      },
    }),
  },
  SUPPORTED_CHAINS: { 1: {}, 8453: {} },
}));

describe('SafeService', () => {
  let safeService: SafeService;

  beforeEach(() => {
    safeService = new SafeService();
  });

  describe('getSafeInfo', () => {
    it('should fetch Safe info from chain', async () => {
      const info = await safeService.getSafeInfo(
        1 as never,
        '0xsafe1234567890abcdef1234567890abcdef1234'
      );

      expect(info.owners).toHaveLength(2);
      expect(info.threshold).toBe(2);
      expect(info.nonce).toBe(5);
      expect(info.version).toBe('1.3.0');
    });
  });

  describe('createEthTransfer', () => {
    it('should create ETH transfer transaction', () => {
      const tx = safeService.createEthTransfer(
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // Valid address (vitalik.eth)
        1000000000000000000n // 1 ETH
      );

      expect(tx.to).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
      expect(tx.value).toBe(1000000000000000000n);
      expect(tx.data).toBe('0x');
      expect(tx.operation).toBe(0);
    });
  });

  describe('createTokenTransfer', () => {
    it('should create token transfer transaction', () => {
      const tx = safeService.createTokenTransfer(
        '0x6B175474E89094C44Da98b954EedeCD1F9C2C94F', // DAI token
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', // vitalik.eth
        1000000n
      );

      expect(tx.to).toBe('0x6B175474E89094C44Da98b954EedeCD1F9C2C94F'); // DAI
      expect(tx.value).toBe(0n);
      expect(tx.data.startsWith('0xa9059cbb')).toBe(true); // transfer selector
    });
  });

  describe('buildSignatures', () => {
    it('should pack signatures sorted by owner', () => {
      const confirmations = [
        {
          owner: '0x2222222222222222222222222222222222222222' as `0x${string}`,
          signature: '0xsig2' as `0x${string}`,
          submissionDate: '2024-01-01',
        },
        {
          owner: '0x1111111111111111111111111111111111111111' as `0x${string}`,
          signature: '0xsig1' as `0x${string}`,
          submissionDate: '2024-01-01',
        },
      ];

      const packed = safeService.buildSignatures(confirmations);

      // Should be sorted by owner address
      expect(packed.startsWith('0x')).toBe(true);
      expect(packed.includes('sig1')).toBe(true);
      expect(packed.includes('sig2')).toBe(true);
      // sig1 should come before sig2 (0x1111... < 0x2222...)
      expect(packed.indexOf('sig1')).toBeLessThan(packed.indexOf('sig2'));
    });
  });
});
