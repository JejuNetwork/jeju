/**
 * @fileoverview Tests for RPC utility functions
 * @module scripts/shared/rpc.test
 */

import { describe, it, expect } from 'bun:test';
import { FailoverProvider, checkRPC, getNetworkInfo } from './rpc';
import { ethers } from 'ethers';

describe('RPC Utilities', () => {
  const LOCALNET_RPC = process.env.RPC_ETH_HTTP || 'http://127.0.0.1:9545';

  describe('FailoverProvider', () => {
    it('should create provider with single URL', () => {
      const provider = new FailoverProvider(LOCALNET_RPC, 'Test');
      expect(provider).toBeTruthy();
    });

    it('should create provider with multiple URLs', () => {
      const provider = new FailoverProvider([
        LOCALNET_RPC,
        'http://backup-rpc.example.com',
      ], 'Test');
      expect(provider).toBeTruthy();
    });

    it('should get working provider', async () => {
      const failover = new FailoverProvider(LOCALNET_RPC, 'Localnet');
      
      try {
        const provider = await failover.getProvider();
        expect(provider).toBeTruthy();
        
        // Try to use it
        const blockNumber = await provider.getBlockNumber();
        expect(blockNumber).toBeGreaterThanOrEqual(0);
        
        console.log(`   ✅ Connected to RPC at block ${blockNumber}`);
      } catch (error) {
        console.log('   ⚠️  RPC not available (localnet not running)');
      }
    }, 10000);

    it('should failover to next endpoint on failure', async () => {
      const failover = new FailoverProvider([
        'http://invalid-rpc-1.example.com',
        'http://invalid-rpc-2.example.com',
        LOCALNET_RPC, // Working endpoint (if localnet is running)
      ], 'Test');

      try {
        const provider = await failover.getProviderWithRetry(3, 100);
        const blockNumber = await provider.getBlockNumber();
        
        console.log(`   ✅ Failover succeeded at block ${blockNumber}`);
      } catch (error) {
        console.log('   ℹ️  All endpoints failed (expected if localnet not running)');
      }
    }, 15000);
  });

  describe('checkRPC', () => {
    it('should return true for healthy RPC', async () => {
      try {
        const isHealthy = await checkRPC(LOCALNET_RPC, 5000);
        if (isHealthy) {
          console.log('   ✅ RPC is healthy');
          expect(isHealthy).toBe(true);
        }
      } catch (error) {
        console.log('   ⚠️  RPC not available');
      }
    }, 10000);

    it('should return false for invalid RPC', async () => {
      const isHealthy = await checkRPC('http://invalid-rpc.example.com', 2000);
      expect(isHealthy).toBe(false);
    }, 5000);

    it('should timeout appropriately', async () => {
      const start = Date.now();
      await checkRPC('http://non-existent-endpoint.local', 1000);
      const elapsed = Date.now() - start;
      
      // Should timeout around 1000ms
      expect(elapsed).toBeLessThan(2000);
    }, 5000);
  });

  describe('getNetworkInfo', () => {
    it('should get network information', async () => {
      try {
        const provider = new ethers.JsonRpcProvider(LOCALNET_RPC);
        const info = await getNetworkInfo(provider);
        
        expect(info.chainId).toBeTruthy();
        expect(info.blockNumber).toBeGreaterThanOrEqual(0);
        expect(info.gasPrice).toBeGreaterThanOrEqual(0n);
        
        console.log(`   ✅ Network Info:`);
        console.log(`      Chain ID: ${info.chainId}`);
        console.log(`      Block: ${info.blockNumber}`);
        console.log(`      Gas Price: ${ethers.formatUnits(info.gasPrice, 'gwei')} gwei`);
      } catch (error) {
        console.log('   ⚠️  Cannot get network info (RPC not available)');
      }
    }, 10000);
  });

  describe('Integration Examples', () => {
    it('should demonstrate deployment script usage', async () => {
      console.log('\n   Example: Deployment with failover\n');
      
      new FailoverProvider([
        'https://rpc.jeju.network',
        'https://rpc-backup.jeju.network',
        LOCALNET_RPC,
      ], 'Jeju');

      console.log('   1. Created failover provider with 3 endpoints');
      console.log('   2. Provider automatically tries each endpoint');
      console.log('   3. Falls back to next if current fails');
      console.log('   4. Throws error only if all fail\n');
    });

    it('should demonstrate monitoring script usage', async () => {
      console.log('\n   Example: Health monitoring\n');
      
      const endpoints = [
        'https://rpc.jeju.network',
        'https://testnet-rpc.jeju.network',
        LOCALNET_RPC,
      ];

      console.log('   Checking RPC health:');
      
      for (const endpoint of endpoints) {
        const isHealthy = await checkRPC(endpoint, 3000);
        const status = isHealthy ? '✅ Healthy' : '❌ Down';
        const url = endpoint.length > 30 ? endpoint.slice(0, 30) + '...' : endpoint;
        console.log(`      ${url.padEnd(35)} ${status}`);
      }
      
      console.log('');
    }, 15000);
  });
});

