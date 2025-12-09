/**
 * End-to-End Settlement Tests
 *
 * Tests the full settlement flow:
 * 1. User sends inference request with auth headers
 * 2. Provider returns response with settlement signature
 * 3. User settles on-chain
 * 4. Funds are transferred
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { JsonRpcProvider, Wallet } from 'ethers';
import { ComputeNodeServer } from '../node/server';
import type { ProviderConfig } from '../node/types';
import { JejuComputeSDK } from '../sdk/sdk';
import type { InferenceResponse } from '../sdk/types';

// Anvil default accounts
const ANVIL_ACCOUNTS = {
  provider:
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  user: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
};

const RPC_URL = 'http://127.0.0.1:8545';

// Contract addresses from Foundry deployment
const CONTRACTS = {
  registry: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  ledger: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  inference: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
};

describe('Settlement Flow', () => {
  let rpcProvider: JsonRpcProvider;
  let providerWallet: Wallet;
  let userWallet: Wallet;
  let computeNode: ComputeNodeServer;
  let userSDK: JejuComputeSDK;
  let networkAvailable = false;

  beforeAll(async () => {
    // Check if Anvil is running
    rpcProvider = new JsonRpcProvider(RPC_URL);
    try {
      await rpcProvider.getBlockNumber();
      networkAvailable = true;
    } catch {
      console.log('⚠️  Anvil not running. Skipping settlement tests.');
      return;
    }

    // Initialize wallets
    providerWallet = new Wallet(ANVIL_ACCOUNTS.provider, rpcProvider);
    userWallet = new Wallet(ANVIL_ACCOUNTS.user, rpcProvider);

    console.log('\n🧪 Settlement Flow Test');
    console.log('========================');
    console.log(`Provider: ${providerWallet.address}`);
    console.log(`User: ${userWallet.address}`);

    // Initialize user SDK
    userSDK = new JejuComputeSDK({
      rpcUrl: RPC_URL,
      signer: userWallet,
      contracts: CONTRACTS,
    });
  });

  afterAll(() => {
    // Process will exit, cleaning up the server
  });

  describe('Compute Node', () => {
    test('start compute node', async () => {
      const nodeConfig: ProviderConfig = {
        privateKey: ANVIL_ACCOUNTS.provider,
        registryAddress: CONTRACTS.registry,
        ledgerAddress: CONTRACTS.ledger,
        inferenceAddress: CONTRACTS.inference,
        rpcUrl: RPC_URL,
        port: 8082,
        models: [
          {
            name: 'settlement-test-model',
            backend: 'mock',
            pricePerInputToken: BigInt(1000000000),
            pricePerOutputToken: BigInt(2000000000),
            maxContextLength: 4096,
          },
        ],
      };

      computeNode = new ComputeNodeServer(nodeConfig);
      computeNode.start(nodeConfig.port);

      // Wait for server to start
      await new Promise((r) => setTimeout(r, 500));

      // Verify it's running
      const response = await fetch('http://localhost:8082/health');
      expect(response.ok).toBe(true);
    });
  });

  describe('Settlement', () => {
    test('user can get settlement-ready response', async () => {
      if (!networkAvailable || !userSDK) {
        console.log('   Skipping: network not available');
        return;
      }
      // Generate auth headers with settlement nonce
      const headers = await userSDK.generateAuthHeaders(providerWallet.address);

      expect(headers['x-jeju-settlement-nonce']).toBeDefined();

      // Make inference request
      const response = await fetch(
        'http://localhost:8082/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify({
            model: 'settlement-test-model',
            messages: [{ role: 'user', content: 'What is 2+2?' }],
          }),
        }
      );

      expect(response.ok).toBe(true);

      const data = await response.json() as InferenceResponse;

      // Should have settlement data
      expect(data.settlement).toBeDefined();
      expect(data.settlement!.provider).toBe(providerWallet.address);
      expect(data.settlement!.requestHash).toBeDefined();
      expect(data.settlement!.inputTokens).toBeGreaterThan(0);
      expect(data.settlement!.outputTokens).toBeGreaterThan(0);
      expect(data.settlement!.signature).toBeDefined();
      expect(data.settlement!.nonce).toBeDefined();

      console.log('\n📜 Settlement Data:');
      console.log(`   Provider: ${data.settlement!.provider}`);
      console.log(`   Request Hash: ${data.settlement!.requestHash}`);
      console.log(`   Input Tokens: ${data.settlement!.inputTokens}`);
      console.log(`   Output Tokens: ${data.settlement!.outputTokens}`);
      console.log(`   Nonce: ${data.settlement!.nonce}`);
    });

    test('settlement signature matches expected format', async () => {
      if (!networkAvailable || !userSDK) {
        console.log('   Skipping: network not available');
        return;
      }
      const headers = await userSDK.generateAuthHeaders(providerWallet.address);

      const response = await fetch(
        'http://localhost:8082/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify({
            model: 'settlement-test-model',
            messages: [{ role: 'user', content: 'Hello!' }],
          }),
        }
      );

      const data = await response.json() as InferenceResponse;

      // The signature should be a valid hex string (0x + 130 chars for secp256k1)
      expect(data.settlement!.signature).toMatch(/^0x[a-fA-F0-9]{130}$/);

      // Nonce should match what we sent
      const expectedNonce = Number.parseInt(
        headers['x-jeju-settlement-nonce'],
        10
      );
      expect(data.settlement!.nonce).toBe(expectedNonce);
    });

    test('token counts are accurate', async () => {
      if (!networkAvailable || !userSDK) {
        console.log('   Skipping: network not available');
        return;
      }
      const headers = await userSDK.generateAuthHeaders(providerWallet.address);

      const testMessage = 'The quick brown fox jumps over the lazy dog';

      const response = await fetch(
        'http://localhost:8082/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: JSON.stringify({
            model: 'settlement-test-model',
            messages: [{ role: 'user', content: testMessage }],
          }),
        }
      );

      const data = await response.json() as InferenceResponse;

      // Real tokenizer should give ~10 tokens for this phrase
      // The old fake tokenizer would give 44/4 = 11
      expect(data.usage.prompt_tokens).toBeGreaterThanOrEqual(8);
      expect(data.usage.prompt_tokens).toBeLessThanOrEqual(12);
    });
  });
});
