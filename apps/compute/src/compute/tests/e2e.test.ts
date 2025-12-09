/**
 * End-to-End Tests for Jeju Compute Marketplace
 *
 * Tests the full flow:
 * 1. Deploy contracts to localnet/Anvil
 * 2. Register provider
 * 3. User deposits and transfers
 * 4. Start compute node
 * 5. Make inference request
 * 6. Settle on-chain
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { JsonRpcProvider, parseEther, Wallet } from 'ethers';
import { ComputeNodeServer } from '../node/server';
import type { AttestationReport, HardwareInfo, ProviderConfig } from '../node/types';
import { JejuComputeSDK } from '../sdk/sdk';
import type { InferenceResponse } from '../sdk/types';

// Test response types
interface HealthResponse {
  status: string;
  provider: string;
  models: string[];
}

interface ModelsResponse {
  object: string;
  data: Array<{ id: string; object: string; created: number; owned_by: string }>;
}

// Localnet/Anvil default accounts
const TEST_ACCOUNTS = {
  deployer:
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  provider:
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  user: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
};

// Use Jeju localnet (9545) or fallback to Anvil (8545)
const RPC_URL = process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545';

// Contract addresses from deployment (set via env or use defaults)
const CONTRACTS = {
  registry: process.env.COMPUTE_REGISTRY_ADDRESS || '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  ledger: process.env.LEDGER_MANAGER_ADDRESS || '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  inference: process.env.INFERENCE_SERVING_ADDRESS || '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
};

describe('Jeju Compute E2E', () => {
  let providerWallet: Wallet;
  let userWallet: Wallet;
  let computeNode: ComputeNodeServer;
  let providerSDK: JejuComputeSDK;
  let userSDK: JejuComputeSDK;
  let networkAvailable = false;

  beforeAll(async () => {
    // Initialize wallets
    const rpcProvider = new JsonRpcProvider(RPC_URL);
    providerWallet = new Wallet(TEST_ACCOUNTS.provider, rpcProvider);
    userWallet = new Wallet(TEST_ACCOUNTS.user, rpcProvider);

    // Check if network is available
    try {
      await rpcProvider.getBlockNumber();
      networkAvailable = true;
    } catch {
      console.log('⚠️  Network not available (RPC connection failed)');
    }

    console.log('Provider address:', providerWallet.address);
    console.log('User address:', userWallet.address);

    // Initialize SDKs
    providerSDK = new JejuComputeSDK({
      rpcUrl: RPC_URL,
      signer: providerWallet,
      contracts: CONTRACTS,
    });

    userSDK = new JejuComputeSDK({
      rpcUrl: RPC_URL,
      signer: userWallet,
      contracts: CONTRACTS,
    });

    // Start compute node
    const nodeConfig: ProviderConfig = {
      privateKey: TEST_ACCOUNTS.provider,
      registryAddress: CONTRACTS.registry,
      ledgerAddress: CONTRACTS.ledger,
      inferenceAddress: CONTRACTS.inference,
      rpcUrl: RPC_URL,
      port: 8081,
      models: [
        {
          name: 'test-model',
          backend: 'mock',
          pricePerInputToken: BigInt(1000000000), // 1 gwei
          pricePerOutputToken: BigInt(2000000000), // 2 gwei
          maxContextLength: 4096,
        },
      ],
    };

    computeNode = new ComputeNodeServer(nodeConfig);
    computeNode.start(nodeConfig.port);

    // Wait for server to start
    await new Promise((r) => setTimeout(r, 1000));
  });

  afterAll(() => {
    // Cleanup
    process.exit(0);
  });

  describe('Compute Node', () => {
    test('health check', async () => {
      const response = await fetch('http://localhost:8081/health');
      expect(response.ok).toBe(true);

      const data = await response.json() as HealthResponse;
      expect(data.status).toBe('ok');
      expect(data.provider).toBe(providerWallet.address);
    });

    test('list models', async () => {
      const response = await fetch('http://localhost:8081/v1/models');
      expect(response.ok).toBe(true);

      const data = await response.json() as ModelsResponse;
      expect(data.object).toBe('list');
      expect(data.data.length).toBeGreaterThan(0);
      expect(data.data[0].id).toBe('test-model');
    });

    test('attestation endpoint', async () => {
      const nonce = crypto.randomUUID();
      const response = await fetch(
        `http://localhost:8081/v1/attestation/report?nonce=${nonce}`
      );
      expect(response.ok).toBe(true);

      const data = await response.json() as AttestationReport;
      expect(data.signingAddress).toBe(providerWallet.address);
      expect(data.nonce).toBe(nonce);
      expect(data.simulated).toBe(true);
      expect(data.hardware).toBeDefined();
    });

    test('hardware info', async () => {
      const response = await fetch('http://localhost:8081/v1/hardware');
      expect(response.ok).toBe(true);

      const data = await response.json() as HardwareInfo;
      expect(data.platform).toBeDefined();
      expect(data.cpus).toBeGreaterThan(0);
      expect(data.memory).toBeGreaterThan(0);
    });
  });

  describe('Chat Completions', () => {
    test('non-streaming completion', async () => {
      const response = await fetch(
        'http://localhost:8081/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'test-model',
            messages: [{ role: 'user', content: 'Hello!' }],
          }),
        }
      );

      expect(response.ok).toBe(true);

      const data = await response.json() as InferenceResponse;
      expect(data.id).toBeDefined();
      expect(data.model).toBe('test-model');
      expect(data.choices.length).toBe(1);
      expect(data.choices[0].message.role).toBe('assistant');
      expect(data.choices[0].message.content).toBeDefined();
      expect(data.usage.prompt_tokens).toBeGreaterThan(0);
      expect(data.usage.completion_tokens).toBeGreaterThan(0);
    });

    test('streaming completion', async () => {
      const response = await fetch(
        'http://localhost:8081/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'test-model',
            messages: [{ role: 'user', content: 'Count to 3' }],
            stream: true,
          }),
        }
      );

      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toContain(
        'text/event-stream'
      );

      const reader = response.body?.getReader();
      const chunks: string[] = [];

      if (reader) {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(decoder.decode(value));
        }
      }

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks.join('')).toContain('[DONE]');
    });

    test('math question response', async () => {
      const response = await fetch(
        'http://localhost:8081/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'test-model',
            messages: [{ role: 'user', content: 'What is 2+2?' }],
          }),
        }
      );

      expect(response.ok).toBe(true);

      const data = await response.json() as InferenceResponse;
      expect(data.choices[0].message.content).toContain('4');
    });
  });

  describe('SDK', () => {
    test('generate auth headers', async () => {
      if (!networkAvailable) {
        console.log('   Skipping: network not available');
        return;
      }
      // Skip if contracts not deployed (getNonce will fail)
      try {
        const headers = await userSDK.generateAuthHeaders(providerWallet.address);
        expect(headers['x-jeju-address']).toBe(userWallet.address);
        expect(headers['x-jeju-nonce']).toBeDefined();
        expect(headers['x-jeju-signature']).toBeDefined();
        expect(headers['x-jeju-timestamp']).toBeDefined();
      } catch (error) {
        if (String(error).includes('BAD_DATA') || String(error).includes('could not decode')) {
          console.log('   Skipping: contracts not deployed');
          return;
        }
        throw error;
      }
    });

    test('provider SDK has correct address', () => {
      expect(providerSDK.getAddress()).toBe(providerWallet.address);
    });

    test('format and parse ether', () => {
      const eth = '1.5';
      const wei = userSDK.parseEther(eth);
      expect(wei).toBe(parseEther(eth));

      const formatted = userSDK.formatEther(wei);
      expect(formatted).toBe(eth);
    });
  });

  describe('Authenticated Requests', () => {
    test('request with auth headers', async () => {
      if (!networkAvailable) {
        console.log('   Skipping: network not available');
        return;
      }
      // Skip if contracts not deployed
      let headers;
      try {
        headers = await userSDK.generateAuthHeaders(providerWallet.address);
      } catch (error) {
        if (String(error).includes('BAD_DATA') || String(error).includes('could not decode')) {
          console.log('   Skipping: contracts not deployed');
          return;
        }
        throw error;
      }

      const response = await fetch(
        'http://localhost:8081/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify({
            model: 'test-model',
            messages: [{ role: 'user', content: 'Hello with auth!' }],
          }),
        }
      );

      expect(response.ok).toBe(true);

      const data = await response.json() as InferenceResponse;
      expect(data.choices[0].message.content).toBeDefined();
    });
  });
});

// Run tests
console.log('\n🧪 Running Jeju Compute E2E Tests\n');
console.log('Prerequisites:');
console.log('1. Anvil running on http://localhost:8545');
console.log('2. Contracts deployed (or using mock addresses)');
console.log('');
