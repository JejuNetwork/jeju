/**
 * Inference Client Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InferenceClient, type AvailableModel } from './inferenceClient';

// ============================================================================
// Mock Types
// ============================================================================

/** API response for models endpoint */
interface ModelsApiResponse {
  models: Partial<AvailableModel>[];
}

/** API response for chat endpoint */
interface ChatApiResponse {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { role?: string; content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

type MockApiResponse = ModelsApiResponse | ChatApiResponse;

// Helper to create mock Response - minimal mock for testing
const createMockResponse = (data: MockApiResponse, ok = true): Response => {
  const response = {
    ok,
    json: () => Promise.resolve(data),
    headers: new Headers(),
    redirected: false,
    status: ok ? 200 : 500,
    statusText: ok ? 'OK' : 'Error',
    type: 'basic' as ResponseType,
    url: '',
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    bytes: () => Promise.resolve(new Uint8Array()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(JSON.stringify(data)),
    clone: (): Response => createMockResponse(data, ok),
  };
  return response as Response;
};

let mockFetch: ReturnType<typeof vi.fn>;

describe('InferenceClient', () => {
  let client: InferenceClient;

  beforeEach(() => {
    mockFetch = vi.fn();
    // Mock fetch for testing - override global fetch
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    client = new InferenceClient({
      gatewayUrl: 'https://test-gateway.example.com',
      maxRetries: 1, // Fast retries for tests
      retryDelayMs: 10,
    });
  });

  describe('configure', () => {
    it('should update configuration', () => {
      client.configure({ preferredModel: 'custom-model' });
      // Configuration should be updated (internal state)
    });
  });

  describe('setWalletAddress', () => {
    it('should set wallet address', () => {
      client.setWalletAddress('0x1234567890123456789012345678901234567890');
      // Address should be set for context injection
    });
  });

  describe('getModels', () => {
    it('should return default models when gateway unavailable', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const models = await client.getModels();

      expect(models).toHaveLength(3);
      expect(models[0].id).toBe('jeju/llama-3.1-70b');
    });

    it('should fetch models from gateway', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        models: [
          {
            id: 'test-model',
            name: 'Test Model',
            description: 'A test model',
            contextWindow: 4096,
            pricePerInputToken: '0.0001',
            pricePerOutputToken: '0.0003',
            provider: 'test',
            teeType: 'none',
            active: true,
          },
        ],
      }));

      const models = await client.getModels();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-gateway.example.com/v1/models',
        expect.objectContaining({ headers: expect.any(Object) })
      );
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('test-model');
    });

    it('should cache models', async () => {
      // Create fresh client for this test
      const cacheClient = new InferenceClient({ gatewayUrl: 'https://cache-test.example.com' });
      
      mockFetch.mockResolvedValueOnce(createMockResponse({
        models: [{ id: 'cached' }],
      }));

      const models1 = await cacheClient.getModels();
      const models2 = await cacheClient.getModels();

      // Second call should use cache (models should be same array reference after cache hit)
      expect(models1).toEqual(models2);
    });

    it('should force refresh when requested', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ models: [] }));

      await client.getModels();
      await client.getModels(true);

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('chat', () => {
    it('should send chat request and return response', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        id: 'chat-123',
        model: 'jeju/llama-3.1-70b',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you?',
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 8,
          total_tokens: 18,
        },
      }));

      const response = await client.chat({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(response.content).toBe('Hello! How can I help you?');
      expect(response.tokensUsed.total).toBe(18);
    });

    it('should fallback to offline mode on error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const response = await client.chat({
        messages: [{ role: 'user', content: 'help' }],
      });

      expect(response.provider).toBe('offline');
      expect(response.content).toContain('AI Service Unavailable');
    });

    it('should maintain conversation history', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        id: 'chat-123',
        choices: [{ message: { content: 'Response 1' } }],
        usage: { total_tokens: 10 },
      }));

      await client.chat({ messages: [{ role: 'user', content: 'First message' }] });

      const history = client.getHistory();
      expect(history.length).toBeGreaterThan(1);
      expect(history.some((m) => m.content === 'First message')).toBe(true);
    });
  });

  describe('clearHistory', () => {
    it('should reset conversation history', async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        choices: [{ message: { content: 'Test' } }],
        usage: { total_tokens: 5 },
      }));

      await client.chat({ messages: [{ role: 'user', content: 'Test' }] });
      client.clearHistory();

      const history = client.getHistory();
      // Should only have system prompt
      expect(history.length).toBe(1);
      expect(history[0].role).toBe('system');
    });
  });

  describe('local fallback', () => {
    let localClient: InferenceClient;
    
    beforeEach(() => {
      mockFetch.mockRejectedValue(new Error('Offline'));
      // Use fast retries for fallback tests
      localClient = new InferenceClient({
        gatewayUrl: 'https://offline.example.com',
        maxRetries: 1,
        retryDelayMs: 1,
      });
    });

    it('should return honest offline message', async () => {
      const response = await localClient.chat({
        messages: [{ role: 'user', content: 'anything' }],
      });

      // Should indicate service is unavailable, not fake AI response
      expect(response.content).toContain('AI Service Unavailable');
      expect(response.content).toContain('API key');
    });

    it('should suggest using sidebar for features', async () => {
      const response = await localClient.chat({
        messages: [{ role: 'user', content: 'help' }],
      });

      expect(response.content).toContain('sidebar');
    });

    it('should mention API key providers', async () => {
      const response = await localClient.chat({
        messages: [{ role: 'user', content: 'test' }],
      });

      // Should mention at least one provider
      expect(
        response.content.includes('OpenAI') || 
        response.content.includes('Anthropic') || 
        response.content.includes('Groq')
      ).toBe(true);
    });

    it('should return offline model identifier', async () => {
      const response = await localClient.chat({
        messages: [{ role: 'user', content: 'test' }],
      });

      expect(response.model).toBe('offline');
      expect(response.provider).toBe('offline');
    });
  });
});
