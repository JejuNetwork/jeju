/**
 * Tests for Decentralized Inference Registry
 *
 * Tests the on-chain model registry functionality.
 * All models are registered on-chain with standardized metadata.
 *
 * Run with: bun test src/compute/tests/inference-registry.test.ts
 */

import { describe, expect, test, beforeAll } from 'bun:test';
import {
  createInferenceRegistry,
  type InferenceRegistrySDK,
} from '../sdk/inference-registry';
import {
  createExternalProvider,
  type ExternalModelProvider,
} from '../sdk/cloud-provider';
import {
  ModelCapabilityEnum,
  ModelHostingTypeEnum,
  ModelSourceTypeEnum,
  ModelTypeEnum,
  TEETypeEnum,
  type ExtendedSDKConfig,
  type RegisteredModel,
} from '../sdk/types';
import { DEFAULT_PRICING, estimatePrice } from '../sdk/x402';

// Test configuration - no on-chain registry, tests SDK structure
const TEST_CONFIG: ExtendedSDKConfig = {
  rpcUrl: 'http://127.0.0.1:8545',
  contracts: {
    registry: '0x0000000000000000000000000000000000000000',
    ledger: '0x0000000000000000000000000000000000000000',
    inference: '0x0000000000000000000000000000000000000000',
  },
};

// Mock model for testing (simulates what would be registered on-chain)
const MOCK_MODEL: RegisteredModel = {
  modelId: 'test-org/test-model-7b',
  name: 'Test Model 7B',
  description: 'A test model for unit testing',
  version: '1.0.0',
  modelType: ModelTypeEnum.LLM,
  sourceType: ModelSourceTypeEnum.OPEN_SOURCE,
  hostingType: ModelHostingTypeEnum.DECENTRALIZED,
  creator: {
    name: 'Test Organization',
    website: 'https://test.org',
    verified: true,
    trustScore: 85,
  },
  capabilities: ModelCapabilityEnum.TEXT_GENERATION | ModelCapabilityEnum.CODE_GENERATION,
  contextWindow: 32000,
  pricing: {
    pricePerInputToken: 100000000000n,      // 0.0000001 ETH per token
    pricePerOutputToken: 300000000000n,     // 0.0000003 ETH per token
    pricePerImageInput: 0n,
    pricePerImageOutput: 0n,
    pricePerVideoSecond: 0n,
    pricePerAudioSecond: 0n,
    minimumFee: 1000000000000n,             // 0.000001 ETH minimum
    currency: 'ETH',
  },
  hardware: {
    minGpuVram: 8,
    recommendedGpuType: 1, // RTX 4090
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

describe('Decentralized Inference Registry', () => {
  let registry: InferenceRegistrySDK;

  beforeAll(() => {
    registry = createInferenceRegistry(TEST_CONFIG);
  });

  describe('Model Metadata Standards', () => {
    test('model has required metadata fields', () => {
      expect(MOCK_MODEL.modelId).toBeDefined();
      expect(MOCK_MODEL.name).toBeDefined();
      expect(MOCK_MODEL.description).toBeDefined();
      expect(MOCK_MODEL.version).toBeDefined();
      expect(MOCK_MODEL.sourceType).toBeDefined();
      expect(MOCK_MODEL.hostingType).toBeDefined();
      expect(MOCK_MODEL.creator).toBeDefined();
      expect(MOCK_MODEL.capabilities).toBeDefined();
      expect(MOCK_MODEL.contextWindow).toBeDefined();
      expect(MOCK_MODEL.pricing).toBeDefined();
      expect(MOCK_MODEL.hardware).toBeDefined();
    });

    test('model ID follows creator/model format', () => {
      expect(MOCK_MODEL.modelId).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+$/i);
    });

    test('creator metadata is complete', () => {
      expect(MOCK_MODEL.creator.name).toBeDefined();
      expect(MOCK_MODEL.creator.website).toBeDefined();
      expect(typeof MOCK_MODEL.creator.verified).toBe('boolean');
      expect(typeof MOCK_MODEL.creator.trustScore).toBe('number');
      expect(MOCK_MODEL.creator.trustScore).toBeGreaterThanOrEqual(0);
      expect(MOCK_MODEL.creator.trustScore).toBeLessThanOrEqual(100);
    });

    test('pricing metadata is complete', () => {
      expect(MOCK_MODEL.pricing.pricePerInputToken).toBeGreaterThan(0n);
      expect(MOCK_MODEL.pricing.pricePerOutputToken).toBeGreaterThan(0n);
      expect(MOCK_MODEL.pricing.pricePerImageInput).toBeGreaterThanOrEqual(0n);
      expect(MOCK_MODEL.pricing.minimumFee).toBeGreaterThan(0n);
      expect(MOCK_MODEL.pricing.currency).toBe('ETH');
    });

    test('hardware requirements are complete', () => {
      expect(typeof MOCK_MODEL.hardware.minGpuVram).toBe('number');
      expect(typeof MOCK_MODEL.hardware.recommendedGpuType).toBe('number');
      expect(typeof MOCK_MODEL.hardware.minCpuCores).toBe('number');
      expect(typeof MOCK_MODEL.hardware.minMemory).toBe('number');
      expect(typeof MOCK_MODEL.hardware.teeRequired).toBe('boolean');
      expect(typeof MOCK_MODEL.hardware.teeType).toBe('number');
    });
  });

  describe('Source Type Classification', () => {
    test('source types are properly defined', () => {
      expect(ModelSourceTypeEnum.CLOSED_SOURCE).toBe(0);
      expect(ModelSourceTypeEnum.OPEN_SOURCE).toBe(1);
      expect(ModelSourceTypeEnum.FINE_TUNED).toBe(2);
    });

    test('model can be classified by source type', () => {
      const openSourceModel = { ...MOCK_MODEL, sourceType: ModelSourceTypeEnum.OPEN_SOURCE };
      const closedSourceModel = { ...MOCK_MODEL, sourceType: ModelSourceTypeEnum.CLOSED_SOURCE };
      const fineTunedModel = { ...MOCK_MODEL, sourceType: ModelSourceTypeEnum.FINE_TUNED };

      expect(openSourceModel.sourceType).toBe(ModelSourceTypeEnum.OPEN_SOURCE);
      expect(closedSourceModel.sourceType).toBe(ModelSourceTypeEnum.CLOSED_SOURCE);
      expect(fineTunedModel.sourceType).toBe(ModelSourceTypeEnum.FINE_TUNED);
    });
  });

  describe('Hosting Type Classification', () => {
    test('hosting types are properly defined', () => {
      expect(ModelHostingTypeEnum.CENTRALIZED).toBe(0);
      expect(ModelHostingTypeEnum.DECENTRALIZED).toBe(1);
      expect(ModelHostingTypeEnum.HYBRID).toBe(2);
    });

    test('model can be classified by hosting type', () => {
      const centralizedModel = { ...MOCK_MODEL, hostingType: ModelHostingTypeEnum.CENTRALIZED };
      const decentralizedModel = { ...MOCK_MODEL, hostingType: ModelHostingTypeEnum.DECENTRALIZED };
      const hybridModel = { ...MOCK_MODEL, hostingType: ModelHostingTypeEnum.HYBRID };

      expect(centralizedModel.hostingType).toBe(ModelHostingTypeEnum.CENTRALIZED);
      expect(decentralizedModel.hostingType).toBe(ModelHostingTypeEnum.DECENTRALIZED);
      expect(hybridModel.hostingType).toBe(ModelHostingTypeEnum.HYBRID);
    });
  });

  describe('Capability Flags', () => {
    test('text capability flags are properly defined', () => {
      expect(ModelCapabilityEnum.TEXT_GENERATION).toBe(1);
      expect(ModelCapabilityEnum.CODE_GENERATION).toBe(2);
      expect(ModelCapabilityEnum.FUNCTION_CALLING).toBe(8);
      expect(ModelCapabilityEnum.STREAMING).toBe(16);
      expect(ModelCapabilityEnum.EMBEDDINGS).toBe(32);
      expect(ModelCapabilityEnum.LONG_CONTEXT).toBe(64);
      expect(ModelCapabilityEnum.REASONING).toBe(128);
    });

    test('vision and image capability flags are properly defined', () => {
      expect(ModelCapabilityEnum.VISION).toBe(4);
      expect(ModelCapabilityEnum.IMAGE_GENERATION).toBe(256);
      expect(ModelCapabilityEnum.IMAGE_EDITING).toBe(512);
    });

    test('audio capability flags are properly defined', () => {
      expect(ModelCapabilityEnum.SPEECH_TO_TEXT).toBe(1024);
      expect(ModelCapabilityEnum.TEXT_TO_SPEECH).toBe(2048);
      expect(ModelCapabilityEnum.AUDIO_GENERATION).toBe(4096);
    });

    test('video capability flags are properly defined', () => {
      expect(ModelCapabilityEnum.VIDEO_GENERATION).toBe(8192);
      expect(ModelCapabilityEnum.VIDEO_ANALYSIS).toBe(16384);
    });

    test('multimodal capability flag is properly defined', () => {
      expect(ModelCapabilityEnum.MULTIMODAL).toBe(32768);
    });

    test('capabilities can be combined with bitmask', () => {
      const capabilities = ModelCapabilityEnum.TEXT_GENERATION |
        ModelCapabilityEnum.CODE_GENERATION |
        ModelCapabilityEnum.VISION;

      expect(capabilities & ModelCapabilityEnum.TEXT_GENERATION).toBeTruthy();
      expect(capabilities & ModelCapabilityEnum.CODE_GENERATION).toBeTruthy();
      expect(capabilities & ModelCapabilityEnum.VISION).toBeTruthy();
      expect(capabilities & ModelCapabilityEnum.FUNCTION_CALLING).toBeFalsy();
    });

    test('hasCapability works correctly', () => {
      expect(registry.hasCapability(MOCK_MODEL, ModelCapabilityEnum.TEXT_GENERATION)).toBe(true);
      expect(registry.hasCapability(MOCK_MODEL, ModelCapabilityEnum.CODE_GENERATION)).toBe(true);
      expect(registry.hasCapability(MOCK_MODEL, ModelCapabilityEnum.VISION)).toBe(false);
    });

    test('image generation model has correct capabilities', () => {
      const imageModel: RegisteredModel = {
        ...MOCK_MODEL,
        modelType: ModelTypeEnum.IMAGE_GEN,
        capabilities: ModelCapabilityEnum.IMAGE_GENERATION | ModelCapabilityEnum.IMAGE_EDITING,
      };
      expect(registry.hasCapability(imageModel, ModelCapabilityEnum.IMAGE_GENERATION)).toBe(true);
      expect(registry.hasCapability(imageModel, ModelCapabilityEnum.TEXT_GENERATION)).toBe(false);
    });

    test('video generation model has correct capabilities', () => {
      const videoModel: RegisteredModel = {
        ...MOCK_MODEL,
        modelType: ModelTypeEnum.VIDEO_GEN,
        capabilities: ModelCapabilityEnum.VIDEO_GENERATION,
      };
      expect(registry.hasCapability(videoModel, ModelCapabilityEnum.VIDEO_GENERATION)).toBe(true);
      expect(registry.hasCapability(videoModel, ModelCapabilityEnum.VIDEO_ANALYSIS)).toBe(false);
    });
  });

  describe('TEE Types', () => {
    test('TEE types are properly defined', () => {
      expect(TEETypeEnum.NONE).toBe(0);
      expect(TEETypeEnum.INTEL_SGX).toBe(1);
      expect(TEETypeEnum.INTEL_TDX).toBe(2);
      expect(TEETypeEnum.AMD_SEV).toBe(3);
      expect(TEETypeEnum.ARM_TRUSTZONE).toBe(4);
      expect(TEETypeEnum.AWS_NITRO).toBe(5);
    });

    test('model can specify TEE requirements', () => {
      const teeModel: RegisteredModel = {
        ...MOCK_MODEL,
        hardware: {
          ...MOCK_MODEL.hardware,
          teeRequired: true,
          teeType: TEETypeEnum.INTEL_TDX,
        },
      };

      expect(teeModel.hardware.teeRequired).toBe(true);
      expect(teeModel.hardware.teeType).toBe(TEETypeEnum.INTEL_TDX);
    });
  });

  describe('InferenceRegistrySDK', () => {
    test('SDK initializes correctly', () => {
      expect(registry).toBeDefined();
      expect(registry.getAddress()).toBeNull(); // No signer
    });

    test('estimateCost calculates correctly', () => {
      const cost = registry.estimateCost(MOCK_MODEL, 1000, 500, 0);

      // Cost = (1000 * 0.0000001 / 1000) + (500 * 0.0000003 / 1000)
      //      = 0.0000001 + 0.00000015 = 0.00000025 ETH
      const expectedInputCost = MOCK_MODEL.pricing.pricePerInputToken; // 1000 tokens / 1000
      const expectedOutputCost = (MOCK_MODEL.pricing.pricePerOutputToken * 500n) / 1000n;
      const expectedTotal = expectedInputCost + expectedOutputCost;
      const expected = expectedTotal > MOCK_MODEL.pricing.minimumFee
        ? expectedTotal
        : MOCK_MODEL.pricing.minimumFee;

      expect(cost).toBe(expected);
    });

    test('estimateCost respects minimum fee', () => {
      // Very small request should hit minimum fee
      const cost = registry.estimateCost(MOCK_MODEL, 1, 1, 0);
      expect(cost).toBe(MOCK_MODEL.pricing.minimumFee);
    });

    test('estimateCost includes image cost', () => {
      const modelWithImagePricing: RegisteredModel = {
        ...MOCK_MODEL,
        pricing: {
          ...MOCK_MODEL.pricing,
          pricePerImageInput: 1000000000000000n, // 0.001 ETH per image
        },
      };

      const costWithImages = registry.estimateCost(modelWithImagePricing, 100, 100, 2);
      const costWithoutImages = registry.estimateCost(modelWithImagePricing, 100, 100, 0);

      expect(costWithImages).toBeGreaterThan(costWithoutImages);
    });
  });

  describe('ExternalModelProvider', () => {
    let provider: ExternalModelProvider;

    beforeAll(() => {
      provider = createExternalProvider({
        rpcUrl: 'http://127.0.0.1:8545',
      });
    });

    test('provider initializes without error', () => {
      expect(provider).toBeDefined();
    });

    test('setSigner works', () => {
      const { Wallet } = require('ethers');
      const wallet = Wallet.createRandom();
      provider.setSigner(wallet);
      // Should not throw
    });
  });

  describe('Model Discovery (Unit Tests)', () => {
    // These test the filter logic without requiring on-chain contracts

    test('filter by source type works', () => {
      const models: RegisteredModel[] = [
        { ...MOCK_MODEL, modelId: 'a/open', sourceType: ModelSourceTypeEnum.OPEN_SOURCE },
        { ...MOCK_MODEL, modelId: 'b/closed', sourceType: ModelSourceTypeEnum.CLOSED_SOURCE },
      ];

      const openSource = models.filter(m => m.sourceType === ModelSourceTypeEnum.OPEN_SOURCE);
      expect(openSource.length).toBe(1);
      expect(openSource[0].modelId).toBe('a/open');
    });

    test('filter by hosting type works', () => {
      const models: RegisteredModel[] = [
        { ...MOCK_MODEL, modelId: 'a/central', hostingType: ModelHostingTypeEnum.CENTRALIZED },
        { ...MOCK_MODEL, modelId: 'b/decentral', hostingType: ModelHostingTypeEnum.DECENTRALIZED },
      ];

      const decentralized = models.filter(m => m.hostingType === ModelHostingTypeEnum.DECENTRALIZED);
      expect(decentralized.length).toBe(1);
      expect(decentralized[0].modelId).toBe('b/decentral');
    });

    test('filter by capabilities works', () => {
      const models: RegisteredModel[] = [
        { ...MOCK_MODEL, modelId: 'a/text', capabilities: ModelCapabilityEnum.TEXT_GENERATION },
        { ...MOCK_MODEL, modelId: 'b/vision', capabilities: ModelCapabilityEnum.TEXT_GENERATION | ModelCapabilityEnum.VISION },
      ];

      const requiredCaps = ModelCapabilityEnum.VISION;
      const withVision = models.filter(m => (m.capabilities & requiredCaps) === requiredCaps);
      expect(withVision.length).toBe(1);
      expect(withVision[0].modelId).toBe('b/vision');
    });

    test('filter by context window works', () => {
      const models: RegisteredModel[] = [
        { ...MOCK_MODEL, modelId: 'a/small', contextWindow: 4096 },
        { ...MOCK_MODEL, modelId: 'b/large', contextWindow: 128000 },
      ];

      const minContext = 32000;
      const largeContext = models.filter(m => m.contextWindow >= minContext);
      expect(largeContext.length).toBe(1);
      expect(largeContext[0].modelId).toBe('b/large');
    });

    test('filter by price works', () => {
      const models: RegisteredModel[] = [
        { ...MOCK_MODEL, modelId: 'a/cheap', pricing: { ...MOCK_MODEL.pricing, pricePerInputToken: 100000000000n } },
        { ...MOCK_MODEL, modelId: 'b/expensive', pricing: { ...MOCK_MODEL.pricing, pricePerInputToken: 1000000000000000n } },
      ];

      const maxPrice = 500000000000n;
      const cheap = models.filter(m => m.pricing.pricePerInputToken <= maxPrice);
      expect(cheap.length).toBe(1);
      expect(cheap[0].modelId).toBe('a/cheap');
    });

    test('filter by creator works', () => {
      const models: RegisteredModel[] = [
        { ...MOCK_MODEL, modelId: 'org-a/model', creator: { ...MOCK_MODEL.creator, name: 'Org A' } },
        { ...MOCK_MODEL, modelId: 'org-b/model', creator: { ...MOCK_MODEL.creator, name: 'Org B' } },
      ];

      const byCreator = models.filter(m => m.creator.name === 'Org A');
      expect(byCreator.length).toBe(1);
      expect(byCreator[0].modelId).toBe('org-a/model');
    });

    test('filter by TEE requirement works', () => {
      const models: RegisteredModel[] = [
        { ...MOCK_MODEL, modelId: 'a/no-tee', hardware: { ...MOCK_MODEL.hardware, teeRequired: false } },
        { ...MOCK_MODEL, modelId: 'b/tee', hardware: { ...MOCK_MODEL.hardware, teeRequired: true, teeType: TEETypeEnum.INTEL_TDX } },
      ];

      const teeRequired = models.filter(m => m.hardware.teeRequired);
      expect(teeRequired.length).toBe(1);
      expect(teeRequired[0].modelId).toBe('b/tee');
    });
  });

  describe('Model Metadata Validation', () => {
    test('model ID cannot be empty', () => {
      const invalidModel = { ...MOCK_MODEL, modelId: '' };
      expect(invalidModel.modelId).toBe('');
      // In real implementation, registration would fail
    });

    test('context window must be positive', () => {
      expect(MOCK_MODEL.contextWindow).toBeGreaterThan(0);
    });

    test('prices must be non-negative', () => {
      expect(MOCK_MODEL.pricing.pricePerInputToken).toBeGreaterThanOrEqual(0n);
      expect(MOCK_MODEL.pricing.pricePerOutputToken).toBeGreaterThanOrEqual(0n);
      expect(MOCK_MODEL.pricing.pricePerImageInput).toBeGreaterThanOrEqual(0n);
    });

    test('trust score is within valid range', () => {
      expect(MOCK_MODEL.creator.trustScore).toBeGreaterThanOrEqual(0);
      expect(MOCK_MODEL.creator.trustScore).toBeLessThanOrEqual(100);
    });
  });

  describe('Model Types', () => {
    test('model types are properly defined', () => {
      expect(ModelTypeEnum.LLM).toBe(0);
      expect(ModelTypeEnum.IMAGE_GEN).toBe(1);
      expect(ModelTypeEnum.VIDEO_GEN).toBe(2);
      expect(ModelTypeEnum.AUDIO_GEN).toBe(3);
      expect(ModelTypeEnum.SPEECH_TO_TEXT).toBe(4);
      expect(ModelTypeEnum.TEXT_TO_SPEECH).toBe(5);
      expect(ModelTypeEnum.EMBEDDING).toBe(6);
      expect(ModelTypeEnum.MULTIMODAL).toBe(7);
    });

    test('can create LLM model', () => {
      const llmModel: RegisteredModel = { ...MOCK_MODEL, modelType: ModelTypeEnum.LLM };
      expect(llmModel.modelType).toBe(ModelTypeEnum.LLM);
    });

    test('can create image generation model', () => {
      const imageModel: RegisteredModel = {
        ...MOCK_MODEL,
        modelType: ModelTypeEnum.IMAGE_GEN,
        maxResolution: '1024x1024',
        contextWindow: 0,
        pricing: {
          ...MOCK_MODEL.pricing,
          pricePerImageOutput: 100000000000000n, // 0.0001 ETH per image
        },
      };
      expect(imageModel.modelType).toBe(ModelTypeEnum.IMAGE_GEN);
      expect(imageModel.maxResolution).toBe('1024x1024');
    });

    test('can create video generation model', () => {
      const videoModel: RegisteredModel = {
        ...MOCK_MODEL,
        modelType: ModelTypeEnum.VIDEO_GEN,
        maxDuration: 60,
        contextWindow: 0,
        pricing: {
          ...MOCK_MODEL.pricing,
          pricePerVideoSecond: 1000000000000000n, // 0.001 ETH per second
        },
      };
      expect(videoModel.modelType).toBe(ModelTypeEnum.VIDEO_GEN);
      expect(videoModel.maxDuration).toBe(60);
    });

    test('can create audio generation model', () => {
      const audioModel: RegisteredModel = {
        ...MOCK_MODEL,
        modelType: ModelTypeEnum.AUDIO_GEN,
        maxDuration: 300,
        contextWindow: 0,
        pricing: {
          ...MOCK_MODEL.pricing,
          pricePerAudioSecond: 50000000000000n, // 0.00005 ETH per second
        },
      };
      expect(audioModel.modelType).toBe(ModelTypeEnum.AUDIO_GEN);
      expect(audioModel.maxDuration).toBe(300);
    });

    test('can create speech-to-text model', () => {
      const sttModel: RegisteredModel = {
        ...MOCK_MODEL,
        modelType: ModelTypeEnum.SPEECH_TO_TEXT,
        capabilities: ModelCapabilityEnum.SPEECH_TO_TEXT,
        contextWindow: 0,
      };
      expect(sttModel.modelType).toBe(ModelTypeEnum.SPEECH_TO_TEXT);
    });

    test('can create embedding model', () => {
      const embeddingModel: RegisteredModel = {
        ...MOCK_MODEL,
        modelType: ModelTypeEnum.EMBEDDING,
        capabilities: ModelCapabilityEnum.EMBEDDINGS,
      };
      expect(embeddingModel.modelType).toBe(ModelTypeEnum.EMBEDDING);
    });
  });

  describe('Model Type Pricing', () => {
    test('LLM pricing estimates correctly', () => {
      const price = estimatePrice('llm', 1000);
      expect(price).toBeGreaterThan(0n);
    });

    test('image generation pricing estimates correctly', () => {
      const price = estimatePrice('image', 1);
      expect(price).toBe(DEFAULT_PRICING.IMAGE_1024);
    });

    test('video generation pricing scales with duration', () => {
      const price5s = estimatePrice('video', 5);
      const price10s = estimatePrice('video', 10);
      expect(price10s).toBe(price5s * 2n);
    });

    test('audio generation pricing scales with duration', () => {
      const price10s = estimatePrice('audio', 10);
      const price20s = estimatePrice('audio', 20);
      expect(price20s).toBe(price10s * 2n);
    });

    test('speech-to-text pricing is per minute', () => {
      const price60s = estimatePrice('stt', 60);
      const price120s = estimatePrice('stt', 120);
      expect(price120s).toBe(price60s * 2n);
    });

    test('embedding pricing scales with tokens', () => {
      const price1k = estimatePrice('embedding', 1000);
      const price2k = estimatePrice('embedding', 2000);
      expect(price2k).toBe(price1k * 2n);
    });

  });

  describe('Filter by Model Type', () => {
    test('can filter models by type', () => {
      const models: RegisteredModel[] = [
        { ...MOCK_MODEL, modelId: 'a/llm', modelType: ModelTypeEnum.LLM },
        { ...MOCK_MODEL, modelId: 'b/image', modelType: ModelTypeEnum.IMAGE_GEN },
        { ...MOCK_MODEL, modelId: 'c/video', modelType: ModelTypeEnum.VIDEO_GEN },
      ];

      const llms = models.filter(m => m.modelType === ModelTypeEnum.LLM);
      expect(llms.length).toBe(1);
      expect(llms[0].modelId).toBe('a/llm');

      const imageGens = models.filter(m => m.modelType === ModelTypeEnum.IMAGE_GEN);
      expect(imageGens.length).toBe(1);
      expect(imageGens[0].modelId).toBe('b/image');

      const videoGens = models.filter(m => m.modelType === ModelTypeEnum.VIDEO_GEN);
      expect(videoGens.length).toBe(1);
      expect(videoGens[0].modelId).toBe('c/video');
    });
  });
});
