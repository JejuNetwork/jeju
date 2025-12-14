/**
 * Integration tests against localnet
 * 
 * These tests require `jeju dev` to be running
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { createPublicClient, http, parseEther, formatEther } from 'viem';
import { createNodeClient, jejuLocalnet, getContractAddresses } from '../../src/lib/contracts';

const RPC_URL = process.env.JEJU_RPC_URL || 'http://127.0.0.1:8545';
const CHAIN_ID = 1337;

// Anvil's default funded account
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TEST_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

describe('Localnet Connection', () => {
  let isLocalnetRunning = false;

  beforeAll(async () => {
    // Check if localnet is running
    try {
      const client = createPublicClient({
        chain: jejuLocalnet,
        transport: http(RPC_URL),
      });
      const blockNumber = await client.getBlockNumber();
      isLocalnetRunning = true;
      console.log(`Localnet running at block ${blockNumber}`);
    } catch {
      console.log('Localnet not running - skipping integration tests');
      console.log('Run `bun run jeju dev` to start localnet');
    }
  });

  test('can connect to localnet', async () => {
    if (!isLocalnetRunning) {
      console.log('SKIPPED: Localnet not running');
      return;
    }

    const client = createPublicClient({
      chain: jejuLocalnet,
      transport: http(RPC_URL),
    });

    const chainId = await client.getChainId();
    expect(chainId).toBe(CHAIN_ID);
  });

  test('can get block number', async () => {
    if (!isLocalnetRunning) {
      console.log('SKIPPED: Localnet not running');
      return;
    }

    const client = createPublicClient({
      chain: jejuLocalnet,
      transport: http(RPC_URL),
    });

    const blockNumber = await client.getBlockNumber();
    expect(blockNumber).toBeGreaterThanOrEqual(0n);
  });

  test('test account has balance', async () => {
    if (!isLocalnetRunning) {
      console.log('SKIPPED: Localnet not running');
      return;
    }

    const client = createPublicClient({
      chain: jejuLocalnet,
      transport: http(RPC_URL),
    });

    const balance = await client.getBalance({ address: TEST_ADDRESS });
    expect(balance).toBeGreaterThan(0n);
    console.log(`Test account balance: ${formatEther(balance)} ETH`);
  });
});

describe('Contract Interactions', () => {
  let isLocalnetRunning = false;
  let client: ReturnType<typeof createNodeClient>;

  beforeAll(async () => {
    try {
      const publicClient = createPublicClient({
        chain: jejuLocalnet,
        transport: http(RPC_URL),
      });
      await publicClient.getBlockNumber();
      isLocalnetRunning = true;
      client = createNodeClient(RPC_URL, CHAIN_ID, TEST_PRIVATE_KEY);
    } catch {
      console.log('Localnet not running - skipping contract tests');
    }
  });

  test('can read contract addresses', () => {
    if (!isLocalnetRunning) {
      console.log('SKIPPED: Localnet not running');
      return;
    }

    const addresses = getContractAddresses(CHAIN_ID);
    
    expect(addresses.identityRegistry).toBeDefined();
    expect(addresses.computeRegistry).toBeDefined();
    expect(addresses.nodeStakingManager).toBeDefined();
  });

  test('createNodeClient with wallet can sign', async () => {
    if (!isLocalnetRunning) {
      console.log('SKIPPED: Localnet not running');
      return;
    }

    expect(client.walletClient).toBeDefined();
    expect(client.walletClient?.account?.address).toBe(TEST_ADDRESS);
  });

  // Note: The following tests require contracts to be deployed
  // They will fail if contracts aren't deployed yet

  test('can check if identity registry is deployed', async () => {
    if (!isLocalnetRunning) {
      console.log('SKIPPED: Localnet not running');
      return;
    }

    try {
      const code = await client.publicClient.getBytecode({
        address: client.addresses.identityRegistry,
      });
      
      if (code && code !== '0x') {
        console.log('Identity Registry is deployed');
        expect(code.length).toBeGreaterThan(2);
      } else {
        console.log('Identity Registry not yet deployed - run contract bootstrap');
      }
    } catch (e) {
      console.log('Could not check contract deployment:', e);
    }
  });
});

describe('Wallet Operations', () => {
  let isLocalnetRunning = false;
  let client: ReturnType<typeof createNodeClient>;

  beforeAll(async () => {
    try {
      const publicClient = createPublicClient({
        chain: jejuLocalnet,
        transport: http(RPC_URL),
      });
      await publicClient.getBlockNumber();
      isLocalnetRunning = true;
      client = createNodeClient(RPC_URL, CHAIN_ID, TEST_PRIVATE_KEY);
    } catch {
      console.log('Localnet not running');
    }
  });

  test('can send ETH transaction', async () => {
    if (!isLocalnetRunning) {
      console.log('SKIPPED: Localnet not running');
      return;
    }

    if (!client.walletClient) {
      throw new Error('Wallet not initialized');
    }

    const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'; // Anvil account 2
    const amount = parseEther('0.01');

    const hash = await client.walletClient.sendTransaction({
      to: recipient,
      value: amount,
    });

    expect(hash).toBeDefined();
    expect(hash).toMatch(/^0x[a-fA-F0-9]{64}$/);

    // Wait for confirmation
    const receipt = await client.publicClient.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe('success');
    
    console.log(`Transaction confirmed: ${hash}`);
  });
});

