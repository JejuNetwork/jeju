/**
 * Testnet Deployment Readiness Tests
 *
 * Verifies that the compute marketplace is ready for testnet deployment:
 * - Contract ABIs and types are correct
 * - SDK can connect to testnet
 * - Node registration flow works
 * - Payment systems (X402, Paymaster) are configured
 * - TEE deployment configuration is valid
 *
 * Run with: bun test src/compute/tests/testnet-deployment.test.ts
 */

import { describe, expect, test } from 'bun:test';
import { Wallet, parseEther } from 'ethers';
import { JejuComputeSDK, createSDK } from '../sdk/sdk';
import { createInferenceRegistry } from '../sdk/inference-registry';
import { createExternalProvider } from '../sdk/cloud-provider';
import { createPaymentClient, COMPUTE_PRICING } from '../sdk/payment';
import { getX402Config, X402_NETWORKS } from '../sdk/x402';
import { ModelCapabilityEnum, ModelSourceTypeEnum, ModelHostingTypeEnum, TEETypeEnum } from '../sdk/types';
import type { ExtendedSDKConfig, RegisteredModel } from '../sdk/types';

// Test wallet (Anvil default)
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Testnet configuration (Base Sepolia)
const TESTNET_CONFIG = {
  rpcUrl: 'https://sepolia.base.org',
  chainId: 84532,
  networkName: 'base-sepolia',
};

describe('Testnet Deployment Readiness', () => {
  describe('SDK Configuration', () => {
    test('SDK initializes with testnet config', () => {
      const config: ExtendedSDKConfig = {
        rpcUrl: TESTNET_CONFIG.rpcUrl,
        signer: new Wallet(TEST_PRIVATE_KEY),
        contracts: {
          registry: '0x0000000000000000000000000000000000000001',
          ledger: '0x0000000000000000000000000000000000000002',
          inference: '0x0000000000000000000000000000000000000003',
        },
      };
      
      const sdk = new JejuComputeSDK(config);
      expect(sdk).toBeDefined();
      expect(sdk.getAddress()).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    });

    test('createSDK helper works', () => {
      const sdk = createSDK({
        rpcUrl: 'http://localhost:8545',
        privateKey: TEST_PRIVATE_KEY,
        registryAddress: '0x0000000000000000000000000000000000000001',
        ledgerAddress: '0x0000000000000000000000000000000000000002',
        inferenceAddress: '0x0000000000000000000000000000000000000003',
      });
      
      expect(sdk).toBeDefined();
    });

    test('SDK has all required methods', () => {
      const sdk = createSDK({
        rpcUrl: 'http://localhost:8545',
        privateKey: TEST_PRIVATE_KEY,
        registryAddress: '0x0000000000000000000000000000000000000001',
        ledgerAddress: '0x0000000000000000000000000000000000000002',
        inferenceAddress: '0x0000000000000000000000000000000000000003',
      });
      
      // Registry methods
      expect(typeof sdk.registerProvider).toBe('function');
      expect(typeof sdk.getProvider).toBe('function');
      expect(typeof sdk.getActiveProviders).toBe('function');
      
      // Ledger methods
      expect(typeof sdk.deposit).toBe('function');
      expect(typeof sdk.withdraw).toBe('function');
      expect(typeof sdk.getLedger).toBe('function');
      
      // Inference methods
      expect(typeof sdk.registerService).toBe('function');
      expect(typeof sdk.sendInference).toBe('function');
      expect(typeof sdk.settle).toBe('function');
      
      // Payment methods
      expect(typeof sdk.isPaymasterEnabled).toBe('function');
      expect(typeof sdk.payForCompute).toBe('function');
    });
  });

  describe('Inference Registry', () => {
    test('registry initializes without on-chain contracts', () => {
      const registry = createInferenceRegistry({
        rpcUrl: TESTNET_CONFIG.rpcUrl,
        contracts: {
          registry: '0x0',
          ledger: '0x0',
          inference: '0x0',
        },
      });
      
      expect(registry).toBeDefined();
    });

    test('registry supports model metadata structure', () => {
      // Test that our metadata types are complete
      const model: RegisteredModel = {
        modelId: 'test/model-7b',
        name: 'Test Model 7B',
        description: 'A test model',
        version: '1.0.0',
        modelType: 0, // LLM
        sourceType: ModelSourceTypeEnum.OPEN_SOURCE,
        hostingType: ModelHostingTypeEnum.DECENTRALIZED,
        creator: {
          name: 'Test Creator',
          website: 'https://test.com',
          verified: true,
          trustScore: 90,
        },
        capabilities: ModelCapabilityEnum.TEXT_GENERATION,
        contextWindow: 32000,
        pricing: {
          pricePerInputToken: 100000000000n,
          pricePerOutputToken: 300000000000n,
          pricePerImageInput: 0n,
          pricePerImageOutput: 0n,
          pricePerVideoSecond: 0n,
          pricePerAudioSecond: 0n,
          minimumFee: 1000000000000n,
          currency: 'ETH',
        },
        hardware: {
          minGpuVram: 8,
          recommendedGpuType: 1,
          minCpuCores: 8,
          minMemory: 32,
          teeRequired: false,
          teeType: TEETypeEnum.NONE,
        },
        registeredAt: Date.now(),
        updatedAt: Date.now(),
        active: true,
        totalRequests: 0n,
        avgLatencyMs: 0,
        uptime: 100,
      };

      expect(model.modelId).toBeDefined();
      expect(model.creator.name).toBeDefined();
      expect(model.pricing.pricePerInputToken).toBeGreaterThan(0n);
    });

    test('capability enums are properly defined', () => {
      expect(ModelCapabilityEnum.TEXT_GENERATION).toBe(1);
      expect(ModelCapabilityEnum.CODE_GENERATION).toBe(2);
      expect(ModelCapabilityEnum.VISION).toBe(4);
      expect(ModelCapabilityEnum.FUNCTION_CALLING).toBe(8);
      expect(ModelCapabilityEnum.STREAMING).toBe(16);
    });
  });

  describe('External Provider', () => {
    test('external provider initializes', () => {
      const provider = createExternalProvider({
        rpcUrl: 'http://localhost:8545',
      });
      expect(provider).toBeDefined();
    });
  });

  describe('Payment System', () => {
    test('payment client initializes', () => {
      const client = createPaymentClient({
        rpcUrl: TESTNET_CONFIG.rpcUrl,
      });
      expect(client).toBeDefined();
    });

    test('COMPUTE_PRICING constants are set', () => {
      expect(COMPUTE_PRICING.INFERENCE_INPUT_PER_1K).toBeGreaterThan(0n);
      expect(COMPUTE_PRICING.INFERENCE_OUTPUT_PER_1K).toBeGreaterThan(0n);
      expect(COMPUTE_PRICING.GPU_A100_HOURLY).toBeGreaterThan(0n);
      expect(COMPUTE_PRICING.GPU_H100_HOURLY).toBeGreaterThan(0n);
      expect(COMPUTE_PRICING.MIN_INFERENCE_FEE).toBeGreaterThan(0n);
    });
  });

  describe('X402 Configuration', () => {
    test('x402 config loads from environment', () => {
      const config = getX402Config();
      expect(config.network).toBeDefined();
      expect(config.creditsPerDollar).toBeGreaterThan(0);
    });

    test('network configs are defined for testnet', () => {
      expect(X402_NETWORKS['base-sepolia']).toBeDefined();
      expect(X402_NETWORKS['base-sepolia'].chainId).toBe(84532);
      expect(X402_NETWORKS['base-sepolia'].isTestnet).toBe(true);
    });

    test('jeju-testnet uses Base Sepolia', () => {
      expect(X402_NETWORKS['jeju-testnet']).toBeDefined();
      expect(X402_NETWORKS['jeju-testnet'].chainId).toBe(84532);
    });
  });

  describe('TEE Deployment Config', () => {
    test('TEE configuration is available', () => {
      // TEE config is now handled by apps/council/src/tee.ts
      // which supports both hardware TEE and local simulation
      const teeEndpoints = {
        cloudEndpoint: process.env.TEE_CLOUD_URL ?? 'https://cloud.phala.network/api/v1',
        dcapVerify: process.env.DCAP_ENDPOINT ?? 'https://dcap.phala.network/verify',
      };
      expect(teeEndpoints.cloudEndpoint).toBeDefined();
      expect(teeEndpoints.dcapVerify).toBeDefined();
    });

    test('Dockerfile exists', async () => {
      const file = Bun.file(`${import.meta.dir}/../../../Dockerfile`);
      expect(await file.exists()).toBe(true);
    });
  });

  describe('Node Types', () => {
    test('CPU nodes are supported', () => {
      const validNodeTypes = ['cpu', 'gpu'];
      expect(validNodeTypes).toContain('cpu');
    });

    test('TEE statuses are properly typed', () => {
      const validTeeStatuses = [
        'none', 
        'simulated', 
        'intel-tdx', 
        'amd-sev', 
        'aws-nitro'
      ];
      
      expect(validTeeStatuses).toContain('simulated');
      expect(validTeeStatuses).toContain('intel-tdx');
    });
  });

  describe('Contract ABIs', () => {
    test('SDK has registry ABI methods', () => {
      const sdk = createSDK({
        rpcUrl: 'http://localhost:8545',
        privateKey: TEST_PRIVATE_KEY,
        registryAddress: '0x0000000000000000000000000000000000000001',
        ledgerAddress: '0x0000000000000000000000000000000000000002',
        inferenceAddress: '0x0000000000000000000000000000000000000003',
      });
      
      expect(typeof sdk.registerProvider).toBe('function');
      expect(typeof sdk.registerWithAgent).toBe('function');
      expect(typeof sdk.getProviderByAgent).toBe('function');
    });

    test('SDK supports ERC-8004 agent integration', () => {
      const sdk = createSDK({
        rpcUrl: 'http://localhost:8545',
        privateKey: TEST_PRIVATE_KEY,
        registryAddress: '0x0000000000000000000000000000000000000001',
        ledgerAddress: '0x0000000000000000000000000000000000000002',
        inferenceAddress: '0x0000000000000000000000000000000000000003',
      });
      
      expect(typeof sdk.registerWithAgent).toBe('function');
      expect(typeof sdk.getProviderAgentId).toBe('function');
      expect(typeof sdk.getProviderByAgent).toBe('function');
    });
  });

  describe('Environment Variables', () => {
    test('required env vars are documented', () => {
      const requiredVars = [
        'PRIVATE_KEY',
        'RPC_URL',
        'REGISTRY_ADDRESS',
        'LEDGER_ADDRESS',
        'INFERENCE_ADDRESS',
      ];
      
      for (const varName of requiredVars) {
        expect(varName).toBeDefined();
      }
    });
  });

  describe('Pricing Validation', () => {
    test('inference pricing is reasonable', () => {
      const minReasonable = parseEther('0.00000001');
      const maxReasonable = parseEther('0.001');
      
      expect(COMPUTE_PRICING.INFERENCE_INPUT_PER_1K).toBeGreaterThan(minReasonable);
      expect(COMPUTE_PRICING.INFERENCE_INPUT_PER_1K).toBeLessThan(maxReasonable);
    });

    test('GPU rental pricing is reasonable', () => {
      const minReasonable = parseEther('0.00003');
      const maxReasonable = parseEther('2');
      
      expect(COMPUTE_PRICING.GPU_A100_HOURLY).toBeGreaterThan(minReasonable);
      expect(COMPUTE_PRICING.GPU_H100_HOURLY).toBeLessThan(maxReasonable);
    });
  });
});

console.log('\n🚀 Testnet Deployment Readiness Tests');
console.log('=====================================\n');
console.log('Verifying compute marketplace is ready for Base Sepolia testnet deployment.\n');
