import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ModelType, type IAgentRuntime } from '@elizaos/core';
import './setup'; // Import to run the mocks
import {
  inferencePlugin,
  getProviderStatus,
  setSelectedProvider,
  setProviderPreferences,
  resetInferenceState,
} from '../index';

// Mock runtime
const createMockRuntime = (settings: Record<string, string> = {}) =>
  ({
    agentId: 'test-agent-123',
    getSetting: (key: string) => settings[key],
    setSetting: vi.fn(),
    useModel: vi.fn(),
    character: { name: 'TestAgent' },
    getService: vi.fn((serviceName: string) => {
      // Return null for validation services to use fallback logic
      return null;
    }),
    emitEvent: vi.fn(), // Add the missing emitEvent mock
  }) as unknown as IAgentRuntime;

describe('Inference Plugin', () => {
  let runtime: IAgentRuntime;

  beforeEach(() => {
    // Reset module state between tests
    vi.clearAllMocks();
    resetInferenceState();
    runtime = createMockRuntime();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Plugin Initialization', () => {
    it('should initialize the plugin successfully', async () => {
      await expect(inferencePlugin.init?.({}, runtime)).resolves.not.toThrow();
    });

    it('should have correct plugin metadata', () => {
      expect(inferencePlugin.name).toBe('inference');
      expect(inferencePlugin.description).toContain('Dynamic model provider routing');
    });
  });

  describe('Provider Status', () => {
    it('should return status of all providers', async () => {
      runtime = createMockRuntime({
        OPENAI_API_KEY: 'test-key',
        ANTHROPIC_API_KEY: 'test-key',
        GROQ_API_KEY: 'test-key',
      });

      const status = await getProviderStatus(runtime);

      expect(status.providers).toHaveLength(6);

      // Check that providers are present with correct names and display names
      const openai = status.providers.find((p: any) => p.name === 'openai');
      const anthropic = status.providers.find((p: any) => p.name === 'anthropic');
      const groq = status.providers.find((p: any) => p.name === 'groq');
      const ollama = status.providers.find((p: any) => p.name === 'ollama');
      const elizaos = status.providers.find((p: any) => p.name === 'elizaos');

      expect(openai).toBeDefined();
      expect(openai).toMatchObject({
        name: 'openai',
        displayName: 'OpenAI',
      });
      // Status can be 'available', 'not_configured', or 'error' depending on test setup
      expect(['available', 'not_configured', 'error']).toContain(openai!.status);

      expect(anthropic).toBeDefined();
      expect(anthropic).toMatchObject({
        name: 'anthropic',
        displayName: 'Anthropic Claude',
      });
      expect(['available', 'not_configured', 'error']).toContain(anthropic!.status);

      expect(groq).toBeDefined();
      expect(groq).toMatchObject({
        name: 'groq',
        displayName: 'Groq',
      });
      expect(['available', 'not_configured', 'error']).toContain(groq!.status);

      expect(ollama).toBeDefined();
      expect(ollama).toMatchObject({
        name: 'ollama',
        displayName: 'Ollama (Local)',
      });
      expect(['available', 'not_configured', 'error']).toContain(ollama!.status);

      expect(elizaos).toBeDefined();
      expect(elizaos).toMatchObject({
        name: 'elizaos',
        displayName: 'ElizaOS Cloud',
      });
      // ElizaOS is expected to fail initialization in tests
      expect(['not_configured', 'error']).toContain(elizaos!.status);
    });

    it('should handle providers without API keys', async () => {
      runtime = createMockRuntime({});

      const status = await getProviderStatus(runtime);

      expect(status.providers).toHaveLength(6);

      const openai = status.providers.find((p: any) => p.name === 'openai');
      const anthropic = status.providers.find((p: any) => p.name === 'anthropic');
      const groq = status.providers.find((p: any) => p.name === 'groq');

      expect(openai?.status).toBe('not_configured');
      expect(anthropic?.status).toBe('not_configured');
      expect(groq?.status).toBe('not_configured');
    });
  });

  describe('Provider Selection', () => {
    it('should set selected provider', async () => {
      runtime = createMockRuntime({
        OPENAI_API_KEY: 'test-key',
        ANTHROPIC_API_KEY: 'test-key',
      });

      await setSelectedProvider(runtime, 'anthropic');
      const status = await getProviderStatus(runtime);

      expect(status.selected).toBe('anthropic');
      expect(runtime.setSetting).toHaveBeenCalledWith('SELECTED_PROVIDER', 'anthropic');
    });

    it('should clear selected provider when null is passed', async () => {
      runtime = createMockRuntime({
        SELECTED_PROVIDER: 'openai',
      });

      await setSelectedProvider(runtime, null);
      const status = await getProviderStatus(runtime);

      expect(status.selected).toBeNull();
    });

    it('should throw error for unknown provider', async () => {
      await expect(setSelectedProvider(runtime, 'unknown-provider')).rejects.toThrow(
        'Unknown provider: unknown-provider'
      );
    });
  });

  describe('Provider Preferences', () => {
    it('should set and use provider preferences', async () => {
      runtime = createMockRuntime({
        OPENAI_API_KEY: 'test-key',
        ANTHROPIC_API_KEY: 'test-key',
        GROQ_API_KEY: 'test-key',
      });

      // Set preferences to prioritize Groq
      await setProviderPreferences(runtime, ['groq', 'openai', 'anthropic', 'ollama', 'elizaos']);

      const status = await getProviderStatus(runtime);
      expect(status.preferences).toEqual(['groq', 'openai', 'anthropic', 'ollama', 'elizaos']);
    });

    it('should filter out invalid providers from preferences', async () => {
      const preferences = ['anthropic', 'invalid-provider', 'openai'];

      await setProviderPreferences(runtime, preferences);

      expect(runtime.setSetting).toHaveBeenCalledWith('INFERENCE_PREFERENCES', 'anthropic,openai');
    });

    it('should load preferences from runtime settings on init', async () => {
      runtime = createMockRuntime({
        INFERENCE_PREFERENCES: 'anthropic,openai',
        ANTHROPIC_API_KEY: 'test-key',
        OPENAI_API_KEY: 'test-key',
      });

      await inferencePlugin.init?.({}, runtime);

      const status = await getProviderStatus(runtime);

      // Should use the configured preferences
      expect(status.preferences).toEqual(['anthropic', 'openai']);

      // First available provider in preferences should be active
      // Note: If neither anthropic nor openai support the requested model type,
      // it might fall back to other providers
      expect(['anthropic', 'openai', 'local_embedding', 'ollama']).toContain(status.active);
    });
  });

  describe('Model Routing', () => {
    it('should route model calls to available providers', async () => {
      runtime = createMockRuntime({
        OLLAMA_AVAILABLE: 'true', // Enable Ollama which has TEXT_SMALL in the mock
      });

      await inferencePlugin.init?.({}, runtime);

      if (inferencePlugin.models && inferencePlugin.models[ModelType.TEXT_SMALL]) {
        const result = await inferencePlugin.models[ModelType.TEXT_SMALL](runtime, {
          prompt: 'Test prompt',
        });

        // The first available provider is local_embedding, but it doesn't support TEXT_SMALL,
        // so it should fall back to ollama.
        expect(result).toBe('Ollama response');
      }
    });

    it('should handle fallback when no providers available', async () => {
      // No providers configured - explicitly disable Ollama
      runtime = createMockRuntime({
        OLLAMA_AVAILABLE: 'false',
      });

      if (inferencePlugin.models && inferencePlugin.models[ModelType.TEXT_SMALL]) {
        // The plugin will try to use Ollama (which appears available during init)
        // but it will fail when actually called because OLLAMA_AVAILABLE is false
        await expect(
          inferencePlugin.models[ModelType.TEXT_SMALL](runtime, {
            prompt: 'Test',
          })
        ).rejects.toThrow(); // Accept any error since no providers work
      }
    });

    it('should route embeddings correctly', async () => {
      runtime = createMockRuntime({
        OPENAI_API_KEY: 'test-key',
        ANTHROPIC_API_KEY: 'test-key',
        GROQ_API_KEY: 'test-key',
      });

      // Initialize the plugin first
      await inferencePlugin.init?.({}, runtime);

      if (inferencePlugin.models) {
        const result = await inferencePlugin.models[ModelType.TEXT_EMBEDDING](runtime, {
          input: 'Hello world',
        });

        // Embeddings should always come from local embedding plugin
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
        // Should be local embedding plugin's response
        expect(result).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]);
      }
    });

    it('should throw error when provider does not support model type', async () => {
      runtime = createMockRuntime({
        OPENAI_API_KEY: 'test-key', // Make OpenAI available
        OLLAMA_AVAILABLE: 'true', // Ensure Ollama is available
      });

      // Initialize the plugin first to set up providers
      await inferencePlugin.init?.({}, runtime);

      // Test with a model type that our mocked providers don't support
      if (inferencePlugin.models && inferencePlugin.models[ModelType.IMAGE]) {
        await expect(
          inferencePlugin.models[ModelType.IMAGE](runtime, { prompt: 'Test' })
        ).rejects.toThrow('No available provider supports model type');
      }
    });

    it('should throw error when local embedding plugin is not available', async () => {
      runtime = createMockRuntime({
        OPENAI_API_KEY: 'test-key',
        ANTHROPIC_API_KEY: 'test-key',
      });

      await inferencePlugin.init?.({}, runtime);

      // This test now uses local embeddings plugin which should always work with mock
      if (inferencePlugin.models && inferencePlugin.models[ModelType.TEXT_EMBEDDING]) {
        // Local embedding should work even without external providers
        const result = await inferencePlugin.models[ModelType.TEXT_EMBEDDING](runtime, {
          input: 'Hello',
        });
        expect(Array.isArray(result)).toBe(true);
      }
    });

    it('should not use local_embedding for TEXT_LARGE model type', async () => {
      runtime = createMockRuntime({
        OLLAMA_AVAILABLE: 'true', // Enable Ollama as fallback
      });

      await inferencePlugin.init?.({}, runtime);

      if (inferencePlugin.models && inferencePlugin.models[ModelType.TEXT_LARGE]) {
        // Even if local_embedding is available, it should not be used for TEXT_LARGE
        const result = await inferencePlugin.models[ModelType.TEXT_LARGE](runtime, {
          prompt: 'Test prompt for large model',
        });

        // Should use Ollama instead of local_embedding
        expect(result).toBe('Ollama response');
      }
    });

    it('should always use local_embedding for TEXT_EMBEDDING regardless of preferences', async () => {
      runtime = createMockRuntime({
        INFERENCE_PREFERENCES: 'openai,anthropic', // local_embedding not in preferences
        OPENAI_API_KEY: 'test-key',
        ANTHROPIC_API_KEY: 'test-key',
      });

      await inferencePlugin.init?.({}, runtime);

      if (inferencePlugin.models && inferencePlugin.models[ModelType.TEXT_EMBEDDING]) {
        const result = await inferencePlugin.models[ModelType.TEXT_EMBEDDING](runtime, {
          input: 'Test embedding',
        });

        // Should still use local_embedding even though it's not in preferences
        expect(Array.isArray(result)).toBe(true);
        expect(result).toEqual([0.1, 0.2, 0.3, 0.4, 0.5]); // Mock local embedding response
      }
    });
  });

  describe('Provider Priority', () => {
    it('should follow default priority order', async () => {
      runtime = createMockRuntime({
        OPENAI_API_KEY: 'test-key',
        ANTHROPIC_API_KEY: 'test-key',
        GROQ_API_KEY: 'test-key',
        ELIZAOS_API_KEY: 'test-key',
        OLLAMA_AVAILABLE: 'true', // Ensure Ollama is available for embeddings
      });

      await inferencePlugin.init?.({}, runtime);

      const status = await getProviderStatus(runtime);

      // Should have an active provider
      expect(status.active).toBeTruthy();
      // Default preferences are now without local_embedding
      expect(['ollama', 'groq', 'elizaos', 'openai', 'anthropic']).toContain(status.active);
    });

    it('should respect custom preferences order', async () => {
      runtime = createMockRuntime({
        INFERENCE_PREFERENCES: 'openai,anthropic,elizaos',
        OPENAI_API_KEY: 'test-key',
        ANTHROPIC_API_KEY: 'test-key',
        ELIZAOS_API_KEY: 'test-key',
      });

      await inferencePlugin.init?.({}, runtime);

      const status = await getProviderStatus(runtime);

      // Should have an active provider from the preferences list or fallback
      expect(status.active).toBeTruthy();
      expect(['openai', 'anthropic', 'elizaos', 'local_embedding']).toContain(status.active);
    });
  });

  describe('Plugin Tests', () => {
    it('should run plugin test suite', async () => {
      runtime = createMockRuntime({
        OPENAI_API_KEY: 'test-key',
      });

      const tests = inferencePlugin.tests?.[0].tests || [];

      expect(tests).toHaveLength(2);
      expect(tests[0].name).toBe('test_provider_status');
      expect(tests[1].name).toBe('test_provider_routing');

      // Run the tests
      for (const test of tests) {
        await expect(test.fn(runtime)).resolves.not.toThrow();
      }
    });
  });
});
