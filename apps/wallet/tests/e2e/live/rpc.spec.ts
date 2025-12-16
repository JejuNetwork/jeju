/**
 * Live E2E Tests - RPC Connectivity
 * 
 * Verifies the wallet can connect to the network localnet and fetch data.
 * Tests actual blockchain interactions.
 */

import { test, expect } from '@playwright/test';
import { createPublicClient, http, formatEther } from 'viem';
import { TEST_CONFIG, assertInfrastructureRunning, getTestAccountBalance } from '../setup';

test.describe('RPC Connectivity (Live)', () => {
  test.beforeAll(async () => {
    await assertInfrastructureRunning();
  });

  test('should connect to the network localnet RPC', async () => {
    const client = createPublicClient({
      transport: http(TEST_CONFIG.rpcUrl),
    });

    const chainId = await client.getChainId();
    expect(chainId).toBe(TEST_CONFIG.chainId);
  });

  test('should fetch real block number', async () => {
    const client = createPublicClient({
      transport: http(TEST_CONFIG.rpcUrl),
    });

    const blockNumber = await client.getBlockNumber();
    // Fresh anvil starts at block 0, which is valid
    expect(blockNumber).toBeGreaterThanOrEqual(0n);
  });

  test('should fetch real gas price', async () => {
    const client = createPublicClient({
      transport: http(TEST_CONFIG.rpcUrl),
    });

    const gasPrice = await client.getGasPrice();
    expect(gasPrice).toBeGreaterThan(0n);
  });

  test('should fetch test account balance', async () => {
    const balance = await getTestAccountBalance();
    
    // Localnet starts accounts with plenty of ETH
    expect(parseFloat(balance)).toBeGreaterThan(100);
  });

  test('should fetch balance for any address', async () => {
    const client = createPublicClient({
      transport: http(TEST_CONFIG.rpcUrl),
    });

    const balance = await client.getBalance({
      address: TEST_CONFIG.testAccount.address,
    });

    expect(formatEther(balance)).not.toBe('0');
  });

  test('should get latest block', async () => {
    const client = createPublicClient({
      transport: http(TEST_CONFIG.rpcUrl),
    });

    const block = await client.getBlock();
    
    // Fresh anvil starts at block 0, which is valid
    expect(block.number).toBeGreaterThanOrEqual(0n);
    expect(block.hash).toBeTruthy();
    expect(block.timestamp).toBeGreaterThanOrEqual(0n);
  });

  test('should verify network settings', async () => {
    const client = createPublicClient({
      transport: http(TEST_CONFIG.rpcUrl),
    });

    // Verify chain ID matches expected
    const chainId = await client.getChainId();
    expect(chainId).toBe(TEST_CONFIG.chainId);

    // Verify we can get block number (fresh anvil starts at 0)
    const block = await client.getBlockNumber();
    expect(block).toBeGreaterThanOrEqual(0n);
  });
});
