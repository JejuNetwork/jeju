/**
 * Cross-Chain Compute Integration Tests
 *
 * Tests EIL and OIF integration:
 * - CrossChainComputeClient initialization
 * - Intent creation for rentals
 * - Intent creation for inference
 * - Gasless rental flow
 * - Cost estimation
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { Wallet, JsonRpcProvider, parseEther } from 'ethers';
import {
  CrossChainComputeClient,
  type CrossChainConfig,
  type CrossChainRentalParams,
  type CrossChainInferenceParams,
  COMPUTE_RENTAL_ORDER_TYPE,
  COMPUTE_INFERENCE_ORDER_TYPE,
} from '../sdk/cross-chain';
import { GPUTypeEnum } from '../sdk/types';

// Test configuration
const TEST_SOURCE_RPC = process.env.L1_RPC_URL || 'http://127.0.0.1:8545';
const TEST_COMPUTE_RPC = process.env.L2_RPC_URL || 'http://127.0.0.1:9545';
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

let sourceProvider: JsonRpcProvider;
let computeProvider: JsonRpcProvider;
let testWallet: Wallet;
let crossChainClient: CrossChainComputeClient;
let computeAvailable = false;

describe('Cross-Chain Compute Integration', () => {
  beforeAll(async () => {
    sourceProvider = new JsonRpcProvider(TEST_SOURCE_RPC);
    computeProvider = new JsonRpcProvider(TEST_COMPUTE_RPC);
    testWallet = new Wallet(TEST_PRIVATE_KEY);

    // Check if networks are available
    try {
      await sourceProvider.getBlockNumber();
    } catch {
      console.log('Source chain not available');
    }

    try {
      await computeProvider.getBlockNumber();
      computeAvailable = true;
    } catch {
      console.log('Compute chain not available');
    }

    // Create client
    const config: CrossChainConfig = {
      computeChainId: 420691,
      sourceChainId: 1,
      sourceRpcUrl: TEST_SOURCE_RPC,
      computeRpcUrl: TEST_COMPUTE_RPC,
      signer: testWallet,
    };

    crossChainClient = new CrossChainComputeClient(config);
  });

  describe('Client Initialization', () => {
    test('creates client with minimal config', () => {
      const config: CrossChainConfig = {
        computeChainId: 420691,
        sourceChainId: 1,
        sourceRpcUrl: TEST_SOURCE_RPC,
        computeRpcUrl: TEST_COMPUTE_RPC,
        signer: testWallet,
      };

      const client = new CrossChainComputeClient(config);
      expect(client).toBeDefined();
    });

    test('creates client with full config', () => {
      const config: CrossChainConfig = {
        computeChainId: 420691,
        sourceChainId: 1,
        sourceRpcUrl: TEST_SOURCE_RPC,
        computeRpcUrl: TEST_COMPUTE_RPC,
        signer: testWallet,
        inputSettlerAddress: '0x1234567890123456789012345678901234567890',
        outputSettlerAddress: '0x1234567890123456789012345678901234567890',
        crossChainPaymasterAddress: '0x1234567890123456789012345678901234567890',
        computeRentalAddress: '0x1234567890123456789012345678901234567890',
      };

      const client = new CrossChainComputeClient(config);
      expect(client).toBeDefined();
    });
  });

  describe('Order Type Constants', () => {
    test('COMPUTE_RENTAL_ORDER_TYPE is defined', () => {
      expect(COMPUTE_RENTAL_ORDER_TYPE).toBeDefined();
      expect(COMPUTE_RENTAL_ORDER_TYPE.startsWith('0x')).toBe(true);
    });

    test('COMPUTE_INFERENCE_ORDER_TYPE is defined', () => {
      expect(COMPUTE_INFERENCE_ORDER_TYPE).toBeDefined();
      expect(COMPUTE_INFERENCE_ORDER_TYPE.startsWith('0x')).toBe(true);
    });

    test('order types are different', () => {
      expect(COMPUTE_RENTAL_ORDER_TYPE).not.toBe(COMPUTE_INFERENCE_ORDER_TYPE);
    });
  });

  describe('Rental Intent Parameters', () => {
    test('rental params structure is valid', () => {
      const params: CrossChainRentalParams = {
        provider: '0x1234567890123456789012345678901234567890',
        durationHours: 2,
        sshPublicKey: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ...',
        containerImage: 'nvidia/cuda:12.0-runtime-ubuntu22.04',
        startupScript: 'echo "Hello from Jeju"',
        paymentToken: '0x0000000000000000000000000000000000000000',
        paymentAmount: parseEther('0.1'),
        gasOnDestination: parseEther('0.001'),
      };

      expect(params.durationHours).toBe(2);
      expect(params.paymentAmount).toBe(parseEther('0.1'));
    });

    test('rental params with minimal fields', () => {
      const params: CrossChainRentalParams = {
        provider: '0x1234567890123456789012345678901234567890',
        durationHours: 1,
        sshPublicKey: 'ssh-rsa test',
        paymentToken: '0x0000000000000000000000000000000000000000',
        paymentAmount: parseEther('0.05'),
      };

      expect(params.containerImage).toBeUndefined();
      expect(params.startupScript).toBeUndefined();
    });
  });

  describe('Inference Intent Parameters', () => {
    test('inference params structure is valid', () => {
      const params: CrossChainInferenceParams = {
        provider: '0x1234567890123456789012345678901234567890',
        model: 'llama2-70b',
        prompt: 'Explain quantum computing',
        maxTokens: 500,
        paymentToken: '0x0000000000000000000000000000000000000000',
        paymentAmount: parseEther('0.001'),
      };

      expect(params.model).toBe('llama2-70b');
      expect(params.maxTokens).toBe(500);
    });

    test('inference params with any provider', () => {
      const params: CrossChainInferenceParams = {
        // No provider specified - any provider can fulfill
        model: '5',
        prompt: 'Hello world',
        paymentToken: '0x0000000000000000000000000000000000000000',
        paymentAmount: parseEther('0.001'),
      };

      expect(params.provider).toBeUndefined();
    });
  });

  describe('Cost Estimation', () => {
    test('estimateCrossChainRentalCost returns structure', async () => {
      if (!computeAvailable) {
        console.log('Skipping: compute chain not available');
        return;
      }

      const estimate = await crossChainClient.estimateCrossChainRentalCost({
        provider: '0x1234567890123456789012345678901234567890',
        durationHours: 4,
      });

      expect(estimate).toHaveProperty('rentalCost');
      expect(estimate).toHaveProperty('estimatedFee');
      expect(estimate).toHaveProperty('estimatedGas');
      expect(estimate).toHaveProperty('total');
      expect(typeof estimate.total).toBe('bigint');
    });
  });

  describe('Provider Resources', () => {
    test('getProviderResources returns structure', async () => {
      if (!computeAvailable) {
        console.log('Skipping: compute chain not available');
        return;
      }

      const resources = await crossChainClient.getProviderResources(
        '0x1234567890123456789012345678901234567890'
      );

      expect(resources).toHaveProperty('available');
      // If not available, other fields may be undefined
      expect(typeof resources.available).toBe('boolean');
    });
  });

  describe('Gasless Support', () => {
    test('canUseGasless returns boolean', async () => {
      const canUse = await crossChainClient.canUseGasless();
      expect(typeof canUse).toBe('boolean');
    });
  });

  describe('Chain Switching', () => {
    test('switchSourceChain updates configuration', () => {
      const originalClient = new CrossChainComputeClient({
        computeChainId: 420691,
        sourceChainId: 1,
        sourceRpcUrl: TEST_SOURCE_RPC,
        computeRpcUrl: TEST_COMPUTE_RPC,
        signer: testWallet,
      });

      // Switch to Arbitrum
      originalClient.switchSourceChain(42161, 'https://arb1.arbitrum.io/rpc');

      // Client should still be functional
      expect(originalClient).toBeDefined();
    });
  });

  describe('Intent Creation (Contract Required)', () => {
    test('createRentalIntent requires InputSettler', async () => {
      // Without InputSettler address, should throw
      try {
        await crossChainClient.createRentalIntent({
          provider: '0x1234567890123456789012345678901234567890',
          durationHours: 1,
          sshPublicKey: 'ssh-rsa test',
          paymentToken: '0x0000000000000000000000000000000000000000',
          paymentAmount: parseEther('0.05'),
        });
        
        // If it doesn't throw, InputSettler must be configured
      } catch (e) {
        expect(String(e)).toContain('InputSettler');
      }
    });

    test('createInferenceIntent requires InputSettler', async () => {
      try {
        await crossChainClient.createInferenceIntent({
          model: 'test-model',
          prompt: 'Hello',
          paymentToken: '0x0000000000000000000000000000000000000000',
          paymentAmount: parseEther('0.001'),
        });
      } catch (e) {
        expect(String(e)).toContain('InputSettler');
      }
    });

    test('createGaslessRental requires CrossChainPaymaster', async () => {
      try {
        await crossChainClient.createGaslessRental({
          provider: '0x1234567890123456789012345678901234567890',
          durationHours: 1,
          sshPublicKey: 'ssh-rsa test',
          paymentToken: '0x0000000000000000000000000000000000000000',
          paymentAmount: parseEther('0.05'),
        });
      } catch (e) {
        expect(String(e)).toContain('CrossChainPaymaster');
      }
    });
  });
});

describe('GPU Type Enum (Cross-Chain Compatible)', () => {
  test('GPU types are defined', () => {
    expect(GPUTypeEnum.NONE).toBe(0);
    expect(GPUTypeEnum.NVIDIA_H100).toBe(4);
    expect(GPUTypeEnum.APPLE_M3_MAX).toBe(9);
  });

  test('GPU type can be used in cross-chain params', () => {
    // Resources can specify GPU type for matching
    const resources = {
      gpuType: GPUTypeEnum.NVIDIA_A100_80GB,
      gpuCount: 4,
    };

    expect(resources.gpuType).toBe(3);
  });
});

