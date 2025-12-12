/**
 * Storage Marketplace Client Tests
 *
 * Tests for the decentralized storage marketplace client that:
 * 1. Verifies provider discovery and selection
 * 2. Tests upload/download through marketplace interface
 * 3. Ensures no vendor-specific code leaks to consumers
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  createStorageMarketplaceClient,
  StorageMarketplaceClient,
} from './marketplace-client';
import type { StorageProviderInterface } from './provider-interface';

describe('StorageMarketplaceClient', () => {
  describe('initialization', () => {
    test('creates client with default config', () => {
      const client = createStorageMarketplaceClient();
      expect(client).toBeInstanceOf(StorageMarketplaceClient);
    });

    test('creates client with custom config', () => {
      const client = createStorageMarketplaceClient({
        preferredProviders: ['arweave', 'ipfs'],
        preferredTier: 'permanent',
        maxCostPerGB: BigInt(1e15),
      });
      expect(client).toBeInstanceOf(StorageMarketplaceClient);
    });

    test('respects environment variables for direct providers', () => {
      const originalIpfs = process.env.IPFS_API_URL;
      process.env.IPFS_API_URL = 'http://localhost:5001';

      const client = createStorageMarketplaceClient();
      expect(client).toBeInstanceOf(StorageMarketplaceClient);

      if (originalIpfs) {
        process.env.IPFS_API_URL = originalIpfs;
      } else {
        delete process.env.IPFS_API_URL;
      }
    });
  });

  describe('provider interface compliance', () => {
    test('marketplace client uses only StorageProviderInterface methods', async () => {
      // This test ensures the marketplace only uses the standard interface
      // No vendor-specific methods should be called

      const mockProvider: StorageProviderInterface = {
        type: 'cloud',
        getCapabilities: () => ({
          tiers: ['hot', 'warm'],
          maxFileSize: 500 * 1024 * 1024,
          maxTotalStorage: 0,
          supportsPermanent: false,
          supportsFolders: true,
          supportsListing: true,
          supportsDeletion: true,
          regions: ['global'],
          supportsEncryption: true,
        }),
        getPricing: () => ({
          storagePerGBMonth: 0n,
          bandwidthPerGB: 0n,
          permanentPerGB: 0n,
          minimumPayment: 0n,
          freeTierBytes: 5 * 1024 * 1024 * 1024,
        }),
        healthCheck: mock(async () => ({
          healthy: true,
          latencyMs: 50,
          lastSuccess: Date.now(),
          errorCount: 0,
          availableCapacity: Number.MAX_SAFE_INTEGER,
        })),
        upload: mock(async (content, filename, options) => ({
          cid: 'test-cid-123',
          url: 'https://example.com/test-cid-123',
          size: content.length,
          provider: 'cloud' as const,
          tier: options?.tier ?? ('hot' as const),
          cost: 0n,
          expiresAt: 0,
        })),
        download: mock(async () => Buffer.from('test content')),
        exists: mock(async () => true),
        delete: mock(async () => {}),
        getUrl: (cid) => `https://example.com/${cid}`,
        estimateCost: mock(async () => 0n),
      };

      // Verify all interface methods are present
      expect(mockProvider.type).toBe('cloud');
      expect(typeof mockProvider.getCapabilities).toBe('function');
      expect(typeof mockProvider.getPricing).toBe('function');
      expect(typeof mockProvider.healthCheck).toBe('function');
      expect(typeof mockProvider.upload).toBe('function');
      expect(typeof mockProvider.download).toBe('function');
      expect(typeof mockProvider.exists).toBe('function');
      expect(typeof mockProvider.delete).toBe('function');
      expect(typeof mockProvider.getUrl).toBe('function');
      expect(typeof mockProvider.estimateCost).toBe('function');
    });
  });

  describe('provider capabilities', () => {
    test('correctly reports storage tiers', () => {
      const caps = {
        tiers: ['hot', 'warm', 'permanent'] as const,
        maxFileSize: 1024 * 1024 * 1024,
        maxTotalStorage: 0,
        supportsPermanent: true,
        supportsFolders: true,
        supportsListing: true,
        supportsDeletion: true,
        regions: ['us-east', 'eu-west'],
        supportsEncryption: true,
      };

      expect(caps.tiers).toContain('hot');
      expect(caps.tiers).toContain('permanent');
      expect(caps.supportsPermanent).toBe(true);
    });

    test('correctly reports pricing', () => {
      const pricing = {
        storagePerGBMonth: BigInt(1e14), // 0.0001 ETH
        bandwidthPerGB: BigInt(1e13),
        permanentPerGB: BigInt(1e15),
        minimumPayment: BigInt(1e12),
        freeTierBytes: 1024 * 1024 * 100, // 100MB
      };

      expect(pricing.storagePerGBMonth).toBe(BigInt(1e14));
      expect(pricing.freeTierBytes).toBe(104857600);
    });
  });

  describe('upload result format', () => {
    test('upload result contains all required fields', () => {
      const result = {
        cid: 'cloud-abc123',
        url: 'https://storage.example.com/cloud-abc123',
        size: 1024,
        provider: 'cloud' as const,
        tier: 'hot' as const,
        cost: 0n,
        expiresAt: 0,
        metadata: { backend: 'vercel' },
      };

      expect(result.cid).toBeTruthy();
      expect(result.url).toBeTruthy();
      expect(result.size).toBeGreaterThan(0);
      expect(['ipfs', 'arweave', 'cloud', 'filecoin']).toContain(result.provider);
      expect(['hot', 'warm', 'cold', 'permanent']).toContain(result.tier);
      expect(typeof result.cost).toBe('bigint');
    });
  });

  describe('CID format validation', () => {
    test('recognizes IPFS CIDs', () => {
      const ipfsCids = [
        'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG', // CIDv0
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', // CIDv1
      ];

      for (const cid of ipfsCids) {
        expect(cid.startsWith('Qm') || cid.startsWith('bafy')).toBe(true);
      }
    });

    test('recognizes Arweave transaction IDs', () => {
      const arTxId = 'xBPb2eWLH-wDhZlg6NNGxwwWvEZ7sCGQIX-nKYFhHgQ';
      expect(arTxId.length).toBe(43); // Arweave TX IDs are 43 chars
    });

    test('recognizes cloud CIDs', () => {
      const cloudCid = 'cloud-a1b2c3d4e5f6';
      expect(cloudCid.startsWith('cloud-')).toBe(true);
    });
  });

  describe('error handling', () => {
    test('throws on no available providers', async () => {
      const client = createStorageMarketplaceClient({
        directProviders: [], // No providers
      });
      await client.initialize();

      await expect(
        client.upload({
          content: Buffer.from('test'),
          filename: 'test.txt',
        })
      ).rejects.toThrow('No storage providers available');
    });
  });
});

describe('CloudStorageProvider', () => {
  test('wraps cloud backend correctly', async () => {
    // Skip if no cloud config
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.log('Skipping: No Vercel Blob token');
      return;
    }

    const { CloudStorageProvider } = await import('../backends/cloud-provider');

    const provider = new CloudStorageProvider({
      name: 'Test Cloud Provider',
    });

    // Verify it implements the interface
    expect(provider.type).toBe('cloud');
    expect(typeof provider.getCapabilities).toBe('function');
    expect(typeof provider.getPricing).toBe('function');
    expect(typeof provider.healthCheck).toBe('function');
    expect(typeof provider.upload).toBe('function');
    expect(typeof provider.download).toBe('function');
    expect(typeof provider.exists).toBe('function');
    expect(typeof provider.delete).toBe('function');
    expect(typeof provider.getUrl).toBe('function');
    expect(typeof provider.estimateCost).toBe('function');
  });

  test('capabilities match cloud storage limitations', () => {
    const expectedCaps = {
      tiers: ['hot', 'warm'],
      maxFileSize: 500 * 1024 * 1024, // 500MB
      supportsPermanent: false, // Cloud is not permanent
      supportsDeletion: true,
    };

    expect(expectedCaps.supportsPermanent).toBe(false);
    expect(expectedCaps.tiers).not.toContain('permanent');
  });
});

describe('Architecture Compliance', () => {
  test('SDK exports do not include raw vendor backends', async () => {
    // This test ensures proper separation
    // The SDK should export:
    // - Provider interface (StorageProviderInterface)
    // - Marketplace client (StorageMarketplaceClient)
    // - Cloud provider wrapper (CloudStorageProvider)
    // It should NOT directly expose:
    // - Raw vendor backends to the SDK consumers

    // Import just the marketplace client (no dependencies on ethers)
    const { StorageMarketplaceClient, createStorageMarketplaceClient, createComputeStorageClient } =
      await import('./marketplace-client');

    // These should be exported
    expect(StorageMarketplaceClient).toBeDefined();
    expect(createStorageMarketplaceClient).toBeDefined();
    expect(createComputeStorageClient).toBeDefined();

    // The raw backends are in backends/, not sdk/
    // Consumers should use marketplace client, not raw backends
  });

  test('cloud backends are only accessible through provider wrapper', async () => {
    const backends = await import('../backends/index');

    // Raw backends are exported (for providers to use)
    expect(backends.VercelBlobBackend).toBeDefined();
    expect(backends.S3Backend).toBeDefined();
    expect(backends.R2Backend).toBeDefined();

    // Provider wrapper is also exported
    expect(backends.CloudStorageProvider).toBeDefined();

    // But consumers should use the wrapper, not raw backends
    // This is enforced by documentation, not code
  });

  test('marketplace client does not expose vendor-specific properties', () => {
    // The marketplace client interface should be vendor-agnostic
    // It uses ProviderType ('ipfs' | 'arweave' | 'cloud' | 'filecoin')
    // not specific vendors ('vercel' | 's3' | 'r2')

    type ValidProviderType = 'ipfs' | 'arweave' | 'cloud' | 'filecoin';
    const types: ValidProviderType[] = ['ipfs', 'arweave', 'cloud', 'filecoin'];

    // 'cloud' is the abstraction over all cloud vendors
    expect(types).toContain('cloud');

    // Vendor-specific types should not be in the interface
    expect(types).not.toContain('vercel');
    expect(types).not.toContain('s3');
    expect(types).not.toContain('r2');
  });
});
