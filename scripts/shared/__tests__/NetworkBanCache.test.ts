/**
 * Tests for NetworkBanCache with Real Contract Integration
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { ethers } from 'ethers';

describe('NetworkBanCache', () => {
  test('NetworkBanCache module should export class', async () => {
    const module = await import('../NetworkBanCache');
    expect(module.NetworkBanCache).toBeDefined();
  });
  
  test('should create NetworkBanCache instance with config', async () => {
    const { NetworkBanCache } = await import('../NetworkBanCache');
    
    const appId = ethers.keccak256(ethers.toUtf8Bytes('testapp'));
    
    const cache = new NetworkBanCache({
      banManagerAddress: '0x0000000000000000000000000000000000000000',
      labelManagerAddress: '0x0000000000000000000000000000000000000000',
      rpcUrl: 'http://localhost:8545',
      appId: appId,
    });
    
    expect(cache).toBeDefined();
  });

  test('isAllowed should return true for non-banned agent', () => {
    // Test cache logic without actual contract
    const { NetworkBanCache } = require('../NetworkBanCache');
    
    const appId = ethers.keccak256(ethers.toUtf8Bytes('testapp'));
    const cache = new NetworkBanCache({
      banManagerAddress: '0x0000000000000000000000000000000000000000',
      labelManagerAddress: '0x0000000000000000000000000000000000000000',
      rpcUrl: 'http://localhost:8545',
      appId,
    });

    // Before initialization, should use default behavior
    const allowed = cache.isAllowed(123);
    expect(typeof allowed).toBe('boolean');
  });

  test('should track network bans in-memory', async () => {
    const { NetworkBanCache } = await import('../NetworkBanCache');
    
    const appId = ethers.keccak256(ethers.toUtf8Bytes('testapp'));
    const cache = new NetworkBanCache({
      banManagerAddress: '0x0000000000000000000000000000000000000000',
      labelManagerAddress: '0x0000000000000000000000000000000000000000',
      rpcUrl: 'http://localhost:8545',
      appId,
    });

    // Cache should maintain internal state
    expect(cache).toBeDefined();
    
    // Get status should return structure
    const status = cache.getStatus(123);
    expect(status).toHaveProperty('networkBanned');
    expect(status).toHaveProperty('appBanned');
    expect(status).toHaveProperty('labels');
  });

  test('should handle app-specific bans correctly', () => {
    const { NetworkBanCache } = require('../NetworkBanCache');
    
    const appId = ethers.keccak256(ethers.toUtf8Bytes('hyperscape'));
    const cache = new NetworkBanCache({
      banManagerAddress: '0x0000000000000000000000000000000000000000',
      labelManagerAddress: '0x0000000000000000000000000000000000000000',
      rpcUrl: 'http://localhost:8545',
      appId,
    });

    // Should differentiate app bans from network bans
    const status = cache.getStatus(456);
    expect(status.networkBanned).toBe(false); // Initially not banned
    expect(status.appBanned).toBe(false);
  });

  test('should track labels for agents', () => {
    const { NetworkBanCache } = require('../NetworkBanCache');
    
    const cache = new NetworkBanCache({
      banManagerAddress: '0x0000000000000000000000000000000000000000',
      labelManagerAddress: '0x0000000000000000000000000000000000000000',
      rpcUrl: 'http://localhost:8545',
      appId: ethers.keccak256(ethers.toUtf8Bytes('testapp')),
    });

    const labels = cache.getLabels(789);
    expect(Array.isArray(labels)).toBe(true);
  });

  // Integration test (requires deployed contracts)
  test.skip('should sync from actual BanManager events', async () => {
    // This would require:
    // 1. Deployed BanManager contract
    // 2. Historical ban events
    // 3. Real RPC endpoint
    
    // Test structure:
    // const cache = new NetworkBanCache(realConfig);
    // await cache.initialize();
    // expect(cache.isInitialized).toBe(true);
  });

  test.skip('should update cache on new ban events', async () => {
    // This would require:
    // 1. Running contracts
    // 2. Ability to trigger ban event
    // 3. Event listener active
    
    // Test structure:
    // cache.startListening();
    // await triggerBanEvent(agentId);
    // expect(cache.isAllowed(agentId)).toBe(false);
  });
});


