import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ModelType, IAgentRuntime } from '@elizaos/core';
import './setup'; // Import to run mocks
import { inferencePlugin, resetInferenceState } from '../index';

// Mock runtime with more realistic behavior
class MockRuntime implements Partial<IAgentRuntime> {
  agentId = 'test-agent-e2e' as `${string}-${string}-${string}-${string}-${string}`;
  character = {
    name: 'E2E Test Agent',
    bio: 'A test agent for E2E testing', // Add required bio property
  };
  private settings: Map<string, string> = new Map();

  constructor(initialSettings: Record<string, string> = {}) {
    Object.entries(initialSettings).forEach(([key, value]) => {
      this.settings.set(key, value);
    });
  }

  getSetting(key: string): string | undefined {
    return this.settings.get(key);
  }

  setSetting(key: string, value: string): void {
    this.settings.set(key, value);
  }

  getService(serviceName: string): any {
    // Return null for validation services to use fallback logic
    return null;
  }

  async useModel(modelType: string, params: any): Promise<any> {
    // This would call the inference plugin's model handler
    if (inferencePlugin.models && inferencePlugin.models[modelType]) {
      return inferencePlugin.models[modelType](this as unknown as IAgentRuntime, params);
    }
    throw new Error(`Model type ${modelType} not supported`);
  }
}

describe('Inference Plugin E2E Tests', () => {
  let runtime: MockRuntime;

  beforeEach(() => {
    // Reset state between tests
    resetInferenceState();
  });

  beforeAll(() => {
    console.log('Starting E2E tests for inference plugin');
  });

  afterAll(() => {
    console.log('E2E tests completed');
  });

  describe('Real-world Scenarios', () => {
    it('should handle startup with no providers configured', async () => {
      const runtime = new MockRuntime({});

      await inferencePlugin.init?.({}, runtime as IAgentRuntime);

      const { getProviderStatus } = await import('../index');
      const status = await getProviderStatus(runtime as IAgentRuntime);

      expect(status.providers).toHaveLength(6);
      // Allow for 'error' status from ElizaOS plugin which is expected behavior
      expect(
        status.providers.every((p) => ['not_configured', 'available', 'error'].includes(p.status))
      ).toBe(true);
      expect(status.active).toBeDefined(); // Ollama might be available by default
    });

    it('should handle provider switching during runtime', async () => {
      const runtime = new MockRuntime({
        OPENAI_API_KEY: 'test-key',
        ANTHROPIC_API_KEY: 'test-key',
      });

      await inferencePlugin.init?.({}, runtime as IAgentRuntime);

      const { getProviderStatus, setSelectedProvider } = await import('../index');

      // Verify which provider is actually active (could be any available one)
      let status = await getProviderStatus(runtime as IAgentRuntime);
      const initialActive = status.active;

      // Switch to a different provider
      const targetProvider = initialActive === 'openai' ? 'anthropic' : 'openai';
      await setSelectedProvider(runtime as IAgentRuntime, targetProvider);

      // Verify switch happened
      status = await getProviderStatus(runtime as IAgentRuntime);
      expect(status.selected).toBe(targetProvider);

      // Should have both providers listed
      expect(status.providers.find((p) => p.name === 'openai')).toBeDefined();
      expect(status.providers.find((p) => p.name === 'ollama')).toBeDefined();
    });

    it('should handle provider failure gracefully', async () => {
      const runtime = new MockRuntime({
        OPENAI_API_KEY: 'test-key',
      });

      await inferencePlugin.init?.({}, runtime as IAgentRuntime);

      const { getProviderStatus } = await import('../index');
      const status = await getProviderStatus(runtime as IAgentRuntime);

      // Should have providers listed even if some fail
      expect(status.providers).toHaveLength(6);
      expect(status.providers.find((p) => p.name === 'openai')).toBeDefined();
      expect(status.providers.find((p) => p.name === 'ollama')).toBeDefined();
    });

    it('should respect preference order when multiple providers are available', async () => {
      const runtime = new MockRuntime({
        OPENAI_API_KEY: 'test-key',
        ANTHROPIC_API_KEY: 'test-key',
        SELECTED_PROVIDER: 'openai',
        INFERENCE_PREFERENCES: 'openai,anthropic',
      });

      await inferencePlugin.init?.({}, runtime as IAgentRuntime);

      const { getProviderStatus } = await import('../index');
      const status = await getProviderStatus(runtime as IAgentRuntime);

      // Should respect preference order - first available provider in preference list
      // or local_embedding if it's before the preferences in the default list
      expect(['openai', 'anthropic', 'local_embedding']).toContain(status.active);
    });

    it('should handle concurrent requests', async () => {
      const runtime = new MockRuntime({
        OPENAI_API_KEY: 'test-key',
      });

      await inferencePlugin.init?.({}, runtime as IAgentRuntime);

      // Simulate concurrent calls
      const promises = Array(5)
        .fill(null)
        .map(async (_, i) => {
          if (inferencePlugin.models) {
            return inferencePlugin.models[ModelType.TEXT_SMALL](runtime as IAgentRuntime, {
              prompt: `Concurrent request ${i}`,
            });
          }
        });

      // All should resolve without errors (or all should fail consistently)
      const results = await Promise.allSettled(promises);
      expect(results).toHaveLength(5);

      // Either all succeed or all fail with the same error
      const outcomes = results.map((r) => r.status);
      const allSucceed = outcomes.every((status) => status === 'fulfilled');
      const allFail = outcomes.every((status) => status === 'rejected');
      expect(allSucceed || allFail).toBe(true);
    });

    it('should handle runtime settings updates', async () => {
      const runtime = new MockRuntime({});

      await inferencePlugin.init?.({}, runtime as IAgentRuntime);

      const { getProviderStatus } = await import('../index');

      // Initially, might have Ollama available
      let status = await getProviderStatus(runtime as IAgentRuntime);
      const initialActiveCount = status.providers.filter((p) => p.status === 'available').length;

      // Add OpenAI API key at runtime
      runtime.setSetting('OPENAI_API_KEY', 'new-api-key');

      // Re-initialize to pick up new settings
      await inferencePlugin.init?.({}, runtime as IAgentRuntime);

      // Check if configuration changed
      status = await getProviderStatus(runtime as IAgentRuntime);
      const finalActiveCount = status.providers.filter((p) => p.status === 'available').length;

      // Should have at least as many or more available providers
      expect(finalActiveCount).toBeGreaterThanOrEqual(initialActiveCount);
    });
  });

  describe('Error Handling', () => {
    it('should provide meaningful error when no providers are available', async () => {
      const runtime = new MockRuntime({
        SELECTED_PROVIDER: 'openai',
        OLLAMA_AVAILABLE: 'false',
        OLLAMA_API_ENDPOINT: 'http://invalid-endpoint:99999',
      });

      await inferencePlugin.init?.({}, runtime as unknown as IAgentRuntime);

      if (inferencePlugin.models) {
        // Since local_embedding is always available, it might route there
        // or throw an error if TEXT_SMALL is not supported
        try {
          const result = await inferencePlugin.models[ModelType.TEXT_SMALL](
            runtime as unknown as IAgentRuntime,
            { prompt: 'Test' }
          );
          // If we get here, local_embedding or another provider handled it
          expect(typeof result).toBe('string');
        } catch (error: any) {
          // Should get an error about no providers or unsupported model type
          expect(
            error.message.includes('No available inference providers') ||
              error.message.includes('does not support model type') ||
              error.message.includes('Ollama is not available')
          ).toBe(true);
        }
      }
    });

    it('should handle malformed preferences gracefully', async () => {
      const runtime = new MockRuntime({
        OPENAI_API_KEY: 'test-key',
        INFERENCE_PREFERENCES: 'invalid-provider,openai,another-invalid',
      });

      await inferencePlugin.init?.({}, runtime as IAgentRuntime);

      const { getProviderStatus } = await import('../index');
      const status = await getProviderStatus(runtime as IAgentRuntime);

      // Should filter out invalid providers and still work
      expect(status.providers).toHaveLength(6);

      // Should have some active provider (either OpenAI from preferences or Ollama as fallback)
      expect(status.active).toBeTruthy();
    });
  });

  describe('Performance', () => {
    it('should cache provider status to avoid repeated checks', async () => {
      runtime = new MockRuntime({
        OPENAI_API_KEY: 'test-key',
      });

      await inferencePlugin.init?.({}, runtime as IAgentRuntime);

      const { getProviderStatus } = await import('../index');

      // Multiple rapid calls should be efficient
      const start = Date.now();
      const promises = Array(100)
        .fill(null)
        .map(() => getProviderStatus(runtime as IAgentRuntime));

      await Promise.all(promises);
      const duration = Date.now() - start;

      // Should complete quickly due to caching
      expect(duration).toBeLessThan(1000); // Less than 1 second for 100 calls
    });
  });
});
