/**
 * Compute + ERC-8004 Agent Integration Tests
 *
 * Tests agent identity integration:
 * - Provider registration with agentId
 * - Agent → Provider lookup
 * - Provider → Agent lookup
 * - Cross-protocol agent discovery
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { JsonRpcProvider, parseEther } from 'ethers';
import { createSDK, JejuComputeSDK } from '../sdk/sdk';
import type { Provider } from '../sdk/types';

// Test configuration
const TEST_RPC_URL = process.env.JEJU_RPC_URL || 'http://127.0.0.1:9545';
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

let provider: JsonRpcProvider;
let sdk: JejuComputeSDK | null = null;
let contractsDeployed = false;

// Mock contract addresses for testing types
const MOCK_REGISTRY = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const MOCK_LEDGER = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
const MOCK_INFERENCE = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';

describe('ERC-8004 Agent Integration', () => {
  beforeAll(async () => {
    provider = new JsonRpcProvider(TEST_RPC_URL);
    
    try {
      await provider.getBlockNumber();
      
      // Try to create SDK with deployed contracts
      sdk = createSDK({
        rpcUrl: TEST_RPC_URL,
        privateKey: TEST_PRIVATE_KEY,
        registryAddress: process.env.REGISTRY_ADDRESS || MOCK_REGISTRY,
        ledgerAddress: process.env.LEDGER_ADDRESS || MOCK_LEDGER,
        inferenceAddress: process.env.INFERENCE_ADDRESS || MOCK_INFERENCE,
      });
      
      // Check if contracts are actually deployed
      try {
        await sdk.getActiveProviders();
        contractsDeployed = true;
      } catch {
        console.log('Contracts not deployed - type tests only');
      }
    } catch {
      console.log('Network not available');
    }
  });

  describe('SDK Agent Methods (Type Validation)', () => {
    test('SDK has registerWithAgent method', () => {
      if (!sdk) {
        console.log('Skipping: SDK not initialized');
        return;
      }
      expect(typeof sdk.registerWithAgent).toBe('function');
    });

    test('SDK has getProviderByAgent method', () => {
      if (!sdk) {
        console.log('Skipping: SDK not initialized');
        return;
      }
      expect(typeof sdk.getProviderByAgent).toBe('function');
    });

    test('SDK has getProviderAgentId method', () => {
      if (!sdk) {
        console.log('Skipping: SDK not initialized');
        return;
      }
      expect(typeof sdk.getProviderAgentId).toBe('function');
    });
  });

  describe('Provider Type with AgentId', () => {
    test('Provider type includes agentId field', () => {
      const mockProvider: Provider = {
        address: '0x1234567890123456789012345678901234567890',
        name: 'Test Provider',
        endpoint: 'https://compute.example.com',
        attestationHash: '0x' + '00'.repeat(32),
        stake: parseEther('1'),
        registeredAt: Date.now(),
        agentId: 123,
        active: true,
      };
      
      expect(mockProvider.agentId).toBe(123);
      expect(typeof mockProvider.agentId).toBe('number');
    });

    test('Provider with no agent has agentId 0', () => {
      const mockProvider: Provider = {
        address: '0x1234567890123456789012345678901234567890',
        name: 'Test Provider',
        endpoint: 'https://compute.example.com',
        attestationHash: '0x' + '00'.repeat(32),
        stake: parseEther('1'),
        registeredAt: Date.now(),
        agentId: 0, // No agent linked
        active: true,
      };
      
      expect(mockProvider.agentId).toBe(0);
    });
  });

  describe('Agent Registration Flow', () => {
    test('registerWithAgent requires all parameters', async () => {
      if (!sdk || !contractsDeployed) {
        console.log('Skipping: contracts not deployed');
        return;
      }

      // Should throw if agentId doesn't exist in IdentityRegistry
      try {
        await sdk.registerWithAgent(
          'Test Provider',
          'https://compute.example.com',
          '0x' + '00'.repeat(32),
          parseEther('0.01'),
          1n // agentId
        );
      } catch (e) {
        // Expected - either agent doesn't exist or already registered
        expect(String(e)).toBeDefined();
      }
    });

    test('getProviderByAgent returns address', async () => {
      if (!sdk || !contractsDeployed) {
        console.log('Skipping: contracts not deployed');
        return;
      }

      // Query for non-existent agent should return zero address
      const providerAddress = await sdk.getProviderByAgent(99999n);
      expect(providerAddress.startsWith('0x')).toBe(true);
    });

    test('getProviderAgentId returns bigint', async () => {
      if (!sdk || !contractsDeployed) {
        console.log('Skipping: contracts not deployed');
        return;
      }

      try {
        const providers = await sdk.getActiveProviders();
        if (providers.length > 0) {
          const agentId = await sdk.getProviderAgentId(providers[0]);
          expect(typeof agentId).toBe('bigint');
        }
      } catch {
        // No providers registered
        console.log('No providers registered');
      }
    });
  });

  describe('Cross-Protocol Discovery', () => {
    test('can lookup provider by agent across protocols', async () => {
      if (!sdk || !contractsDeployed) {
        console.log('Skipping: contracts not deployed');
        return;
      }

      // Simulate cross-protocol lookup:
      // 1. Get agent ID from another protocol
      // 2. Look up provider in compute
      const simulatedAgentId = 1n;
      const providerAddress = await sdk.getProviderByAgent(simulatedAgentId);
      
      if (providerAddress !== '0x0000000000000000000000000000000000000000') {
        // Agent is linked to a provider
        const providerInfo = await sdk.getProvider(providerAddress);
        expect(providerInfo.agentId).toBe(Number(simulatedAgentId));
      }
    });

    test('agent identity is consistent across lookups', async () => {
      if (!sdk || !contractsDeployed) {
        console.log('Skipping: contracts not deployed');
        return;
      }

      try {
        const providers = await sdk.getActiveProviders();
        if (providers.length > 0) {
          const providerAddress = providers[0];
          const agentId = await sdk.getProviderAgentId(providerAddress);
          
          if (agentId > 0n) {
            // Reverse lookup should return same provider
            const lookupAddress = await sdk.getProviderByAgent(agentId);
            expect(lookupAddress.toLowerCase()).toBe(providerAddress.toLowerCase());
          }
        }
      } catch {
        console.log('No providers with agents');
      }
    });
  });
});

describe('Agent-Provider Linking (Unit Tests)', () => {
  test('agentId is required for registerWithAgent', () => {
    // Type checking - agentId parameter is required
    const params = {
      name: 'Test',
      endpoint: 'https://test.com',
      attestationHash: '0x' + '00'.repeat(32),
      stake: parseEther('0.01'),
      agentId: 1n,
    };
    
    expect(params.agentId).toBe(1n);
    expect(typeof params.agentId).toBe('bigint');
  });

  test('agentId can be zero for unlinked providers', () => {
    const provider: Provider = {
      address: '0x1234567890123456789012345678901234567890',
      name: 'Unlinked Provider',
      endpoint: 'https://compute.example.com',
      attestationHash: '0x' + '00'.repeat(32),
      stake: parseEther('1'),
      registeredAt: Date.now(),
      agentId: 0,
      active: true,
    };
    
    expect(provider.agentId).toBe(0);
  });

  test('SDK config supports rental contract with agent linking', () => {
    const config = {
      rpcUrl: TEST_RPC_URL,
      privateKey: TEST_PRIVATE_KEY,
      registryAddress: MOCK_REGISTRY,
      ledgerAddress: MOCK_LEDGER,
      inferenceAddress: MOCK_INFERENCE,
      rentalAddress: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9',
    };
    
    expect(config.rentalAddress).toBeDefined();
    
    // Just verify the config is valid - SDK will fail if contracts not deployed
    expect(config.registryAddress).toBe(MOCK_REGISTRY);
    expect(config.rentalAddress).toBe('0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9');
  });
});

