/**
 * Live E2E Tests - Network Management
 * 
 * Verifies network switching and chain management functionality.
 */

import { test, expect } from '@playwright/test';
import { createPublicClient, http } from 'viem';
import { TEST_CONFIG, assertInfrastructureRunning } from '../setup';

test.describe('Network Management (Live)', () => {
  test.beforeAll(async () => {
    await assertInfrastructureRunning();
  });

  test('should connect to localnet RPC', async () => {
    const client = createPublicClient({
      transport: http(TEST_CONFIG.rpcUrl),
    });

    const chainId = await client.getChainId();
    expect(chainId).toBe(TEST_CONFIG.chainId);
  });

  test('should get current block number', async () => {
    const client = createPublicClient({
      transport: http(TEST_CONFIG.rpcUrl),
    });

    const blockNumber = await client.getBlockNumber();
    expect(blockNumber).toBeGreaterThanOrEqual(0n);
  });

  test('should get gas price', async () => {
    const client = createPublicClient({
      transport: http(TEST_CONFIG.rpcUrl),
    });

    const gasPrice = await client.getGasPrice();
    expect(gasPrice).toBeGreaterThan(0n);
  });

  test('should handle network errors gracefully', async () => {
    // Try connecting to non-existent RPC
    const client = createPublicClient({
      transport: http('http://localhost:19999', { timeout: 1000 }),
    });

    await expect(client.getChainId()).rejects.toThrow();
  });

  test('should fetch pending transactions', async () => {
    const client = createPublicClient({
      transport: http(TEST_CONFIG.rpcUrl),
    });

    const pendingBlock = await client.getBlock({ blockTag: 'pending' });
    expect(pendingBlock).toBeTruthy();
    expect(pendingBlock.transactions).toBeInstanceOf(Array);
  });
});

