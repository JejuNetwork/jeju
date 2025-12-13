/**
 * Integration Tests - Runs against localnet with deployed contracts.
 * 
 * Prerequisites:
 * - Local anvil/hardhat node running on 8545
 * - Contracts deployed to localnet
 * - IPFS/storage API running
 * 
 * Run with: INTEGRATION=true bun test src/tests/integration.test.ts
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { localhost } from 'viem/chains';
import { createStorage } from '../sdk/storage';
import { createCompute } from '../sdk/compute';
import { createAgentSDK } from '../sdk/agent';
import { createRoomSDK } from '../sdk/room';
import { createLogger } from '../sdk/logger';
import { getCharacter } from '../characters';
import type { CrucibleConfig } from '../types';

// Skip integration tests unless explicitly enabled
const SKIP = !process.env.INTEGRATION;

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // anvil default

// Read contract addresses from env or use defaults
const config: CrucibleConfig = {
  rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
  privateKey: TEST_PRIVATE_KEY,
  contracts: {
    agentVault: (process.env.AGENT_VAULT_ADDRESS ?? '0x5FbDB2315678afecb367f032d93F642f64180aa3') as `0x${string}`,
    roomRegistry: (process.env.ROOM_REGISTRY_ADDRESS ?? '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512') as `0x${string}`,
    triggerRegistry: (process.env.TRIGGER_REGISTRY_ADDRESS ?? '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0') as `0x${string}`,
    identityRegistry: (process.env.IDENTITY_REGISTRY_ADDRESS ?? '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9') as `0x${string}`,
    serviceRegistry: (process.env.SERVICE_REGISTRY_ADDRESS ?? '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9') as `0x${string}`,
  },
  services: {
    computeMarketplace: process.env.COMPUTE_MARKETPLACE_URL ?? 'http://127.0.0.1:4007',
    storageApi: process.env.STORAGE_API_URL ?? 'http://127.0.0.1:3100',
    ipfsGateway: process.env.IPFS_GATEWAY ?? 'http://127.0.0.1:3100',
    indexerGraphql: process.env.INDEXER_GRAPHQL_URL ?? 'http://127.0.0.1:4350/graphql',
  },
  network: 'localnet',
};

const log = createLogger('IntegrationTest', { level: 'debug' });

describe.skipIf(SKIP)('Integration Tests', () => {
  const account = privateKeyToAccount(TEST_PRIVATE_KEY as `0x${string}`);
  const publicClient = createPublicClient({ chain: localhost, transport: http(config.rpcUrl) });
  const walletClient = createWalletClient({ account, chain: localhost, transport: http(config.rpcUrl) });

  let storage: ReturnType<typeof createStorage>;
  let compute: ReturnType<typeof createCompute>;
  let agentSdk: ReturnType<typeof createAgentSDK>;
  let roomSdk: ReturnType<typeof createRoomSDK>;

  beforeAll(async () => {
    log.info('Setting up integration test environment', {
      rpcUrl: config.rpcUrl,
      account: account.address,
    });

    storage = createStorage({
      apiUrl: config.services.storageApi,
      ipfsGateway: config.services.ipfsGateway,
      logger: createLogger('Storage', { level: 'debug' }),
    });

    compute = createCompute({
      marketplaceUrl: config.services.computeMarketplace,
      rpcUrl: config.rpcUrl,
      logger: createLogger('Compute', { level: 'debug' }),
    });

    agentSdk = createAgentSDK({
      crucibleConfig: config,
      storage,
      compute,
      publicClient,
      walletClient,
      logger: createLogger('AgentSDK', { level: 'debug' }),
    });

    roomSdk = createRoomSDK({
      crucibleConfig: config,
      storage,
      publicClient,
      walletClient,
      logger: createLogger('RoomSDK', { level: 'debug' }),
    });
  });

  describe('Blockchain Connectivity', () => {
    test('should connect to local RPC', async () => {
      const blockNumber = await publicClient.getBlockNumber();
      log.info('Connected to chain', { blockNumber: blockNumber.toString() });
      expect(blockNumber).toBeGreaterThanOrEqual(0n);
    });

    test('should have test account with ETH', async () => {
      const balance = await publicClient.getBalance({ address: account.address });
      log.info('Account balance', { balance: balance.toString() });
      expect(balance).toBeGreaterThan(parseEther('1'));
    });
  });

  describe('Contract Verification', () => {
    test('should have IdentityRegistry deployed', async () => {
      const code = await publicClient.getCode({ address: config.contracts.identityRegistry });
      log.info('IdentityRegistry code', { hasCode: !!code && code.length > 2 });
      expect(code).toBeDefined();
      expect(code?.length).toBeGreaterThan(2);
    });

    test('should have AgentVault deployed', async () => {
      const code = await publicClient.getCode({ address: config.contracts.agentVault });
      log.info('AgentVault code', { hasCode: !!code && code.length > 2 });
      expect(code).toBeDefined();
      expect(code?.length).toBeGreaterThan(2);
    });

    test('should have RoomRegistry deployed', async () => {
      const code = await publicClient.getCode({ address: config.contracts.roomRegistry });
      log.info('RoomRegistry code', { hasCode: !!code && code.length > 2 });
      expect(code).toBeDefined();
      expect(code?.length).toBeGreaterThan(2);
    });

    test('should have TriggerRegistry deployed', async () => {
      const code = await publicClient.getCode({ address: config.contracts.triggerRegistry });
      log.info('TriggerRegistry code', { hasCode: !!code && code.length > 2 });
      expect(code).toBeDefined();
      expect(code?.length).toBeGreaterThan(2);
    });
  });

  describe('Storage API', () => {
    test('should store and retrieve character from IPFS', async () => {
      const character = getCharacter('project-manager');
      expect(character).toBeDefined();

      const cid = await storage.storeCharacter(character!);
      log.info('Stored character', { cid });
      expect(cid).toMatch(/^Qm|^bafy/);

      const loaded = await storage.loadCharacter(cid);
      expect(loaded.id).toBe(character!.id);
      expect(loaded.name).toBe(character!.name);
    });

    test('should store and retrieve agent state from IPFS', async () => {
      const state = storage.createInitialState('test-agent');
      const cid = await storage.storeAgentState(state);
      log.info('Stored state', { cid });

      const loaded = await storage.loadAgentState(cid);
      expect(loaded.agentId).toBe('test-agent');
      expect(loaded.version).toBe(0);
    });
  });

  describe('Agent Registration (requires deployed contracts)', () => {
    test('should register agent and create vault', async () => {
      const character = getCharacter('project-manager');
      expect(character).toBeDefined();

      log.info('Registering agent', { name: character!.name });

      const result = await agentSdk.registerAgent(character!, {
        initialFunding: parseEther('0.01'),
      });

      log.info('Agent registered', {
        agentId: result.agentId.toString(),
        vaultAddress: result.vaultAddress,
        characterCid: result.characterCid,
        stateCid: result.stateCid,
      });

      expect(result.agentId).toBeGreaterThan(0n);
      expect(result.vaultAddress).toMatch(/^0x/);
      expect(result.characterCid).toMatch(/^Qm|^bafy/);
      expect(result.stateCid).toMatch(/^Qm|^bafy/);

      // Verify agent exists
      const agent = await agentSdk.getAgent(result.agentId);
      expect(agent).toBeDefined();
      expect(agent?.owner).toBe(account.address);

      // Verify vault has balance
      const balance = await agentSdk.getVaultBalance(result.agentId);
      expect(balance).toBeGreaterThanOrEqual(parseEther('0.01'));
    });
  });

  describe('Room Management (requires deployed contracts)', () => {
    test('should create room', async () => {
      log.info('Creating room');

      const result = await roomSdk.createRoom(
        'Integration Test Room',
        'Testing room creation',
        'collaboration',
        { maxMembers: 5, turnBased: false, visibility: 'public' }
      );

      log.info('Room created', {
        roomId: result.roomId.toString(),
        stateCid: result.stateCid,
      });

      expect(result.roomId).toBeGreaterThan(0n);
      expect(result.stateCid).toMatch(/^Qm|^bafy/);

      // Verify room exists
      const room = await roomSdk.getRoom(result.roomId);
      expect(room).toBeDefined();
      expect(room?.name).toBe('Integration Test Room');
    });
  });
});

// Run these tests with: INTEGRATION=true bun test src/tests/integration.test.ts
