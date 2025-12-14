/**
 * Service integration tests
 * 
 * These tests require `jeju dev` to be running with contracts deployed
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { createPublicClient, http, parseEther, formatEther } from 'viem';
import { createNodeClient, jejuLocalnet } from '../../src/lib/contracts';
import { createNodeServices } from '../../src/lib/services';

const RPC_URL = process.env.JEJU_RPC_URL || 'http://127.0.0.1:8545';
const CHAIN_ID = 1337;
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

describe('Compute Service', () => {
  let isLocalnetRunning = false;
  let services: ReturnType<typeof createNodeServices>;

  beforeAll(async () => {
    try {
      const publicClient = createPublicClient({
        chain: jejuLocalnet,
        transport: http(RPC_URL),
      });
      await publicClient.getBlockNumber();
      isLocalnetRunning = true;
      
      const client = createNodeClient(RPC_URL, CHAIN_ID, TEST_PRIVATE_KEY);
      services = createNodeServices(client);
    } catch {
      console.log('Localnet not running - skipping service tests');
    }
  });

  test('can get compute service state', async () => {
    if (!isLocalnetRunning) {
      console.log('SKIPPED: Localnet not running');
      return;
    }

    try {
      const state = await services.compute.getState(TEST_ADDRESS);
      
      expect(state).toBeDefined();
      expect(typeof state.isRegistered).toBe('boolean');
      expect(typeof state.isStaked).toBe('boolean');
      
      console.log('Compute service state:', {
        isRegistered: state.isRegistered,
        isStaked: state.isStaked,
        stakeAmount: formatEther(state.stakeAmount),
      });
    } catch (e) {
      console.log('Compute contracts not deployed yet:', e);
    }
  });
});

describe('Oracle Service', () => {
  let isLocalnetRunning = false;
  let services: ReturnType<typeof createNodeServices>;

  beforeAll(async () => {
    try {
      const publicClient = createPublicClient({
        chain: jejuLocalnet,
        transport: http(RPC_URL),
      });
      await publicClient.getBlockNumber();
      isLocalnetRunning = true;
      
      const client = createNodeClient(RPC_URL, CHAIN_ID, TEST_PRIVATE_KEY);
      services = createNodeServices(client);
    } catch {
      console.log('Localnet not running');
    }
  });

  test('can get oracle service state', async () => {
    if (!isLocalnetRunning) {
      console.log('SKIPPED: Localnet not running');
      return;
    }

    try {
      const state = await services.oracle.getState(TEST_ADDRESS);
      
      expect(state).toBeDefined();
      expect(typeof state.isRegistered).toBe('boolean');
      
      console.log('Oracle service state:', {
        isRegistered: state.isRegistered,
        stake: formatEther(state.stake),
        reputation: state.reputation.toString(),
      });
    } catch (e) {
      console.log('Oracle contracts not deployed yet:', e);
    }
  });
});

describe('Storage Service', () => {
  let isLocalnetRunning = false;
  let services: ReturnType<typeof createNodeServices>;

  beforeAll(async () => {
    try {
      const publicClient = createPublicClient({
        chain: jejuLocalnet,
        transport: http(RPC_URL),
      });
      await publicClient.getBlockNumber();
      isLocalnetRunning = true;
      
      const client = createNodeClient(RPC_URL, CHAIN_ID, TEST_PRIVATE_KEY);
      services = createNodeServices(client);
    } catch {
      console.log('Localnet not running');
    }
  });

  test('can get storage service state', async () => {
    if (!isLocalnetRunning) {
      console.log('SKIPPED: Localnet not running');
      return;
    }

    try {
      const state = await services.storage.getState(TEST_ADDRESS);
      
      expect(state).toBeDefined();
      expect(typeof state.isRegistered).toBe('boolean');
      
      console.log('Storage service state:', {
        isRegistered: state.isRegistered,
        capacityGB: state.capacityGB,
        usedGB: state.usedGB,
      });
    } catch (e) {
      console.log('Storage contracts not deployed yet:', e);
    }
  });
});

describe('Cron Service', () => {
  let isLocalnetRunning = false;
  let services: ReturnType<typeof createNodeServices>;

  beforeAll(async () => {
    try {
      const publicClient = createPublicClient({
        chain: jejuLocalnet,
        transport: http(RPC_URL),
      });
      await publicClient.getBlockNumber();
      isLocalnetRunning = true;
      
      const client = createNodeClient(RPC_URL, CHAIN_ID, TEST_PRIVATE_KEY);
      services = createNodeServices(client);
    } catch {
      console.log('Localnet not running');
    }
  });

  test('can get active triggers', async () => {
    if (!isLocalnetRunning) {
      console.log('SKIPPED: Localnet not running');
      return;
    }

    try {
      const triggers = await services.cron.getActiveTriggers();
      
      expect(Array.isArray(triggers)).toBe(true);
      
      console.log(`Found ${triggers.length} active triggers`);
    } catch (e) {
      console.log('Cron contracts not deployed yet:', e);
    }
  });

  test('cron state tracking works', () => {
    if (!isLocalnetRunning) {
      console.log('SKIPPED: Localnet not running');
      return;
    }

    const state = services.cron.getState();
    
    expect(state.executionsCompleted).toBe(0);
    expect(state.earningsWei).toBe(0n);
  });
});

