/**
 * Comprehensive tests for ElizaOS Services plugin
 * These tests cover functionality without requiring external APIs or full runtime
 */

import { describe, test, expect, mock } from 'bun:test';
import { elizaOSServicesPlugin, ElizaOSService } from '../index.js';
import { ModelType, IAgentRuntime, createMockRuntime } from '@elizaos/core';

describe('ElizaOS Services Plugin - Comprehensive Tests', () => {
  describe('Plugin Structure', () => {
    test('plugin has correct metadata', () => {
      expect(elizaOSServicesPlugin.name).toBe('elizaos-services');
      expect(elizaOSServicesPlugin.description).toContain('ElizaOS hosted services');
      expect(elizaOSServicesPlugin.models).toBeDefined();
      expect(elizaOSServicesPlugin.services).toBeDefined();
      expect(elizaOSServicesPlugin.init).toBeDefined();
    });

    test('plugin exports all required model types', () => {
      const models = elizaOSServicesPlugin.models!;
      expect(models[ModelType.TEXT_SMALL]).toBeDefined();
      expect(models[ModelType.TEXT_LARGE]).toBeDefined();
      expect(models[ModelType.TEXT_EMBEDDING]).toBeDefined();
      expect(models[ModelType.IMAGE_DESCRIPTION]).toBeDefined();
      expect(models[ModelType.OBJECT_SMALL]).toBeDefined();
      expect(models[ModelType.OBJECT_LARGE]).toBeDefined();
    });

    test('plugin includes ElizaOSService', () => {
      expect(elizaOSServicesPlugin.services).toContain(ElizaOSService);
    });
  });

  describe('Plugin Configuration', () => {
    test('plugin initialization with valid config', async () => {
      const mockRuntime = createMockRuntime({
        getSetting: (key: string) => {
          if (key === 'OPENAI_API_KEY') return 'test-openai-key';
          if (key === 'ELIZAOS_API_URL') return 'https://api.elizaos.ai';
          if (key === 'ELIZAOS_API_KEY') return 'test-key-123';
          return undefined;
        },
      });
      const config = {
        ELIZAOS_API_URL: 'https://api.elizaos.ai',
        ELIZAOS_API_KEY: 'test-key-123',
      };

      // Should not throw - using type-safe runtime
      await expect(
        elizaOSServicesPlugin.init!(config, mockRuntime as IAgentRuntime)
      ).resolves.toBeUndefined();
    });

    test('plugin initialization with minimal config', async () => {
      const mockRuntime = createMockRuntime({
        getSetting: (key: string) => {
          if (key === 'OPENAI_API_KEY') return 'test-openai-key';
          return undefined;
        },
      });
      const config = {};

      // Should not throw even with empty config - using type-safe runtime
      await expect(
        elizaOSServicesPlugin.init!(config, mockRuntime as IAgentRuntime)
      ).resolves.toBeUndefined();
    });
  });

  describe('Service Management', () => {
    test('ElizaOSService can be started', async () => {
      const mockRuntime = createMockRuntime();
      const service = await ElizaOSService.start(mockRuntime as IAgentRuntime);

      expect(service).toBeInstanceOf(ElizaOSService);
      expect(service.capabilityDescription).toContain('multi-provider support');
    });

    test('ElizaOSService can be stopped', async () => {
      const mockService = { stop: mock(() => Promise.resolve()) };
      const mockRuntime = createMockRuntime({
        getService: <T extends any>() => mockService as T,
      });

      // Should not throw - using type-safe runtime
      await expect(ElizaOSService.stop(mockRuntime as IAgentRuntime)).resolves.toBeUndefined();
      expect(mockService.stop).toHaveBeenCalled();
    });

    test('stopping non-existent service throws error', async () => {
      const mockRuntime = createMockRuntime({
        getService: <T extends any>() => null as T | null,
      });

      // Should throw error when service not found - using type-safe runtime
      await expect(ElizaOSService.stop(mockRuntime as IAgentRuntime)).rejects.toThrow(
        'ElizaOS service not found'
      );
    });
  });

  describe('Model Function Structure', () => {
    test('TEXT_SMALL model is properly defined', () => {
      const textSmallModel = elizaOSServicesPlugin.models![ModelType.TEXT_SMALL];
      expect(typeof textSmallModel).toBe('function');
      expect(textSmallModel.length).toBe(2); // runtime, params
    });

    test('TEXT_LARGE model is properly defined', () => {
      const textLargeModel = elizaOSServicesPlugin.models![ModelType.TEXT_LARGE];
      expect(typeof textLargeModel).toBe('function');
      expect(textLargeModel.length).toBe(2); // runtime, params
    });

    test('TEXT_EMBEDDING model is properly defined', () => {
      const embeddingModel = elizaOSServicesPlugin.models![ModelType.TEXT_EMBEDDING];
      expect(typeof embeddingModel).toBe('function');
      expect(embeddingModel.length).toBe(2); // runtime, params
    });

    test('IMAGE_DESCRIPTION model is properly defined', () => {
      const imageModel = elizaOSServicesPlugin.models![ModelType.IMAGE_DESCRIPTION];
      expect(typeof imageModel).toBe('function');
      expect(imageModel.length).toBe(2); // runtime, params
    });

    test('OBJECT_SMALL model is properly defined', () => {
      const objectSmallModel = elizaOSServicesPlugin.models![ModelType.OBJECT_SMALL];
      expect(typeof objectSmallModel).toBe('function');
      expect(objectSmallModel.length).toBe(2); // runtime, params
    });

    test('OBJECT_LARGE model is properly defined', () => {
      const objectLargeModel = elizaOSServicesPlugin.models![ModelType.OBJECT_LARGE];
      expect(typeof objectLargeModel).toBe('function');
      expect(objectLargeModel.length).toBe(2); // runtime, params
    });
  });

  describe('Error Handling', () => {
    test('models handle missing API keys gracefully', async () => {
      const mockRuntime = createMockRuntime();
      const textModel = elizaOSServicesPlugin.models![ModelType.TEXT_SMALL];

      await expect(textModel(mockRuntime as IAgentRuntime, { prompt: 'test' })).rejects.toThrow();
    });

    test('embedding model handles missing API keys gracefully', async () => {
      const mockRuntime = createMockRuntime();
      const embeddingModel = elizaOSServicesPlugin.models![ModelType.TEXT_EMBEDDING];

      // Should throw an error when no API provider is available - using type-safe runtime
      await expect(
        embeddingModel(mockRuntime as IAgentRuntime, { text: 'test' })
      ).rejects.toThrow();
    });
  });

  describe('Provider Utils', () => {
    test('ElizaOS provider utilities are exported', async () => {
      const { makeElizaOSRequest, getModelForType, checkElizaOSAPI } = await import(
        '../providers/elizaos-provider.js'
      );

      expect(typeof makeElizaOSRequest).toBe('function');
      expect(typeof getModelForType).toBe('function');
      expect(typeof checkElizaOSAPI).toBe('function');
    });

    test('getModelForType returns correct models', async () => {
      const { getModelForType } = await import('../providers/elizaos-provider.js');

      expect(getModelForType('TEXT_SMALL')).toBe('gpt-4o-mini');
      expect(getModelForType('TEXT_LARGE')).toBe('gpt-4o');
      expect(getModelForType('IMAGE_DESCRIPTION')).toBe('gpt-4o');
      expect(getModelForType('EMBEDDING')).toBe('text-embedding-3-small');
    });
  });

  describe('Test Suites', () => {
    test('test suites are properly exported', () => {
      expect(elizaOSServicesPlugin.tests).toBeDefined();
      expect(Array.isArray(elizaOSServicesPlugin.tests)).toBe(true);
      expect(elizaOSServicesPlugin.tests?.length).toBeGreaterThan(0);
    });

    test('test suites contain expected test structures', () => {
      const testSuites = elizaOSServicesPlugin.tests!;

      // Each test suite should have a name and tests
      testSuites.forEach((testSuite) => {
        expect(testSuite).toHaveProperty('name');
        expect(testSuite).toHaveProperty('tests');
        expect(typeof testSuite.name).toBe('string');
        expect(Array.isArray(testSuite.tests)).toBe(true);

        // Each test in the suite should have name and fn
        testSuite.tests.forEach((test) => {
          expect(test).toHaveProperty('name');
          expect(test).toHaveProperty('fn');
          expect(typeof test.name).toBe('string');
          expect(typeof test.fn).toBe('function');
        });
      });
    });
  });
});
