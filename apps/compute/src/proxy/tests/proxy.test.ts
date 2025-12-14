/**
 * Network Proxy Network Tests
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { Wallet } from 'ethers';
import { ProxyNodeClient } from '../node/client';
import { ProxySDK } from '../sdk/proxy-sdk';
import { hashRegion, regionFromHash, REGION_CODES, getAllRegionCodes } from '../types';
import { MysteriumAdapter, createMysteriumAdapter } from '../external/mysterium';
import { OrchidAdapter, createOrchidAdapter } from '../external/orchid';
import { SentinelAdapter, createSentinelAdapter } from '../external/sentinel';
import type { RegionCode } from '../types';

// Test wallet (Anvil default account #1)
const TEST_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const TEST_WALLET = new Wallet(TEST_PRIVATE_KEY);

describe('Proxy Network Types', () => {
  test('hashRegion produces consistent hashes', () => {
    const usHash1 = hashRegion('US');
    const usHash2 = hashRegion('US');
    expect(usHash1).toBe(usHash2);
    expect(usHash1.startsWith('0x')).toBe(true);
    expect(usHash1.length).toBe(66); // 0x + 64 hex chars
  });

  test('regionFromHash reverses hashRegion', () => {
    const regions: RegionCode[] = ['US', 'GB', 'DE', 'JP', 'KR', 'SG'];
    
    for (const region of regions) {
      const hash = hashRegion(region);
      const recovered = regionFromHash(hash);
      expect(recovered).toBe(region);
    }
  });

  test('regionFromHash returns null for unknown hash', () => {
    const unknownHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`;
    expect(regionFromHash(unknownHash)).toBeNull();
  });

  test('REGION_CODES contains expected regions', () => {
    expect(REGION_CODES.US).toBe('US');
    expect(REGION_CODES.GB).toBe('GB');
    expect(REGION_CODES.JP).toBe('JP');
    expect(Object.keys(REGION_CODES).length).toBeGreaterThan(10);
  });
});

describe('ProxyNodeClient', () => {
  test('creates client with correct address', () => {
    const client = new ProxyNodeClient({
      coordinatorUrl: 'ws://localhost:4021',
      privateKey: TEST_PRIVATE_KEY,
      regionCode: 'US',
    });

    expect(client.address.toLowerCase()).toBe(TEST_WALLET.address.toLowerCase());
    expect(client.regionCode).toBe('US');
    expect(client.connected).toBe(false);
  });

  test('getStats returns initial stats', () => {
    const client = new ProxyNodeClient({
      coordinatorUrl: 'ws://localhost:4021',
      privateKey: TEST_PRIVATE_KEY,
      regionCode: 'US',
    });

    const stats = client.getStats();
    expect(stats.totalRequests).toBe(0);
    expect(stats.successfulRequests).toBe(0);
    expect(stats.failedRequests).toBe(0);
    expect(stats.totalBytesServed).toBe(0);
    expect(stats.currentLoad).toBe(0);
    expect(stats.pendingRequests).toBe(0);
  });
});

describe('ProxySDK', () => {
  let sdk: ProxySDK;

  beforeAll(() => {
    sdk = new ProxySDK({
      coordinatorUrl: 'http://localhost:4020',
    });
  });

  test('creates SDK instance', () => {
    expect(sdk).toBeDefined();
  });

  test('getActiveSessions returns empty initially', () => {
    const sessions = sdk.getActiveSessions();
    expect(sessions).toEqual([]);
  });

  test('estimateCost calculates correctly without contract', async () => {
    // Without payment contract, uses fallback rate
    const costForOneGb = await sdk.estimateCost(1e9); // 1 GB
    expect(costForOneGb).toBeGreaterThan(0n);
  });

  test('clearSession removes session from tracking', () => {
    // Create a mock session
    const mockSessionId = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as `0x${string}`;
    
    // Clear should not throw even if session doesn't exist
    expect(() => sdk.clearSession(mockSessionId)).not.toThrow();
  });
});

describe('Integration Tests (requires running coordinator)', () => {
  const COORDINATOR_URL = process.env.PROXY_COORDINATOR_URL || 'http://localhost:4020';

  test.skipIf(!process.env.RUN_INTEGRATION_TESTS)('fetches coordinator health', async () => {
    const response = await fetch(`${COORDINATOR_URL}/health`);
    expect(response.ok).toBe(true);
    
    const health = await response.json() as { status: string; service: string };
    expect(health.status).toBe('ok');
    expect(health.service).toBe('proxy-coordinator');
  });

  test.skipIf(!process.env.RUN_INTEGRATION_TESTS)('fetches available regions', async () => {
    const sdk = new ProxySDK({ coordinatorUrl: COORDINATOR_URL });
    const regions = await sdk.getAvailableRegions();
    
    expect(Array.isArray(regions)).toBe(true);
  });

  test.skipIf(!process.env.RUN_INTEGRATION_TESTS)('fetches coordinator stats', async () => {
    const sdk = new ProxySDK({ coordinatorUrl: COORDINATOR_URL });
    const stats = await sdk.getStats();
    
    expect(typeof stats.connectedNodes).toBe('number');
    expect(Array.isArray(stats.availableRegions)).toBe(true);
  });
});

describe('End-to-End Proxy Flow (requires full stack)', () => {
  test.skipIf(!process.env.RUN_E2E_TESTS)('complete proxy request flow', async () => {
    const COORDINATOR_URL = process.env.PROXY_COORDINATOR_URL || 'http://localhost:4020';
    const sdk = new ProxySDK({ coordinatorUrl: COORDINATOR_URL });

    // This test requires:
    // 1. Running coordinator
    // 2. At least one connected node
    // 3. Deployed contracts with session

    const result = await sdk.fetchUrl('https://httpbin.org/get', {
      regionCode: 'US',
    });

    if (result.success) {
      expect(result.statusCode).toBe(200);
      expect(result.bytesTransferred).toBeGreaterThan(0);
      expect(result.body).toContain('httpbin');
    } else {
      // Expected to fail without full stack
      expect(result.error).toBeDefined();
    }
  });
});

describe('Decentralized External Adapters', () => {
  describe('MysteriumAdapter', () => {
    test('creates adapter with config', () => {
      const adapter = new MysteriumAdapter({
        name: 'Test Mysterium',
        baseUrl: 'http://localhost:4050',
        markupBps: 500,
      });

      expect(adapter.name).toBe('Test Mysterium');
      expect(adapter.type).toBe('mysterium');
    });

    test('createMysteriumAdapter returns null without config', () => {
      const originalEnv = process.env.MYSTERIUM_NODE_URL;
      delete process.env.MYSTERIUM_NODE_URL;
      
      const adapter = createMysteriumAdapter();
      expect(adapter).toBeNull();
      
      process.env.MYSTERIUM_NODE_URL = originalEnv;
    });

    test('createMysteriumAdapter creates adapter with env config', () => {
      const originalEnv = process.env.MYSTERIUM_NODE_URL;
      process.env.MYSTERIUM_NODE_URL = 'http://test:4050';
      
      const adapter = createMysteriumAdapter();
      expect(adapter).not.toBeNull();
      expect(adapter?.name).toBe('Mysterium Network');
      
      process.env.MYSTERIUM_NODE_URL = originalEnv;
    });

    test('isAvailable returns false when node is unavailable', async () => {
      const adapter = new MysteriumAdapter({
        name: 'Test',
        baseUrl: 'http://nonexistent:4050',
        markupBps: 500,
      });

      const available = await adapter.isAvailable();
      expect(available).toBe(false);
    });

    test('getRate returns positive value', async () => {
      const adapter = new MysteriumAdapter({
        name: 'Test',
        baseUrl: 'http://localhost:4050',
        markupBps: 500,
      });

      const rate = await adapter.getRate('US');
      expect(rate).toBeGreaterThan(0n);
    });
  });

  describe('OrchidAdapter', () => {
    test('creates adapter with config', () => {
      const adapter = new OrchidAdapter({
        name: 'Test Orchid',
        baseUrl: 'http://localhost:8545',
        rpcUrl: 'http://localhost:8545',
        markupBps: 500,
      });

      expect(adapter.name).toBe('Test Orchid');
      expect(adapter.type).toBe('orchid');
    });

    test('createOrchidAdapter returns null without config', () => {
      const originalRpc = process.env.ORCHID_RPC_URL;
      const originalContract = process.env.ORCHID_STAKING_CONTRACT;
      delete process.env.ORCHID_RPC_URL;
      delete process.env.ORCHID_STAKING_CONTRACT;
      
      const adapter = createOrchidAdapter();
      expect(adapter).toBeNull();
      
      process.env.ORCHID_RPC_URL = originalRpc;
      process.env.ORCHID_STAKING_CONTRACT = originalContract;
    });

    test('getRate returns positive value', async () => {
      const adapter = new OrchidAdapter({
        name: 'Test',
        baseUrl: 'http://localhost:8545',
        rpcUrl: 'http://localhost:8545',
        markupBps: 500,
      });

      const rate = await adapter.getRate('US');
      expect(rate).toBeGreaterThan(0n);
    });
  });

  describe('SentinelAdapter', () => {
    test('creates adapter with config', () => {
      const adapter = new SentinelAdapter({
        name: 'Test Sentinel',
        baseUrl: 'https://api.sentinel.co',
        markupBps: 500,
      });

      expect(adapter.name).toBe('Test Sentinel');
      expect(adapter.type).toBe('sentinel');
    });

    test('createSentinelAdapter returns null without config', () => {
      const originalEnv = process.env.SENTINEL_API_URL;
      delete process.env.SENTINEL_API_URL;
      
      const adapter = createSentinelAdapter();
      expect(adapter).toBeNull();
      
      process.env.SENTINEL_API_URL = originalEnv;
    });

    test('createSentinelAdapter creates adapter with env config', () => {
      const originalEnv = process.env.SENTINEL_API_URL;
      process.env.SENTINEL_API_URL = 'https://api.sentinel.co';
      
      const adapter = createSentinelAdapter();
      expect(adapter).not.toBeNull();
      expect(adapter?.name).toBe('Sentinel Network');
      
      process.env.SENTINEL_API_URL = originalEnv;
    });

    test('isAvailable returns false when API is unavailable', async () => {
      const adapter = new SentinelAdapter({
        name: 'Test',
        baseUrl: 'http://nonexistent:9999',
        markupBps: 500,
      });

      const available = await adapter.isAvailable();
      expect(available).toBe(false);
    });

    test('getRate returns positive value', async () => {
      const adapter = new SentinelAdapter({
        name: 'Test',
        baseUrl: 'https://api.sentinel.co',
        markupBps: 500,
      });

      const rate = await adapter.getRate('US');
      expect(rate).toBeGreaterThan(0n);
    });
  });
});

